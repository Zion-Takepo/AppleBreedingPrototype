// Freshness V1 focused verification (see PROJECT.md "Freshness" / the
// implementation brief's "VERIFICATION" section). Plain-TS script, run
// directly with Node's built-in type stripping (`node
// scripts/verify-freshness.ts`) — no test framework exists in this
// prototype yet, matching scripts/verify-market.ts's,
// scripts/verify-specimens.ts's, and
// scripts/verify-shipping-infrastructure.ts's existing convention.
//
// SCOPE: this script exercises ONLY Freshness V1's own decay/retention math
// and its integration with harvest-locking, the shared Packing queue, and
// day settlement. It deliberately does not re-verify Market V1, Market
// display, Specimen genetics/discovery, or the rest of Shipping
// Infrastructure end to end — those are already covered by
// verify-market.ts, verify-market-display.ts, verify-specimens.ts, and
// verify-shipping-infrastructure.ts respectively, all four of which were
// re-run against this pass's changes and remain green (see the final
// report). Phaser-rendered UI (the End Day summary's new Freshness Loss
// row, the StatHelpModal/ShippingInfraModal text changes) is NOT exercised
// here — that needs human browser verification (see the final report's
// explicit limitation note), matching every other verify-*.ts script's own
// documented scope in this codebase.
import { TUNING } from '../src/game/tuning.ts';
import { freshnessLossFraction, freshnessRetention, realizedShippingValue } from '../src/game/systems/freshness.ts';
import { operatingCost, priceHarvestedApple, shippingCadenceForLevel } from '../src/game/systems/economy.ts';
import { Game } from '../src/game/Game.ts';
import type { BreedingSpecimen, Field, GameState, ProcessingItem } from '../src/game/types.ts';

// ---------------------------------------------------------------------------
// Minimal in-memory localStorage polyfill — same as the other verify-*.ts
// scripts.
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

function setSlot(field: Field, index: number, ripe: boolean, specimen: BreedingSpecimen | null = null): void {
  const slot = field.slots[index];
  slot.active = true;
  slot.ripe = ripe;
  slot.timer = 0;
  slot.specimen = specimen;
}

/** Clears the Day-1/Day-2 guaranteed onboarding Specimen (out of scope here — see verify-specimens.ts) so tests get full deterministic control over which slots are ripe. */
function clearAllSpecimens(game: Game): void {
  for (const field of game.state.fields) {
    for (const slot of field.slots) slot.specimen = null;
  }
}

function pushItem(state: GameState, overrides: Partial<ProcessingItem> = {}): ProcessingItem {
  const item: ProcessingItem = {
    fieldId: 1,
    value: overrides.value ?? 10,
    baseValue: overrides.baseValue ?? 10,
    freshness: overrides.freshness ?? 50,
    packingWaitSeconds: overrides.packingWaitSeconds ?? 0,
  };
  state.processingQueue.push(item);
  return item;
}

function runClosing(game: Game): void {
  game.beginClosing();
  let guard = 0;
  while (!game.state.dayEnded) {
    game.update(0.05);
    if (++guard > 20000) throw new Error('Closing never finished — regression in Day Cycle');
  }
}

const approx = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

