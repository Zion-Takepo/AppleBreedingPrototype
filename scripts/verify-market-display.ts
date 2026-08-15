// Focused verification for the Market graph clarity pass (see PROJECT.md
// Market V1) — pure display math only (chart mapping + daily-change
// derivation), no Phaser import needed since systems/marketDisplay.ts never
// imports it. Does NOT touch/re-verify Market simulation logic itself; see
// scripts/verify-market.ts for that.
import { TUNING } from '../src/game/tuning.ts';
import type { MarketHistoryPoint } from '../src/game/types.ts';
import { CHART_PCT_MAX, CHART_PCT_MIN, dailyChangeFromHistory, formatDailyChange, pctToChartUnit, zeroLineChartUnit } from '../src/game/systems/marketDisplay.ts';

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

function pt(day: number, pct: number): MarketHistoryPoint {
  return { day, pct };
}

// ===========================================================================
// 1. Fixed chart mapping — shared +60% / 0% / -50% scale
// ===========================================================================
{
  assert('chart range matches the real Market legal range (min)', CHART_PCT_MIN === TUNING.MARKET_PCT_MIN);
  assert('chart range matches the real Market legal range (max)', CHART_PCT_MAX === TUNING.MARKET_PCT_MAX);

  assert('+60% (MARKET_PCT_MAX) maps to the graph top (unit 1)', pctToChartUnit(TUNING.MARKET_PCT_MAX) === 1);
  assert('-50% (MARKET_PCT_MIN) maps to the graph bottom (unit 0)', pctToChartUnit(TUNING.MARKET_PCT_MIN) === 0);

  const zeroUnit = zeroLineChartUnit();
  const expectedZeroUnit = (0 - TUNING.MARKET_PCT_MIN) / (TUNING.MARKET_PCT_MAX - TUNING.MARKET_PCT_MIN);
  assert('0% baseline maps to the expected fixed fraction of the range', Math.abs(zeroUnit - expectedZeroUnit) < 1e-9);
  assert('0% baseline sits strictly between top and bottom', zeroUnit > 0 && zeroUnit < 1);

  const unit10 = pctToChartUnit(0.10);
  const distToZero = Math.abs(unit10 - zeroUnit);
  const distToTop = Math.abs(1 - unit10);
  assert('+10% is visually much closer to the 0% baseline than to the +60% top', distToZero < distToTop);
  assert('+10% specifically sits well under halfway to the top', distToZero < (1 - zeroUnit) * 0.3);

  const unitNeg20 = pctToChartUnit(-0.20);
  assert('-20% maps below the 0% baseline', unitNeg20 < zeroUnit);

  // Same mapping function used for every card — no per-card autoscaling
  // exists in this module at all (there is no min/max parameter to vary).
  assert('mapping is a pure function of pct alone (identical input -> identical output)', pctToChartUnit(0.25) === pctToChartUnit(0.25));

  // Out-of-range inputs (shouldn't happen given the simulation's own clamp,
  // but display code must not assume that blindly) stay clamped to 0..1.
  assert('above-max pct clamps to unit 1', pctToChartUnit(TUNING.MARKET_PCT_MAX + 0.5) === 1);
  assert('below-min pct clamps to unit 0', pctToChartUnit(TUNING.MARKET_PCT_MIN - 0.5) === 0);
}

// ===========================================================================
// 2. Daily movement in percentage POINTS, derived from the newest two
//    history entries — not relative growth, never inventing a prior value.
// ===========================================================================
{
  // yesterday +14%, today +10% => Today -4pt
  const d1 = dailyChangeFromHistory([pt(1, 0.02), pt(2, 0.08), pt(3, 0.14), pt(4, 0.10)]);
  assert('yesterday +14%, today +10% => -4pt', d1.points === -4, `got ${d1.points}`);
  assert('formats as "Today -4pt ▼"', formatDailyChange(d1) === 'Today -4pt ▼');

  // yesterday -8%, today +2% => Today +10pt
  const d2 = dailyChangeFromHistory([pt(1, -0.08), pt(2, 0.02)]);
  assert('yesterday -8%, today +2% => +10pt', d2.points === 10, `got ${d2.points}`);
  assert('formats as "Today +10pt ▲"', formatDailyChange(d2) === 'Today +10pt ▲');

  // unchanged => 0pt / STABLE-compatible display
  const d3 = dailyChangeFromHistory([pt(1, 0.05), pt(2, 0.05)]);
  assert('unchanged value => 0pt', d3.points === 0);
  assert('formats as "Today 0pt" (no arrow)', formatDailyChange(d3) === 'Today 0pt');

  // one-point history must not invent a previous-day value
  const d4 = dailyChangeFromHistory([pt(1, 0.05)]);
  assert('single history point => daily movement unavailable (null), not invented', d4.points === null);
  assert('formats as "Today —" for unavailable', formatDailyChange(d4) === 'Today —');

  // zero-point history (defensive) must not throw or invent a value either.
  const d5 = dailyChangeFromHistory([]);
  assert('empty history => daily movement unavailable (null)', d5.points === null);

  // Uses percentage POINTS, explicitly NOT relative percentage growth —
  // +14% -> +10% is a -4pt move, never "-28.6%".
  assert('daily delta is a POINT difference, not a relative-growth ratio', d1.points === Math.round(0.10 * 100) - Math.round(0.14 * 100));
}

// ===========================================================================
// 3. Current displayed % still means baseline-relative Market level — this
//    pass changes presentation only, never the underlying value's meaning.
//    (formatMarketPct itself is exercised by verify-market.ts; this just
//    confirms the daily-change helper reads the SAME pct field, not a
//    separately-tracked one.)
// ===========================================================================
{
  const history = [pt(1, 0.0), pt(2, 0.10)];
  const change = dailyChangeFromHistory(history);
  assert(
    "daily-change math is derived from the same history[].pct the current-level display reads, not a separate source",
    change.points === Math.round(history[1].pct * 100) - Math.round(history[0].pct * 100),
  );
}

console.log(`\n${checks - failures}/${checks} checks passed.`);
if (failures > 0) {
  console.error(`${failures} FAILURE(S)`);
  process.exit(1);
}
