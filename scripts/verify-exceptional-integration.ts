// Exceptional Specimen genetics — GAMEPLAY INTEGRATION focused verification
// (see PROJECT.md "Exceptional Specimen genetics core" / the implementation
// brief's "VERIFICATION" section). Plain-TS script, run directly with
// Node's built-in type stripping (`node scripts/verify-exceptional-
// integration.ts`), matching scripts/verify-specimens.ts's/verify-
// exceptional-genetics.ts's existing conventions.
//
// Deliberately NOT a re-test of the pure genetics core itself (archetype
// weights, focus-bias tables, 360-cap math) — that's
// scripts/verify-exceptional-genetics.ts's job. This script only proves the
// wiring: Orchard ripening -> persisted FruitSlot -> Specimen inventory ->
// existing Breed integration, per PROJECT.md's "Gameplay integration"
// subsection.
//
// Game.ts's new integration methods (maybeGenerateExceptionalSpecimen) are
// `private` at the TypeScript level only — private is erased at runtime, so
// this script calls them directly via a narrow local cast where a
// deterministic, single-purpose check is far simpler than driving the full
// Orchard ripening loop. Since Game.ts calls the pure genetics core with its
// default `Math.random` (not an injected rng, same convention
// buildSpecimen/rollOrchardSpecimen already use), reaching determinism here
// means temporarily monkeypatching the global Math.random with a queued
// sequence (see withQueuedRandom) — always restored in a `finally`, never
// left patched across test blocks. A handful of true end-to-end checks
// (via Game.update()) confirm the real ripening path is actually wired to
// this method, not just that the method works in isolation.
//
// LIMITATIONS (matching verify-specimens.ts's own documented scope):
// Phaser-rendered UI (the ring indicator actually drawing on the tree,
// Specimen inventory/detail screens) is NOT exercised here — this only
// proves the underlying game-logic/data wiring those views read from.
// "No reroll on screen navigation" has no meaningful headless equivalent
// (there's no screen concept here) — it's proven structurally instead:
// nothing outside the ripening transition ever calls
// maybeGenerateExceptionalSpecimen, so nothing can reroll it, full stop.
import { TUNING } from '../src/game/tuning.ts';
import type { BreedingSpecimen, CultivationPolicy, Field, Variety } from '../src/game/types.ts';
import { STAT_KEYS, generateExceptionalSpecimen, type StatSet } from '../src/game/systems/exceptional.ts';
import { formatExceptionalReveal } from '../src/game/systems/exceptionalReveal.ts';
import { Game } from '../src/game/Game.ts';
import { STARTER_GREEN } from '../src/game/systems/starterLines.ts';

// ---------------------------------------------------------------------------
// Minimal in-memory localStorage polyfill — same as verify-specimens.ts.
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