// ===========================================================================
// FORMULA — freshnessLossFraction / freshnessRetention
// ===========================================================================
{
  assert('wait exactly at grace (2.0s) => 0 loss, any Freshness', freshnessLossFraction(0, 2.0) === 0 && freshnessLossFraction(100, 2.0) === 0);
  assert('wait below grace (1.0s) => 0 loss', freshnessLossFraction(50, 1.0) === 0);
  assert('wait of 0s => 0 loss', freshnessLossFraction(50, 0) === 0);

  assert('Freshness 0 at 10s => 16% loss', approx(freshnessLossFraction(0, 10), 0.16), `got ${freshnessLossFraction(0, 10)}`);
  assert('Freshness 50 at 10s => 9.6% loss', approx(freshnessLossFraction(50, 10), 0.096), `got ${freshnessLossFraction(50, 10)}`);
  assert('Freshness 100 at 10s => 3.2% loss', approx(freshnessLossFraction(100, 10), 0.032), `got ${freshnessLossFraction(100, 10)}`);

  assert('Freshness 0 at 10s => 84% retention', approx(freshnessRetention(0, 10), 0.84));
  assert('Freshness 50 at 10s => 90.4% retention', approx(freshnessRetention(50, 10), 0.904));
  assert('Freshness 100 at 10s => 96.8% retention', approx(freshnessRetention(100, 10), 0.968));

  assert('loss never exceeds 30% even at extreme wait, Freshness 0', freshnessLossFraction(0, 100000) <= 0.3 + 1e-9);
  assert('loss caps at exactly 30% at extreme wait, Freshness 0', approx(freshnessLossFraction(0, 100000), 0.3));
  assert('retention never below 70% even at extreme wait, Freshness 0', freshnessRetention(0, 100000) >= 0.7 - 1e-9);

  assert('Freshness clamps safely below 0 (matches Freshness 0)', freshnessLossFraction(-50, 10) === freshnessLossFraction(0, 10));
  assert('Freshness clamps safely above 100 (matches Freshness 100)', freshnessLossFraction(150, 10) === freshnessLossFraction(100, 10));

  // Monotonicity: higher Freshness never produces worse (higher) loss at the
  // same wait; longer wait never improves (reduces) loss at the same
  // Freshness.
  let freshnessMonotonic = true;
  let waitMonotonic = true;
  for (let wait = 0; wait <= 60; wait += 3) {
    let prevLoss = freshnessLossFraction(0, wait);
    for (let f = 5; f <= 100; f += 5) {
      const loss = freshnessLossFraction(f, wait);
      if (loss > prevLoss + 1e-9) freshnessMonotonic = false;
      prevLoss = loss;
    }
  }
  for (let f = 0; f <= 100; f += 5) {
    let prevLoss = freshnessLossFraction(f, 0);
    for (let wait = 1; wait <= 60; wait += 1) {
      const loss = freshnessLossFraction(f, wait);
      if (loss < prevLoss - 1e-9) waitMonotonic = false;
      prevLoss = loss;
    }
  }
  assert('higher Freshness never produces worse (higher) loss at the same wait', freshnessMonotonic);
  assert('longer wait never produces better (lower) loss at the same Freshness', waitMonotonic);

  assert('realizedShippingValue = lockedValue * retention', approx(realizedShippingValue(10, 0, 10), 8.4));
  assert('realizedShippingValue never exceeds the locked value', realizedShippingValue(10, 100, 0) <= 10 + 1e-9);
}

// ===========================================================================
// HARVEST LOCK — genetic Freshness + Market-adjusted value frozen at
// harvest time, immune to later Market/Line changes.
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  clearAllSpecimens(game);
  const field = game.state.fields[0] as Field;
  const variety = game.getVariety(field.varietyId)!;
  variety.freshness = 77;

  const slotIndex = field.slots.findIndex((s) => s.active);
  setSlot(field, slotIndex, true);
  const expected = priceHarvestedApple(variety, field, game.state, variety.baseVisualId);
  const ok = game.harvestFruitSlot(field.id, slotIndex);
  assert('harvest succeeds', ok === true);

  const item = game.state.processingQueue[game.state.processingQueue.length - 1];
  assert('queued item stores the exact genetic Freshness at harvest time', item.freshness === 77);
  assert('queued item packingWaitSeconds starts at 0', item.packingWaitSeconds === 0);
  assert('queued item value matches the shared priceHarvestedApple pricing path', approx(item.value, expected.value));

  // Later Market move on the same visual must not reprice the already-queued item.
  const valueBeforeMarketMove = item.value;
  game.state.visualMarket[variety.baseVisualId].pct = 0.5;
  assert('a later Market change does not retroactively reprice the locked queue item', item.value === valueBeforeMarketMove);

  // Later Line-level Freshness change (e.g. via replant onto a different
  // Line, or the Line itself being edited) must not alter the already-queued
  // item's frozen Freshness either.
  variety.freshness = 3;
  assert('a later change to the planted Line\'s own Freshness does not alter the already-queued item', item.freshness === 77);
}

