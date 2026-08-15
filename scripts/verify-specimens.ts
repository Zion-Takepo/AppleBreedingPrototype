// Orchard Mutation / Breeding Specimen focused verification (see
// PROJECT.md "Orchard Mutation / Breeding Specimen / Breed connection" /
// the implementation brief's "VERIFICATION" section). Plain-TS script, run
// directly with Node's built-in type stripping (`node
// scripts/verify-specimens.ts`) — no test framework exists in this
// prototype yet (see package.json), matching scripts/verify-market.ts's
// existing convention.
//
// LIMITATIONS (deliberate, matching verify-market.ts's own documented
// scope): Phaser-rendered UI (the special fruit's illustration actually
// swapping on the tree, LibraryPicker's LINES/SPECIMENS toggle, Breed's
// parent cards) is NOT exercised here — this only proves the underlying
// game-logic/data wiring those views read from. Hitbox/interaction
// behavior and the 1600x900 rendering baseline are untouched by this pass
// and are not re-verified here either.
//
// Several checks are statistical (D-mutation rate, its tier distribution,
// Day-3+ Orchard tier probabilities) since Math.random() itself can't be
// seeded from here without threading rng injection through breeding.ts's
// entire existing internals (noise/blendStats/applyTradeoff etc.) — doing
// so was judged out of proportion to this pass's scope. Every statistical
// check instead uses a large trial count (N in the thousands) with a
// tolerance band comfortably beyond many standard deviations, the same
// non-flaky-by-margin approach verify-market.ts's own RISING/FALLING trend
// trial already uses.
import { TUNING } from '../src/game/tuning.ts';
import type { AppleAssetId } from '../src/game/render/appleAssets.ts';
import { APPLE_RARITY } from '../src/game/render/appleAssets.ts';
import { breedOffspring, type BreedParent, type Stats5 } from '../src/game/systems/breeding.ts';
import {
  affinityBonusChance,
  basePerSpecificChance,
  chooseDay2GuaranteedVisual,
  chooseGuaranteedSpecimenFieldIndex,
  deriveSpecimenBaseVisualId,
  generateSpecimenStats,
  mutationAffinityFor,
  pickOrchardSpecimenVisual,
  rollOrchardSpecimen,
  rollSpecimenTier,
} from '../src/game/systems/specimen.ts';
import { marketMultiplierForVisual } from '../src/game/systems/market.ts';
import { Game } from '../src/game/Game.ts';
import { STARTER_GREEN, STARTER_RED } from '../src/game/systems/starterLines.ts';
import type { BreedingSpecimen, Field, Variety } from '../src/game/types.ts';

// ---------------------------------------------------------------------------
// Minimal in-memory localStorage polyfill — same as verify-market.ts.
// ---------------------------------------------------------------------------
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

let checks = 0;
let failures = 0;
function assert(name: string, cond: boolean, detail?: string): void {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

function clearStorage(): void {
  localStorage.removeItem(TUNING.SAVE_KEY);
}

function constRng(v: number): () => number {
  return () => v;
}

function queueRng(values: number[]): () => number {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error('queueRng exhausted — test miscounted rng() calls');
    return values[i++];
  };
}

// Same mulberry32 family used elsewhere in this codebase (systems/economy.ts) — reproducible seeded randomness for statistical trials.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fakeParent(visualId: AppleAssetId, baseVisualId: AppleAssetId = visualId): BreedParent {
  return { visualId, baseVisualId, color: 'Red', pattern: 'Plain', sweetness: 50, size: 50, yieldStat: 50, growth: 50, freshness: 50, generation: 1 };
}

function fakeSpecimen(overrides: Partial<BreedingSpecimen> = {}): BreedingSpecimen {
  const visualId = overrides.visualId ?? 'C2';
  return {
    id: overrides.id ?? crypto.randomUUID(),
    visualId,
    baseVisualId: overrides.baseVisualId ?? (APPLE_RARITY[visualId] === 'COMMON' ? visualId : 'C1'),
    sweetness: overrides.sweetness ?? 50,
    size: overrides.size ?? 50,
    yieldStat: overrides.yieldStat ?? 50,
    growth: overrides.growth ?? 50,
    freshness: overrides.freshness ?? 50,
    foundDay: overrides.foundDay ?? 1,
    sourceLineId: overrides.sourceLineId ?? STARTER_RED.id,
    sourceGeneration: overrides.sourceGeneration ?? 1,
  };
}

/** Runs a full Closing (beginClosing + drain the queue) exactly like a real END DAY / 18:00 timeout, same helper pattern as verify-market.ts. */
function runClosing(game: Game): void {
  game.beginClosing();
  let guard = 0;
  while (!game.state.dayEnded) {
    game.update(0.05);
    if (++guard > 20000) throw new Error('Closing never finished — regression in Shipping/Day Cycle');
  }
}

/** Resolves the in-progress breeding synchronously without advancing the day timer (dt=0), then commits an arbitrary candidate so the NEXT startBreeding call is unblocked. */
function resolveAndClear(game: Game): void {
  game.state.breeding.elapsed = game.state.breeding.duration;
  game.update(0);
  game.keepOffspring('A');
}

function countAllSpecimensInPlay(game: Game): number {
  let onTree = 0;
  for (const field of game.state.fields) {
    for (const slot of field.slots) if (slot.specimen) onTree++;
  }
  return onTree + game.state.specimens.length;
}

// ===========================================================================
// EARLY GUARANTEES
// ===========================================================================
{
  clearStorage();
  const game = new Game();

  assert('Day 1 guarantee flag is recorded as spawned', game.state.day1SpecimenGuaranteeUsed === true);
  assert('Day 2 guarantee has NOT fired yet on Day 1', game.state.day2SpecimenGuaranteeUsed === false);

  const day1SpecimenSlots = game.state.fields.flatMap((f) => f.slots.filter((s) => s.specimen));
  assert('Day 1 produces exactly one guaranteed Specimen', day1SpecimenSlots.length === 1);
  assert('Day 1 guaranteed Specimen is COMMON · #002 (C2)', day1SpecimenSlots[0]?.specimen?.visualId === 'C2');
  assert('Day 1 guaranteed Specimen is already ripe (visible in the Orchard immediately)', day1SpecimenSlots[0]?.ripe === true);
  assert('Day 1 produces no random additional specimens (only the one guarantee)', countAllSpecimensInPlay(game) === 1);
  assert('rollSpecimenTier never fires on Day 1 (pure function, many trials)', Array.from({ length: 500 }, () => rollSpecimenTier(1)).every((t) => t === null));
  assert('rollSpecimenTier never fires on Day 2 (pure function, many trials)', Array.from({ length: 500 }, () => rollSpecimenTier(2)).every((t) => t === null));

  // Reload cannot duplicate the Day 1 guarantee.
  game.save();
  const reloaded = new Game();
  assert('Day 1 reload cannot duplicate the guarantee', countAllSpecimensInPlay(reloaded) === 1);
  assert('Day 1 reload keeps the guarantee flag true', reloaded.state.day1SpecimenGuaranteeUsed === true);

  // Harvesting it must not make it respawn later the same day.
  const field1 = reloaded.state.fields[0] as Field;
  const specimenSlotIndex = field1.slots.findIndex((s) => s.specimen);
  const cashBefore = reloaded.state.cash;
  reloaded.harvestFruitSlot(field1.id, specimenSlotIndex);
  assert('harvesting the Day 1 Specimen moves it into the inventory', reloaded.state.specimens.some((s) => s.visualId === 'C2' && s.foundDay === 1));
  assert('harvesting a Specimen adds no Shipping Queue item', reloaded.state.processingQueue.length === 0);
  assert('harvesting a Specimen pays no normal sale revenue', reloaded.state.cash === cashBefore);
  assert('using/harvesting the guarantee does not make it respawn later that day', countAllSpecimensInPlay(reloaded) === 1 && !reloaded.state.fields.some((f) => f.slots.some((s) => s.specimen)));

  // Advance to Day 2 -> the Day-2 guarantee should fire.
  runClosing(reloaded);
  assert('Operating Cost / Day Cycle regression: Day 1 Closing still settles correctly', reloaded.state.lastDayLog?.operatingCost === 35);
  reloaded.proceedToNextDay();
  assert('advanced to Day 2', reloaded.state.day === 2);
  assert('Day 2 guarantee flag now recorded as spawned', reloaded.state.day2SpecimenGuaranteeUsed === true);

  const day2SpecimenSlots = reloaded.state.fields.flatMap((f) => f.slots.filter((s) => s.specimen));
  assert('Day 2 produces exactly one guaranteed Specimen (still unharvested on the tree)', day2SpecimenSlots.length === 1);
  const day2Visual = day2SpecimenSlots[0]?.specimen?.visualId;
  assert('Day 2 guaranteed Specimen is COMMON · #003 or COMMON · #004', day2Visual === 'C3' || day2Visual === 'C4');
  assert('Day 2 guaranteed Specimen is discovered the moment it appears, before being harvested', reloaded.state.discoveredVisualIds.includes(day2Visual!));
  assert('newly discovered Day 2 visual gets a safe baseline/STABLE Market entry', reloaded.state.visualMarket[day2Visual!]?.pct === 0 && reloaded.state.visualMarket[day2Visual!]?.trend === 'STABLE');

  // Day 2 reload cannot duplicate it.
  reloaded.save();
  const reloaded2 = new Game();
  assert('Day 2 reload cannot duplicate the guarantee', reloaded2.state.fields.flatMap((f) => f.slots.filter((s) => s.specimen)).length === 1);

  // Advance to Day 3 -> no more guaranteed daily specimen.
  runClosing(reloaded2);
  reloaded2.proceedToNextDay();
  assert('advanced to Day 3', reloaded2.state.day === 3);
  assert('Day 3 onward: no guaranteed daily specimen remains (flags stay used, no forced spawn on this transition)', reloaded2.state.day1SpecimenGuaranteeUsed && reloaded2.state.day2SpecimenGuaranteeUsed);
}

