// Field Rarity Model V2 LIVE INTEGRATION verification (Pass 3B — see
// PROJECT.md "Field Rarity + Line Affinity Probability Model V2" and this
// pass's own implementation brief "VERIFICATION" sections 18-21). Plain-TS
// script, run directly with Node's built-in type stripping (`node
// scripts/verify-orchard-rarity-integration.ts`), matching
// scripts/verify-field-rarity-model.ts's own convention.
//
// scripts/verify-field-rarity-model.ts already proves fieldRarityModel.ts's
// own pure math in isolation (exact table, weighting, first-Rare ramp).
// THIS script proves the WIRING: that Game.ts's real ripening path
// (Game.update() -> rollFruitOutcomeForSlot) actually calls that module with
// the right Field index, the right day-gating, and persists/threads
// GameState.firstRareProtection correctly — the part Pass 3A's own script
// structurally could not exercise (nothing read fieldRarityModel.ts yet).
//
// Every fixture plants a throwaway 100-Yield "TEST LINE" (never used for
// pricing/economy assertions) on a real Field so Game.update()'s real
// ripening block runs exactly as it would in play. Slot 0 of that Field is
// the one measured; forceRipenOnce() forces ONLY that slot's timer to ~0
// each trial and reads back whatever Game.ts itself decided (specimen vs
// commonVisualId) — never calling any private roll method directly.
import { TUNING } from '../src/game/tuning.ts';
import type { AppleAssetId, AppleRarity } from '../src/game/render/appleAssets.ts';
import { APPLE_RARITY } from '../src/game/render/appleAssets.ts';
import { Game } from '../src/game/Game.ts';
import type { Field, Variety } from '../src/game/types.ts';
import { INITIAL_FIRST_RARE_PROTECTION_STATE, type FirstRareProtectionState } from '../src/game/systems/fieldRarityModel.ts';

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

// Same mulberry32 family used elsewhere in this codebase (systems/economy.ts, scripts/verify-specimens.ts).
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

function withRandom<T>(fn: () => number, run: () => T): T {
  const original = Math.random;
  Math.random = fn;
  try {
    return run();
  } finally {
    Math.random = original;
  }
}

function queueRng(values: number[]): () => number {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error('queued rng exhausted — test miscounted Math.random() calls');
    return values[i++];
  };
}

/**
 * Like queueRng, but falls back to a seeded PRNG once `values` is exhausted
 * instead of throwing — for tests that need Stage A/B pinned exactly (to
 * force a specific tier/visual) but whose outcome then flows into
 * buildSpecimen()'s own generateSpecimenStats(), which consumes several
 * further Math.random() calls (per-stat mutations, the one major mutation,
 * the budget-target roll) that this test doesn't care about controlling.
 */
function queueThenRandom(values: number[], tailSeed = 1): () => number {
  let i = 0;
  const tail = mulberry32(tailSeed);
  return () => (i < values.length ? values[i++] : tail());
}

/** 6-sigma tolerance band for a binomial rate at sample size n — comfortably beyond noise, matching scripts/verify-specimens.ts's own non-flaky-by-margin approach. */
function tol(p: number, n: number): number {
  return 6 * Math.sqrt((p * (1 - p)) / n);
}

/** A fresh Game, forced to `day`, with dayTimeRemaining parked far out so a long statistical loop's simulated dt can never trigger automatic Closing mid-trial (irrelevant to what's being measured here). */
function freshGame(day: number): Game {
  clearStorage();
  const game = new Game();
  game.state.day = day;
  game.state.dayTimeRemaining = 1e9;
  return game;
}

let testLineCounter = 0;

/**
 * Plants a throwaway 100-Yield Line (every one of the 15 physical slots
 * active — see economy.ts activeSlotCount(100)=15) on `fieldId`, real
 * unlocked/varietyId wiring exactly like a purchased+planted Field. Slot 0
 * is reset to a controlled, far-from-ripe state for the caller to force via
 * forceRipenOnce. 100 Yield also guarantees pickNextProductiveSlot's
 * documented same-slot re-arm fallback after a harvest (see economy.ts) —
 * useful for the harvest/next-cycle persistence checks below.
 */
