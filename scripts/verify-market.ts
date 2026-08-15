// Market V1 focused verification (see PROJECT.md Market V1 / "VERIFICATION"
// section of the implementation brief). Plain-TS script, run directly with
// Node's built-in type stripping (`node scripts/verify-market.ts`) — no
// test framework exists in this prototype yet (see package.json), and this
// exercises pure game-logic modules that never import Phaser, so no DOM/
// canvas is needed. Phaser-rendered UI (Market overview cards, HUD click
// zone) is NOT exercised here — see the final report for that explicit
// limitation.
import { TUNING } from '../src/game/tuning.ts';
import type { AppleAssetId } from '../src/game/render/appleAssets.ts';
import {
  advanceDailyMarket,
  advanceVisualMarket,
  eventShockSignForDay,
  initVisualMarket,
  initVisualMarketEntry,
  marketMultiplierForVisual,
} from '../src/game/systems/market.ts';
import { operatingCost } from '../src/game/systems/economy.ts';
import { Game } from '../src/game/Game.ts';
import type { Variety, Field } from '../src/game/types.ts';

// ---------------------------------------------------------------------------
// Minimal in-memory localStorage polyfill — this Node runtime has none, and
// Game/save.ts's real save/load path (including the exact migration logic
// under test) needs one to actually exercise persistence/reload/migration
// rather than silently no-op through their try/catch fallbacks.
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

function constRng(v: number): () => number {
  return () => v;
}
// Deterministic PRNG (mulberry32) for statistical trials — same family used
// elsewhere in this codebase (systems/economy.ts) for reproducible seeded
// randomness; used here purely so the trend-prediction trial below can
// never be flaky.
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

function clearStorage(): void {
  localStorage.removeItem(TUNING.SAVE_KEY);
}

// ===========================================================================
// 1. Per-Visual identity
// ===========================================================================
{
  const visualMarket = initVisualMarket(['C1', 'R2'], 1);
  visualMarket.C1 = advanceVisualMarket(visualMarket.C1, 2, 0, constRng(0.9));

  const varietyA: Variety = { ...baseVariety(), id: 'a', visualId: 'C1', sweetness: 20, size: 10 };
  const varietyB: Variety = { ...baseVariety(), id: 'b', visualId: 'C1', sweetness: 90, size: 80 };
  const varietyC: Variety = { ...baseVariety(), id: 'c', visualId: 'R2', sweetness: 20, size: 10 };

  const multA = marketMultiplierForVisual(varietyA.visualId, visualMarket);
  const multB = marketMultiplierForVisual(varietyB.visualId, visualMarket);
  const multC = marketMultiplierForVisual(varietyC.visualId, visualMarket);

  assert('two different owned Lines with the SAME visualId get the identical Market multiplier', multA === multB);
  assert('two different Visual Varieties can have different prices', multA !== multC);
}

// ===========================================================================
// 2. Discovery
// ===========================================================================
{
  const visualMarket = initVisualMarket(['C1'], 1);
  assert('undiscovered variety has no market entry', !('R1' in visualMarket));

  const fresh = initVisualMarketEntry('R3', 4);
  assert('newly discovered variety initializes at baseline (0%)', fresh.pct === 0);
  assert('newly discovered variety initializes STABLE', fresh.trend === 'STABLE');
  assert('newly discovered variety gets exactly one current-day history point', fresh.history.length === 1 && fresh.history[0].day === 4);
}