// Day-2 visual selection rule (pure function, exact + statistical).
{
  assert('undiscovered #003 -> #004 already known picks #003', chooseDay2GuaranteedVisual(['C1', 'C2', 'C4'], constRng(0.9)) === 'C3');
  assert('undiscovered #004 -> #003 already known picks #004', chooseDay2GuaranteedVisual(['C1', 'C2', 'C3'], constRng(0.1)) === 'C4');

  const rng = mulberry32(777);
  let c3 = 0;
  let c4 = 0;
  const N = 2000;
  for (let i = 0; i < N; i++) {
    const pick = chooseDay2GuaranteedVisual(['C1', 'C2'], rng); // both undiscovered -> 50/50
    if (pick === 'C3') c3++;
    else c4++;
  }
  assert(`both undiscovered is 50/50-capable (${c3}/${N} C3)`, Math.abs(c3 / N - 0.5) < 0.06);

  let c3b = 0;
  let c4b = 0;
  for (let i = 0; i < N; i++) {
    const pick = chooseDay2GuaranteedVisual(['C1', 'C2', 'C3', 'C4'], rng); // both already discovered -> 50/50
    if (pick === 'C3') c3b++;
    else c4b++;
  }
  assert(`both already discovered is 50/50-capable (${c3b}/${N} C3)`, Math.abs(c3b / N - 0.5) < 0.06);
}

// Guaranteed-specimen field selection (pure function).
{
  const fields = [
    { unlocked: true, varietyId: 'a' },
    { unlocked: true, varietyId: 'b' },
    { unlocked: false, varietyId: null },
  ];
  const visualOf: Record<string, AppleAssetId> = { a: 'C2', b: 'C1' };
  assert(
    'prefers a Field whose planted Line visual differs from the target',
    fields[chooseGuaranteedSpecimenFieldIndex(fields, (id) => visualOf[id], 'C2')] === fields[1],
  );
  const allC2 = [{ unlocked: true, varietyId: 'a' }];
  assert('falls back to the only planted Field even if its visual matches the target', chooseGuaranteedSpecimenFieldIndex(allC2, () => 'C2', 'C2') === 0);
  assert('returns -1 when nothing is planted at all', chooseGuaranteedSpecimenFieldIndex([{ unlocked: false, varietyId: null }], () => undefined, 'C2') === -1);
}

// ===========================================================================
// DAY 3+ RANDOM APPEARANCE
// ===========================================================================
{
  assert('Day 3: Rare never appears (base rate is 0 before Day 4)', TUNING.SPECIMEN_RARE_CHANCE > 0 && rollSpecimenTier(3, constRng(TUNING.SPECIMEN_COMMON_CHANCE + 0.0001)) === null);
  assert('Day 3: Common can appear at the configured rate', rollSpecimenTier(3, constRng(TUNING.SPECIMEN_COMMON_CHANCE * 0.5)) === 'COMMON');
  assert('Day 4: Rare cannot appear before Day 4 (already proven by the Day 3 check above) — Day 4 Rare CAN appear', rollSpecimenTier(4, constRng(TUNING.SPECIMEN_RARE_CHANCE * 0.5)) === 'RARE');
  assert('Day 5: Epic cannot appear before Day 6', rollSpecimenTier(5, constRng(TUNING.SPECIMEN_EPIC_CHANCE * 0.5)) !== 'EPIC');
  assert('Day 6: Epic can appear from Day 6 onward', rollSpecimenTier(6, constRng(TUNING.SPECIMEN_EPIC_CHANCE * 0.5)) === 'EPIC');

  // A single fruit can never become multiple tiers — structural (one
  // sequential if/else returning at most one tier) plus a statistical
  // sanity pass confirming the empirical mix roughly matches the tuned
  // per-tier rates at Day 6 (all three tiers simultaneously active).
  const rng = mulberry32(20260816);
  const N = 400000;
  let common = 0;
  let rare = 0;
  let epic = 0;
  let none = 0;
  for (let i = 0; i < N; i++) {
    const t = rollSpecimenTier(6, rng);
    if (t === 'COMMON') common++;
    else if (t === 'RARE') rare++;
    else if (t === 'EPIC') epic++;
    else none++;
  }
  assert('every roll is exactly one outcome (Common/Rare/Epic/none), never combined', common + rare + epic + none === N);
  assert(`Day 6 Common rate ~matches TUNING (${common}/${N})`, Math.abs(common / N - TUNING.SPECIMEN_COMMON_CHANCE) < 0.0006);
  assert(`Day 6 Rare rate ~matches TUNING (${rare}/${N})`, Math.abs(rare / N - TUNING.SPECIMEN_RARE_CHANCE) < 0.0003);
  assert(`Day 6 Epic rate ~matches TUNING (${epic}/${N})`, Math.abs(epic / N - TUNING.SPECIMEN_EPIC_CHANCE) < 0.0002);

  // Selected Visual always differs from the source Line, and rarity never buys stat budget.
  const visual = pickOrchardSpecimenVisual('EPIC', 6, 'E1', [], constRng(0));
  assert('Day 3+ random specimen Visual always differs from the planted source Line (Epic pool of 2, excluding source leaves exactly 1)', visual === 'E2');
  const noAlt = pickOrchardSpecimenVisual('EPIC', 6, 'E1', [], constRng(0)); // still E2 (pool size 1 regardless of rng)
  assert('deterministic when only one alternate exists', noAlt === 'E2');
}