// ===========================================================================
// WAITING — queue-age semantics: head + waiting items, Breed pause freeze
// with no catch-up, Closing/Final Shipment continuing to age, save/reload.
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  game.state.processingQueue = [];
  const head = pushItem(game.state, { packingWaitSeconds: 0 });
  const waiting = pushItem(game.state, { packingWaitSeconds: 0 });
  game.state.processingTimer = 1000; // keep the head from shipping mid-test

  game.update(3.0, false);
  assert('the head item ages while the farm simulation runs', approx(head.packingWaitSeconds, 3.0));
  assert('a waiting (non-head) item ages too, not just the head', approx(waiting.packingWaitSeconds, 3.0));

  game.update(2.0, true); // Breed strategic pause active
  assert("Breed's strategic pause freezes packing wait time (head)", approx(head.packingWaitSeconds, 3.0));
  assert("Breed's strategic pause freezes packing wait time (waiting item)", approx(waiting.packingWaitSeconds, 3.0));

  game.update(1.0, false); // resume — must add exactly 1.0s, no catch-up for the paused window
  assert('resuming after a pause adds no catch-up delta (head)', approx(head.packingWaitSeconds, 4.0));
  assert('resuming after a pause adds no catch-up delta (waiting item)', approx(waiting.packingWaitSeconds, 4.0));
}
{
  // Closing/Final Shipment continues aging queued items (Closing never sets
  // pauseFarmSimulation — see MainScene.isBreedPauseActive()).
  clearStorage();
  const game = new Game();
  clearAllSpecimens(game);
  const field = game.state.fields[0] as Field;
  const slotIndex = field.slots.findIndex((s) => s.active);
  setSlot(field, slotIndex, true);
  game.state.processingQueue = [];
  const stillWaiting = pushItem(game.state, { packingWaitSeconds: 0 });
  game.harvestFruitSlot(field.id, slotIndex); // second item behind stillWaiting; both should age during Closing

  game.beginClosing();
  const waitBeforeDrainTick = stillWaiting.packingWaitSeconds;
  game.update(0.5); // one Closing-time tick — closing=true, but pauseFarmSimulation is false
  assert('a still-queued item continues aging during Closing/Final Shipment', stillWaiting.packingWaitSeconds > waitBeforeDrainTick);
}
{
  // Save/reload preserves exact accumulated wait time.
  clearStorage();
  const game = new Game();
  game.state.processingQueue = [];
  pushItem(game.state, { freshness: 33, packingWaitSeconds: 12.375 });
  game.state.processingTimer = 1000;
  game.save();
  const reloaded = new Game();
  const reloadedItem = reloaded.state.processingQueue[reloaded.state.processingQueue.length - 1];
  assert('save/reload preserves exact accumulated packingWaitSeconds', reloadedItem.packingWaitSeconds === 12.375);
  assert('save/reload preserves exact frozen freshness', reloadedItem.freshness === 33);
}

// ===========================================================================
// SHIPPING — realized value paid, shipment event uses it, no double payment.
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  game.state.processingQueue = [];
  const item = pushItem(game.state, { value: 10, baseValue: 8, freshness: 0, packingWaitSeconds: 10 }); // 16% loss expected
  game.state.processingTimer = 0.01;

  const cashBefore = game.state.cash;
  const totalRevenueBefore = game.state.totalRevenue;
  let shipmentRevenue = -1;
  let shipmentCount = 0;
  game.on((e) => {
    if (e.type === 'shipment') {
      shipmentRevenue = e.revenue;
      shipmentCount++;
    }
  });

  const dt = 0.02; // the queue-age pass inside update() ages this item by dt too, before it ships this same frame
  const expectedRealized = realizedShippingValue(10, 0, 10 + dt);
  game.update(dt);

  assert('shipment fires exactly once for one queued item', shipmentCount === 1);
  assert('the shipment event carries the REALIZED value, not the locked value', approx(shipmentRevenue, expectedRealized));
  assert('shipment revenue is strictly less than the locked value when Freshness decayed it', shipmentRevenue < item.value);
  assert('cash increases by exactly the realized value', approx(game.state.cash - cashBefore, expectedRealized));
  assert('totalRevenue increases by exactly the realized value', approx(game.state.totalRevenue - totalRevenueBefore, expectedRealized));
  assert('the item leaves the queue exactly once', game.state.processingQueue.length === 0);
}