/** Temporarily replaces global Math.random with a fixed, queued sequence — see file header for why this is needed at the Game.ts integration layer. Always restored, even on throw. */
function withQueuedRandom<T>(values: number[], fn: () => T): T {
  const original = Math.random;
  let i = 0;
  Math.random = () => {
    if (i >= values.length) throw new Error(`queued Math.random exhausted after ${i} call(s) — test miscounted rng() calls`);
    return values[i++];
  };
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

/** Temporarily pins Math.random to a single constant for every call — used where the exact call count doesn't matter (e.g. proving a day-gate short-circuits before any rng is consumed at all). */
function withConstantRandom<T>(v: number, fn: () => T): T {
  const original = Math.random;
  Math.random = () => v;
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

type PrivateGame = Game & {
  maybeGenerateExceptionalSpecimen(sourceVariety: Variety, policy: CultivationPolicy): BreedingSpecimen | null;
};

function callExceptionalRoll(game: Game, sourceVariety: Variety, policy: CultivationPolicy): BreedingSpecimen | null {
  return (game as PrivateGame).maybeGenerateExceptionalSpecimen(sourceVariety, policy);
}

function runClosing(game: Game): void {
  game.beginClosing();
  let guard = 0;
  while (!game.state.dayEnded) {
    game.update(0.05);
    if (++guard > 20000) throw new Error('Closing never finished — regression in Shipping/Day Cycle');
  }
}

function advanceToDay(game: Game, targetDay: number): void {
  while (game.state.day < targetDay) {
    runClosing(game);
    game.proceedToNextDay();
  }
}

// A queued Math.random sequence that reliably produces a non-meaningless
// TRAIT_OUTLIER (a Stat clearly increased over source) when fed into
// maybeGenerateExceptionalSpecimen: [occurrence-roll pass, archetype ->
// TRAIT_OUTLIER, focus-stat pick, focusIncrease magnitude, totalDelta
// magnitude]. focusRoll=0.05 lands in the FIRST STAT_KEYS bucket
// (sweetness) under every policy's weight table (every policy's first
// bucket starts at 0 and is always > 0.05 wide — NORMAL 20%, SWEETEN/
// GROW_BIG's own boosted stat 60%, and even the smallest 10% "other" slots
// used for non-boosted stats are still wider than 0.05), so this queue is
// policy-agnostic for the FIRST stat specifically; the CULTIVATION section
// below uses a different, deliberately discriminating focusRoll instead.
const TRAIT_OUTLIER_QUEUE = [0.0, 0.1, 0.05, 0.5, 0.5];

// At Day 3 (Rare unlocked Day 4, Epic Day 6), the Line Affinity System's
// Stage A roll (rollGlobalRarity, see systems/lineAffinity.ts) ALWAYS
// resolves to COMMON regardless of rng value — there is no more "the tier
// roll misses" case to construct (Common is the deterministic complement of
// Rare+Epic, not a separate probability-gated outcome). The two-stage roll
// still unconditionally CONSUMES exactly 2 rng() calls before falling
// through to maybeGenerateExceptionalSpecimen, though — these two
// placeholder values exist purely to satisfy that consumption; their exact
// values don't matter at Day 3.
const DAY3_TIER_ROLL_PLACEHOLDER = [0.5, 0.5];

function fakeVariety(overrides: Partial<Variety> = {}): Variety {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    customName: overrides.customName ?? 'TEST LINE',
    generation: overrides.generation ?? 1,
    color: overrides.color ?? 'Red',
    pattern: overrides.pattern ?? 'Plain',
    visualId: overrides.visualId ?? 'C1',
    baseVisualId: overrides.baseVisualId ?? (overrides.visualId ?? 'C1'),
    sweetness: overrides.sweetness ?? 50,
    size: overrides.size ?? 50,
    yieldStat: overrides.yieldStat ?? 50,
    growth: overrides.growth ?? 50,
    freshness: overrides.freshness ?? 50,
    createdDay: overrides.createdDay ?? 1,
    awards: overrides.awards ?? [],
    favorite: overrides.favorite ?? false,
    archived: overrides.archived ?? false,
  };
}

// ===========================================================================
// ROLL ORDER
// ===========================================================================
{
  assert('occurrence chance constant is exactly 0.006 (reused from the genetics core, never redefined here)', TUNING.EXCEPTIONAL_OCCURRENCE_CHANCE === 0.006);

  assert('EXCEPTIONAL_START_DAY is exactly 3 (its own dedicated constant, not SPECIMEN_RANDOM_START_DAY)', TUNING.EXCEPTIONAL_START_DAY === 3);

  // No Exceptional on Day 1 or Day 2 — proven with rng pinned to a value
  // that would trivially pass every downstream chance check if the day
  // gate didn't short-circuit first (rollFruitOutcomeForSlot checks its own
  // `day >= SPECIMEN_RANDOM_START_DAY` before even running the two-stage
  // roll; maybeGenerateExceptionalSpecimen checks its own, separate
  // `day < EXCEPTIONAL_START_DAY` — see the decoupling proof further below).
  {
    clearStorage();
    const game = new Game();
    const field = game.state.fields[0] as Field;
    const targetIdx = field.slots.findIndex((s) => s.active && !s.specimen);
    field.slots[targetIdx].ripe = false;
    field.slots[targetIdx].timer = 0.0001;
    withConstantRandom(0, () => game.update(0.001));
    assert('Day 1: an ordinary ripening fruit never becomes Exceptional, even with rng pinned to always-succeed', field.slots[targetIdx].specimen === null);

    advanceToDay(game, 2);
    const field2 = game.state.fields[0] as Field;
    const targetIdx2 = field2.slots.findIndex((s) => s.active && !s.specimen);
    field2.slots[targetIdx2].ripe = false;
    field2.slots[targetIdx2].timer = 0.0001;
    withConstantRandom(0, () => game.update(0.001));
    assert('Day 2: an ordinary ripening fruit never becomes Exceptional, even with rng pinned to always-succeed', field2.slots[targetIdx2].specimen === null);
  }

  // Day 3+ eligible: the exact same pinned-rng ripening, one day later, DOES produce one.
  {
    clearStorage();
    const game = new Game();
    advanceToDay(game, 3);
    const field = game.state.fields[0] as Field;
    const targetIdx = field.slots.findIndex((s) => s.active && !s.specimen);
    field.slots[targetIdx].ripe = false;
    field.slots[targetIdx].timer = 0.0001;
    // At Day 3 the two-stage roll always resolves to COMMON (see
    // DAY3_TIER_ROLL_PLACEHOLDER above), so it always falls through to the
    // Exceptional branch; occurrence/archetype/focus rolls all pinned to succeed.
    withQueuedRandom([...DAY3_TIER_ROLL_PLACEHOLDER, ...TRAIT_OUTLIER_QUEUE], () => game.update(0.001));
    assert('Day 3+: an ordinary ripening fruit CAN become a Genetic Exceptional Specimen', field.slots[targetIdx].specimen?.exceptionalArchetype === 'TRAIT_OUTLIER');
  }

  // A Rare/Epic-tier fruit-outcome roll wins priority over Exceptional — the
  // two-stage roll's own early `return` (see Game.ts's rollFruitOutcomeForSlot)
  // means maybeGenerateExceptionalSpecimen is never even reached for a fruit
  // that already became a physical Specimen this way. Under the new Line
  // Affinity System, COMMON tier NEVER produces a Specimen object anymore
  // (only `slot.commonVisualId` on ordinary fruit) — the old "Common
  // Specimen" mechanic this test used to exercise no longer exists — so this
  // now uses Day 4 (Rare unlocked) with rng pinned to 0, which deterministically
  // resolves Stage A to RARE (0 < TUNING.SPECIMEN_RARE_CHANCE) and Stage B to
  // the pool's first candidate.
  {
    clearStorage();
    const game = new Game();
    advanceToDay(game, 4);
    const field = game.state.fields[0] as Field;
    const targetIdx = field.slots.findIndex((s) => s.active && !s.specimen);
    field.slots[targetIdx].ripe = false;
    field.slots[targetIdx].timer = 0.0001;
    withConstantRandom(0, () => game.update(0.001)); // 0 < every threshold this path can hit
    const specimen = field.slots[targetIdx].specimen;
    assert('setup sanity: the two-stage roll actually produced a Rare/Epic-tier Specimen', !!specimen);
    assert('a fruit that already produced a Rare/Epic-tier Specimen never also carries Exceptional metadata', specimen?.exceptionalArchetype === undefined);
    assert(
      'the Rare/Epic-tier Specimen shows a visual from a different rarity tier than the source Line (proof it took the two-stage-roll branch, not a coincidentally-null Exceptional one)',
      specimen?.visualId !== game.getVariety(field.varietyId!)?.baseVisualId,
    );
  }

  // One fruit cannot contain both types — structural: a single FieldFruitSlot
  // has exactly one `specimen` reference, and the function above returns
  // immediately once either branch assigns it (see Game.ts's rollFruitOutcomeForSlot).
  // The two checks above (priority test's exceptionalArchetype===undefined,
  // and the Day-3+ eligible test's exceptionalArchetype==='TRAIT_OUTLIER' with
  // a visualId equal to the source's own base — see IDENTITY section) already
  // demonstrate both branches are mutually exclusive outcomes of one roll.

  // Decoupling proof: EXCEPTIONAL_START_DAY, NOT SPECIMEN_RANDOM_START_DAY,
  // is what actually gates Exceptional eligibility. TUNING is a plain
  // object (not frozen), so SPECIMEN_RANDOM_START_DAY is temporarily
  // mutated far past Day 3 — always restored in a `finally` — while
  // EXCEPTIONAL_START_DAY stays untouched at 3.
  {
    clearStorage();
    const game = new Game();
    advanceToDay(game, 3);
    const field = game.state.fields[0] as Field;
    const targetIdx = field.slots.findIndex((s) => s.active && !s.specimen);
    field.slots[targetIdx].ripe = false;
    field.slots[targetIdx].timer = 0.0001;

    const mutableTuning = TUNING as unknown as { SPECIMEN_RANDOM_START_DAY: number };
    const originalSpecimenStartDay = mutableTuning.SPECIMEN_RANDOM_START_DAY;
    mutableTuning.SPECIMEN_RANDOM_START_DAY = 99; // the two-stage roll's own gate now structurally can't fire on Day 3 at all
    try {
      // With the two-stage-roll gate pushed out, rollFruitOutcomeForSlot's
      // own day-check short-circuits before consuming any rng at all, so the
      // queue starts directly at the Exceptional occurrence roll (no
      // leading placeholder values needed here, unlike the Day-3+ test above).
      withQueuedRandom(TRAIT_OUTLIER_QUEUE, () => game.update(0.001));
    } finally {
      mutableTuning.SPECIMEN_RANDOM_START_DAY = originalSpecimenStartDay;
    }
    assert(
      'Exceptional still generates on Day 3 even with SPECIMEN_RANDOM_START_DAY mutated far past Day 3 — proves EXCEPTIONAL_START_DAY (unchanged, still 3), not SPECIMEN_RANDOM_START_DAY, is what actually gates Exceptional eligibility',
      field.slots[targetIdx].specimen?.exceptionalArchetype === 'TRAIT_OUTLIER',
    );
  }
}

// ===========================================================================
// CULTIVATION
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  // maybeGenerateExceptionalSpecimen day-gates on state.day itself — set
  // directly rather than via advanceToDay (no ripening loop is involved in
  // these direct-call tests, so there's nothing to actually simulate).
  game.state.day = 3;
  const normalSource = fakeVariety({ sweetness: 40, size: 40, yieldStat: 40, growth: 40, freshness: 40 });

  // Same exact rng sequence, only the policy differs -> different focus Stat
  // picked, proving the Field's policy is genuinely threaded into the
  // generator (never a no-op parameter). focusRoll=0.3 lands in NORMAL's
  // "size" bucket (20/40/60/80/100%) but SWEETEN's "sweetness" bucket
  // (0/60%) — see TUNING.EXCEPTIONAL_FOCUS_BIAS.
  const queue = [0.0, 0.1, 0.3, 0.5, 0.5]; // occurrence pass, TRAIT_OUTLIER, focusRoll=0.3, focusIncrease, totalDelta
  const normalResult = withQueuedRandom(queue, () => callExceptionalRoll(game, normalSource, 'NORMAL'));
  const sweetenResult = withQueuedRandom(queue, () => callExceptionalRoll(game, normalSource, 'SWEETEN'));
  assert('NORMAL Cultivation (even weights) with focusRoll=0.3 picks SIZE', normalResult?.exceptionalFocusStat === 'size' && normalResult.size > normalSource.size);
  assert('SWEETEN Cultivation (60% Sweetness bias) with the SAME rng sequence instead picks SWEETNESS', sweetenResult?.exceptionalFocusStat === 'sweetness' && sweetenResult.sweetness > normalSource.sweetness);
  assert("Field's current Cultivation policy is genuinely passed into the Exceptional generator (different focus Stat from identical rng, per-policy)", normalResult?.exceptionalFocusStat !== sweetenResult?.exceptionalFocusStat);

  // Cultivation never changes the 0.6% occurrence chance itself — the
  // occurrence roll is consumed and compared BEFORE the policy-only focus
  // bias is ever reached, so the exact same occurrence-roll value either
  // passes or fails identically regardless of which policy is passed in.
  const justBelow = TUNING.EXCEPTIONAL_OCCURRENCE_CHANCE - 0.0001;
  const justAtOrAbove = TUNING.EXCEPTIONAL_OCCURRENCE_CHANCE;
  for (const policy of ['NORMAL', 'SWEETEN', 'GROW_BIG'] as CultivationPolicy[]) {
    const passes = withQueuedRandom([justBelow, 0.1, 0.05, 0.5, 0.5], () => callExceptionalRoll(game, normalSource, policy));
    const fails = withQueuedRandom([justAtOrAbove], () => callExceptionalRoll(game, normalSource, policy));
    assert(`${policy}: an occurrence roll just BELOW 0.6% still succeeds (policy never loosens/tightens the gate)`, passes !== null);
    assert(`${policy}: an occurrence roll AT/ABOVE 0.6% still fails (policy never loosens/tightens the gate)`, fails === null);
  }
}

