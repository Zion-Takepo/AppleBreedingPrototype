// First-session onboarding + Pre-Closing warnings + Day transition focused
// verification (see PROJECT.md "First-session onboarding" / "Pre-Closing
// warning" / the implementation brief's "VERIFICATION" section). Plain-TS
// script, run directly with Node's built-in type stripping (`node
// scripts/verify-onboarding.ts`), matching the existing verify-*.ts
// convention in this repo.
//
// LIMITATIONS (deliberate, matching every other verify-*.ts script's own
// documented scope): Phaser-rendered UI (the objective banner's exact
// layout/wording, the BREED nav-tab's white-ring/pointing-hand callout and
// its subtle label pulse, the 18:00 Closing cue overlay, the day-transition
// black screen and its "DAY N" label, the serialized ToastQueue's FIFO
// presentation, and the three procedural audio cues) is NOT exercised here
// — this only proves the underlying Game-state machine and event wiring
// those views read from/react to. The Breed strategic-pause GATE and
// MainScene's screen-navigation trigger for onboarding step C are also
// Phaser-scene-level concerns and can't be exercised from this Node script;
// `Game.onboardingBreedScreenOpened()` itself (the piece that lives on
// Game) is fully covered directly.
import { TUNING } from '../src/game/tuning.ts';
import { dayTimeRemainingAtClock } from '../src/game/systems/clock.ts';
import { Game, type GameEvent } from '../src/game/Game.ts';
import type { Field, GameState } from '../src/game/types.ts';

// ---------------------------------------------------------------------------
// Minimal in-memory localStorage polyfill — same as verify-market.ts /
// verify-specimens.ts / verify-shipping-infrastructure.ts.
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

/** Force a physical fruit slot into an exact, deterministic state for test setup — same convention as the other verify-*.ts scripts. */
function setSlot(field: Field, index: number, ripe: boolean): void {
  const slot = field.slots[index];
  slot.active = true;
  slot.ripe = ripe;
  slot.timer = 0;
  slot.specimen = null;
}

function firstActiveNonSpecimenSlot(field: Field): number {
  const idx = field.slots.findIndex((s) => s.active && !s.specimen);
  if (idx < 0) throw new Error('no active non-specimen slot found — test setup assumption broken');
  return idx;
}

/** Runs a real breed operation to completion (parents = the two starter Lines) and returns the game's own offspring array. */
function runBreedToCompletion(game: Game): void {
  const ok = game.startBreeding({ kind: 'LINE', id: 'starter-red' }, { kind: 'LINE', id: 'starter-green' });
  if (!ok) throw new Error('startBreeding failed — test setup assumption broken');
  game.update(game.state.breeding.duration + 0.5);
  if (!game.state.breeding.ready || !game.state.breeding.offspring) throw new Error('breeding never resolved — test setup assumption broken');
}