// ===========================================================================
// 2b. Ownership status (OWNED vs DISCOVERED ONLY)
//
// #004 (COMMON · C4) was observed in Market despite the player not owning a
// C4 Line. Root cause (see breeding.ts breedOffspring, called from
// Game.resolveBreeding): ALL FOUR offspring candidates (A/B/C/D) roll and
// register their own visualId as discovered — discoveredVisualIdsWorking/
// newlyDiscoveredVisualIds accumulate from every candidate in the SLOTS.map
// loop, entirely independent of which single candidate (if any) is later
// KEPT via Game.keepOffspring(). This is the exact, already-documented
// PROJECT.md behavior ("DISCOVERED already happens the moment breeding
// resolves... OWNED is derived on demand... A Visual Variety may therefore
// be DISCOVERED but NOT OWNED") — not a bug. These checks confirm the two
// concepts stay correctly independent, and that ownership is derived live
// from Library state rather than persisted redundantly onto Market state.
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  // Simulate exactly what breedOffspring's SLOTS.map loop does for every
  // candidate — including ones nobody ever KEEPS: register a visualId as
  // discovered without inserting anything into the Library.
  game.state.discoveredVisualIds.push('C4');
  game.state.visualMarket.C4 = initVisualMarketEntry('C4', game.state.day);

  assert('a Visual Variety can be DISCOVERED without any Library Line owning it (reproduces the #004 report)', !game.isVisualIdOwned('C4'));
  assert('C4 is still visible in Market once discovered, exactly like an owned one', 'C4' in game.state.visualMarket);

  assert('C1 (the starter RED BASIC Line) IS owned', game.isVisualIdOwned('C1'));

  // Ownership must be derived live, never persisted onto VisualMarketEntry.
  const entryKeys = Object.keys(game.state.visualMarket.C4).sort();
  assert(
    'VisualMarketEntry carries no redundant "owned" field — exactly {visualId, pct, trend, history}',
    entryKeys.join(',') === 'history,pct,trend,visualId',
  );

  // "Derived live": obtaining a C4 Line flips isVisualIdOwned immediately,
  // with zero change to the Market entry itself.
  const marketEntryBefore = { ...game.state.visualMarket.C4 };
  game.state.library.push({ ...baseVariety(), id: 'newly-owned-c4', visualId: 'C4' });
  assert('C4 becomes OWNED the instant a matching Line exists in the Library — no separate flag to flip', game.isVisualIdOwned('C4'));
  assert(
    'gaining ownership does not mutate the Market entry at all',
    JSON.stringify(game.state.visualMarket.C4) === JSON.stringify(marketEntryBefore),
  );

  // ...and losing it (Library never supports delete, but archived Lines are
  // still "owned" — archiving is reversible hiding, not deletion, per
  // PROJECT.md Library — so removing the entry outright is the only way
  // ownership can go back to false) flips back correctly too.
  game.state.library = game.state.library.filter((l) => l.id !== 'newly-owned-c4');
  assert('removing the only C4 Line makes it DISCOVERED ONLY again', !game.isVisualIdOwned('C4'));
}

// ===========================================================================
// 3 & 9. Daily update timing + Regression (Shipping/Day Cycle/Closing/
// Operating Cost/save migration), exercised together through the real Game
// class so the checks reflect actual gameplay wiring, not just market.ts in
// isolation.
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  assert('fresh game starts Day 1 with C1/C2 discovered varieties at baseline', game.state.visualMarket.C1?.pct === 0 && game.state.visualMarket.C2?.pct === 0);

  // Day 1 -> run a full Closing (beginClosing + drain queue) exactly like a
  // real END DAY click / 18:00 timeout would.
  game.beginClosing();
  let guard = 0;
  while (!game.state.dayEnded) {
    game.update(0.05);
    if (++guard > 20000) throw new Error('Day 1 Closing never finished — regression in Shipping/Day Cycle');
  }
  assert('Closing finishes and settles a DayLogEntry', game.state.lastDayLog !== null);
  const day1Log = game.state.lastDayLog!;
  assert('Operating Cost formula unchanged (Day 1, 1 Field = $35)', day1Log.operatingCost === 35);
  assert(
    'Gross/Net accounting still correct',
    Math.abs(day1Log.harvestRevenue + day1Log.marketBonus + day1Log.contestPrize - day1Log.operatingCost - day1Log.net) < 1e-9,
  );
  assert('C1 not yet updated before the Day 1->2 transition', game.state.visualMarket.C1.history.length === 1);

  game.proceedToNextDay();
  assert('day advanced to 2', game.state.day === 2);
  assert('C1 received exactly one new history point on the Day1->2 transition', game.state.visualMarket.C1.history.length === 2);
  assert('new history point is stamped with the new day', game.state.visualMarket.C1.history[1].day === 2);
  const c1AfterDay2Update = game.state.visualMarket.C1;

  // "Reload does not cause another same-day update"
  game.save();
  const reloaded = new Game();
  assert(
    'reload does not trigger another same-day Market update',
    reloaded.state.visualMarket.C1.history.length === 2 && reloaded.state.visualMarket.C1.pct === c1AfterDay2Update.pct,
  );

  // "Next day does update" — drive Day 2 -> Day 3 the same way.
  reloaded.beginClosing();
  guard = 0;
  while (!reloaded.state.dayEnded) {
    reloaded.update(0.05);
    if (++guard > 20000) throw new Error('Day 2 Closing never finished');
  }
  reloaded.proceedToNextDay();
  assert('next day transition DOES update Market again', reloaded.state.day === 3 && reloaded.state.visualMarket.C1.history.length === 3);

  // Drive through the rest of Week 1 to confirm history caps at ~5 days and
  // Closing/Operating Cost/Shipping keep working on later days too.
  let currentGame = reloaded;
  while (currentGame.state.day < 7) {
    currentGame.beginClosing();
    guard = 0;
    while (!currentGame.state.dayEnded) {
      currentGame.update(0.05);
      if (++guard > 20000) throw new Error(`Closing never finished on Day ${currentGame.state.day}`);
    }
    currentGame.proceedToNextDay();
  }
  assert('history caps at TUNING.MARKET_HISTORY_DAYS', currentGame.state.visualMarket.C1.history.length === TUNING.MARKET_HISTORY_DAYS);
  assert(
    'Operating Cost formula still correct on Day 7 (1 Field = $53)',
    operatingCost(7, 1) === 53,
  );
}