// ===========================================================================
// GENERATION
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  game.state.day = 3;
  const source = fakeVariety({ sweetness: 55, size: 58, yieldStat: 60, growth: 54, freshness: 56 }); // TOTAL 283

  const result = withQueuedRandom(TRAIT_OUTLIER_QUEUE, () => callExceptionalRoll(game, source, 'NORMAL'));
  assert('setup sanity: the queued sequence produced a TRAIT_OUTLIER result', result?.exceptionalArchetype === 'TRAIT_OUTLIER');
  assert("source Line's own Stats are what's actually read as the generation source (the focus Stat visibly increased from THIS source's own sweetness)", result!.sweetness > source.sweetness && result?.exceptionalFocusStat === 'sweetness');

  // "Verbatim, not re-derived/duplicated": feed the exact same source Stats
  // + policy + rng sequence (minus the one occurrence-roll value Game.ts
  // itself consumes before ever calling the core) directly into the pure
  // genetics core and confirm byte-identical output.
  const sourceStatSet: StatSet = { sweetness: source.sweetness, size: source.size, yieldStat: source.yieldStat, growth: source.growth, freshness: source.freshness };
  let qi = 0;
  const directQueue = TRAIT_OUTLIER_QUEUE.slice(1); // drop the occurrence-roll value
  const directResult = generateExceptionalSpecimen(sourceStatSet, 'NORMAL', () => directQueue[qi++]);
  assert(
    "Game.ts uses the genetics core's output verbatim — no separate/duplicated stat math in Game.ts itself",
    STAT_KEYS.every((k) => result![k] === directResult.stats[k]) && result?.exceptionalArchetype === directResult.archetype && result?.exceptionalFocusStat === directResult.focusStat,
  );

  // Meaningless-result guard: a source already at the 360 cap makes
  // HIGH_POTENTIAL degrade to an exactly-unchanged source (its valid
  // mathematical fallback) — this must NOT become an Exceptional Specimen.
  const cappedSource = fakeVariety({ sweetness: 72, size: 72, yieldStat: 72, growth: 72, freshness: 72 }); // TOTAL 360
  const cappedQueue = [0.0, 0.7, 0.5]; // occurrence pass, archetype -> HIGH_POTENTIAL (0.6..0.95), totalDelta
  const cappedResult = withQueuedRandom(cappedQueue, () => callExceptionalRoll(game, cappedSource, 'NORMAL'));
  assert('a meaningless (unchanged-from-source) generated result creates NO Exceptional Specimen', cappedResult === null);

  // No reroll/retry after a meaningless result: the queue above has exactly
  // 3 values and callExceptionalRoll only consumed exactly that many (proven
  // by withQueuedRandom's own "exhausted" guard never firing) — a
  // reroll/retry loop would have consumed more and thrown.
  assert('no reroll/retry was attempted after the meaningless result (queued rng was not over-consumed)', true);
}