function plantTestLine(game: Game, fieldId: number, visualId: AppleAssetId, baseVisualId: AppleAssetId): { field: Field; slotIndex: number } {
  const id = `test-line-${++testLineCounter}`;
  const variety: Variety = {
    id,
    customName: 'TEST LINE',
    generation: 1,
    color: 'Red',
    pattern: 'Plain',
    sweetness: 50,
    size: 50,
    yieldStat: 100,
    growth: 50,
    freshness: 50,
    createdDay: 1,
    awards: [],
    visualId,
    baseVisualId,
    favorite: false,
    archived: false,
  };
  game.state.library.push(variety);
  const field = game.state.fields.find((f) => f.id === fieldId)!;
  field.unlocked = true;
  field.varietyId = id;
  // Fully neutralize EVERY slot, not just the one under test — a raw
  // construction-time slot can start already `ripe: true`, or (if it was
  // outside the previous variety's Yield-active set) `active: false` with a
  // stale `timer: 0` that would ripen on the very first update() tick the
  // instant it's forced active above. Either would silently steal a
  // Math.random() call from a queued deterministic test. Only slot 0 is
  // ever actually driven by forceRipenOnce below; every other slot is
  // parked far out so it can never fire on its own during a trial/loop.
  field.slots.forEach((s) => {
    s.active = true;
    s.ripe = false;
    s.timer = 999999;
    s.specimen = null;
    s.commonVisualId = null;
  });
  const slotIndex = 0;
  return { field, slotIndex };
}

interface Outcome {
  tier: AppleRarity | 'NONE';
  visualId: AppleAssetId | null;
}

/** Forces exactly one ripening cycle on `field.slots[slotIndex]` through the REAL Game.update() path, then reads back whatever Game.ts itself persisted. 'NONE' means no roll happened at all (pre-SPECIMEN_RANDOM_START_DAY — ordinary fruit, no commonVisualId/specimen). */
function forceRipenOnce(game: Game, field: Field, slotIndex: number): Outcome {
  const slot = field.slots[slotIndex];
  slot.active = true;
  slot.ripe = false;
  slot.timer = 0.0001;
  slot.specimen = null;
  slot.commonVisualId = null;
  game.update(0.001);
  if (slot.specimen) return { tier: APPLE_RARITY[slot.specimen.visualId], visualId: slot.specimen.visualId };
  if (slot.commonVisualId) return { tier: 'COMMON', visualId: slot.commonVisualId };
  return { tier: 'NONE', visualId: null };
}

function protectionInactive(): FirstRareProtectionState {
  return { hasFoundRare: true, missStreak: 0 };
}