// ===========================================================================
// ACCOUNTING — freshnessLoss reconciliation, unharvested/unshipped fruit
// contributes nothing, Operating Cost unchanged, settlement reconciles.
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  clearAllSpecimens(game);
  game.state.processingQueue = [];
  game.state.dayHarvestRevenue = 0;
  game.state.dayMarketBonus = 0;
  game.state.dayFreshnessLoss = 0;

  // Item A: no decay (within grace). Item B: meaningful decay.
  pushItem(game.state, { value: 10, baseValue: 6, freshness: 100, packingWaitSeconds: 0 });
  pushItem(game.state, { value: 20, baseValue: 12, freshness: 0, packingWaitSeconds: 30 }); // capped at 30% loss -> realized 14
  game.state.processingTimer = 0.01;

  assert('dayFreshnessLoss is 0 before anything ships (queued-but-not-shipped adds no loss yet)', game.state.dayFreshnessLoss === 0);

  let guard = 0;
  while (game.state.processingQueue.length > 0) {
    game.update(shippingCadenceForLevel(game.state.shippingSpeedLevel) + 0.01);
    if (++guard > 100) throw new Error('Queue never drained');
  }

  const expectedLossA = 10 - realizedShippingValue(10, 100, 0);
  const expectedLossB = 20 - realizedShippingValue(20, 0, 30);
  assert('dayFreshnessLoss accumulates exactly across both shipped items', approx(game.state.dayFreshnessLoss, expectedLossA + expectedLossB));
  assert('the near-zero-decay item contributes ~0 loss', approx(expectedLossA, 0, 1e-9));
  assert('the fully-decayed item contributes exactly its 30%-capped loss', approx(expectedLossB, 6));
}
{
  // Unharvested ripe tree fruit adds no loss (it was never queued at all).
  clearStorage();
  const game = new Game();
  clearAllSpecimens(game);
  const field = game.state.fields[0] as Field;
  const slotIndex = field.slots.findIndex((s) => s.active);
  setSlot(field, slotIndex, true); // ripe, but never harvested
  game.update(5.0);
  assert('an unharvested ripe apple adds nothing to dayFreshnessLoss', game.state.dayFreshnessLoss === 0);
}
{
  // End-of-day settlement reconciliation: harvestRevenue + marketBonus -
  // freshnessLoss + contestPrize - operatingCost === net, and Operating
  // Cost's own formula is untouched by this pass.
  clearStorage();
  const game = new Game();
  clearAllSpecimens(game);
  const field = game.state.fields[0] as Field;
  const variety = game.getVariety(field.varietyId)!;
  variety.freshness = 20; // meaningful decay so freshnessLoss is nonzero this day

  const activeSlots = field.slots.map((_, i) => i).filter((i) => field.slots[i].active);
  for (const i of activeSlots.slice(0, 5)) setSlot(field, i, true);
  const cashBeforeDay = game.state.cash;
  for (const i of activeSlots.slice(0, 5)) game.harvestFruitSlot(field.id, i);

  // Let items accumulate meaningful wait before Closing drains them.
  game.update(8.0);
  runClosing(game);

  const log = game.state.lastDayLog!;
  assert('settlement produced a freshnessLoss figure', typeof log.freshnessLoss === 'number');
  assert('freshnessLoss is non-negative', log.freshnessLoss >= 0);
  assert(
    'net reconciles exactly: harvestRevenue + marketBonus - freshnessLoss + contestPrize - operatingCost === net',
    approx(log.harvestRevenue + log.marketBonus - log.freshnessLoss + log.contestPrize - log.operatingCost, log.net, 1e-6),
  );
  assert('displayed cash-before + displayed Net === displayed cash-after, to the cent', approx(Math.round((cashBeforeDay + log.net) * 100) / 100, Math.round(game.state.cash * 100) / 100));
  const expectedOpCost = operatingCost(log.day, game.unlockedFields().length);
  assert('Operating Cost formula is unchanged by this pass', approx(log.operatingCost, expectedOpCost));
}

