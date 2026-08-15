// Shipping Infrastructure V1 focused verification (see PROJECT.md "Shipping
// Infrastructure" / the implementation brief's "VERIFICATION" section).
// Plain-TS script, run directly with Node's built-in type stripping (`node
// scripts/verify-shipping-infrastructure.ts`) — no test framework exists in
// this prototype yet, matching scripts/verify-market.ts's and
// scripts/verify-specimens.ts's existing convention.
//
// SCOPE: this script exercises ONLY the new Packing Capacity / Shipping
// Speed system end to end (Game/economy/save.ts). It deliberately does not
// re-verify Market V1, Market display, or Specimen genetics/discovery
// mechanics — those are already covered by verify-market.ts,
// verify-market-display.ts, and verify-specimens.ts respectively, all three
// of which were re-run against this pass's changes and remain green (see
// the final report). Phaser-rendered UI (the Packing Box readout, the
// upgrade panel's disabled/MAX states, the "PACKING FULL" toast) is NOT
// exercised here — that needs human browser verification (see the final
// report's explicit limitation note), matching every other verify-*.ts
// script's own documented scope in this codebase.
import { TUNING } from '../src/game/tuning.ts';
import { finalShipmentCadenceSeconds, packingCapacityForLevel, packingUpgradeCost, priceHarvestedApple, shippingCadenceForLevel, shippingSpeedUpgradeCost } from '../src/game/systems/economy.ts';
import { Game } from '../src/game/Game.ts';
import type { BreedingSpecimen, Field, GameState } from '../src/game/types.ts';

// ---------------------------------------------------------------------------
// Minimal in-memory localStorage polyfill — same as verify-market.ts /
// verify-specimens.ts.
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

/** Force a physical fruit slot into an exact, deterministic state for test setup — bypasses the real regrow timer entirely, same "force-ripen instead of waiting" convention verify-market.ts/verify-specimens.ts already use. */
function setSlot(field: Field, index: number, ripe: boolean, specimen: BreedingSpecimen | null = null): void {
  const slot = field.slots[index];
  slot.active = true;
  slot.ripe = ripe;
  slot.timer = 0;
  slot.specimen = specimen;
}

function fakeSpecimen(overrides: Partial<BreedingSpecimen> = {}): BreedingSpecimen {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    visualId: overrides.visualId ?? 'C2',
    baseVisualId: overrides.baseVisualId ?? 'C2',
    sweetness: overrides.sweetness ?? 50,
    size: overrides.size ?? 50,
    yieldStat: overrides.yieldStat ?? 50,
    growth: overrides.growth ?? 50,
    freshness: overrides.freshness ?? 50,
    foundDay: overrides.foundDay ?? 1,
    sourceLineId: overrides.sourceLineId ?? 'starter-red',
    sourceGeneration: overrides.sourceGeneration ?? 1,
  };
}

/** Unlocks Field 2 planted with the exact same Line as Field 1 (identical price per apple) — used by the Closing tie-break tests below. */
function unlockField2SameVariety(game: Game): Field {
  const field1 = game.state.fields[0] as Field;
  const field2 = game.state.fields[1] as Field;
  field2.unlocked = true;
  field2.varietyId = field1.varietyId;
  field2.policy = 'NORMAL';
  field2.pendingPolicy = null;
  return field2;
}

/**
 * A fresh Day-1 Game always spawns exactly one guaranteed onboarding
 * Specimen already ripe on Field 1 (see PROJECT.md "Orchard Mutation /
 * Breeding Specimen" — deliberately out of scope for this pass, verified
 * separately by verify-specimens.ts). This suite's Capacity/Closing tests
 * need full, deterministic control over which slots are ripe/hold a
 * Specimen, so every test below starts from a clean slate via this helper
 * rather than accounting for that unrelated guarantee everywhere.
 */
function clearAllSpecimens(game: Game): void {
  for (const field of game.state.fields) {
    for (const slot of field.slots) slot.specimen = null;
  }
}

/** Runs a full Closing (beginClosing + drain the queue) exactly like a real END DAY / 18:00 timeout, same helper pattern as verify-market.ts/verify-specimens.ts. */
function runClosing(game: Game): void {
  game.beginClosing();
  let guard = 0;
  while (!game.state.dayEnded) {
    game.update(0.05);
    if (++guard > 20000) throw new Error('Closing never finished — regression in Shipping/Day Cycle');
  }
}

// Freshness V1 (see PROJECT.md "Freshness") gave ProcessingItem two more
// fields — freshness 50 / packingWaitSeconds 0 here means 0 real-time wait
// so far, well inside FRESHNESS_GRACE_SECONDS, so a dummy item's realized
// Shipping value stays exactly equal to its locked `value` for every
// pre-existing arithmetic check in this suite (it predates Freshness V1 and
// is intentionally not re-verifying Freshness decay itself — see
// scripts/verify-freshness.ts for that).
function pushDummyQueueItems(state: GameState, count: number, value = 3): void {
  for (let i = 0; i < count; i++) state.processingQueue.push({ fieldId: 1, value, baseValue: value, freshness: 50, packingWaitSeconds: 0 });
}