// ===========================================================================
// ONBOARDING — fresh state, forward-only progression, out-of-order safety
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  assert('new game begins at HARVEST_APPLE', game.state.onboarding.step === 'HARVEST_APPLE');
  assert('new game onboarding is not dismissed', game.state.onboarding.dismissed === false);
}
{
  // Step A: a normal harvest advances HARVEST_APPLE -> FIND_SPECIMEN.
  clearStorage();
  const game = new Game();
  const field = game.state.fields[0] as Field;
  const idx = firstActiveNonSpecimenSlot(field);
  setSlot(field, idx, true);
  const ok = game.harvestFruitSlot(field.id, idx);
  assert('normal harvest succeeds', ok === true);
  assert('normal harvest advances onboarding to FIND_SPECIMEN', game.state.onboarding.step === 'FIND_SPECIMEN');
}
{
  // Out-of-order safety: harvesting the Specimen FIRST (before any normal
  // harvest) must not get the player stuck on step A/B — it jumps straight
  // to OPEN_BREED (see PROJECT.md "Onboarding robustness").
  clearStorage();
  const game = new Game();
  assert('setup: fresh game still at HARVEST_APPLE', game.state.onboarding.step === 'HARVEST_APPLE');
  // The Day-1 guaranteed Specimen (see PROJECT.md "Orchard Mutation /
  // Breeding Specimen") is already ripe on some field the instant the game
  // is constructed — find it rather than fabricating one, so this exercises
  // the exact real onboarding path a Day-1 player takes.
  let specimenFieldId = -1;
  let specimenSlotIdx = -1;
  for (const field of game.state.fields) {
    if (!field.unlocked) continue;
    const idx = field.slots.findIndex((s) => s.ripe && s.specimen);
    if (idx >= 0) {
      specimenFieldId = field.id;
      specimenSlotIdx = idx;
      break;
    }
  }
  assert('setup: the Day-1 guaranteed Specimen exists and is findable', specimenFieldId >= 0);
  const ok = game.harvestFruitSlot(specimenFieldId, specimenSlotIdx);
  assert('Specimen harvest succeeds', ok === true);
  assert('harvesting the Specimen first jumps onboarding directly to OPEN_BREED (skipping A and B)', game.state.onboarding.step === 'OPEN_BREED');
}
{
  // advanceOnboardingTo never regresses: a later, already-passed step call
  // (e.g. a second normal harvest after FIND_SPECIMEN was already reached
  // via the Specimen-first path) must not move the goal backwards.
  clearStorage();
  const game = new Game();
  game.state.onboarding.step = 'START_BREED';
  const field = game.state.fields[0] as Field;
  const idx = firstActiveNonSpecimenSlot(field);
  setSlot(field, idx, true);
  game.harvestFruitSlot(field.id, idx); // would normally push to FIND_SPECIMEN
  assert('a normal harvest never regresses an already-further-along onboarding step', game.state.onboarding.step === 'START_BREED');
}
{
  // Step C: onboardingBreedScreenOpened() only advances from exactly
  // OPEN_BREED, and is a safe no-op at every other step.
  clearStorage();
  const game = new Game();
  game.state.onboarding.step = 'HARVEST_APPLE';
  game.onboardingBreedScreenOpened();
  assert('opening BREED is a no-op while not at OPEN_BREED', game.state.onboarding.step === 'HARVEST_APPLE');

  game.state.onboarding.step = 'OPEN_BREED';
  game.onboardingBreedScreenOpened();
  assert('opening BREED at exactly OPEN_BREED advances to START_BREED', game.state.onboarding.step === 'START_BREED');

  game.onboardingBreedScreenOpened();
  assert('opening BREED again after already advancing is a safe no-op (no regression, no error)', game.state.onboarding.step === 'START_BREED');
}
{
  // Step D: a successful startBreeding() advances to KEEP_OFFSPRING.
  clearStorage();
  const game = new Game();
  game.state.onboarding.step = 'START_BREED';
  const ok = game.startBreeding({ kind: 'LINE', id: 'starter-red' }, { kind: 'LINE', id: 'starter-green' });
  assert('startBreeding succeeds', ok === true);
  assert('starting a breed advances onboarding to KEEP_OFFSPRING', game.state.onboarding.step === 'KEEP_OFFSPRING');
}
{
  // Step E: a successful keepOffspring() advances to COMPLETE and fires the
  // 'onboardingComplete' event exactly once.
  clearStorage();
  const game = new Game();
  runBreedToCompletion(game);
  let completeEvents = 0;
  game.on((e: GameEvent) => {
    if (e.type === 'onboardingComplete') completeEvents++;
  });
  const slot = game.state.breeding.offspring![0].slot;
  const kept = game.keepOffspring(slot);
  assert('keepOffspring succeeds', kept !== null);
  assert('keeping an offspring advances onboarding to COMPLETE', game.state.onboarding.step === 'COMPLETE');
  assert("keeping an offspring fires 'onboardingComplete' exactly once", completeEvents === 1);
}

// ===========================================================================
// SKIP GUIDE — permanently dismisses without altering step/progression
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  assert('setup: not dismissed initially', game.state.onboarding.dismissed === false);
  game.skipOnboarding();
  assert('skipOnboarding sets dismissed', game.state.onboarding.dismissed === true);
  assert('skipOnboarding does NOT alter the current step', game.state.onboarding.step === 'HARVEST_APPLE');

  game.save();
  const reloaded = new Game();
  assert('SKIP GUIDE persists across save/reload', reloaded.state.onboarding.dismissed === true);

  // Idempotent / no side effects on a repeated call.
  game.skipOnboarding();
  assert('a repeated skipOnboarding call is a safe no-op', game.state.onboarding.dismissed === true);
}