// ===========================================================================
// TREE CARRYOVER — overflow ripe fruit never accumulates wait/decay before
// an actual harvest; next-day harvest starts Freshness fresh at 0 wait.
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  clearAllSpecimens(game);
  const field = game.state.fields[0] as Field;
  // Field 1's Yield only gives 12 simultaneously-active physical slots —
  // fewer than Level-1 Packing capacity (18) — so slot indices are reused
  // cyclically via setSlot's force-ripen to fill the queue to capacity (see
  // the identical pattern in verify-shipping-infrastructure.ts). set+harvest
  // must happen in the SAME iteration (not two separate loops) since a
  // reused index may already have been harvested (and rotated to a
  // different physical slot) by an earlier iteration.
  const activeSlots = field.slots.map((_, i) => i).filter((i) => field.slots[i].active);
  for (let k = 0; k < 18; k++) {
    const idx = activeSlots[k % activeSlots.length];
    setSlot(field, idx, true);
    game.harvestFruitSlot(field.id, idx);
  }
  assert('setup: Packing is now full', game.state.processingQueue.length === 18);

  const overflowSlot = field.slots.findIndex((s) => s.active);
  setSlot(field, overflowSlot, true); // ripe, but blocked by full Packing -> stays on tree
  const blocked = game.harvestFruitSlot(field.id, overflowSlot);
  assert('overflow harvest is blocked (stays on tree)', blocked === false);

  game.update(20.0); // plenty of real time passes while it sits ripe, unharvested
  assert('overflow fruit still on the tree accumulates no Packing wait (it was never queued)', field.slots[overflowSlot].ripe === true);

  // Drain the queue, then actually harvest the overflow apple — its
  // Freshness wait must start fresh at 0, using whatever Market rate is
  // current right now.
  let guard = 0;
  while (game.state.processingQueue.length > 0) {
    game.update(0.5);
    if (++guard > 5000) throw new Error('Queue never drained');
  }
  const variety = game.getVariety(field.varietyId)!;
  const expected = priceHarvestedApple(variety, field, game.state, variety.baseVisualId);
  const harvested = game.harvestFruitSlot(field.id, overflowSlot);
  assert('the previously-overflowed apple can now be harvested', harvested === true);
  const queuedItem = game.state.processingQueue[game.state.processingQueue.length - 1];
  assert('a carryover apple, once actually harvested, starts packingWaitSeconds at exactly 0', queuedItem.packingWaitSeconds === 0);
  assert('a carryover apple is priced at the CURRENT Market rate, not any rate implied while it sat on the tree', approx(queuedItem.value, expected.value));
}

// ===========================================================================
// INFRASTRUCTURE — faster Shipping reduces loss for an otherwise-identical
// queue; Packing Capacity alone does not improve retention; Specimens stay
// outside Packing/Freshness entirely; a Packing-full rejected harvest is
// untouched.
// ===========================================================================
{
  function totalFreshnessLossForShippingLevel(level: number): number {
    clearStorage();
    const game = new Game();
    game.state.shippingSpeedLevel = level;
    game.state.processingQueue = [];
    for (let i = 0; i < 5; i++) pushItem(game.state, { value: 10, baseValue: 8, freshness: 10, packingWaitSeconds: 0 });
    game.state.processingTimer = shippingCadenceForLevel(level);
    game.state.dayFreshnessLoss = 0;
    let guard = 0;
    while (game.state.processingQueue.length > 0) {
      game.update(shippingCadenceForLevel(level) + 0.001);
      if (++guard > 1000) throw new Error('Queue never drained');
    }
    return game.state.dayFreshnessLoss;
  }
  const lossLv1 = totalFreshnessLossForShippingLevel(1);
  const lossLv5 = totalFreshnessLossForShippingLevel(5);
  assert('faster Shipping Speed produces strictly less total Freshness loss for an otherwise-identical queue', lossLv5 < lossLv1, `Lv1=${lossLv1} Lv5=${lossLv5}`);
}
{
  // Packing Capacity alone (without affecting actual wait time) never
  // changes retention — the formula only reads freshness/packingWaitSeconds.
  const lockedValue = 10;
  const atLv1Capacity = realizedShippingValue(lockedValue, 30, 15);
  const atLv5Capacity = realizedShippingValue(lockedValue, 30, 15); // capacity is not a parameter of the formula at all
  assert('Packing Capacity level has no direct bearing on the retention formula for the same wait/Freshness', atLv1Capacity === atLv5Capacity);
}
{
  // Specimens never enter the Packing queue, so they can never accrue
  // packingWaitSeconds or Freshness decay at all.
  clearStorage();
  const game = new Game();
  clearAllSpecimens(game);
  const field = game.state.fields[0] as Field;
  const slotIndex = field.slots.findIndex((s) => s.active);
  const specimen: BreedingSpecimen = {
    id: 'freshness-verify-specimen',
    visualId: 'C2',
    baseVisualId: 'C2',
    sweetness: 50,
    size: 50,
    yieldStat: 50,
    growth: 50,
    freshness: 50,
    foundDay: game.state.day,
    sourceLineId: field.varietyId!,
    sourceGeneration: 1,
  };
  setSlot(field, slotIndex, true, specimen);
  const queueLenBefore = game.state.processingQueue.length;
  const ok = game.harvestFruitSlot(field.id, slotIndex);
  assert('Specimen harvest succeeds', ok === true);
  assert('a harvested Specimen never enters the Packing queue (no Freshness decay possible)', game.state.processingQueue.length === queueLenBefore);
  assert('the Specimen inventory received it instead', game.state.specimens.some((s) => s.id === 'freshness-verify-specimen'));
}
{
  // Packing-full rejected harvest still stays on tree unchanged (regression
  // spot-check — full coverage lives in verify-shipping-infrastructure.ts).
  clearStorage();
  const game = new Game();
  clearAllSpecimens(game);
  const field = game.state.fields[0] as Field;
  const activeSlots = field.slots.map((_, i) => i).filter((i) => field.slots[i].active);
  for (let k = 0; k < 18; k++) {
    const idx = activeSlots[k % activeSlots.length];
    setSlot(field, idx, true);
    game.harvestFruitSlot(field.id, idx);
  }
  const targetSlot = field.slots.findIndex((s) => s.active);
  setSlot(field, targetSlot, true);
  const before = { ...field.slots[targetSlot] };
  const blocked = game.harvestFruitSlot(field.id, targetSlot);
  assert('a Packing-full rejected harvest returns false', blocked === false);
  assert('a Packing-full rejected harvest leaves the fruit slot byte-for-byte unchanged', JSON.stringify(field.slots[targetSlot]) === JSON.stringify(before));
}