// ===========================================================================
// 4. Trend prediction (deterministic RNG)
// ===========================================================================
{
  const baseline = initVisualMarketEntry('C1', 1);

  const rising = { ...baseline, trend: 'RISING' as const };
  const risingNext = advanceVisualMarket(rising, 2, 0, constRng(0.5)); // rng=0.5 -> zero noise
  assert('RISING + zero noise + zero reversion produces a strictly positive move', risingNext.pct > 0);

  const falling = { ...baseline, trend: 'FALLING' as const };
  const fallingNext = advanceVisualMarket(falling, 2, 0, constRng(0.5));
  assert('FALLING + zero noise + zero reversion produces a strictly negative move', fallingNext.pct < 0);

  const stable = { ...baseline, trend: 'STABLE' as const };
  const stableNext = advanceVisualMarket(stable, 2, 0, constRng(0.5));
  assert('STABLE + zero noise has no directional bias', stableNext.pct === 0);

  // Not a guarantee: a strongly negative noise roll can still overcome a
  // RISING bias (noise amplitude > trend bias by design).
  const risingButNoisy = advanceVisualMarket(rising, 2, 0, constRng(0)); // rng=0 -> noise = -MARKET_NOISE_AMPLITUDE
  assert('RISING trend does NOT guarantee a positive move (noise can overcome it)', risingButNoisy.pct < 0);
  const fallingButNoisy = advanceVisualMarket(falling, 2, 0, constRng(1)); // rng=1 -> noise = +MARKET_NOISE_AMPLITUDE
  assert('FALLING trend does NOT guarantee a negative move (noise can overcome it)', fallingButNoisy.pct > 0);

  // Statistical bias over many deterministic trials, starting exactly at
  // baseline so mean-reversion contributes nothing and only noise+trendBias
  // drive the result.
  const N = 4000;
  const rng = mulberry32(12345);
  let sumRising = 0;
  let sumFalling = 0;
  let sumStable = 0;
  for (let i = 0; i < N; i++) {
    sumRising += advanceVisualMarket(rising, 2, 0, rng).pct;
    sumFalling += advanceVisualMarket(falling, 2, 0, rng).pct;
    sumStable += advanceVisualMarket(stable, 2, 0, rng).pct;
  }
  const avgRising = sumRising / N;
  const avgFalling = sumFalling / N;
  const avgStable = sumStable / N;
  assert(`RISING has a real positive statistical bias (avg=${avgRising.toFixed(4)})`, avgRising > TUNING.MARKET_TREND_BIAS * 0.5);
  assert(`FALLING has a real negative statistical bias (avg=${avgFalling.toFixed(4)})`, avgFalling < -TUNING.MARKET_TREND_BIAS * 0.5);
  assert(`STABLE has little/no directional bias (avg=${avgStable.toFixed(4)})`, Math.abs(avgStable) < TUNING.MARKET_TREND_BIAS * 0.5);
}

// ===========================================================================
// 5. Mean reversion
// ===========================================================================
{
  const high = { ...initVisualMarketEntry('C1', 1), pct: 0.5, trend: 'STABLE' as const };
  const highNext = advanceVisualMarket(high, 2, 0, constRng(0.5)); // zero noise, isolate reversion
  assert('high positive price is pulled downward by mean reversion', highNext.pct < high.pct);

  const low = { ...initVisualMarketEntry('C1', 1), pct: -0.5, trend: 'STABLE' as const };
  const lowNext = advanceVisualMarket(low, 2, 0, constRng(0.5));
  assert('low negative price is pulled upward by mean reversion', lowNext.pct > low.pct);

  // Repeatedly hammer with the most extreme possible inputs (max noise +
  // trend bias + event shock, every day) and confirm it never leaves the
  // clamped safe range.
  let extreme = { ...initVisualMarketEntry('C1', 1), pct: 0, trend: 'RISING' as const };
  for (let day = 2; day < 200; day++) {
    extreme = advanceVisualMarket(extreme, day, 1, constRng(1));
    assert(`Day ${day}: price stays within clamped bounds`, extreme.pct >= TUNING.MARKET_PCT_MIN - 1e-9 && extreme.pct <= TUNING.MARKET_PCT_MAX + 1e-9);
  }
}