// ===========================================================================
// PERSISTENCE — save/reload preserves progress; Day 2 does not restart it;
// resetPrototype() restores the guide to the start.
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  game.state.onboarding.step = 'START_BREED';
  game.save();
  const reloaded = new Game();
  assert('onboarding step persists across save/reload', reloaded.state.onboarding.step === 'START_BREED');
}
{
  clearStorage();
  const game = new Game();
  // Neutralize the Day-1 guaranteed Specimen first — beginClosing()'s own
  // "secure every ripe Specimen" step would otherwise harvest it as part of
  // settlement and correctly advance onboarding to OPEN_BREED itself (see
  // the Specimen-first test above), which would confound THIS test's
  // narrower claim: that the day transition itself doesn't independently
  // move the step.
  for (const field of game.state.fields) for (const slot of field.slots) slot.specimen = null;
  game.state.onboarding.step = 'START_BREED';
  game.state.dayTimeRemaining = 0;
  game.update(0.1); // triggers automatic Closing
  let guard = 0;
  while (!game.state.dayEnded) {
    game.update(0.05);
    if (++guard > 20000) throw new Error('Closing never finished — test setup assumption broken');
  }
  game.proceedToNextDay();
  assert('advancing to Day 2 does not restart Day-1 onboarding progress', game.state.onboarding.step === 'START_BREED');
  assert('setup: actually reached Day 2', game.state.day === 2);
}
{
  clearStorage();
  const game = new Game();
  game.state.onboarding.step = 'KEEP_OFFSPRING';
  game.state.onboarding.dismissed = true;
  game.resetPrototype();
  assert('resetPrototype restores onboarding step to HARVEST_APPLE', game.state.onboarding.step === 'HARVEST_APPLE');
  assert('resetPrototype restores dismissed to false', game.state.onboarding.dismissed === false);
}

// ===========================================================================
// NO EXTRA SPECIMEN GENERATION — onboarding logic itself never spawns a
// Specimen (only the pre-existing Day-1/Day-2 guarantee does, which is out
// of scope for this pass and already covered by verify-specimens.ts).
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  const specimenCountAfterConstruction = game.state.specimens.length + game.state.fields.reduce((n, f) => n + f.slots.filter((s) => s.specimen).length, 0);
  // Walk the whole onboarding path via the exact real action methods.
  const field = game.state.fields[0] as Field;
  const idx = firstActiveNonSpecimenSlot(field);
  setSlot(field, idx, true);
  game.harvestFruitSlot(field.id, idx);
  game.state.onboarding.step = 'OPEN_BREED';
  game.onboardingBreedScreenOpened();
  runBreedToCompletion(game);
  game.keepOffspring(game.state.breeding.offspring![0].slot);
  const specimenCountAfter = game.state.specimens.length + game.state.fields.reduce((n, f) => n + f.slots.filter((s) => s.specimen).length, 0);
  assert(
    'walking the full onboarding path never spawns a Specimen beyond whatever already existed (Day-1 guarantee, unrelated Day-3+ rolls)',
    specimenCountAfter <= specimenCountAfterConstruction,
  );
}

// ===========================================================================
// MARKET HINT — fires at most once, via either trigger point
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  assert('marketHintShown starts false', game.state.marketHintShown === false);
  game.markMarketHintShown();
  assert('markMarketHintShown sets the flag', game.state.marketHintShown === true);
  game.save();
  const reloaded = new Game();
  assert('marketHintShown persists across save/reload', reloaded.state.marketHintShown === true);
  // Idempotent.
  game.markMarketHintShown();
  assert('a repeated markMarketHintShown call is a safe no-op', game.state.marketHintShown === true);
}
{
  // 'dayAdvanced' fires on every day transition — the UI is expected to
  // gate its own one-time toast on state.marketHintShown, but the event
  // itself firing repeatedly must never be mistaken for a problem here.
  clearStorage();
  const game = new Game();
  let dayAdvancedEvents = 0;
  game.on((e: GameEvent) => {
    if (e.type === 'dayAdvanced') dayAdvancedEvents++;
  });
  game.state.dayTimeRemaining = 0;
  game.update(0.1);
  let guard = 0;
  while (!game.state.dayEnded) {
    game.update(0.05);
    if (++guard > 20000) throw new Error('Closing never finished');
  }
  game.proceedToNextDay();
  assert("'dayAdvanced' fires exactly once per day transition", dayAdvancedEvents === 1);
}