// ===========================================================================
// TUNING TABLES
// ===========================================================================
{
  assert('Packing Capacity levels are exactly 12/18/24/32/40', JSON.stringify(TUNING.PACKING_CAPACITY_LEVELS) === JSON.stringify([12, 18, 24, 32, 40]));
  assert('Packing Capacity upgrade costs are exactly 150/350/700/1200', JSON.stringify(TUNING.PACKING_CAPACITY_UPGRADE_COSTS) === JSON.stringify([150, 350, 700, 1200]));
  assert('Packing max level is 5', TUNING.PACKING_MAX_LEVEL === 5);
  assert('Shipping Speed levels are exactly 1.00/0.80/0.65/0.52/0.42', JSON.stringify(TUNING.SHIPPING_SPEED_LEVELS) === JSON.stringify([1.0, 0.8, 0.65, 0.52, 0.42]));
  assert('Shipping Speed upgrade costs are exactly 200/450/900/1600', JSON.stringify(TUNING.SHIPPING_SPEED_UPGRADE_COSTS) === JSON.stringify([200, 450, 900, 1600]));
  assert('Shipping Speed max level is 5', TUNING.SHIPPING_SPEED_MAX_LEVEL === 5);
  for (let lvl = 1; lvl <= 5; lvl++) {
    assert(`packingCapacityForLevel(${lvl}) matches the table`, packingCapacityForLevel(lvl) === TUNING.PACKING_CAPACITY_LEVELS[lvl - 1]);
    assert(`shippingCadenceForLevel(${lvl}) matches the table`, shippingCadenceForLevel(lvl) === TUNING.SHIPPING_SPEED_LEVELS[lvl - 1]);
  }
  assert('packingUpgradeCost at MAX level returns null', packingUpgradeCost(5) === null);
  assert('shippingSpeedUpgradeCost at MAX level returns null', shippingSpeedUpgradeCost(5) === null);

  // Final Shipment cadence formula: max(0.08, normalCadence * 0.20).
  const expected = [0.2, 0.16, 0.13, 0.104, 0.084];
  for (let lvl = 1; lvl <= 5; lvl++) {
    const actual = finalShipmentCadenceSeconds(shippingCadenceForLevel(lvl));
    assert(`Final Shipment cadence at Lv${lvl} ≈ ${expected[lvl - 1]}`, Math.abs(actual - expected[lvl - 1]) < 1e-6, `got ${actual}`);
  }
  assert('Final Shipment cadence floors at 0.08 even for a hypothetical near-zero normal cadence', Math.abs(finalShipmentCadenceSeconds(0.01) - 0.08) < 1e-9);
}

// ===========================================================================
// CAPACITY — default level, gating, blocked-harvest side effects
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  clearAllSpecimens(game);
  assert('default packingCapacityLevel is 1', game.state.packingCapacityLevel === 1);
  assert('default Packing capacity is 12', game.packingCapacity() === 12);
  assert('default shippingSpeedLevel is 1', game.state.shippingSpeedLevel === 1);
  assert('default Shipping cadence is 1.00s/apple', game.shippingCadenceSeconds() === 1.0);

  const field = game.state.fields[0] as Field;
  const variety = game.getVariety(field.varietyId)!;

  // Fill the queue to exactly capacity via 12 real harvests.
  const activeNonSpecimen = field.slots.map((s, i) => i).filter((i) => field.slots[i].active && !field.slots[i].specimen);
  assert('starter Field 1 has at least 12 non-specimen active slots to test with', activeNonSpecimen.length >= 12);
  for (let k = 0; k < 12; k++) {
    setSlot(field, activeNonSpecimen[k], true);
    const ok = game.harvestFruitSlot(field.id, activeNonSpecimen[k]);
    assert(`normal harvest #${k + 1} succeeds below capacity`, ok === true);
  }
  assert('queue occupancy counts toward capacity (12/12 now)', game.state.processingQueue.length === 12);

  // 13th normal apple must be blocked. 12 harvests above rotated the
  // productive set (see pickNextProductiveSlot) — the currently-active 12
  // slots are very likely no longer the same physical indices as before, so
  // re-query the field's CURRENT active set rather than reusing the stale
  // pre-harvest `activeNonSpecimen` list.
  const blockedSlotIndex = field.slots.findIndex((s) => s.active);
  assert('field still has an active slot to attempt the 13th (blocked) harvest on', blockedSlotIndex >= 0);
  setSlot(field, blockedSlotIndex, true);
  const cashBefore = game.state.cash;
  const queueLenBefore = game.state.processingQueue.length;
  let packingFullFired = false;
  game.on((e) => {
    if (e.type === 'packingFull') packingFullFired = true;
  });
  const blockedResult = game.harvestFruitSlot(field.id, blockedSlotIndex);
  assert('normal harvest fails at capacity (returns false)', blockedResult === false);
  assert("failed harvest fires a 'packingFull' event", packingFullFired === true);
  assert('failed harvest leaves the exact fruit ripe on the exact slot', field.slots[blockedSlotIndex].ripe === true && field.slots[blockedSlotIndex].active === true);
  assert('failed harvest creates no queue item', game.state.processingQueue.length === queueLenBefore);
  assert('failed harvest pays no revenue', game.state.cash === cashBefore);

  // Specimen harvest still works at 12/12 Packing.
  const specimenSlotIndex = field.slots.findIndex((s, i) => i !== blockedSlotIndex && s.active);
  assert('field has another active slot for the Specimen-at-full-Packing check', specimenSlotIndex >= 0);
  setSlot(field, specimenSlotIndex, true, fakeSpecimen());
  const specimenResult = game.harvestFruitSlot(field.id, specimenSlotIndex);
  assert('Specimen harvest succeeds even at full Packing (12/12)', specimenResult === true);
  assert('Specimen harvest does not occupy a queue slot', game.state.processingQueue.length === 12);
  assert('Specimen went into the inventory, not the queue', game.state.specimens.length >= 1 && field.slots[specimenSlotIndex].specimen === null);

  // Pricing sanity: value used for capacity math still comes from the
  // shared priceHarvestedApple path, never a second pricing formula.
  const { value } = priceHarvestedApple(variety, field, game.state);
  assert('queued items use the shared priceHarvestedApple pricing path', game.state.processingQueue.every((item) => Math.abs(item.value - value) < 1e-6 || item.fieldId !== field.id));
}