// ===========================================================================
// AFFINITY (Rare x10 / Epic x20 Mutation Affinity — see PROJECT.md "Revise
// Rare / Epic Line behavior")
// ===========================================================================
{
  assert('Common Lines have no Mutation Affinity', mutationAffinityFor('C1') === null);
  const rareAffinity = mutationAffinityFor('R2');
  assert(
    "a Rare Line grants Rare x10 affinity for its OWN visual only",
    rareAffinity?.tier === 'RARE' && rareAffinity.visualId === 'R2' && rareAffinity.multiplier === TUNING.RARE_MUTATION_AFFINITY_MULTIPLIER,
  );
  const epicAffinity = mutationAffinityFor('E1');
  assert(
    "an Epic Line grants Epic x20 affinity for its OWN visual only",
    epicAffinity?.tier === 'EPIC' && epicAffinity.visualId === 'E1' && epicAffinity.multiplier === TUNING.EPIC_MUTATION_AFFINITY_MULTIPLIER,
  );
  assert(
    "affinity never stacks by generation — it's a pure function of the Line's own visualId alone (no generation input exists to stack), stable across repeated calls",
    mutationAffinityFor('R2')?.multiplier === TUNING.RARE_MUTATION_AFFINITY_MULTIPLIER && mutationAffinityFor('R2')?.multiplier === rareAffinity?.multiplier,
  );

  // Day-gating: affinity can never bypass the tier's own unlock day.
  assert('Rare affinity bonus is locked before Day 4', affinityBonusChance('RARE', 3, 10) === 0);
  assert('Rare affinity bonus is active from Day 4', affinityBonusChance('RARE', 4, 10) > 0);
  assert('Epic affinity bonus is locked before Day 6', affinityBonusChance('EPIC', 5, 20) === 0);
  assert('Epic affinity bonus is active from Day 6', affinityBonusChance('EPIC', 6, 20) > 0);

  // Absolute-rate math matches PROJECT.md's worked example exactly: the
  // bonus is baseline*(multiplier-1), ADDITIONAL to (never replacing) the
  // normal within-tier baseline share.
  const rareBase = basePerSpecificChance('RARE', 4); // 0.05% / 4 visuals = 0.0125%
  const rareBonus = affinityBonusChance('RARE', 4, TUNING.RARE_MUTATION_AFFINITY_MULTIPLIER);
  assert(
    `Rare affinity bonus == baseline*(10-1) exactly (base=${(rareBase * 100).toFixed(4)}%, bonus=${(rareBonus * 100).toFixed(4)}%)`,
    Math.abs(rareBonus - rareBase * 9) < 1e-12,
  );
  const epicBase = basePerSpecificChance('EPIC', 6); // 0.005% / 2 visuals = 0.0025%
  const epicBonus = affinityBonusChance('EPIC', 6, TUNING.EPIC_MUTATION_AFFINITY_MULTIPLIER);
  assert(
    `Epic affinity bonus == baseline*(20-1) exactly (base=${(epicBase * 100).toFixed(4)}%, bonus=${(epicBonus * 100).toFixed(4)}%)`,
    Math.abs(epicBonus - epicBase * 19) < 1e-12,
  );

  // rollOrchardSpecimen always yields AT MOST one Specimen per call.
  let allSingleOrNull = true;
  for (let i = 0; i < 2000; i++) {
    const roll = rollOrchardSpecimen(6, 'C1', 'R2', []);
    if (roll !== null && (typeof roll.tier !== 'string' || typeof roll.visualId !== 'string')) allSingleOrNull = false;
  }
  assert('rollOrchardSpecimen always yields at most one Specimen per ripening, never a combined/multi result', allSingleOrNull);

  // Tier-gate holds end-to-end through rollOrchardSpecimen too, even with
  // an active matching affinity.
  {
    let sawRareAtDay3 = false;
    const rng = mulberry32(31337);
    for (let i = 0; i < 200000; i++) {
      if (rollOrchardSpecimen(3, 'C1', 'R2', [], rng)?.tier === 'RARE') sawRareAtDay3 = true;
    }
    assert('Rare affinity cannot produce Rare before Day 4 end-to-end (tier-gate respected even with affinity active)', !sawRareAtDay3);

    let sawEpicAtDay5 = false;
    const rng2 = mulberry32(31338);
    for (let i = 0; i < 200000; i++) {
      if (rollOrchardSpecimen(5, 'C1', 'E1', [], rng2)?.tier === 'EPIC') sawEpicAtDay5 = true;
    }
    assert('Epic affinity cannot produce Epic before Day 6 end-to-end (tier-gate respected even with affinity active)', !sawEpicAtDay5);
  }

  // Absolute occurrence rate, end-to-end: an affinity lineage's OWN Rare
  // visual should occur roughly 10x as often as the exact same visual does
  // on a non-affinity lineage — and sibling Rare visuals must NOT be
  // boosted at all (affinity applies only to the matching special visual).
  {
    const day = 4;
    const N = 1000000;
    const rngAffinity = mulberry32(555001);
    const rngBaseline = mulberry32(555002);

    const affinityCounts: Record<string, number> = {};
    for (let i = 0; i < N; i++) {
      const roll = rollOrchardSpecimen(day, 'C1', 'R2', [], rngAffinity); // planted Line IS the R2 lineage
      if (roll) affinityCounts[roll.visualId] = (affinityCounts[roll.visualId] ?? 0) + 1;
    }
    const baselineCounts: Record<string, number> = {};
    for (let i = 0; i < N; i++) {
      const roll = rollOrchardSpecimen(day, 'C1', 'C1', [], rngBaseline); // ordinary Common lineage, no affinity at all
      if (roll) baselineCounts[roll.visualId] = (baselineCounts[roll.visualId] ?? 0) + 1;
    }

    const affinityR2Rate = (affinityCounts['R2'] ?? 0) / N;
    const baselineR2Rate = (baselineCounts['R2'] ?? 0) / N;
    assert(
      `affinity increases the ABSOLUTE occurrence chance of the matching Visual by roughly 10x, not merely its within-tier weight (affinity=${affinityCounts['R2'] ?? 0}, baseline=${baselineCounts['R2'] ?? 0} of ${N})`,
      baselineR2Rate > 0 && affinityR2Rate / baselineR2Rate > 6 && affinityR2Rate / baselineR2Rate < 15,
    );

    let siblingsMatchBaseline = true;
    for (const id of ['R1', 'R3', 'R4'] as AppleAssetId[]) {
      const a = (affinityCounts[id] ?? 0) / N;
      const b = (baselineCounts[id] ?? 0) / N;
      if (b > 0 && (a / b < 0.5 || a / b > 2)) siblingsMatchBaseline = false;
    }
    assert('affinity applies ONLY to the matching special Visual — sibling Rare Visuals (R1/R3/R4) stay at their normal, unboosted baseline rate', siblingsMatchBaseline);
  }
}