// ===========================================================================
// IDENTITY
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  game.state.day = 3;

  const commonLine = fakeVariety({ visualId: 'C1', baseVisualId: 'C1' });
  const commonResult = withQueuedRandom(TRAIT_OUTLIER_QUEUE, () => callExceptionalRoll(game, commonLine, 'NORMAL'));
  assert('Common Line Exceptional uses its own base Common visual', commonResult?.visualId === 'C1' && commonResult?.baseVisualId === 'C1');

  const rareLine = fakeVariety({ visualId: 'R2', baseVisualId: 'C1' }); // Rare identity, stable Common production base
  const rareResult = withQueuedRandom(TRAIT_OUTLIER_QUEUE, () => callExceptionalRoll(game, rareLine, 'NORMAL'));
  assert('Rare Line Exceptional ALSO uses the base Common visual, never its Rare identity', rareResult?.visualId === 'C1' && rareResult?.baseVisualId === 'C1');
  assert('Exceptional never inherits the Rare/Epic visualId automatically', rareResult?.visualId !== rareLine.visualId);
}

// ===========================================================================
// PERSISTENCE
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  advanceToDay(game, 3);
  const field = game.state.fields[0] as Field;
  const targetIdx = field.slots.findIndex((s) => s.active && !s.specimen);
  field.slots[targetIdx].ripe = false;
  field.slots[targetIdx].timer = 0.0001;
  withQueuedRandom([...DAY3_TIER_ROLL_PLACEHOLDER, ...TRAIT_OUTLIER_QUEUE], () => game.update(0.001));
  const before = JSON.parse(JSON.stringify(field.slots[targetIdx].specimen));
  assert('setup sanity: specimen is created exactly at ripening', before.exceptionalArchetype === 'TRAIT_OUTLIER');

  game.save();
  const reloaded = new Game();
  const reloadedField = reloaded.state.fields[0] as Field;
  const reloadedSpecimen = reloadedField.slots[targetIdx].specimen;
  assert('the exact specimen object persists on the FruitSlot across reload', JSON.stringify(reloadedSpecimen) === JSON.stringify(before));
  assert('reload preserves id/archetype/focus/stats identically (no reroll)', reloadedSpecimen?.id === before.id && reloadedSpecimen?.exceptionalArchetype === before.exceptionalArchetype && reloadedSpecimen?.exceptionalFocusStat === before.exceptionalFocusStat);
}