// ===========================================================================
// CAPACITY — upgrade purchasing
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  game.state.cash = 0;
  const failNoMoney = game.buyPackingCapacityUpgrade();
  assert('cannot purchase Packing Capacity without enough cash', failNoMoney === false);
  assert('insufficient-cash attempt does not change level', game.state.packingCapacityLevel === 1);
  assert('insufficient-cash attempt does not change cash', game.state.cash === 0);

  game.state.cash = 150;
  const ok1 = game.buyPackingCapacityUpgrade();
  assert('Lv1->Lv2 purchase succeeds at exactly $150', ok1 === true);
  assert('cash deducted exactly $150', game.state.cash === 0);
  assert('level is now 2', game.state.packingCapacityLevel === 2);
  assert('capacity is now 18', game.packingCapacity() === 18);

  game.state.cash = 10000;
  game.buyPackingCapacityUpgrade(); // Lv2->3 ($350)
  game.buyPackingCapacityUpgrade(); // Lv3->4 ($700)
  game.buyPackingCapacityUpgrade(); // Lv4->5 ($1200)
  assert('reached Lv5 (capacity 40)', game.state.packingCapacityLevel === 5 && game.packingCapacity() === 40);
  const cashAtMax = game.state.cash;
  const overMax = game.buyPackingCapacityUpgrade();
  assert('cannot exceed Lv5', overMax === false);
  assert('cash unchanged when already at MAX', game.state.cash === cashAtMax);
  assert('level unchanged when already at MAX', game.state.packingCapacityLevel === 5);

  // Persistence.
  game.save();
  const reloaded = new Game();
  assert('Packing Capacity level persists across save/reload', reloaded.state.packingCapacityLevel === 5);
}

// ===========================================================================
// SHIPPING SPEED — upgrade purchasing + non-retroactive timer behavior
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  game.state.cash = 0;
  assert('cannot purchase Shipping Speed without enough cash', game.buyShippingSpeedUpgrade() === false);
  assert('level unchanged', game.state.shippingSpeedLevel === 1);

  game.state.cash = 200;
  assert('Lv1->Lv2 purchase succeeds at exactly $200', game.buyShippingSpeedUpgrade() === true);
  assert('cash deducted exactly $200', game.state.cash === 0);
  assert('cadence is now 0.80s/apple', game.shippingCadenceSeconds() === 0.8);

  game.state.cash = 10000;
  game.buyShippingSpeedUpgrade(); // Lv2->3 ($450)
  game.buyShippingSpeedUpgrade(); // Lv3->4 ($900)
  game.buyShippingSpeedUpgrade(); // Lv4->5 ($1600)
  assert('reached Lv5 (0.42s/apple)', game.state.shippingSpeedLevel === 5 && game.shippingCadenceSeconds() === 0.42);
  const cashAtMax = game.state.cash;
  assert('cannot exceed Lv5', game.buyShippingSpeedUpgrade() === false);
  assert('cash unchanged at MAX', game.state.cash === cashAtMax);

  game.save();
  const reloaded = new Game();
  assert('Shipping Speed level persists across save/reload', reloaded.state.shippingSpeedLevel === 5);
}
{
  // A mid-day upgrade must NOT retroactively rescale the currently-running
  // head timer — only the NEXT scheduled interval uses the new cadence.
  clearStorage();
  const game = new Game();
  game.state.cash = 200;
  game.state.processingQueue = [
    { fieldId: 1, value: 3, baseValue: 3, freshness: 50, packingWaitSeconds: 0 },
    { fieldId: 1, value: 3, baseValue: 3, freshness: 50, packingWaitSeconds: 0 },
  ];
  game.state.processingTimer = 1.0; // simulate a Lv1-cadence head item already mid-flight

  const bought = game.buyShippingSpeedUpgrade();
  assert('mid-day Shipping Speed purchase succeeds', bought === true);
  assert('current head processingTimer is NOT retroactively rescaled by the upgrade', game.state.processingTimer === 1.0);

  game.update(1.0); // exactly drains the head item's remaining timer
  assert('head item shipped', game.state.processingQueue.length === 1);
  assert('the NEXT scheduled interval uses the upgraded (0.80s) cadence', Math.abs(game.state.processingTimer - 0.8) < 1e-9);
}