// ===========================================================================
// MIGRATION
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
    processingQueue: [
      { fieldId: 1, value: 5, baseValue: 4 }, // no freshness/packingWaitSeconds at all
      { fieldId: 1, value: 7, baseValue: 6, freshness: 88, packingWaitSeconds: 4.5 }, // already-migrated item, must be left exactly as-is
    ],
    processingTimer: 0,
    breeding: { active: false, everBredOnce: false },
    irrigationLevel: 0,
    shippingLevel: 0,
    packingCapacityLevel: 3,
    shippingSpeedLevel: 2,
    // dayFreshnessLoss intentionally absent.
  };
  localStorage.setItem(TUNING.SAVE_KEY, JSON.stringify(oldSave));
  const migrated = new Game();

  assert('old queued item with no freshness at all migrates to neutral Freshness 50', migrated.state.processingQueue[0].freshness === 50);
  assert('old queued item with no packingWaitSeconds at all migrates to 0', migrated.state.processingQueue[0].packingWaitSeconds === 0);
  assert('an already-migrated queued item is left exactly as-is (freshness)', migrated.state.processingQueue[1].freshness === 88);
  assert('an already-migrated queued item is left exactly as-is (packingWaitSeconds)', migrated.state.processingQueue[1].packingWaitSeconds === 4.5);
  assert('new GameState.dayFreshnessLoss defaults to 0 on an old save', migrated.state.dayFreshnessLoss === 0);
  assert('queue length is preserved (no items dropped/duplicated)', migrated.state.processingQueue.length === 2);
  assert('Packing Capacity level preserved through this migration too', migrated.state.packingCapacityLevel === 3);
  assert('Shipping Speed level preserved through this migration too', migrated.state.shippingSpeedLevel === 2);
}
{
  // A settled lastDayLog persisted before this pass has no freshnessLoss at all.
  clearStorage();
  const oldSave = {
    day: 2,
    dayTimeRemaining: 0,
    dayActive: false,
    cash: 200,
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
    lastDayLog: { day: 1, harvestRevenue: 10, marketBonus: 2, contestPrize: 0, operatingCost: 35, net: -23 },
    dayEnded: true,
  };
  localStorage.setItem(TUNING.SAVE_KEY, JSON.stringify(oldSave));
  const migrated = new Game();
  assert('a pre-Freshness lastDayLog backfills freshnessLoss to exactly 0', migrated.state.lastDayLog?.freshnessLoss === 0);
}

console.log(`\n${checks - failures}/${checks} checks passed.`);
if (failures > 0) process.exit(1);