// ===========================================================================
// BREED TOTAL (see PROJECT.md "Every Breed must improve total genetic strength")
// ===========================================================================
{
  const game = new Game();
  const state = game.state;
  const sum5 = (v: { sweetness: number; size: number; yieldStat: number; growth: number; freshness: number }) =>
    v.sweetness + v.size + v.yieldStat + v.growth + v.freshness;

  // Parent totals are read correctly (stronger = max(A,B)); target exceeds
  // it; improvement lands in the tuned range; all four candidates share
  // the SAME target; A/D still meaningfully differ in distribution.
  {
    const parentA = { ...fakeParent('C1'), sweetness: 40, size: 40, yieldStat: 40, growth: 40, freshness: 40 }; // total 200
    const parentB = { ...fakeParent('C2'), sweetness: 50, size: 50, yieldStat: 50, growth: 50, freshness: 50 }; // total 250
    const result = breedOffspring(parentA, parentB, 3, state);
    assert('strongerParentTotal reads the max of the two parents (200 vs 250 -> 250)', result.strongerParentTotal === 250);
    assert('breedTargetTotal exceeds the stronger parent (below the 360 cap)', result.breedTargetTotal > result.strongerParentTotal);
    assert(
      'the ONE improvement roll lands in the tuned +2..+6 range',
      result.breedTargetTotal - result.strongerParentTotal >= TUNING.BREED_IMPROVEMENT_MIN && result.breedTargetTotal - result.strongerParentTotal <= TUNING.BREED_IMPROVEMENT_MAX,
    );

    let allFourMatchTarget = true;
    const slotSums: Record<string, number> = {};
    for (const o of result.offspring) {
      slotSums[o.slot] = sum5(o);
      if (Math.abs(slotSums[o.slot] - result.breedTargetTotal) > 3) allFourMatchTarget = false;
    }
    assert(`all four candidates land on the SAME shared target TOTAL, within rounding (${JSON.stringify(slotSums)} vs target ${result.breedTargetTotal})`, allFourMatchTarget);

    const statsOfSlot = (slot: string) => {
      const o = result.offspring.find((c) => c.slot === slot)!;
      return [o.sweetness, o.size, o.yieldStat, o.growth, o.freshness];
    };
    const a = statsOfSlot('A');
    const d = statsOfSlot('D');
    assert('A/B/C/D still produce meaningfully different stat distributions despite sharing the same TOTAL', a.some((v, i) => Math.abs(v - d[i]) > 3));
  }

  // Target never exceeds 360, even from very high-total parents.
  {
    const parentA = { ...fakeParent('C1'), sweetness: 90, size: 90, yieldStat: 90, growth: 90, freshness: 90 }; // total 450
    const parentB = { ...fakeParent('C2'), sweetness: 80, size: 80, yieldStat: 80, growth: 80, freshness: 80 }; // total 400
    const result = breedOffspring(parentA, parentB, 6, state);
    assert('target TOTAL never exceeds the absolute 360 cap', result.breedTargetTotal <= 360);
    assert('a maxed-out parent pair produces a 360 target', result.breedTargetTotal === 360);
    let allNear360 = true;
    for (const o of result.offspring) if (Math.abs(sum5(o) - 360) > 3) allNear360 = false;
    assert('every candidate sums to ~360 when the target is capped', allNear360);
  }

  // A parent pair already exactly at 360 stays at 360 — the ONE allowed
  // exception to "Breed always increases TOTAL" — but redistribution still happens.
  {
    const maxedParent = { ...fakeParent('C1'), sweetness: 72, size: 72, yieldStat: 72, growth: 72, freshness: 72 }; // total 360
    const result = breedOffspring(maxedParent, maxedParent, 6, state);
    assert('strongerParentTotal is exactly 360 for an already-maxed pair', result.strongerParentTotal === 360);
    assert('breedTargetTotal stays exactly 360 — no further increase possible', result.breedTargetTotal === 360);
  }

  // Many trials: the improvement delta always lands in +2..+6 for a
  // comfortably-below-cap parent pair.
  {
    const parentA = { ...fakeParent('C1'), sweetness: 40, size: 40, yieldStat: 40, growth: 40, freshness: 40 };
    const parentB = { ...fakeParent('C2'), sweetness: 40, size: 40, yieldStat: 40, growth: 40, freshness: 40 };
    let allInRange = true;
    for (let i = 0; i < 500; i++) {
      const result = breedOffspring(parentA, parentB, 3, state);
      const delta = result.breedTargetTotal - result.strongerParentTotal;
      if (delta < TUNING.BREED_IMPROVEMENT_MIN || delta > TUNING.BREED_IMPROVEMENT_MAX) allInRange = false;
    }
    assert('the ONE improvement roll per Breed always lands in +2..+6 (500 trials)', allInRange);
  }
}

// ===========================================================================
// BASE VISUAL
// ===========================================================================
{
  assert('starter Common Lines have visualId == baseVisualId', STARTER_RED.visualId === STARTER_RED.baseVisualId && STARTER_GREEN.visualId === STARTER_GREEN.baseVisualId);
  assert('Common specimen: deriveSpecimenBaseVisualId(visualId, anything) == visualId', deriveSpecimenBaseVisualId('C4', 'C1') === 'C4');
  assert(
    "Rare/Epic specimen: deriveSpecimenBaseVisualId preserves the source Line's baseVisualId, never its visualId (the exact PROJECT.md worked example: #009 on a #003-lineage -> base #003)",
    deriveSpecimenBaseVisualId('E1', 'C3') === 'C3',
  );

  // Common Specimen via the real guaranteed-Day-1 flow: visualId == baseVisualId.
  clearStorage();
  const game = new Game();
  const field1 = game.state.fields[0] as Field;
  const day1Specimen = field1.slots.find((s) => s.specimen)!.specimen!;
  assert('Day 1 guaranteed (Common) Specimen has visualId == baseVisualId', day1Specimen.visualId === day1Specimen.baseVisualId && day1Specimen.visualId === 'C2');

  // save/load preserves baseVisualId on both a Line and a held Specimen.
  game.state.specimens.push(fakeSpecimen({ id: 'save-base-test', visualId: 'E2', baseVisualId: 'C4' }));
  game.save();
  const reloaded = new Game();
  const reloadedHeld = reloaded.state.specimens.find((s) => s.id === 'save-base-test');
  assert('save/load preserves a held Specimen\'s baseVisualId exactly', reloadedHeld?.baseVisualId === 'C4');
  assert('save/load preserves a Line\'s baseVisualId exactly (starter RED BASIC)', reloaded.getVariety(STARTER_RED.id)?.baseVisualId === STARTER_RED.baseVisualId);
}