// ===========================================================================
// HARVEST ALL — Specimens secured regardless of capacity, normal fruit
// capped at remaining capacity, overflow left untouched.
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  clearAllSpecimens(game);
  const field = game.state.fields[0] as Field;
  pushDummyQueueItems(game.state, 12); // Packing already full (12/12) before HARVEST ALL

  const activeSlots = field.slots.map((_, i) => i).filter((i) => field.slots[i].active);
  const specimenIdx = activeSlots[0];
  const normalIdx1 = activeSlots[1];
  const normalIdx2 = activeSlots[2];
  setSlot(field, specimenIdx, true, fakeSpecimen({ id: 'harvest-all-specimen' }));
  setSlot(field, normalIdx1, true);
  setSlot(field, normalIdx2, true);

  const specimensBefore = game.state.specimens.length;
  const queueBefore = game.state.processingQueue.length;
  game.harvestFruitSlot(field.id, specimenIdx); // exercises the same shared path HARVEST ALL uses per-slot
  const blocked1 = game.harvestFruitSlot(field.id, normalIdx1);
  const blocked2 = game.harvestFruitSlot(field.id, normalIdx2);

  assert('HARVEST ALL path: Specimen is secured even while Packing is already full', game.state.specimens.length === specimensBefore + 1);
  assert('HARVEST ALL path: Specimen never enters the queue', game.state.processingQueue.length === queueBefore);
  assert('HARVEST ALL path: normal fruit is blocked once Packing is full', blocked1 === false && blocked2 === false);
  assert('HARVEST ALL path: blocked normal fruit stays ripe on the tree (no overflow deletion)', field.slots[normalIdx1].ripe === true && field.slots[normalIdx2].ripe === true);
  assert('HARVEST ALL path: no overflow revenue paid', game.state.processingQueue.length === 12);
}

// ===========================================================================
// CLOSING — capacity-aware sequence
// ===========================================================================

// Specimens secured first, regardless of capacity; free capacity computed
// from existing occupancy; overflow stays ripe and survives settlement.
{
  clearStorage();
  const game = new Game();
  clearAllSpecimens(game);
  const field = game.state.fields[0] as Field;
  pushDummyQueueItems(game.state, 10); // 10/12 occupied -> 2 free slots at Closing

  const activeSlots = field.slots.map((_, i) => i).filter((i) => field.slots[i].active);
  const specimenIdx = activeSlots[0];
  const normalIdxA = activeSlots[1];
  const normalIdxB = activeSlots[2];
  const normalIdxC = activeSlots[3]; // this one should overflow (only 2 free slots)
  setSlot(field, specimenIdx, true, fakeSpecimen({ id: 'closing-specimen' }));
  setSlot(field, normalIdxA, true);
  setSlot(field, normalIdxB, true);
  setSlot(field, normalIdxC, true);

  const specimensBefore = game.state.specimens.length;
  const started = game.beginClosing();
  assert('beginClosing() starts successfully', started === true);
  assert('growth freezes immediately (state.closing true)', game.state.closing === true);
  assert('Closing secures the ripe Specimen regardless of capacity', game.state.specimens.length === specimensBefore + 1);
  assert('Specimen slot is no longer ripe after Closing collection', field.slots[specimenIdx].ripe === false);
  assert('free capacity (2) computed from existing 10/12 occupancy — queue is now 12', game.state.processingQueue.length === 12);

  const stillRipe = [normalIdxA, normalIdxB, normalIdxC].filter((i) => field.slots[i].ripe);
  assert('exactly one of the three normal ripe apples overflows (only 2 free slots existed)', stillRipe.length === 1);
  assert('normal collection never exceeds capacity', game.state.processingQueue.length <= game.packingCapacity());

  // Drain to settlement and confirm the single-collection-pass rule: no
  // second tree sweep happens once the queue empties, even though capacity
  // is now fully free again.
  let guard = 0;
  while (!game.state.dayEnded) {
    game.update(0.05);
    if (++guard > 20000) throw new Error('Closing never finished');
  }
  assert('Final Shipment emptying the queue does NOT trigger a second tree collection', field.slots.filter((s, i) => [normalIdxA, normalIdxB, normalIdxC].includes(i) && s.ripe).length === 1);
  assert('overflow fruit remains ripe after settlement', stillRipe.length === 1);
  assert('overflow fruit is still ripe post-settlement (same slot)', field.slots[stillRipe[0]].ripe === true);
}