// ===========================================================================
// 6. Calendar
// ===========================================================================
{
  assert('Day 1 has no scripted market event -> no shock', eventShockSignForDay(1) === 0);
  assert('Day 2 (Yellow Market Surge +30%) -> positive shock sign', eventShockSignForDay(2) === 1);
  assert('Day 3 has no scripted market event -> no shock', eventShockSignForDay(3) === 0);
  assert('Day 6 (Purple +40% / Striped +25%) -> positive shock sign', eventShockSignForDay(6) === 1);
}

// ===========================================================================
// 7. Economy — locked pricing
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  const field = game.state.fields[0] as Field;
  const variety = game.getVariety(field.varietyId)!;
  // Field 1's own active slots may include the guaranteed Day-1 tutorial
  // Specimen (see PROJECT.md Orchard Mutation / Breeding Specimen) — that
  // slot deliberately does NOT enter the Processing Queue on harvest (see
  // section 8 below/verify-specimens.ts), so this ordinary-pricing check
  // must pick a slot that ISN'T holding one.
  const slotIndex = field.slots.findIndex((s) => s.active && !s.specimen);
  field.slots[slotIndex].ripe = true; // force-ripen deterministically instead of waiting on the regrow timer

  game.harvestFruitSlot(field.id, slotIndex);
  const queued = game.state.processingQueue[game.state.processingQueue.length - 1];
  assert('harvested apple enters the Processing Queue with a locked value', queued !== undefined);
  const lockedValue = queued.value;
  const multBefore = marketMultiplierForVisual(variety.visualId, game.state.visualMarket);
  assert('sale price uses the Market entry for the apple\'s Visual Variety', Math.abs(queued.value - queued.baseValue * multBefore) < 1e-9);

  // Simulate "a Market change tomorrow" happening WHILE this apple still
  // sits in the queue.
  game.state.visualMarket[variety.visualId].pct = 0.5;
  assert('already-queued apple keeps its harvest-time locked value after a later Market change', game.state.processingQueue[game.state.processingQueue.length - 1].value === lockedValue);

  // Let it ship and confirm the cash actually paid out is the locked value,
  // not a re-priced one.
  const cashBefore = game.state.cash;
  let guard = 0;
  while (game.state.processingQueue.length > 0) {
    game.update(0.05);
    if (++guard > 20000) throw new Error('Queue never drained');
  }
  assert('shipped apple pays exactly its locked value, not a repriced one', Math.abs(game.state.cash - cashBefore - lockedValue) < 1e-6);
}

// ===========================================================================
// Save migration — old save with no visualMarket at all
// ===========================================================================
{
  clearStorage();
  const oldSave = {
    day: 3,
    discoveredVisualIds: ['C1', 'C2', 'C3'],
    library: [],
    fields: [],
    // visualMarket intentionally absent, like a pre-Market-V1 save.
  };
  localStorage.setItem(TUNING.SAVE_KEY, JSON.stringify(oldSave));
  // loadState() isn't exported directly by name here, so go through a fresh
  // Game() — its constructor calls loadState() internally.
  const migrated = new Game();
  assert('old save without visualMarket migrates safely (no crash)', migrated.state.visualMarket !== undefined);
  for (const id of ['C1', 'C2', 'C3'] as AppleAssetId[]) {
    const entry = migrated.state.visualMarket[id];
    assert(`migrated ${id} initializes at baseline`, entry?.pct === 0);
    assert(`migrated ${id} initializes STABLE`, entry?.trend === 'STABLE');
  }
}

// ---------------------------------------------------------------------------
function baseVariety(): Variety {
  return {
    id: 'base',
    customName: 'TEST',
    generation: 1,
    color: 'Red',
    pattern: 'Plain',
    visualId: 'C1',
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
}

console.log(`\n${checks - failures}/${checks} checks passed.`);
if (failures > 0) {
  console.error(`${failures} FAILURE(S)`);
  process.exit(1);
}