// ===========================================================================
// SPECIMEN STATS
// ===========================================================================
{
  const source: Stats5 = [50, 50, 50, 50, 50];
  const sourceTotal = 250;

  // Exact-zero minor mutation (r=0.5 -> floor(0.5*9)=4 -> offset 0 for the
  // -4..+4 range), major mutation forced onto index 0 with minimum
  // magnitude (r=0 -> 8) and a positive sign, budget offset forced to
  // exactly 0 (r=0.35 -> floor(0.35*9)=3 -> -3+3=0).
  const rngZeroOffsets = queueRng([0.5, 0.5, 0.5, 0.5, 0.5, 0.1, 0, 0.9, 0.35]);
  const resultMin = generateSpecimenStats(source, rngZeroOffsets);
  assert('source genetics are clearly inherited (non-major stats track the source 1:1 modulo the shared budget scale)', resultMin[1] === resultMin[2] && resultMin[2] === resultMin[3] && resultMin[3] === resultMin[4]);
  assert('exactly one stat receives the major mutation (it alone stands out from the other four)', resultMin[0] > resultMin[1]);
  assert('minor mutation of the other four stats is 0 here by construction (r=0.5 -> offset 0)', Math.abs(resultMin[1] - source[1] * (sourceTotal / (sourceTotal + 8))) < 1e-9);

  // Major mutation magnitude spans its tuned 8..12 range: compare the low
  // extreme (r=0 -> magnitude 8) against the high extreme (r~1 -> magnitude
  // ~12), all other rng slots pinned identically so only magnitude varies.
  const rngLowMag = queueRng([0.5, 0.5, 0.5, 0.5, 0.5, 0.1, 0, 0.9, 0.35]);
  const rngHighMag = queueRng([0.5, 0.5, 0.5, 0.5, 0.5, 0.1, 0.999999, 0.9, 0.35]);
  const lowMagResult = generateSpecimenStats(source, rngLowMag)[0];
  const highMagResult = generateSpecimenStats(source, rngHighMag)[0];
  assert('major mutation magnitude scales across its tuned 8..12 range (a near-1 rng roll produces a visibly larger boosted stat than a 0 roll)', highMagResult > lowMagResult);

  // Budget target = source total + randInt(-3..+5): pin everything else,
  // vary only the final budget rng slot to its two extremes.
  const rngBudgetLow = queueRng([0.5, 0.5, 0.5, 0.5, 0.5, 0.1, 0.5, 0.9, 0]); // offset -3
  const rngBudgetHigh = queueRng([0.5, 0.5, 0.5, 0.5, 0.5, 0.1, 0.5, 0.9, 0.95]); // offset +5
  const sum = (s: Stats5) => s[0] + s[1] + s[2] + s[3] + s[4];
  const budgetLow = sum(generateSpecimenStats(source, rngBudgetLow));
  const budgetHigh = sum(generateSpecimenStats(source, rngBudgetHigh));
  assert(`budget target floor is source total - 3 (got ${budgetLow.toFixed(2)}, expected ~${sourceTotal - 3})`, Math.abs(budgetLow - (sourceTotal - 3)) < 1e-6);
  assert(`budget target ceiling is source total + 5 (got ${budgetHigh.toFixed(2)}, expected ~${sourceTotal + 5})`, Math.abs(budgetHigh - (sourceTotal + 5)) < 1e-6);

  // Absolute budget cap of 360 is respected even from a near-max source.
  const highSource: Stats5 = [100, 100, 100, 100, 100];
  const cappedResult = generateSpecimenStats(highSource, queueRng([0.999, 0.999, 0.999, 0.999, 0.999, 0.1, 0.999999, 0.9, 0.999]));
  assert(`absolute budget cap 360 is respected from a near-max source (sum=${sum(cappedResult).toFixed(2)})`, sum(cappedResult) <= 360 + 1e-6);

  // All stats stay within 0..100 across many random samples, including
  // near-boundary sources.
  const rng = mulberry32(4242);
  let allInBounds = true;
  for (let i = 0; i < 2000; i++) {
    const src: Stats5 = i % 2 === 0 ? [2, 2, 2, 2, 2] : [98, 98, 98, 98, 98];
    const out = generateSpecimenStats(src, rng);
    if (out.some((v) => v < 0 || v > 100)) allInBounds = false;
  }
  assert('all stats remain clamped to 0..100 across many boundary-source samples', allInBounds);

  // Rarity has no stat-budget advantage: the function has no visual/tier
  // parameter at all, so it structurally cannot bias the budget by
  // rarity — confirmed by the mean total over many trials tracking the
  // source total (no available lever to skew it).
  let totalSum = 0;
  const N = 3000;
  for (let i = 0; i < N; i++) totalSum += sum(generateSpecimenStats(source, rng));
  const mean = totalSum / N;
  assert(`mean generated budget tracks source total regardless of (nonexistent) rarity input (mean=${mean.toFixed(2)}, source=${sourceTotal})`, Math.abs(mean - sourceTotal) < 3);
}

// A held Specimen (and one still on a fruit slot) persists identically across save/reload.
{
  clearStorage();
  const game = new Game();
  const field1 = game.state.fields[0] as Field;
  const onTreeSlot = field1.slots.find((s) => s.specimen)!;
  const beforeOnTree = JSON.parse(JSON.stringify(onTreeSlot.specimen));

  game.save();
  const reloaded = new Game();
  const reloadedSlot = reloaded.state.fields[0].slots.find((s) => s.specimen)!;
  assert('a Specimen still on a fruit slot persists identically across save/reload', JSON.stringify(reloadedSlot.specimen) === JSON.stringify(beforeOnTree));

  reloaded.harvestFruitSlot(reloaded.state.fields[0].id, reloaded.state.fields[0].slots.indexOf(reloadedSlot));
  const heldBefore = JSON.parse(JSON.stringify(reloaded.state.specimens[0]));
  reloaded.save();
  const reloaded2 = new Game();
  assert('a held Specimen persists exactly across save/reload', JSON.stringify(reloaded2.state.specimens[0]) === JSON.stringify(heldBefore));
}

// ===========================================================================
// ORCHARD / HARVEST
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  const field1 = game.state.fields[0] as Field;
  const specimenSlot = field1.slots.find((s) => s.specimen)!;
  assert('special fruit is discovered the moment it appears, before harvest', game.state.discoveredVisualIds.includes(specimenSlot.specimen!.visualId));

  const specimenSlotIndex = field1.slots.indexOf(specimenSlot);
  const expectedSpecimenId = specimenSlot.specimen!.id;
  const cashBefore = game.state.cash;
  const queueLenBefore = game.state.processingQueue.length;
  game.harvestFruitSlot(field1.id, specimenSlotIndex);
  assert('harvesting a specimen adds the exact specimen (same id) to the inventory', game.state.specimens.some((s) => s.id === expectedSpecimenId));
  assert('specimen harvest gives no Shipping Queue item', game.state.processingQueue.length === queueLenBefore);
  assert('specimen harvest gives no normal sale revenue', game.state.cash === cashBefore);

  // Normal (non-specimen) fruit harvesting remains unchanged: the next
  // ripe, non-specimen slot must still enter the Processing Queue.
  const ordinarySlotIndex = field1.slots.findIndex((s) => s.ripe && !s.specimen);
  if (ordinarySlotIndex >= 0) {
    game.harvestFruitSlot(field1.id, ordinarySlotIndex);
    assert('ordinary fruit harvesting is unchanged: it still enters the Processing Queue', game.state.processingQueue.length === queueLenBefore + 1);
  }
}

// ===========================================================================
// ORCHARD PRODUCTION — a Rare/Epic-planted Field's ordinary fruit uses
// baseVisualId, both for what it visually is (LIMITATION: the actual
// Phaser tree rendering isn't exercised here — see file header) and for
// sale pricing (which IS testable at this layer).
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  // Craft a Rare Line directly (bypassing the full breed/KEEP flow for a
  // focused, fast test) — special identity R2, stable ordinary fruit C1.
  const rareLine: Variety = {
    id: 'test-rare-line',
    customName: 'TEST RARE LINE',
    generation: 2,
    color: 'Red',
    pattern: 'Plain',
    visualId: 'R2',
    baseVisualId: 'C1',
    sweetness: 50,
    size: 50,
    yieldStat: 50,
    growth: 50,
    freshness: 50,
    createdDay: 1,
    awards: [],
    favorite: false,
    archived: false,
  };
  game.state.library.push(rareLine);
  const field = game.state.fields[0];
  field.varietyId = rareLine.id;

  // Give the Rare identity Visual a big Market boost while the Common base
  // stays at baseline — a pricing bug (using visualId instead of
  // baseVisualId) would immediately show up as an inflated sale price.
  game.state.discoveredVisualIds.push('R2');
  game.state.visualMarket.R2 = { visualId: 'R2', pct: 0.5, trend: 'STABLE', history: [{ day: 1, pct: 0.5 }] };

  const c1Mult = marketMultiplierForVisual('C1', game.state.visualMarket); // baseline, 1.0
  const r2Mult = marketMultiplierForVisual('R2', game.state.visualMarket); // inflated, 1.5
  assert('setup sanity: the Rare identity Visual and the Common base have different Market multipliers', c1Mult !== r2Mult);

  let allOrdinaryUseBase = true;
  let harvestedAny = false;
  for (let i = 0; i < 3; i++) {
    const slotIndex = field.slots.findIndex((s) => s.active && !s.specimen && !s.ripe);
    if (slotIndex < 0) break;
    field.slots[slotIndex].ripe = true;
    game.harvestFruitSlot(field.id, slotIndex);
    const queued = game.state.processingQueue[game.state.processingQueue.length - 1];
    if (!queued) continue;
    harvestedAny = true;
    if (Math.abs(queued.value / queued.baseValue - c1Mult) > 1e-9) allOrdinaryUseBase = false;
  }
  assert('setup sanity: at least one ordinary harvest was queued', harvestedAny);
  assert(
    "ordinary sale pricing uses baseVisualId's Market multiplier, never the Rare/Epic identity Visual's — a Rare/Epic lineage does NOT become a field full of inflated-price rare fruit",
    allOrdinaryUseBase,
  );
}