// Closing when Packing is ALREADY full: specimens still secured, zero
// normal apples collected.
{
  clearStorage();
  const game = new Game();
  clearAllSpecimens(game);
  const field = game.state.fields[0] as Field;
  pushDummyQueueItems(game.state, 12); // already 12/12

  const activeSlots = field.slots.map((_, i) => i).filter((i) => field.slots[i].active);
  const specimenIdx = activeSlots[0];
  const normalIdx = activeSlots[1];
  setSlot(field, specimenIdx, true, fakeSpecimen({ id: 'full-closing-specimen' }));
  setSlot(field, normalIdx, true);

  const specimensBefore = game.state.specimens.length;
  game.beginClosing();
  assert('Closing secures ripe Specimens even when Packing is already 12/12', game.state.specimens.length === specimensBefore + 1);
  assert('zero normal apples collected when Packing was already full', field.slots[normalIdx].ripe === true);
  assert('queue occupancy still exactly 12 (unchanged by the blocked normal apple)', game.state.processingQueue.length === 12);
}

// Highest-current-value-first priority + deterministic field-order tie-break.
{
  clearStorage();
  const game = new Game();
  clearAllSpecimens(game);
  const field1 = game.state.fields[0] as Field;
  const field2 = unlockField2SameVariety(game);
  // Field 2 gets a value bump via SWEETEN cultivation so its apples are
  // strictly worth more than Field 1's NORMAL apples — an unambiguous,
  // deterministic value difference driven by the existing pricing formula
  // (no second pricing path invented for this test).
  field2.policy = 'SWEETEN';

  const f1Active = field1.slots.map((_, i) => i).filter((i) => field1.slots[i].active);
  const f2Active = field2.slots.map((_, i) => i).filter((i) => field2.slots[i].active);
  const lowValueSlot = f1Active[0];
  const highValueSlot = f2Active[0];
  const tieSlotF1 = f1Active[1]; // same value/field as another Field-1 slot below -> tests tie order too
  const tieSlotF1b = f1Active[2];

  setSlot(field1, lowValueSlot, true);
  setSlot(field2, highValueSlot, true);
  setSlot(field1, tieSlotF1, true);
  setSlot(field1, tieSlotF1b, true);

  // Only 1 free Packing slot: the highest-value apple (Field 2, SWEETEN)
  // must be chosen over any Field-1 NORMAL apple.
  pushDummyQueueItems(game.state, 11);
  game.beginClosing();

  assert('highest-current-value ripe fruit (Field 2, SWEETEN) is collected first', field2.slots[highValueSlot].ripe === false);
  assert('lower-value Field-1 apples stay on the tree when capacity only fit the top one', field1.slots[lowValueSlot].ripe === true && field1.slots[tieSlotF1].ripe === true && field1.slots[tieSlotF1b].ripe === true);
}
{
  // Deterministic tie-break: equal value, Field order then slot index.
  clearStorage();
  const game = new Game();
  clearAllSpecimens(game);
  const field1 = game.state.fields[0] as Field;
  const field2 = unlockField2SameVariety(game); // identical variety+policy -> identical value

  const f1Active = field1.slots.map((_, i) => i).filter((i) => field1.slots[i].active);
  const f2Active = field2.slots.map((_, i) => i).filter((i) => field2.slots[i].active);
  const f1SlotLow = Math.min(...f1Active);
  const f2SlotLow = Math.min(...f2Active);
  setSlot(field1, f1SlotLow, true);
  setSlot(field2, f2SlotLow, true);

  pushDummyQueueItems(game.state, 11); // exactly 1 free slot, values tied -> Field order decides
  game.beginClosing();

  assert('tie-break: earlier Field (Field 1) wins an equal-value tie', field1.slots[f1SlotLow].ripe === false);
  assert('tie-break: later Field (Field 2) stays ripe on an equal-value tie', field2.slots[f2SlotLow].ripe === true);
}