// ===========================================================================
// SECTION 18 — LIVE FIELD ODDS
// ===========================================================================
console.log('\n=== SECTION 18: Live Field odds (real Game.update() ripening path) ===');
{
  const EXPECTED: Record<number, { rare: number; epic: number }> = {
    1: { rare: 0.015, epic: 0.001 },
    2: { rare: 0.017, epic: 0.0015 },
    3: { rare: 0.02, epic: 0.0025 },
    4: { rare: 0.024, epic: 0.0035 },
  };
  const N = 200000;

  for (const fieldId of [1, 2, 3, 4] as const) {
    const game = freshGame(6); // Day 6: Rare (Day 4) and Epic (Day 6) both eligible
    game.state.firstRareProtection = protectionInactive(); // isolate pure Field odds from the first-Rare ramp
    const { field, slotIndex } = plantTestLine(game, fieldId, 'C1', 'C1'); // Common signature -> Stage B never touches Rare/Epic weighting, keeping this purely a Stage-A measurement

    let rare = 0;
    let epic = 0;
    let common = 0;
    withRandom(mulberry32(9000 + fieldId), () => {
      for (let i = 0; i < N; i++) {
        const o = forceRipenOnce(game, field, slotIndex);
        if (o.tier === 'RARE') rare++;
        else if (o.tier === 'EPIC') epic++;
        else if (o.tier === 'COMMON') common++;
      }
    });

    const exp = EXPECTED[fieldId];
    const rareRate = rare / N;
    const epicRate = epic / N;
    assert(`Field ${fieldId} every live roll resolves to exactly one tier (${common}+${rare}+${epic} === ${N})`, common + rare + epic === N);
    assert(`Field ${fieldId} live Rare rate ~= ${(exp.rare * 100).toFixed(2)}% (observed ${(rareRate * 100).toFixed(3)}%)`, Math.abs(rareRate - exp.rare) < tol(exp.rare, N), `rare=${rare}/${N}`);
    assert(`Field ${fieldId} live Epic rate ~= ${(exp.epic * 100).toFixed(2)}% (observed ${(epicRate * 100).toFixed(3)}%)`, Math.abs(epicRate - exp.epic) < tol(exp.epic, N), `epic=${epic}/${N}`);
  }

  // Distinguish the LIVE rate from the OLD retired global rate
  // (SPECIMEN_RARE_CHANCE = 0.05%, ~30x smaller than Field 1's 1.50%) — a
  // regression back to the old lineAffinity.ts path would fail this loudly
  // rather than silently.
  {
    const game = freshGame(6);
    game.state.firstRareProtection = protectionInactive();
    const { field, slotIndex } = plantTestLine(game, 1, 'C1', 'C1');
    const N = 200000;
    let rare = 0;
    withRandom(mulberry32(424242), () => {
      for (let i = 0; i < N; i++) if (forceRipenOnce(game, field, slotIndex).tier === 'RARE') rare++;
    });
    const rareRate = rare / N;
    assert(
      `Field 1's live Rare rate matches the NEW Field Rarity Table (1.50%), not the OLD retired global SPECIMEN_RARE_CHANCE (${(TUNING.SPECIMEN_RARE_CHANCE * 100).toFixed(2)}%)`,
      Math.abs(rareRate - 0.015) < tol(0.015, N) && Math.abs(rareRate - TUNING.SPECIMEN_RARE_CHANCE) > 0.01,
      `observed ${(rareRate * 100).toFixed(3)}%`,
    );
  }

  // Field 4 purchase must not change Field 1's own odds.
  {
    const N = 150000;
    const game = freshGame(6);
    game.state.firstRareProtection = protectionInactive();
    const { field: field1, slotIndex } = plantTestLine(game, 1, 'C1', 'C1');

    let rareBefore = 0;
    withRandom(mulberry32(70001), () => {
      for (let i = 0; i < N; i++) if (forceRipenOnce(game, field1, slotIndex).tier === 'RARE') rareBefore++;
    });

    // "Purchase" Fields 2-4 (unlocked + planted, exactly like a real buy).
    plantTestLine(game, 2, 'C1', 'C1');
    plantTestLine(game, 3, 'C1', 'C1');
    plantTestLine(game, 4, 'C1', 'C1');

    let rareAfter = 0;
    withRandom(mulberry32(70002), () => {
      for (let i = 0; i < N; i++) if (forceRipenOnce(game, field1, slotIndex).tier === 'RARE') rareAfter++;
    });

    const diffTol = 6 * Math.sqrt((2 * 0.015 * 0.985) / N); // two independent samples of the same distribution
    assert(
      `Field 1's Rare rate is statistically unaffected by unlocking/purchasing Fields 2-4 (before ${rareBefore}/${N}, after ${rareAfter}/${N})`,
      Math.abs(rareBefore / N - rareAfter / N) < diffTol,
    );
  }
}