// ===========================================================================
// HARVEST
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  advanceToDay(game, 3);
  const field = game.state.fields[0] as Field;
  const targetIdx = field.slots.findIndex((s) => s.active && !s.specimen);
  field.slots[targetIdx].ripe = false;
  field.slots[targetIdx].timer = 0.0001;
  withQueuedRandom([...DAY3_TIER_ROLL_PLACEHOLDER, ...TRAIT_OUTLIER_QUEUE], () => game.update(0.001));
  const exceptionalId = field.slots[targetIdx].specimen!.id;

  const cashBefore = game.state.cash;
  const queueLenBefore = game.state.processingQueue.length;
  const harvested = game.harvestFruitSlot(field.id, targetIdx);
  assert('harvest returns true for a ripe Exceptional Specimen slot', harvested);
  assert('Exceptional enters GameState.specimens with the exact same id', game.state.specimens.some((s) => s.id === exceptionalId && s.exceptionalArchetype === 'TRAIT_OUTLIER'));
  assert('no Packing/Processing Queue item is created for it', game.state.processingQueue.length === queueLenBefore);
  assert('no normal sale revenue is paid for it', game.state.cash === cashBefore);
  assert("the ripe fruit slot is consumed (specimen cleared, no longer ripe on that exact slot)", field.slots[targetIdx].specimen === null && field.slots[targetIdx].ripe === false);
}

// ===========================================================================
// PACKING FULL / HARVEST ALL
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  advanceToDay(game, 3);
  const field = game.state.fields[0] as Field;
  const targetIdx = field.slots.findIndex((s) => s.active && !s.specimen);
  field.slots[targetIdx].ripe = false;
  field.slots[targetIdx].timer = 0.0001;
  withQueuedRandom([...DAY3_TIER_ROLL_PLACEHOLDER, ...TRAIT_OUTLIER_QUEUE], () => game.update(0.001));
  assert('setup sanity: an Exceptional Specimen is ripe on the tree', field.slots[targetIdx].specimen?.exceptionalArchetype === 'TRAIT_OUTLIER');

  // Deterministically force one ORDINARY (non-specimen) slot ripe too —
  // directly flipping ripe/timer, never through the ripening transition, so
  // it can never itself roll a specimen — so the "blocked while full" check
  // below always has something real to exercise rather than depending on
  // whatever background growth happened to leave ripe.
  const normalRipeIdx = field.slots.findIndex((s, i) => i !== targetIdx && s.active && !s.specimen);
  field.slots[normalRipeIdx].ripe = true;
  field.slots[normalRipeIdx].timer = 0;

  // Fill Packing to capacity with dummy items so a normal apple harvest is blocked.
  const capacity = game.packingCapacity();
  while (game.state.processingQueue.length < capacity) {
    game.state.processingQueue.push({ fieldId: field.id, value: 1, baseValue: 1, freshness: 50, packingWaitSeconds: 0 });
  }

  const queueLenBefore = game.state.processingQueue.length;
  const blockedHarvest = game.harvestFruitSlot(field.id, normalRipeIdx);
  assert('a normal ripe apple is blocked while Packing is full (unchanged existing behavior)', !blockedHarvest && field.slots[normalRipeIdx].ripe === true);

  const exceptionalHarvest = game.harvestFruitSlot(field.id, targetIdx);
  assert('the Exceptional Specimen still harvests while Packing is completely full (capacity-exempt, same as any other Specimen)', exceptionalHarvest);
  assert('harvesting the Exceptional while full did not add a Packing item', game.state.processingQueue.length === queueLenBefore);
}