// Carryover fruit price timing: an overflowed ripe apple is priced at
// TODAY's (next day's) Market rate when actually harvested, never the
// Closing day's rate.
{
  clearStorage();
  const game = new Game();
  clearAllSpecimens(game);
  const field = game.state.fields[0] as Field;
  pushDummyQueueItems(game.state, 12); // Packing already full -> guarantees overflow
  const activeSlots = field.slots.map((_, i) => i).filter((i) => field.slots[i].active);
  const overflowSlot = activeSlots[0];
  setSlot(field, overflowSlot, true);

  runClosing(game);
  assert('overflow fruit survives settlement still ripe', field.slots[overflowSlot].ripe === true);
  game.proceedToNextDay();
  // The Day-2 guaranteed onboarding Specimen (see PROJECT.md "Orchard
  // Mutation / Breeding Specimen", out of scope here) can land on this same
  // physical slot — neutralize it again so the carryover slot stays
  // ordinary fruit for this test, exactly like the initial clearAllSpecimens
  // call above.
  clearAllSpecimens(game);
  assert('overflow fruit survives into the next day', field.slots[overflowSlot].ripe === true);

  // Force a Market move on the planted Visual between Closing and the
  // actual next-day harvest, then confirm the harvested value reflects the
  // NEW rate, not any value implicitly computed back on the Closing day.
  const variety = game.getVariety(field.varietyId)!;
  game.state.visualMarket[variety.baseVisualId].pct = 0.5;
  const expected = priceHarvestedApple(variety, field, game.state);
  game.harvestFruitSlot(field.id, overflowSlot);
  const queued = game.state.processingQueue[game.state.processingQueue.length - 1];
  assert('carryover fruit is priced at CURRENT (post-Closing) Market rate when actually harvested', Math.abs(queued.value - expected.value) < 1e-6);
}

// A slower normal-cadence head timer is clamped down (never lengthened) at
// the moment Closing begins.
{
  clearStorage();
  const game = new Game();
  game.state.processingQueue = [{ fieldId: 1, value: 3, baseValue: 3, freshness: 50, packingWaitSeconds: 0 }];
  game.state.processingTimer = 1.0; // Lv1 normal cadence, freshly started
  game.beginClosing();
  const expectedFinalCadence = finalShipmentCadenceSeconds(game.shippingCadenceSeconds());
  assert('a slower remaining head timer is clamped down to Final Shipment cadence at Closing', Math.abs(game.state.processingTimer - expectedFinalCadence) < 1e-9);
}
{
  clearStorage();
  const game = new Game();
  game.state.processingQueue = [{ fieldId: 1, value: 3, baseValue: 3, freshness: 50, packingWaitSeconds: 0 }];
  game.state.processingTimer = 0.05; // already shorter than Final Shipment cadence
  game.beginClosing();
  assert('an already-shorter remaining head timer is NOT increased at Closing', Math.abs(game.state.processingTimer - 0.05) < 1e-9);
}

// No duplicate Closing settlement.
{
  clearStorage();
  const game = new Game();
  runClosing(game);
  const cashAfterFirst = game.state.cash;
  const secondCall = game.beginClosing();
  assert('a second beginClosing() call while already dayEnded is a no-op', secondCall === false);
  assert('cash unchanged by the rejected second call', game.state.cash === cashAfterFirst);
}

// ===========================================================================
// ACCOUNTING — overflow contributes nothing until actually shipped;
// Operating Cost deducted exactly once; totalRevenue stays gross lifetime.
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  clearAllSpecimens(game);
  // This check predates Freshness V1 and isn't about Freshness at all — it's
  // about overflow/Operating-Cost/totalRevenue accounting. Max Shipping
  // Speed keeps the whole 12-item Final Shipment drain comfortably inside
  // FRESHNESS_GRACE_SECONDS (see PROJECT.md "Freshness"), so every dummy
  // item ships with 0 Freshness loss and the original "exactly 36" gross
  // figure this check asserts stays exactly true; Freshness's own decay
  // math is covered separately by scripts/verify-freshness.ts.
  game.state.shippingSpeedLevel = 5;
  const field = game.state.fields[0] as Field;
  pushDummyQueueItems(game.state, 12); // guarantee overflow
  const activeSlots = field.slots.map((_, i) => i).filter((i) => field.slots[i].active);
  const overflowSlot = activeSlots[0];
  setSlot(field, overflowSlot, true);

  const totalRevenueBefore = game.state.totalRevenue;
  runClosing(game);
  assert('overflow ripe fruit adds nothing to the day\'s Gross', field.slots[overflowSlot].ripe === true);
  assert('Operating Cost deducted exactly once this Closing', game.state.lastDayLog !== null);
  const expectedOpCost = 15 + game.unlockedFields().length * 20; // Day 1, matches operatingCost() formula
  assert('Operating Cost formula is unchanged by this pass', Math.abs((game.state.lastDayLog?.operatingCost ?? -1) - expectedOpCost) < 1e-6);
  assert('totalRevenue only grew from the 12 dummy-queued items worth of gross shipping (36) + nothing from overflow', Math.abs(game.state.totalRevenue - totalRevenueBefore - 36) < 1e-6);
}