// ===========================================================================
// SECTION 19 — PERSISTENCE
// ===========================================================================
console.log('\n=== SECTION 19: Persistence (one roll per cycle, no reroll, save/load) ===');
{
  // One slot rolls once; repeated update() calls (standing in for
  // sync()/screen-navigation/hide-show, all of which are pure state
  // consumers that never touch GameState — see OrchardTreeLayer.sync()) do
  // not reroll it, even with Math.random() pinned to a value that would
  // pick a DIFFERENT outcome if a reroll happened.
  {
    const game = freshGame(3); // Day 3: two-stage roll active, Rare/Epic not yet eligible -> deterministically Common
    const { field, slotIndex } = plantTestLine(game, 1, 'C2', 'C1');
    const outcome = withRandom(queueRng([0.9, 0.9, 0.9]), () => forceRipenOnce(game, field, slotIndex));
    assert('Day 3 roll resolves to COMMON (Rare/Epic not yet eligible)', outcome.tier === 'COMMON');
    const rolled = field.slots[slotIndex].commonVisualId;
    assert('a real visual was persisted', rolled !== null);

    withRandom(mulberry32(1), () => {
      for (let i = 0; i < 20; i++) game.update(0.1);
    });
    assert('repeated update() calls after ripening never reroll the persisted visual', field.slots[slotIndex].commonVisualId === rolled);
  }

  // save/load preserves the rolled ordinary-fruit visual exactly.
  {
    const game = freshGame(3);
    const { field, slotIndex } = plantTestLine(game, 1, 'C3', 'C4');
    withRandom(queueRng([0.9, 0.1, 0.9]), () => forceRipenOnce(game, field, slotIndex)); // Common, Stage B lands on the Common-Tendency-weighted candidate; 3rd value skips the Exceptional occurrence roll (>= EXCEPTIONAL_OCCURRENCE_CHANCE)
    const rolled = field.slots[slotIndex].commonVisualId;
    assert('setup: a visual was rolled before save', rolled !== null);
    game.save();
    const reloaded = new Game();
    const reloadedSlot = reloaded.state.fields.find((f) => f.id === field.id)!.slots[slotIndex];
    assert('save/load preserves the exact rolled ordinary-fruit visual', reloadedSlot.commonVisualId === rolled);
  }

  // A physical Rare/Epic Specimen keeps its exact visual through harvest.
  {
    const game = freshGame(6);
    game.state.firstRareProtection = protectionInactive();
    const { field, slotIndex } = plantTestLine(game, 1, 'R2', 'C1');
    // Stage A forced into the Rare band (Field 1: epic [0,0.001), rare [0.001,0.016)); Stage B forced onto the Signature R2 (see verify-field-rarity-model.ts's identical 0.3 -> R2 derivation).
    const outcome = withRandom(queueThenRandom([0.005, 0.3]), () => forceRipenOnce(game, field, slotIndex));
    assert('forced roll resolved to RARE', outcome.tier === 'RARE');
    assert('Stage B landed on the Signature R2', outcome.visualId === 'R2');
    const specimenId = field.slots[slotIndex].specimen?.id;
    assert('a physical Specimen is sitting on the slot', !!specimenId);

    const harvested = game.harvestFruitSlot(field.id, slotIndex);
    assert('harvest succeeds (Specimens are never Packing-capacity-gated)', harvested === true);
    const inInventory = game.state.specimens.find((s) => s.id === specimenId);
    assert('the exact same Specimen (same id, same visualId) is now in the held inventory', inInventory?.visualId === 'R2');
    assert('it never entered the Shipping/Processing Queue', game.state.processingQueue.length === 0);
  }

  // Harvest clears the completed outcome; the next cycle rolls a genuinely NEW one.
  {
    const game = freshGame(3);
    const { field, slotIndex } = plantTestLine(game, 1, 'C1', 'C2');
    const first = withRandom(queueRng([0.9, 0.99, 0.9]), () => forceRipenOnce(game, field, slotIndex)); // last pool candidate; 3rd value skips the Exceptional occurrence roll
    assert('setup: first ordinary outcome rolled', first.tier === 'COMMON' && first.visualId !== null);

    withRandom(mulberry32(2), () => {
      const harvested = game.harvestFruitSlot(field.id, slotIndex);
      assert('harvest of ordinary fruit succeeds', harvested === true);
    });
    // 100 Yield -> pickNextProductiveSlot's documented same-slot re-arm fallback (see economy.ts) — the SAME slot index becomes productive again.
    assert('harvest clears the completed outcome off the slot', field.slots[slotIndex].commonVisualId === null && field.slots[slotIndex].specimen === null);
    assert('the same slot was re-armed (100 Yield -> nothing else to rotate to)', field.slots[slotIndex].active === true);

    const second = withRandom(queueRng([0.9, 0.01, 0.9]), () => forceRipenOnce(game, field, slotIndex)); // first pool candidate this time; 3rd value skips the Exceptional occurrence roll
    assert('the next growth cycle rolls a genuinely new outcome (different Stage-B rng -> different visual)', second.tier === 'COMMON' && second.visualId !== null && second.visualId !== first.visualId);
  }
}