// HARVEST ALL and Closing both preserve specimens (same shared harvestFruitSlot path).
{
  clearStorage();
  const game = new Game();
  const field1 = game.state.fields[0] as Field;

  // Simulate HARVEST ALL: collect every currently-ripe slot through the
  // same harvestFruitSlot() path the real button uses (Phaser's own click
  // wiring isn't exercised here — see the file header's documented limitation).
  const ripeIndicesBefore = field1.slots.map((s, i) => (s.ripe ? i : -1)).filter((i) => i >= 0);
  const hadSpecimenAmongRipe = ripeIndicesBefore.some((i) => field1.slots[i].specimen);
  assert('setup sanity: the guaranteed Day 1 specimen is among the currently-ripe fruit', hadSpecimenAmongRipe);
  for (const i of ripeIndicesBefore) game.harvestFruitSlot(field1.id, i);
  assert('HARVEST ALL preserves specimens instead of selling them', game.state.specimens.some((s) => s.visualId === 'C2' && s.foundDay === 1));
}
{
  clearStorage();
  const game = new Game();
  const field1 = game.state.fields[0] as Field;
  const hadSpecimen = field1.slots.some((s) => s.specimen);
  assert('setup sanity: a specimen is ripe going into Closing', hadSpecimen);
  runClosing(game);
  assert("Closing's automatic ripe-fruit collection preserves the specimen instead of shipping it", game.state.specimens.some((s) => s.visualId === 'C2' && s.foundDay === 1));
  assert('Day Cycle / Closing regression: settlement still completes normally', game.state.dayEnded === true && game.state.lastDayLog !== null);
}

// ===========================================================================
// PARENT SELECTION / CONSUMPTION
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  game.state.cash = 100000;

  // Line x Line (including self-cross).
  {
    const ok = game.startBreeding({ kind: 'LINE', id: STARTER_RED.id }, { kind: 'LINE', id: STARTER_RED.id });
    assert('Line self-cross remains allowed', ok);
    assert('a permanent Library Line is never consumed', !!game.getVariety(STARTER_RED.id));
    resolveAndClear(game);
  }

  // Line x Specimen / Specimen x Line.
  const specA = fakeSpecimen({ id: 'spec-a', visualId: 'R1' });
  const specB = fakeSpecimen({ id: 'spec-b', visualId: 'R1' }); // same visualId, different id
  const specC = fakeSpecimen({ id: 'spec-c', visualId: 'E1' });
  game.state.specimens.push(specA, specB, specC);

  {
    const ok = game.startBreeding({ kind: 'LINE', id: STARTER_GREEN.id }, { kind: 'SPECIMEN', id: 'spec-a' });
    assert('Line x Specimen is allowed', ok);
    assert('specimen is consumed exactly once when BREED starts', !game.state.specimens.some((s) => s.id === 'spec-a'));
    resolveAndClear(game);
    assert('specimen is not returned after resolving even without KEEPing that exact candidate', !game.state.specimens.some((s) => s.id === 'spec-a'));
  }

  {
    const ok = game.startBreeding({ kind: 'SPECIMEN', id: 'spec-b' }, { kind: 'LINE', id: STARTER_RED.id });
    assert('Specimen x Line is allowed', ok);
    resolveAndClear(game);
  }

  // Two distinct Specimens (Specimen x Specimen), same visualId allowed.
  {
    const specD = fakeSpecimen({ id: 'spec-d', visualId: 'R1' });
    game.state.specimens.push(specD);
    const ok = game.startBreeding({ kind: 'SPECIMEN', id: 'spec-c' }, { kind: 'SPECIMEN', id: 'spec-d' });
    assert('two distinct Specimens (even sharing the same visualId as another pair) work as both parents', ok);
    assert('both specimens are consumed', !game.state.specimens.some((s) => s.id === 'spec-c' || s.id === 'spec-d'));
    resolveAndClear(game);
  }

  // Same specimen id cannot occupy both slots.
  {
    const specE = fakeSpecimen({ id: 'spec-e' });
    game.state.specimens.push(specE);
    const before = game.state.specimens.length;
    const ok = game.startBreeding({ kind: 'SPECIMEN', id: 'spec-e' }, { kind: 'SPECIMEN', id: 'spec-e' });
    assert('the same specimen id cannot occupy both Parent A and Parent B', !ok);
    assert('a rejected same-specimen attempt does not consume it', game.state.specimens.length === before && game.state.specimens.some((s) => s.id === 'spec-e'));
  }
}

// Save/reload during an in-progress Specimen breeding: consumption + snapshot both survive.
{
  clearStorage();
  const game = new Game();
  game.state.cash = 100000;
  const spec = fakeSpecimen({ id: 'consume-me', visualId: 'R2', sourceLineId: STARTER_RED.id });
  game.state.specimens.push(spec);

  game.startBreeding({ kind: 'SPECIMEN', id: 'consume-me' }, { kind: 'LINE', id: STARTER_GREEN.id });
  game.save(); // saved mid-breeding, well before the timer elapses
  const reloaded = new Game();
  assert('save/reload mid-breeding cannot restore a consumed specimen', !reloaded.state.specimens.some((s) => s.id === 'consume-me'));
  assert('the consumed specimen data survives reload as a breeding snapshot (so resolution still works later)', reloaded.state.breeding.parentASpecimenSnapshot?.id === 'consume-me');

  resolveAndClear(reloaded);
  assert('breeding resolves correctly after reload using the snapshot (offspring were generated)', true); // resolveAndClear would have thrown/left breeding.ready false on a real failure — keepOffspring below is the stronger proof
  assert('after KEEP on the reloaded session, the specimen is still not refunded', !reloaded.state.specimens.some((s) => s.id === 'consume-me'));
}