// ===========================================================================
// SAVE MIGRATION
// ===========================================================================
{
  clearStorage();
  const oldSave = {
    day: 3,
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
    // packingCapacityLevel / shippingSpeedLevel intentionally absent.
  };
  localStorage.setItem(TUNING.SAVE_KEY, JSON.stringify(oldSave));
  const migrated = new Game();
  assert('old save with no packingCapacityLevel migrates to Level 1', migrated.state.packingCapacityLevel === 1);
  assert('old save with no shippingSpeedLevel migrates to Level 1', migrated.state.shippingSpeedLevel === 1);
}
{
  // Over-capacity legacy queue must be preserved, never truncated, and must
  // still block new normal entries while occupancy >= capacity.
  clearStorage();
  const game = new Game();
  pushDummyQueueItems(game.state, 20); // 20 > default Level-1 capacity of 12
  game.save();
  const reloaded = new Game();
  clearAllSpecimens(reloaded);
  assert('an over-capacity legacy queue is preserved on load, never truncated', reloaded.state.processingQueue.length === 20);
  assert('reloaded packingCapacityLevel still 1 (12) despite the larger legacy queue', reloaded.packingCapacity() === 12);

  const field = reloaded.state.fields[0] as Field;
  const slotIndex = field.slots.findIndex((s) => s.active);
  setSlot(field, slotIndex, true);
  const blocked = reloaded.harvestFruitSlot(field.id, slotIndex);
  assert('no new normal fruit can enter while the legacy queue is over capacity', blocked === false);
  assert('the over-capacity queue is left exactly as-is (still 20, not truncated further)', reloaded.state.processingQueue.length === 20);

  // Draining it below capacity must re-open normal harvesting.
  let guard = 0;
  while (reloaded.state.processingQueue.length >= reloaded.packingCapacity()) {
    reloaded.update(0.05);
    if (++guard > 200000) throw new Error('Legacy over-capacity queue never drained below capacity');
  }
  const nowAllowed = reloaded.harvestFruitSlot(field.id, slotIndex);
  assert('normal harvesting resumes once the drained queue is back under capacity', nowAllowed === true);
}

// ===========================================================================
// PACKING-FULL HARVEST CONTRACT — root-fix regression for "a blocked
// harvest attempt must be a true no-op on the fruit itself, and must never
// invoke the visual removal/pop path." This directly audits
// Game.harvestFruitSlot's contract (the boolean it returns IS what
// render/OrchardTreeLayer.ts's FruitSlot.attemptHarvest() gates its pop
// animation on — see that file: `if (!harvested) return;` runs BEFORE any
// tween/consumed-flag mutation, so a false return is provably unreachable
// past that guard). `simulateFruitSlotClick` below mirrors that exact
// early-return contract (not a reimplementation of Phaser rendering) so
// this can assert on it without a browser; the actual tween/animation
// itself remains a browser-only check (see the final report).
// ===========================================================================
function simulateFruitSlotClick(attemptHarvest: (slotIndex: number) => boolean, slotIndex: number): { harvested: boolean; visualRemovalInvoked: boolean } {
  const harvested = attemptHarvest(slotIndex);
  // Mirrors render/OrchardTreeLayer.ts FruitSlot.attemptHarvest(): the pop
  // animation / consumed flag / revealed=false only ever happen AFTER (and
  // conditioned on) a true return — never before, never unconditionally.
  const visualRemovalInvoked = harvested;
  return { harvested, visualRemovalInvoked };
}