// HARVEST ALL: Exceptional collected, blocked normal fruit left untouched.
{
  clearStorage();
  const game = new Game();
  advanceToDay(game, 3);
  const field = game.state.fields[0] as Field;
  const targetIdx = field.slots.findIndex((s) => s.active && !s.specimen);
  field.slots[targetIdx].ripe = false;
  field.slots[targetIdx].timer = 0.0001;
  withQueuedRandom([...DAY3_TIER_ROLL_PLACEHOLDER, ...TRAIT_OUTLIER_QUEUE], () => game.update(0.001));

  // Deterministically force one ORDINARY ripe slot too — see the identical
  // technique/rationale in the PACKING FULL block above.
  const normalRipeIdx = field.slots.findIndex((s, i) => i !== targetIdx && s.active && !s.specimen);
  field.slots[normalRipeIdx].ripe = true;
  field.slots[normalRipeIdx].timer = 0;

  const capacity = game.packingCapacity();
  while (game.state.processingQueue.length < capacity) {
    game.state.processingQueue.push({ fieldId: field.id, value: 1, baseValue: 1, freshness: 50, packingWaitSeconds: 0 });
  }

  const ripeBefore = field.slots.map((s, i) => (s.ripe ? i : -1)).filter((i) => i >= 0);
  // Only TRUE ordinary fruit (no specimen at all) can ever be blocked by
  // Packing capacity — any OTHER specimen-bearing ripe slot (e.g. a
  // still-unharvested Day1/Day2 guarantee) is just as capacity-exempt as
  // the Exceptional one, so it must be excluded from this "should stay
  // blocked" set.
  const normalRipeBefore = ripeBefore.filter((i) => i !== targetIdx && !field.slots[i].specimen);
  assert('setup sanity: at least one ordinary ripe apple is present to prove the block', normalRipeBefore.includes(normalRipeIdx));
  // Same technique verify-specimens.ts uses to simulate the HARVEST ALL button: attempt every currently-ripe slot through harvestFruitSlot.
  for (const i of ripeBefore) game.harvestFruitSlot(field.id, i);

  assert('HARVEST ALL collects the Exceptional Specimen even while Packing is full', game.state.specimens.some((s) => s.exceptionalArchetype === 'TRAIT_OUTLIER'));
  const stillBlockedCount = normalRipeBefore.filter((i) => field.slots[i].ripe).length;
  assert('HARVEST ALL leaves blocked normal ripe fruit untouched (still ripe, not deleted, not revenue)', stillBlockedCount === normalRipeBefore.length);
}

// ===========================================================================
// BREED
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  game.state.cash = 100000;
  advanceToDay(game, 3);
  const field = game.state.fields[0] as Field;
  const targetIdx = field.slots.findIndex((s) => s.active && !s.specimen);
  field.slots[targetIdx].ripe = false;
  field.slots[targetIdx].timer = 0.0001;
  withQueuedRandom([...DAY3_TIER_ROLL_PLACEHOLDER, ...TRAIT_OUTLIER_QUEUE], () => game.update(0.001));
  const exceptionalId = field.slots[targetIdx].specimen!.id;
  game.harvestFruitSlot(field.id, targetIdx);
  assert('setup sanity: the harvested Exceptional is held in the inventory', game.state.specimens.some((s) => s.id === exceptionalId));

  const ok = game.startBreeding({ kind: 'SPECIMEN', id: exceptionalId }, { kind: 'LINE', id: STARTER_GREEN.id });
  assert('a harvested Exceptional Specimen works as a valid existing Breed parent (Specimen x Line)', ok);
  assert('the Exceptional Specimen is consumed (one-use) the instant BREED starts, same as any other Specimen', !game.state.specimens.some((s) => s.id === exceptionalId));

  // Resolve and KEEP so the game is left in a clean, idle state.
  game.state.breeding.elapsed = game.state.breeding.duration;
  game.update(0);
  game.keepOffspring('A');
  assert('no new Breed path was introduced — the standard startBreeding/keepOffspring flow handled it end to end', game.state.breeding.ready === false);

  // Same-specimen-both-slots rule still applies to an Exceptional the same as any other Specimen.
  const field2 = game.state.fields[0] as Field;
  const targetIdx2 = field2.slots.findIndex((s) => s.active && !s.specimen);
  field2.slots[targetIdx2].ripe = false;
  field2.slots[targetIdx2].timer = 0.0001;
  withQueuedRandom([...DAY3_TIER_ROLL_PLACEHOLDER, ...TRAIT_OUTLIER_QUEUE], () => game.update(0.001));
  const secondId = field2.slots[targetIdx2].specimen!.id;
  game.harvestFruitSlot(field2.id, targetIdx2);
  const rejectedOk = game.startBreeding({ kind: 'SPECIMEN', id: secondId }, { kind: 'SPECIMEN', id: secondId });
  assert('the same Exceptional Specimen id cannot occupy both parent slots (existing Specimen rule, unchanged)', !rejectedOk);
  assert('a rejected same-specimen attempt does not consume it', game.state.specimens.some((s) => s.id === secondId));
}