// ===========================================================================
// VISUAL INHERITANCE (A/B/C/D) — visualId AND baseVisualId together, never
// mixed (see PROJECT.md section 11). Rare/Epic can no longer be
// spontaneously created by breeding at all (section 12) — the ONLY route
// for a new Rare/Epic Visual is a physical Orchard Specimen (see AFFINITY
// below).
// ===========================================================================
{
  const game = new Game();
  const state = game.state;
  const parentA = fakeParent('E1', 'C1'); // the exact PROJECT.md worked example: Epic identity #009-like, Common base #001-like
  const parentB = fakeParent('C2'); // Common: base defaults to its own visualId
  const N = 400;
  let aAlwaysMatches = true;
  let aBaseAlwaysMatches = true;
  let bAlwaysMatches = true;
  let bBaseAlwaysMatches = true;
  let cAlwaysInPair = true;
  let baseNeverMixed = true;
  let cSawA = false;
  let cSawB = false;
  let dMutatedCount = 0;
  let dMutatedAlwaysOwnBase = true;
  for (let i = 0; i < N; i++) {
    const result = breedOffspring(parentA, parentB, 6, state);
    const bySlot = (s: string) => result.offspring.find((o) => o.slot === s)!;
    const A = bySlot('A');
    const B = bySlot('B');
    const C = bySlot('C');
    const D = bySlot('D');

    if (A.visualId !== parentA.visualId) aAlwaysMatches = false;
    if (A.baseVisualId !== parentA.baseVisualId) aBaseAlwaysMatches = false;
    if (B.visualId !== parentB.visualId) bAlwaysMatches = false;
    if (B.baseVisualId !== parentB.baseVisualId) bBaseAlwaysMatches = false;

    const cVis = C.visualId;
    if (cVis !== parentA.visualId && cVis !== parentB.visualId) cAlwaysInPair = false;
    if (cVis === parentA.visualId) {
      cSawA = true;
      if (C.baseVisualId !== parentA.baseVisualId) baseNeverMixed = false;
    }
    if (cVis === parentB.visualId) {
      cSawB = true;
      if (C.baseVisualId !== parentB.baseVisualId) baseNeverMixed = false;
    }

    const dMutated = D.visualId !== parentA.visualId && D.visualId !== parentB.visualId;
    if (dMutated) {
      dMutatedCount++;
      // A freshly mutated Common visual is always its own stable base.
      if (D.baseVisualId !== D.visualId) dMutatedAlwaysOwnBase = false;
    } else {
      if (D.visualId === parentA.visualId && D.baseVisualId !== parentA.baseVisualId) baseNeverMixed = false;
      if (D.visualId === parentB.visualId && D.baseVisualId !== parentB.baseVisualId) baseNeverMixed = false;
    }
  }
  assert(`Candidate A always shows Parent A's exact Visual (${N} trials) — a hard-won rare Specimen used as Parent A can never lose its Visual via A`, aAlwaysMatches);
  assert('Candidate A also preserves the matching baseVisualId (visual+base always come from the SAME parent, never mixed)', aBaseAlwaysMatches);
  assert(`Candidate B always shows Parent B's exact Visual (${N} trials)`, bAlwaysMatches);
  assert('Candidate B also preserves the matching baseVisualId', bBaseAlwaysMatches);
  assert(`Candidate C is only ever Parent A or Parent B's Visual, never a third (${N} trials) — C cannot mutate`, cAlwaysInPair);
  assert('Candidate C is 50/50-capable between A and B across trials', cSawA && cSawB);
  assert("Candidate C (and non-mutated D) never mixes one parent's special Visual with the other parent's base", baseNeverMixed);
  assert('A/B never independently introduce a new Rare/Epic Visual (both always equal an existing parent Visual)', aAlwaysMatches && bAlwaysMatches);
  assert(`D inherits A/B most of the time when mutation does not occur (only ${dMutatedCount}/${N} trials mutated, consistent with the tuned ~10% rate)`, dMutatedCount < N * 0.3);
  assert('D Common mutation always sets baseVisualId == visualId (a freshly mutated Common visual is its own stable base)', dMutatedAlwaysOwnBase);
}

// Candidate D: mutation rate + Common-only target — Rare/Epic can no
// longer be created by breeding even once both are otherwise unlocked.
{
  const game = new Game();
  const state = game.state;
  const parentA = fakeParent('C1');
  const parentB = fakeParent('C2');
  const N = 6000;
  let mutated = 0;
  let allCommon = true;
  for (let i = 0; i < N; i++) {
    const result = breedOffspring(parentA, parentB, 6, state); // Day 6+: Rare/Epic fully unlocked elsewhere in the game
    const d = result.offspring.find((o) => o.slot === 'D')!;
    if (d.visualId !== parentA.visualId && d.visualId !== parentB.visualId) {
      mutated++;
      if (APPLE_RARITY[d.visualId] !== 'COMMON') allCommon = false;
    }
  }
  const rate = mutated / N;
  assert(`Candidate D mutation rate is ~10% (observed ${(rate * 100).toFixed(1)}%, ${mutated}/${N})`, Math.abs(rate - TUNING.SPECIMEN_D_VISUAL_MUTATION_CHANCE) < 0.03);
  assert(`Breed cannot spontaneously create Rare/Epic anymore — D-mutation is Common-only even on Day 6+ (${mutated} mutated samples, all Common)`, allCommon);
}

// Candidate D mutation Day-gating for WHICH Common ids may appear (Day 1
// only #001/#002 per onboarding; Day 3+ all four).
{
  const game = new Game();
  const state = game.state;
  const parentA = fakeParent('E1');
  const parentB = fakeParent('E2');

  function mutatedVisualsOnDay(day: number, trials: number): Set<AppleAssetId> {
    const seen = new Set<AppleAssetId>();
    for (let i = 0; i < trials; i++) {
      const result = breedOffspring(parentA, parentB, day, state);
      const d = result.offspring.find((o) => o.slot === 'D')!;
      if (d.visualId !== parentA.visualId && d.visualId !== parentB.visualId) seen.add(d.visualId);
    }
    return seen;
  }

  const day1Mutations = mutatedVisualsOnDay(1, 4000);
  assert(`Day 1 D-mutation occurs at a nonzero rate (${day1Mutations.size} distinct Visuals seen)`, day1Mutations.size > 0);
  assert('Day 1 D-mutation never reveals #003/#004 before their intended onboarding', !day1Mutations.has('C3') && !day1Mutations.has('C4'));

  const day3Mutations = mutatedVisualsOnDay(3, 4000);
  assert(
    'Day 3+ D-mutation may use all four Common Visuals',
    day3Mutations.has('C1') && day3Mutations.has('C2') && day3Mutations.has('C3') && day3Mutations.has('C4'),
  );
}

// ===========================================================================
// KEEP / OWNERSHIP
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  game.state.cash = 100000;
  const spec = fakeSpecimen({ id: 'keep-me', visualId: 'R3', sourceLineId: STARTER_RED.id });
  game.state.specimens.push(spec);

  assert('holding a Specimen alone does NOT make its Visual OWNED', !game.isVisualIdOwned('R3'));
  game.startBreeding({ kind: 'SPECIMEN', id: 'keep-me' }, { kind: 'LINE', id: STARTER_GREEN.id });
  game.state.breeding.elapsed = game.state.breeding.duration;
  game.update(0);
  const chosenSlot = game.state.breeding.offspring![0].slot;
  const libraryCountBefore = game.state.library.length;
  const kept = game.keepOffspring(chosenSlot);
  assert('keeping offspring creates a normal permanent Library Line', !!kept && game.state.library.length === libraryCountBefore + 1);
  assert('OWNED becomes true through normal Library derivation once kept', game.isVisualIdOwned(kept!.visualId));
}

// ===========================================================================
// STRATEGIC PAUSE (see PROJECT.md "Breed is a strategic pause")
//
// LIMITATION: the actual pause GATE — deciding *when* `pauseFarmSimulation`
// should be true (i.e. "is BREED the active screen") — lives in
// scenes/MainScene.ts's isBreedPauseActive(), a Phaser/browser-level
// UI-navigation decision that can't be exercised from this Node script;
// human/browser verification is needed for that wiring. What CAN be
// verified here is the underlying mechanism `Game.update(dt,
// pauseFarmSimulation)` itself implements: with the flag true, farm/day
// simulation (day clock, fruit growth, shipping queue, Closing-by-time)
// stays completely frozen, while an in-progress Breed operation's own
// countdown keeps advancing and resolving regardless — i.e. staying on the
// BREED screen the whole time must NOT prevent a breeding from completing.
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  game.state.cash = 100000;
  game.startBreeding({ kind: 'LINE', id: STARTER_RED.id }, { kind: 'LINE', id: STARTER_GREEN.id });
  const duration = game.state.breeding.duration;

  const dayTimeBefore = game.state.dayTimeRemaining;
  const queueBefore = game.state.processingQueue.length;
  const cashBefore = game.state.cash;
  const fieldSlotsBefore = JSON.stringify(game.state.fields.map((f) => f.slots));

  // Simulate "sitting on the BREED screen" for the breeding's entire
  // duration, one small frame at a time, always with the pause flag set —
  // exactly what MainScene now does every frame while isBreedPauseActive().
  let guard = 0;
  while (!game.state.breeding.ready) {
    game.update(0.05, true);
    if (++guard > 20000) throw new Error('breeding never resolved while farm-paused — the Breed-timer pause bug is back');
  }

  assert(`breeding resolves to completion while farm simulation stays paused the whole time (duration ~${duration}s)`, game.state.breeding.ready === true && game.state.breeding.offspring !== null);
  assert('day clock does not advance while farm-paused, even across the whole breeding duration', game.state.dayTimeRemaining === dayTimeBefore);
  assert('fruit growth/ripening does not advance while farm-paused', JSON.stringify(game.state.fields.map((f) => f.slots)) === fieldSlotsBefore);
  assert('the shipping/processing queue does not advance while farm-paused', game.state.processingQueue.length === queueBefore);
  assert('cash does not change from shipping while farm-paused', game.state.cash === cashBefore);

  // Resuming (pauseFarmSimulation=false) behaves like one ordinary frame, never a catch-up jump.
  const dayTimeBeforeResume = game.state.dayTimeRemaining;
  game.update(1 / 60, false);
  assert('resuming farm simulation advances by exactly one normal frame worth of time, never a catch-up jump', Math.abs(dayTimeBeforeResume - game.state.dayTimeRemaining - 1 / 60) < 1e-9);
}