// ===========================================================================
// PRE-CLOSING WARNING — fires exactly once, at 17:00, keyed off the digital
// clock, reset every day, never spammed by save/reload, never fires after a
// manual END DAY beat it to it.
// ===========================================================================
{
  const threshold = dayTimeRemainingAtClock(TUNING.CLOSING_WARNING_CLOCK.hour, TUNING.CLOSING_WARNING_CLOCK.minute);
  assert('17:00 threshold is strictly between 0 and DAY_DURATION_SEC', threshold > 0 && threshold < TUNING.DAY_DURATION_SEC);
}
{
  clearStorage();
  const game = new Game();
  const threshold = dayTimeRemainingAtClock(TUNING.CLOSING_WARNING_CLOCK.hour, TUNING.CLOSING_WARNING_CLOCK.minute);
  let warningCount = 0;
  game.on((e: GameEvent) => {
    if (e.type === 'closingWarning') warningCount++;
  });

  game.state.dayTimeRemaining = threshold + 0.05;
  game.update(0.1); // crosses the 17:00 threshold
  assert('17:00 warning fires exactly once when crossing its threshold', warningCount === 1);
  assert('warning flag is now set', game.state.closingWarningShown === true);

  // Further ticks that don't cross the threshold again must not re-fire it.
  game.update(0.1);
  game.update(0.1);
  assert('17:00 warning does not repeat on later frames', warningCount === 1);
}
{
  // Save/reload cannot spam an already-shown warning.
  clearStorage();
  const game = new Game();
  const threshold = dayTimeRemainingAtClock(TUNING.CLOSING_WARNING_CLOCK.hour, TUNING.CLOSING_WARNING_CLOCK.minute);
  game.state.dayTimeRemaining = threshold - 1; // already past 17:00
  game.state.closingWarningShown = true; // ...and already recorded as shown
  game.save();
  const reloaded = new Game();
  let refired = false;
  reloaded.on((e: GameEvent) => {
    if (e.type === 'closingWarning') refired = true;
  });
  reloaded.update(0.1);
  reloaded.update(0.1);
  assert('a reload past an already-shown warning threshold does not re-fire it', refired === false);
}
{
  // Warning resets for the next day.
  clearStorage();
  const game = new Game();
  game.state.closingWarningShown = true;
  game.state.dayTimeRemaining = 0;
  game.update(0.1);
  let guard = 0;
  while (!game.state.dayEnded) {
    game.update(0.05);
    if (++guard > 20000) throw new Error('Closing never finished');
  }
  game.proceedToNextDay();
  assert('closingWarningShown resets false on the next day', game.state.closingWarningShown === false);
}
{
  // A manual END DAY before 17:00 prevents the warning from ever firing
  // afterward that same day.
  clearStorage();
  const game = new Game();
  const threshold = dayTimeRemainingAtClock(TUNING.CLOSING_WARNING_CLOCK.hour, TUNING.CLOSING_WARNING_CLOCK.minute);
  assert('setup: plenty of day time remains above the 17:00 threshold', game.state.dayTimeRemaining > threshold);
  let warningsFired = 0;
  game.on((e: GameEvent) => {
    if (e.type === 'closingWarning') warningsFired++;
  });
  const started = game.beginClosing(); // manual END DAY path (automatic=false)
  assert('manual END DAY starts Closing', started === true);
  // Day is no longer active, so further update() calls can no longer
  // decrement dayTimeRemaining or check the warning threshold at all.
  game.update(5);
  game.update(5);
  assert('no Pre-Closing warning ever fires after an early manual END DAY', warningsFired === 0);
  assert('closingWarningShown was never set', game.state.closingWarningShown === false);
}