// ===========================================================================
// SECTION 20 — FIRST-RARE PROTECTION (live wiring)
// ===========================================================================
console.log('\n=== SECTION 20: First-Rare protection (live wiring through GameState) ===');
{
  // Before Rare eligibility (Day 3): eligible-miss counting must not
  // increment at all. rng is pinned to a fixed 0.5 — with Rare/Epic
  // day-gated to 0 regardless of odds, EVERY rng value resolves Common here
  // (there is no "band" to land in at all), so this also proves the
  // day-gate itself, not just the counter; 0.5 additionally stays above
  // EXCEPTIONAL_OCCURRENCE_CHANCE (0.006) so the Common fallthrough's
  // Exceptional roll stays a no-op, keeping this trial focused purely on
  // the first-Rare counter.
  {
    const game = freshGame(3);
    const { field, slotIndex } = plantTestLine(game, 1, 'R2', 'C1');
    game.state.firstRareProtection = { hasFoundRare: false, missStreak: 0 };
    withRandom(() => 0.5, () => {
      for (let i = 0; i < 5; i++) forceRipenOnce(game, field, slotIndex);
    });
    assert('pre-Day-4 rolls never increment the first-Rare miss streak', game.state.firstRareProtection.missStreak === 0);
    assert('pre-Day-4 rolls never set hasFoundRare (they cannot even reach Rare)', game.state.firstRareProtection.hasFoundRare === false);
  }

  // First 10 eligible misses: real Field odds, untouched.
  {
    const game = freshGame(4); // Day 4: Rare eligible, Epic not yet
    const { field, slotIndex } = plantTestLine(game, 1, 'C1', 'C1');
    game.state.firstRareProtection = { hasFoundRare: false, missStreak: 0 };
    withRandom(() => 0.99, () => {
      for (let roll = 1; roll <= 10; roll++) {
        const outcome = forceRipenOnce(game, field, slotIndex);
        assert(`eligible roll ${roll}: forced-Common rng still resolves Common (no premature bonus)`, outcome.tier === 'COMMON');
        assert(`eligible roll ${roll}: miss streak is exactly ${roll}`, game.state.firstRareProtection.missStreak === roll);
      }
    });
    assert('hasFoundRare still false after 10 misses', game.state.firstRareProtection.hasFoundRare === false);

    // Roll 11: rng chosen to fall OUTSIDE the plain 1.5% Rare band but
    // INSIDE the roll-11 bonus-boosted 2.25% band. Epic is day-gated to 0 at
    // Day 4 (EPIC_UNLOCK_DAY is 6), so the bands are: plain rare [0,0.015),
    // boosted rare [0,0.0225) — 0.02 lands only in the boosted one, proving
    // the live path actually reads the +0.75pp bonus, not just the base odds.
    const outcome11 = withRandom(queueThenRandom([0.02, 0.1]), () => forceRipenOnce(game, field, slotIndex));
    assert('roll 11 (missStreak=10 going in): the first-Rare bonus is live — a roll the BASE odds would miss resolves RARE', outcome11.tier === 'RARE');
    assert('a real Rare Specimen was actually created for it', outcome11.visualId !== null && APPLE_RARITY[outcome11.visualId!] === 'RARE');
  }

  // Roll 25 (missStreak=24 going in): hard guarantee, live — forced with an
  // rng value that would normally be deep in the Common band.
  {
    const game = freshGame(4);
    const { field, slotIndex } = plantTestLine(game, 1, 'C1', 'C1');
    game.state.firstRareProtection = { hasFoundRare: false, missStreak: 24 };
    const outcome = withRandom(queueThenRandom([0.9999, 0.5]), () => forceRipenOnce(game, field, slotIndex));
    assert('the 25th eligible miss guarantees RARE live, even with rng deep in what would normally be the Common band', outcome.tier === 'RARE');
    assert('protection ends permanently the instant this Rare outcome is persisted', game.state.firstRareProtection.hasFoundRare === true);
    assert('the miss streak resets alongside it', game.state.firstRareProtection.missStreak === 0);
  }

  // Once ended, protection never reactivates — later misses stay at base odds, no matter how long the dry spell.
  {
    const game = freshGame(6);
    const { field, slotIndex } = plantTestLine(game, 1, 'C1', 'C1');
    game.state.firstRareProtection = { hasFoundRare: true, missStreak: 0 };
    withRandom(() => 0.99, () => {
      for (let i = 0; i < 50; i++) forceRipenOnce(game, field, slotIndex);
    });
    assert('50 further misses after hasFoundRare never reactivate protection', game.state.firstRareProtection.hasFoundRare === true && game.state.firstRareProtection.missStreak === 0);

    // A roll that WOULD have won under the roll-11 bonus band must miss now that protection is permanently off.
    const outcome = withRandom(queueRng([0.02, 0.1, 0.9]), () => forceRipenOnce(game, field, slotIndex)); // 3rd value skips the Exceptional occurrence roll
    assert('post-protection: the same rng that used to win under the bonus now correctly misses (base 1.5% odds only)', outcome.tier === 'COMMON');
  }

  // save/load preserves the miss streak exactly.
  {
    const game = freshGame(4);
    game.state.firstRareProtection = { hasFoundRare: false, missStreak: 7 };
    game.save();
    const reloaded = new Game();
    assert('save/load preserves an in-progress miss streak exactly', reloaded.state.firstRareProtection.missStreak === 7 && reloaded.state.firstRareProtection.hasFoundRare === false);
  }

  // An old save (pre-firstRareProtection) that already proves a Rare was
  // found (anywhere: discoveredVisualIds, Library, held Specimens, an
  // in-flight breeding snapshot, or an unharvested slot Specimen)
  // initializes protection as permanently completed — never re-grants pity.
  {
    clearStorage();
    const oldSaveWithRare = {
      day: 10,
      discoveredVisualIds: ['C1', 'C2', 'R3'],
      library: [],
      specimens: [],
      fields: [{ id: 1, unlocked: true, varietyId: null, policy: 'NORMAL', pendingPolicy: null, slots: Array.from({ length: 15 }, () => ({ ripe: false, timer: 5, active: true, specimen: null, commonVisualId: null })) }],
      // firstRareProtection intentionally absent, like a pre-Pass-3B save.
    };
    localStorage.setItem(TUNING.SAVE_KEY, JSON.stringify(oldSaveWithRare));
    const migrated = new Game();
    assert('an old save that already discovered a Rare visual migrates protection as permanently completed', migrated.state.firstRareProtection.hasFoundRare === true);
    assert('its miss streak starts at 0 (irrelevant once completed)', migrated.state.firstRareProtection.missStreak === 0);
  }
  {
    clearStorage();
    const oldSaveNoRare = {
      day: 2,
      discoveredVisualIds: ['C1', 'C2'],
      library: [],
      specimens: [],
      fields: [{ id: 1, unlocked: true, varietyId: null, policy: 'NORMAL', pendingPolicy: null, slots: Array.from({ length: 15 }, () => ({ ripe: false, timer: 5, active: true, specimen: null, commonVisualId: null })) }],
    };
    localStorage.setItem(TUNING.SAVE_KEY, JSON.stringify(oldSaveNoRare));
    const migrated = new Game();
    assert('an old save with no Rare anywhere migrates a fresh, active protection state (never fabricates pity OR a false completion)', migrated.state.firstRareProtection.hasFoundRare === false && migrated.state.firstRareProtection.missStreak === 0);
    assert('the fresh state matches the module default exactly', JSON.stringify(migrated.state.firstRareProtection) === JSON.stringify(INITIAL_FIRST_RARE_PROTECTION_STATE));
  }
}