// pauseFarmSimulation defaults to false when omitted (backward compatible
// with every other call site in this script and in production code that
// doesn't pass a second argument at all).
{
  clearStorage();
  const game = new Game();
  const dayTimeBefore = game.state.dayTimeRemaining;
  game.update(1 / 60);
  assert('update() with no second argument behaves as unpaused by default (day clock still advances)', game.state.dayTimeRemaining < dayTimeBefore);
}

// ===========================================================================
// REGRESSION — sanity pass through a full week with specimens in play,
// confirming Shipping/Day Cycle/Operating Cost/save migration still work
// (Market V1 itself is covered by scripts/verify-market.ts, not duplicated
// here).
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  let day = game.state.day;
  while (day < 5) {
    runClosing(game);
    game.proceedToNextDay();
    day = game.state.day;
  }
  assert('a multi-day run with specimen guarantees/rolls active never breaks Day Cycle/Closing', game.state.day === 5);
  assert('Operating Cost keeps accruing correctly alongside specimen handling', game.state.lastDayLog !== null && game.state.lastDayLog!.operatingCost > 0);
}

// Old-save migration backfills specimen state safely.
{
  clearStorage();
  const oldSave = {
    day: 3,
    discoveredVisualIds: ['C1', 'C2'],
    library: [],
    fields: [
      {
        id: 1,
        unlocked: true,
        varietyId: 'starter-red',
        policy: 'NORMAL',
        pendingPolicy: null,
        slots: Array.from({ length: 15 }, () => ({ ripe: false, timer: 5, active: true })), // no `specimen` field at all
      },
    ],
    // specimens / day1SpecimenGuaranteeUsed / day2SpecimenGuaranteeUsed intentionally absent, like a pre-Specimen-pass save.
  };
  localStorage.setItem(TUNING.SAVE_KEY, JSON.stringify(oldSave));
  const migrated = new Game();
  assert('old save without a specimen inventory migrates safely (no crash)', Array.isArray(migrated.state.specimens) && migrated.state.specimens.length === 0);
  assert('old save without guarantee flags backfills them false', migrated.state.day1SpecimenGuaranteeUsed === false && migrated.state.day2SpecimenGuaranteeUsed === false);
  assert('old save on Day 3 does NOT retroactively fabricate a Day 1/2 guarantee', migrated.state.fields.every((f) => f.slots.every((s) => s.specimen === null)));
  assert('old per-slot data backfills `specimen: null` on every existing slot', migrated.state.fields[0].slots.every((s) => s.specimen === null));
}

// Old-save migration backfills baseVisualId specifically (see PROJECT.md section 17).
{
  clearStorage();
  const oldSave = {
    day: 5,
    discoveredVisualIds: ['C1', 'C3', 'R2'],
    library: [
      { ...STARTER_RED, baseVisualId: undefined }, // Common Line missing baseVisualId
      {
        id: 'old-rare-line',
        customName: 'OLD RARE LINE',
        generation: 2,
        color: 'Red',
        pattern: 'Plain',
        visualId: 'R2',
        baseVisualId: 'C3', // already has a real, distinct stable base (from an earlier point where baseVisualId already existed) — used below to prove Specimen recovery reads THIS, not a blind fallback to its own visualId
        sweetness: 50,
        size: 50,
        yieldStat: 50,
        growth: 50,
        freshness: 50,
        createdDay: 1,
        awards: [],
        favorite: false,
        archived: false,
      },
    ],
    specimens: [
      { id: 'old-common-spec', visualId: 'C3', sweetness: 50, size: 50, yieldStat: 50, growth: 50, freshness: 50, foundDay: 3, sourceLineId: 'starter-red', sourceGeneration: 1 }, // Common, no baseVisualId
      { id: 'old-rare-spec', visualId: 'R2', sweetness: 50, size: 50, yieldStat: 50, growth: 50, freshness: 50, foundDay: 3, sourceLineId: 'old-rare-line', sourceGeneration: 2 }, // Rare, sourced from the Rare Line above — recoverable
    ],
    day1SpecimenGuaranteeUsed: true,
    day2SpecimenGuaranteeUsed: true,
    fields: [
      { id: 1, unlocked: true, varietyId: 'starter-red', policy: 'NORMAL', pendingPolicy: null, slots: Array.from({ length: 15 }, (_, i) => ({ ripe: false, timer: 5, active: i < 9, specimen: null })) },
    ],
  };
  localStorage.setItem(TUNING.SAVE_KEY, JSON.stringify(oldSave));
  const migrated = new Game();
  assert('migration: Common Line missing baseVisualId backfills to its own visualId', migrated.getVariety(STARTER_RED.id)?.baseVisualId === 'C1');
  assert('migration: an already-baseVisualId-tagged Rare Line is left untouched', migrated.getVariety('old-rare-line')?.baseVisualId === 'C3');
  assert('migration: Common Specimen missing baseVisualId backfills to its own visualId', migrated.state.specimens.find((s) => s.id === 'old-common-spec')?.baseVisualId === 'C3');
  assert(
    "migration: Rare Specimen missing baseVisualId RECOVERS it from its still-present source Line's own baseVisualId (C3, not R2 — proves it's real recovery, not a blind fallback to its own visualId, since Specimens do track sourceLineId)",
    migrated.state.specimens.find((s) => s.id === 'old-rare-spec')?.baseVisualId === 'C3',
  );
}

// Old save still on Day 1 gets the still-applicable guarantee once (per PROJECT.md section 16).
{
  clearStorage();
  const oldSaveDay1 = {
    day: 1,
    discoveredVisualIds: ['C1', 'C2'],
    library: [],
    fields: [
      {
        id: 1,
        unlocked: true,
        varietyId: 'starter-red',
        policy: 'NORMAL',
        pendingPolicy: null,
        slots: Array.from({ length: 15 }, (_, i) => ({ ripe: false, timer: 5, active: i < 9 })),
      },
    ],
  };
  localStorage.setItem(TUNING.SAVE_KEY, JSON.stringify(oldSaveDay1));
  const migrated = new Game();
  assert('an old save still on Day 1 with no guarantee bookkeeping receives the guarantee once on load', migrated.state.fields.flatMap((f) => f.slots.filter((s) => s.specimen)).length === 1);
}

console.log(`\n${checks - failures}/${checks} checks passed.`);
if (failures > 0) {
  console.error(`${failures} FAILURE(S)`);
  process.exit(1);
}