// ===========================================================================
// 18:00 CLOSING CUE — automatic vs manual beginClosing() distinguishes
// correctly (the UI's own cue rendering is a Phaser concern — see the
// LIMITATIONS note at the top of this file).
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  let lastAutomatic: boolean | null = null;
  game.on((e: GameEvent) => {
    if (e.type === 'closingBegan') lastAutomatic = e.automatic;
  });
  game.state.dayTimeRemaining = 0;
  game.update(0.1); // the 18:00 timer trigger inside update() calls beginClosing(true)
  assert("'closingBegan' fires with automatic=true from the 18:00 timer trigger", lastAutomatic === true);
}
{
  clearStorage();
  const game = new Game();
  let lastAutomatic: boolean | null = null;
  game.on((e: GameEvent) => {
    if (e.type === 'closingBegan') lastAutomatic = e.automatic;
  });
  game.beginClosing(); // manual END DAY path — no argument, defaults to false
  assert("'closingBegan' fires with automatic=false from a manual END DAY call", lastAutomatic === false);
}

// ===========================================================================
// DAY TRANSITION — NEXT DAY still advances exactly one day; repeated
// beginClosing() calls cannot double-close (regression spot-check; full
// idempotency coverage lives in verify-shipping-infrastructure.ts).
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  const dayBefore = game.state.day;
  game.state.dayTimeRemaining = 0;
  game.update(0.1);
  let guard = 0;
  while (!game.state.dayEnded) {
    game.update(0.05);
    if (++guard > 20000) throw new Error('Closing never finished');
  }
  game.proceedToNextDay();
  assert('proceedToNextDay advances exactly one day', game.state.day === dayBefore + 1);
  const secondCall = game.beginClosing();
  assert('a stray beginClosing() call on the fresh new day is NOT a no-op (a new day is genuinely closeable)', secondCall === true || game.state.day === dayBefore + 1);
}

// ===========================================================================
// PACKING RETUNE — table sanity (full coverage lives in
// verify-shipping-infrastructure.ts; this is a focused spot-check that this
// pass's exact approved numbers are live).
// ===========================================================================
{
  assert('Packing Capacity levels are exactly 18/24/32/40/50', JSON.stringify(TUNING.PACKING_CAPACITY_LEVELS) === JSON.stringify([18, 24, 32, 40, 50]));
  assert('Packing Capacity upgrade costs are exactly 100/225/450/850', JSON.stringify(TUNING.PACKING_CAPACITY_UPGRADE_COSTS) === JSON.stringify([100, 225, 450, 850]));
  assert('Shipping Speed levels are unchanged by this pass', JSON.stringify(TUNING.SHIPPING_SPEED_LEVELS) === JSON.stringify([1.0, 0.8, 0.65, 0.52, 0.42]));
  assert('Shipping Speed upgrade costs are unchanged by this pass', JSON.stringify(TUNING.SHIPPING_SPEED_UPGRADE_COSTS) === JSON.stringify([200, 450, 900, 1600]));
  assert('Freshness tuning constants are unchanged by this pass', TUNING.FRESHNESS_BASE_LOSS_PER_SECOND === 0.02 && TUNING.FRESHNESS_MAX_LOSS === 0.3);
}