// ===========================================================================
// MIGRATION
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  advanceToDay(game, 4); // Rare unlocked — see the "priority" test above for why Day 3 can no longer produce a Specimen at all
  const field = game.state.fields[0] as Field;
  const targetIdx = field.slots.findIndex((s) => s.active && !s.specimen);
  field.slots[targetIdx].ripe = false;
  field.slots[targetIdx].timer = 0.0001;
  // A plain Rare-tier Specimen (rng=0 deterministically resolves Stage A to
  // RARE and Stage B to the pool's first candidate — see the "priority" test
  // above) — never touched by this pass's fields, exactly the old-shaped
  // "no Exceptional metadata" Specimen this migration test needs.
  withConstantRandom(0, () => game.update(0.001));
  const ordinarySpecimen = field.slots[targetIdx].specimen!;
  assert('setup sanity: an ordinary Rare-tier Specimen was produced', ordinarySpecimen.exceptionalArchetype === undefined);

  game.harvestFruitSlot(field.id, targetIdx);
  const beforeSave = JSON.parse(JSON.stringify(game.state.specimens.find((s) => s.id === ordinarySpecimen.id)));
  assert('an old-shaped (pre-this-pass) Specimen has no Exceptional metadata at all', !('exceptionalArchetype' in beforeSave) || beforeSave.exceptionalArchetype === undefined);

  game.save();
  const reloaded = new Game();
  const reloadedSpecimen = reloaded.state.specimens.find((s) => s.id === ordinarySpecimen.id);
  assert('the old save loads safely with no crash', !!reloadedSpecimen);
  assert('the optional Exceptional fields safely default to undefined on load, never fabricated', reloadedSpecimen?.exceptionalArchetype === undefined && reloadedSpecimen?.exceptionalFocusStat == null);
  assert('no old specimen is reinterpreted — every other field is byte-identical after reload', JSON.stringify(reloadedSpecimen) === JSON.stringify(beforeSave));
}

// ===========================================================================
// REGRESSION (light, structural — the full suites are re-run separately)
// ===========================================================================
{
  assert('STAT_KEYS is still the canonical 5-key order shared with the genetics core (no divergent local copy in Game.ts)', STAT_KEYS.length === 5 && STAT_KEYS[0] === 'sweetness' && STAT_KEYS[4] === 'freshness');
  // SPECIMEN_COMMON_CHANCE is vestigial under the Line Affinity System (no
  // longer read by rollGlobalRarity — Common is now the complement of
  // Rare+Epic, not its own probability-gated rate) but the constant itself
  // is untouched, same value, same as SPECIMEN_RARE_CHANCE/EPIC_CHANCE
  // (which ARE still actively read as the global Rare/Epic rates).
  assert('existing Day-3+ base-rate TUNING constants are untouched by this pass (same values, not redefined)', TUNING.SPECIMEN_COMMON_CHANCE === 0.003 && TUNING.SPECIMEN_RARE_CHANCE === 0.0005 && TUNING.SPECIMEN_EPIC_CHANCE === 0.00005);
  assert('the existing Visual/Common/Rare/Epic Specimen start-day rule (SPECIMEN_RANDOM_START_DAY) is untouched by the EXCEPTIONAL_START_DAY split', TUNING.SPECIMEN_RANDOM_START_DAY === 3);
}