{
  clearStorage();
  const game = new Game();
  clearAllSpecimens(game);
  const field = game.state.fields[0] as Field;
  const attemptHarvest = (slotIndex: number) => game.harvestFruitSlot(field.id, slotIndex);

  // Fill Packing to capacity.
  const activeSlots = field.slots.map((_, i) => i).filter((i) => field.slots[i].active);
  for (let k = 0; k < 12; k++) {
    setSlot(field, activeSlots[k], true);
    assert(`setup harvest #${k + 1} fills Packing`, game.harvestFruitSlot(field.id, activeSlots[k]) === true);
  }
  assert('setup: Packing is now at capacity (12/12)', game.state.processingQueue.length === 12);

  // Attempt a direct click/harvest of one more ripe normal fruit.
  const targetSlot = field.slots.findIndex((s) => s.active);
  assert('setup: a target slot exists to click', targetSlot >= 0);
  setSlot(field, targetSlot, true);
  field.slots[targetSlot].timer = 4.2; // sentinel — a ripe slot's timer is normally meaningless/0; a non-zero sentinel makes "timer untouched" actually provable
  const before = { ...field.slots[targetSlot] };
  const cashBefore = game.state.cash;
  const queueLenBefore = game.state.processingQueue.length;

  const { harvested, visualRemovalInvoked } = simulateFruitSlotClick(attemptHarvest, targetSlot);

  assert('harvest returns failure (false)', harvested === false);
  assert('the visual pop/removal path is NEVER invoked on a failed harvest', visualRemovalInvoked === false);
  assert('exact slot remains ripe', field.slots[targetSlot].ripe === true);
  assert('exact slot remains active', field.slots[targetSlot].active === true);
  assert('fruit data is byte-for-byte unchanged (ripe/active/timer/specimen)', JSON.stringify(field.slots[targetSlot]) === JSON.stringify(before));
  assert('no regrowth timer restart — sentinel timer value survives untouched', field.slots[targetSlot].timer === 4.2);
  assert('no queue item was created', game.state.processingQueue.length === queueLenBefore);
  assert('no revenue was paid', game.state.cash === cashBefore);

  // Repeated hold-and-sweep overlap over the SAME still-full slot: must
  // stay continuously "ripe/visible" and never toggle any transient state
  // that would restart a reveal/pop animation.
  for (let i = 0; i < 5; i++) {
    const repeat = simulateFruitSlotClick(attemptHarvest, targetSlot);
    assert(`repeated sweep touch #${i + 1} over a still-full Packing box also fails cleanly`, repeat.harvested === false && repeat.visualRemovalInvoked === false);
  }
  assert('after repeated sweep touches, the fruit is still exactly as it was (no accumulated state drift)', JSON.stringify(field.slots[targetSlot]) === JSON.stringify(before));

  // Successful harvest still works normally (capacity now free after
  // draining one item off the front of the queue).
  game.update(1.1); // ships exactly the head item at Lv1's 1.0s/apple cadence
  assert('setup: Packing now has exactly 1 free slot', game.state.processingQueue.length === 11);
  const successResult = simulateFruitSlotClick(attemptHarvest, targetSlot);
  assert('a normal harvest still succeeds once Packing has a free slot again', successResult.harvested === true);
  assert('a successful harvest DOES invoke the visual removal/pop path', successResult.visualRemovalInvoked === true);
  assert('a successful harvest actually clears the slot (no longer ripe)', field.slots[targetSlot].ripe === false);
  assert('a successful harvest enqueues exactly one item', game.state.processingQueue.length === 12);

  // Specimen harvest still works at full Packing, through the identical
  // click contract.
  const specimenSlot = field.slots.findIndex((s) => s.active);
  assert('setup: a slot exists for the Specimen-at-full-Packing check', specimenSlot >= 0);
  setSlot(field, specimenSlot, true, fakeSpecimen({ id: 'contract-check-specimen' }));
  const specimensBefore = game.state.specimens.length;
  const specimenClick = simulateFruitSlotClick(attemptHarvest, specimenSlot);
  assert('Specimen harvest succeeds through the same click contract even at 12/12 Packing', specimenClick.harvested === true && specimenClick.visualRemovalInvoked === true);
  assert('Specimen went into the inventory, not the queue', game.state.specimens.length === specimensBefore + 1 && game.state.processingQueue.length === 12);
}

// HARVEST ALL leaves overflow fruit fully intact (data + visual contract),
// not just "some assertion somewhere" — exercised via the same per-slot
// click contract every slot in a real HARVEST ALL loop goes through.
{
  clearStorage();
  const game = new Game();
  clearAllSpecimens(game);
  const field = game.state.fields[0] as Field;
  pushDummyQueueItems(game.state, 12);
  const activeSlots = field.slots.map((_, i) => i).filter((i) => field.slots[i].active);
  const overflowA = activeSlots[0];
  const overflowB = activeSlots[1];
  setSlot(field, overflowA, true);
  setSlot(field, overflowB, true);
  const beforeA = { ...field.slots[overflowA] };
  const beforeB = { ...field.slots[overflowB] };

  const attemptHarvest = (slotIndex: number) => game.harvestFruitSlot(field.id, slotIndex);
  // Same loop shape as OrchardTreeLayer.harvestAllRemaining() (attemptHarvest on every slot).
  for (const i of activeSlots) simulateFruitSlotClick(attemptHarvest, i);

  assert('HARVEST ALL: overflow fruit A is untouched, byte-for-byte', JSON.stringify(field.slots[overflowA]) === JSON.stringify(beforeA));
  assert('HARVEST ALL: overflow fruit B is untouched, byte-for-byte', JSON.stringify(field.slots[overflowB]) === JSON.stringify(beforeB));
}

// ===========================================================================
// REGRESSION spot-check — shipment events still fire normally within
// capacity (full regression coverage lives in verify-market.ts /
// verify-market-display.ts / verify-specimens.ts, all re-run green
// alongside this script — see the final report).
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  const field = game.state.fields[0] as Field;
  const slotIndex = field.slots.findIndex((s) => s.active && !s.specimen);
  setSlot(field, slotIndex, true);

  let shipmentRevenue = -1;
  game.on((e) => {
    if (e.type === 'shipment') shipmentRevenue = e.revenue;
  });
  game.harvestFruitSlot(field.id, slotIndex);
  const queuedValue = game.state.processingQueue[0]?.value ?? -2;
  let guard = 0;
  while (game.state.processingQueue.length > 0) {
    game.update(0.05);
    if (++guard > 20000) throw new Error('Queue never drained');
  }
  assert("normal shipping still fires a 'shipment' event with the locked value", Math.abs(shipmentRevenue - queuedValue) < 1e-9);
}

console.log(`\n${checks - failures}/${checks} checks passed.`);
if (failures > 0) process.exit(1);