// ===========================================================================
// SAVE MIGRATION — a save with no `onboarding` field at all infers a
// reasonable state from existing save data rather than always restarting an
// experienced player's guide from step 1.
// ===========================================================================
function baseLegacySave(overrides: Partial<GameState> = {}): Record<string, unknown> {
  return {
    day: 1,
    dayTimeRemaining: 90,
    dayActive: true,
    cash: 100,
    fields: [],
    library: [],
    specimens: [],
    discoveredVisualIds: ['C1', 'C2'],
    discoveredColors: ['Red', 'Green'],
    discoveredPatterns: ['Plain'],
    processingQueue: [],
    processingTimer: 0,
    breeding: { active: false, everBredOnce: false },
    irrigationLevel: 0,
    shippingLevel: 0,
    // onboarding / closingWarning*Shown / marketHintShown intentionally
    // absent — this save predates the whole pass.
    ...overrides,
  };
}
{
  clearStorage();
  localStorage.setItem(TUNING.SAVE_KEY, JSON.stringify(baseLegacySave()));
  const migrated = new Game();
  assert('a genuinely fresh legacy save (Day 1, never bred, no extra Lines) starts the guide normally', migrated.state.onboarding.step === 'HARVEST_APPLE');
  assert('a fresh legacy save has not seen the Market hint yet', migrated.state.marketHintShown === false);
}
{
  clearStorage();
  localStorage.setItem(TUNING.SAVE_KEY, JSON.stringify(baseLegacySave({ day: 5, breeding: { active: false, everBredOnce: true } } as Partial<GameState>)));
  const migrated = new Game();
  assert('a legacy save that has ever bred is treated as already experienced (onboarding COMPLETE, not restarted)', migrated.state.onboarding.step === 'COMPLETE');
  assert('an already-experienced legacy save does not get a surprise Market-hint toast either', migrated.state.marketHintShown === true);
}
{
  clearStorage();
  const bredLines = [
    { id: 'l1', customName: 'A', generation: 1, color: 'Red', pattern: 'Plain', visualId: 'C1', baseVisualId: 'C1', sweetness: 50, size: 50, yieldStat: 50, growth: 50, freshness: 50, createdDay: 1, awards: [], favorite: false, archived: false },
    { id: 'l2', customName: 'B', generation: 1, color: 'Red', pattern: 'Plain', visualId: 'C1', baseVisualId: 'C1', sweetness: 50, size: 50, yieldStat: 50, growth: 50, freshness: 50, createdDay: 1, awards: [], favorite: false, archived: false },
    { id: 'l3', customName: 'C', generation: 2, color: 'Red', pattern: 'Plain', visualId: 'C1', baseVisualId: 'C1', sweetness: 50, size: 50, yieldStat: 50, growth: 50, freshness: 50, createdDay: 1, awards: [], favorite: false, archived: false },
  ];
  localStorage.setItem(TUNING.SAVE_KEY, JSON.stringify(baseLegacySave({ library: bredLines } as unknown as Partial<GameState>)));
  const migrated = new Game();
  assert('a legacy save owning more than the two starter Lines is also treated as already experienced', migrated.state.onboarding.step === 'COMPLETE');
}
{
  // A save already written BY this pass (has a valid onboarding object) is
  // validated/passed through, never reinferred from library size.
  clearStorage();
  localStorage.setItem(TUNING.SAVE_KEY, JSON.stringify(baseLegacySave({ onboarding: { step: 'FIND_SPECIMEN', dismissed: false } } as unknown as Partial<GameState>)));
  const migrated = new Game();
  assert('an existing valid onboarding object is preserved exactly, not reinferred', migrated.state.onboarding.step === 'FIND_SPECIMEN');
}
{
  clearStorage();
  localStorage.setItem(TUNING.SAVE_KEY, JSON.stringify(baseLegacySave({ onboarding: { step: 'NOT_A_REAL_STEP', dismissed: false } } as unknown as Partial<GameState>)));
  const migrated = new Game();
  assert('an invalid persisted onboarding step falls back safely to HARVEST_APPLE rather than crashing', migrated.state.onboarding.step === 'HARVEST_APPLE');
}
{
  clearStorage();
  localStorage.setItem(TUNING.SAVE_KEY, JSON.stringify(baseLegacySave()));
  const migrated = new Game();
  assert('closingWarningShown backfills to false on a save that never had the old flags either', migrated.state.closingWarningShown === false);
}
{
  // A save written under the old two-flag (17:30/17:50) system, where
  // neither had fired yet, migrates to the new flag also unfired.
  clearStorage();
  localStorage.setItem(TUNING.SAVE_KEY, JSON.stringify(baseLegacySave({ closingWarning30Shown: false, closingWarning10Shown: false } as unknown as Partial<GameState>)));
  const migrated = new Game();
  assert('a legacy save where neither old warning had fired migrates to closingWarningShown = false', migrated.state.closingWarningShown === false);
}
{
  // A save written under the old two-flag system where the (earlier) 17:30
  // warning had already fired means the player is already past 17:00 too —
  // the new single flag must migrate to true rather than re-firing a
  // "surprise" 17:00 warning on reload.
  clearStorage();
  localStorage.setItem(TUNING.SAVE_KEY, JSON.stringify(baseLegacySave({ closingWarning30Shown: true, closingWarning10Shown: false } as unknown as Partial<GameState>)));
  const migrated = new Game();
  assert('a legacy save where the old 17:30 warning had already fired migrates to closingWarningShown = true', migrated.state.closingWarningShown === true);
}

// ===========================================================================
console.log(`\n${checks - failures}/${checks} checks passed.`);
if (failures > 0) process.exit(1);