// ===========================================================================
// REVEAL FORMATTING (see PROJECT.md "Exceptional discovery/reveal UX" —
// systems/exceptionalReveal.ts is pure string logic, so this is exercised
// directly here rather than needing the Phaser-rendered ToastQueue).
// ===========================================================================
{
  function fakeSpecimen(overrides: Partial<BreedingSpecimen> = {}): BreedingSpecimen {
    return {
      id: overrides.id ?? crypto.randomUUID(),
      visualId: overrides.visualId ?? 'C1',
      baseVisualId: overrides.baseVisualId ?? 'C1',
      sweetness: overrides.sweetness ?? 50,
      size: overrides.size ?? 50,
      yieldStat: overrides.yieldStat ?? 50,
      growth: overrides.growth ?? 50,
      freshness: overrides.freshness ?? 50,
      foundDay: overrides.foundDay ?? 3,
      sourceLineId: overrides.sourceLineId ?? 'fake-line',
      sourceGeneration: overrides.sourceGeneration ?? 1,
      exceptionalArchetype: overrides.exceptionalArchetype,
      exceptionalFocusStat: overrides.exceptionalFocusStat,
    };
  }

  const sourceStats: StatSet = { sweetness: 50, size: 40, yieldStat: 50, growth: 50, freshness: 50 };

  // TRAIT_OUTLIER: focus Stat clearly up (source total 240, only size changed).
  const traitSpecimen = fakeSpecimen({ exceptionalArchetype: 'TRAIT_OUTLIER', exceptionalFocusStat: 'size', size: 54, sweetness: 50, yieldStat: 50, growth: 50, freshness: 50 });
  const traitText = formatExceptionalReveal(traitSpecimen, sourceStats);
  assert('TRAIT_OUTLIER reveal shows the archetype label', traitText.includes('TRAIT OUTLIER'));
  assert('TRAIT_OUTLIER reveal derives the correct focus Stat delta (54-40 = +14)', traitText.includes('SIZE +14'));
  assert('TRAIT_OUTLIER reveal derives the correct TOTAL delta (254-240 = +14)', traitText.includes('TOTAL +14'));
  assert('TRAIT_OUTLIER reveal always includes the saved-as-specimen line', traitText.includes('SAVED AS BREEDING SPECIMEN'));

  // HIGH_POTENTIAL: no focus Stat — only archetype + TOTAL delta, no Stat delta line at all.
  const highSpecimen = fakeSpecimen({ exceptionalArchetype: 'HIGH_POTENTIAL', exceptionalFocusStat: null, sweetness: 55, size: 44, yieldStat: 55, growth: 55, freshness: 55 });
  const highText = formatExceptionalReveal(highSpecimen, sourceStats);
  assert('HIGH_POTENTIAL reveal shows the archetype label', highText.includes('HIGH POTENTIAL'));
  assert('HIGH_POTENTIAL reveal derives the correct TOTAL delta (264-240 = +24)', highText.includes('TOTAL +24'));
  assert('HIGH_POTENTIAL reveal never shows a per-Stat delta line (no focus Stat exists)', !/SWEETNESS|SIZE \+|YIELD|GROWTH|FRESHNESS \+/.test(highText.split('\n').slice(2, -2).join('\n')));

  // ELITE_OUTLIER: focus Stat AND TOTAL both clearly up.
  const eliteSpecimen = fakeSpecimen({ exceptionalArchetype: 'ELITE_OUTLIER', exceptionalFocusStat: 'sweetness', sweetness: 61, size: 45, yieldStat: 52, growth: 51, freshness: 51 });
  const eliteText = formatExceptionalReveal(eliteSpecimen, sourceStats);
  assert('ELITE_OUTLIER reveal shows the archetype label', eliteText.includes('ELITE OUTLIER'));
  assert('ELITE_OUTLIER reveal derives the correct focus Stat delta (61-50 = +11)', eliteText.includes('SWEETNESS +11'));
  assert('ELITE_OUTLIER reveal derives the correct TOTAL delta (260-240 = +20)', eliteText.includes('TOTAL +20'));

  // Missing source Line: degrades safely to absolute values instead of a delta — never throws.
  let degradedText = '';
  let threw = false;
  try {
    degradedText = formatExceptionalReveal(traitSpecimen, undefined);
  } catch {
    threw = true;
  }
  assert('a missing source Line does not throw — degrades safely instead', !threw);
  assert('degraded reveal shows the absolute focus Stat value (54), not a delta', degradedText.includes('SIZE 54'));
  assert('degraded reveal shows the absolute TOTAL value (254), not a delta', degradedText.includes('TOTAL 254'));

  // Ordinary (non-Exceptional) specimen never gets a reveal string at all — the
  // "no Exceptional label on an ordinary specimen" guard for this formatter.
  const ordinarySpecimen = fakeSpecimen({});
  assert('an ordinary (non-Exceptional) specimen produces no reveal text', formatExceptionalReveal(ordinarySpecimen, sourceStats) === '');
}

// ===========================================================================
// DEV FORCE PATH (Game.debugForceExceptional — see PROJECT.md "Exceptional
// discovery/reveal UX"). Production-inaccessibility is structural, not
// something a headless script can prove: the method is only ever reachable
// via the DEV-only `window.__debugGame` console exposure wired in
// MainScene.create()'s `import.meta.env.DEV` block, and is never wired to
// any UI/button — see that file and PROJECT.md for the actual gate. What
// IS checked here is that the method produces a real, valid, harvestable
// Exceptional Specimen through the same record shape gameplay uses, and
// safely no-ops when there's nothing valid to force.
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  const field = game.state.fields[0] as Field;

  const forced = game.debugForceExceptional(field.id);
  assert('debugForceExceptional succeeds against a planted Field with a free active slot', forced);
  const slotIndex = field.slots.findIndex((s) => s.specimen?.exceptionalArchetype);
  const slot = slotIndex >= 0 ? field.slots[slotIndex] : undefined;
  assert('the forced slot is ripe with a valid Exceptional Specimen', !!slot && slot.ripe === true);
  assert('the forced Specimen has a valid archetype', ['TRAIT_OUTLIER', 'HIGH_POTENTIAL', 'ELITE_OUTLIER'].includes(slot!.specimen!.exceptionalArchetype!));
  assert('the forced Specimen carries the current day as foundDay', slot!.specimen!.foundDay === game.state.day);

  const forcedId = slot!.specimen!.id;
  const harvested = game.harvestFruitSlot(field.id, slotIndex);
  assert('the forced Specimen harvests through the normal harvestFruitSlot path, same as a real one', harvested);
  assert('it lands in the held Specimen inventory like any other Exceptional', game.state.specimens.some((s) => s.id === forcedId));

  assert('debugForceExceptional safely no-ops (returns false) against a nonexistent Field id', game.debugForceExceptional(9999) === false);

  assert("debugForceExceptional never touches TUNING's occurrence/day-gate constants", TUNING.EXCEPTIONAL_OCCURRENCE_CHANCE === 0.006 && TUNING.EXCEPTIONAL_START_DAY === 3);
}

console.log(`\n${checks - failures}/${checks} checks passed.`);
if (failures > 0) {
  console.error(`${failures} FAILURE(S)`);
  process.exit(1);
}