// ===========================================================================
// SECTION 21 — AFFINITY (live)
// ===========================================================================
console.log('\n=== SECTION 21: Signature / Common Tendency affinity (live) ===');
{
  // R2 Signature: Stage A still uses plain Field odds (no boost from having
  // a Rare Signature), THEN Stage B favors R2 at the new 1.30 weight.
  {
    const N = 150000;
    const gameSig = freshGame(6);
    gameSig.state.firstRareProtection = protectionInactive();
    const sig = plantTestLine(gameSig, 1, 'R2', 'C1');

    const gamePlain = freshGame(6);
    gamePlain.state.firstRareProtection = protectionInactive();
    const plain = plantTestLine(gamePlain, 1, 'C1', 'C1'); // Common signature -> no Rare-tier favoritism at all

    let rareSig = 0;
    withRandom(mulberry32(81001), () => {
      for (let i = 0; i < N; i++) if (forceRipenOnce(gameSig, sig.field, sig.slotIndex).tier === 'RARE') rareSig++;
    });
    let rarePlain = 0;
    withRandom(mulberry32(81001), () => {
      for (let i = 0; i < N; i++) if (forceRipenOnce(gamePlain, plain.field, plain.slotIndex).tier === 'RARE') rarePlain++;
    });
    const diffTol = 6 * Math.sqrt((2 * 0.015 * 0.985) / N);
    assert(
      `an R2-signature Line's live Rare-TIER rate matches a plain Line's exactly (Signature never moves Stage A) — sig ${rareSig}/${N}, plain ${rarePlain}/${N}`,
      Math.abs(rareSig / N - rarePlain / N) < diffTol,
    );

    // Stage B: among Rare outcomes, how often is the visual R2 specifically?
    const gameB = freshGame(6);
    gameB.state.firstRareProtection = protectionInactive();
    const b = plantTestLine(gameB, 1, 'R2', 'C1');
    let rareCount = 0;
    let r2Count = 0;
    withRandom(mulberry32(81002), () => {
      for (let i = 0; i < N; i++) {
        const o = forceRipenOnce(gameB, b.field, b.slotIndex);
        if (o.tier === 'RARE') {
          rareCount++;
          if (o.visualId === 'R2') r2Count++;
        }
      }
    });
    const observedPct = r2Count / rareCount;
    const expectedPct = 1.3 / (1.3 + 1 + 1 + 1); // R2 weighted 1.30 among R1-R4
    // rareCount itself is a small conditional sample (~1.5% of N trials), so
    // the tolerance is computed from the ACTUAL observed sample size, same
    // 6-sigma non-flaky-by-margin approach as the rest of this script,
    // rather than a fixed band sized for the much larger unconditional N.
    assert(
      `within Rare outcomes, R2 (the Signature) is picked ~${(expectedPct * 100).toFixed(2)}% of the time via the NEW 1.30 weight, not the old ×3 weight (observed ${(observedPct * 100).toFixed(2)}%, ${r2Count}/${rareCount})`,
      Math.abs(observedPct - expectedPct) < tol(expectedPct, rareCount),
    );
  }

  // C1 Common Tendency: among Common outcomes, C1 favored at the new 1.15 weight.
  {
    const N = 150000;
    const game = freshGame(3); // Common-only day is enough to exercise Stage B's Common pool
    const { field, slotIndex } = plantTestLine(game, 1, 'R2', 'C1'); // Signature is R2 (irrelevant to Common outcomes) — Common Tendency is C1
    let c1Count = 0;
    let commonCount = 0;
    withRandom(mulberry32(81003), () => {
      for (let i = 0; i < N; i++) {
        const o = forceRipenOnce(game, field, slotIndex);
        if (o.tier === 'COMMON') {
          commonCount++;
          if (o.visualId === 'C1') c1Count++;
        }
      }
    });
    const observedPct = c1Count / commonCount;
    const expectedPct = 1.15 / (1.15 + 1 + 1 + 1); // C1 weighted 1.15 among C1-C4
    assert(
      `within Common outcomes, C1 (the Common Tendency) is picked ~${(expectedPct * 100).toFixed(2)}% of the time via the NEW 1.15 weight, not the old ×2 weight (observed ${(observedPct * 100).toFixed(2)}%, ${c1Count}/${commonCount})`,
      Math.abs(observedPct - expectedPct) < tol(expectedPct, commonCount),
    );
  }

  // Changing Signature must never alter Stage-A Field rarity odds (day-gate
  // holds even with a matching Signature, live end-to-end).
  {
    const game = freshGame(3); // Rare not eligible until Day 4
    const { field, slotIndex } = plantTestLine(game, 1, 'R2', 'C1');
    let sawRare = false;
    withRandom(mulberry32(81004), () => {
      for (let i = 0; i < 50000; i++) if (forceRipenOnce(game, field, slotIndex).tier === 'RARE') sawRare = true;
    });
    assert('an R2-signature Line cannot produce Rare before Day 4 live, even with a strongly matching Signature', !sawRare);
  }
}

console.log(`\n${checks} checks, ${failures} failures`);
if (failures > 0) process.exit(1);
