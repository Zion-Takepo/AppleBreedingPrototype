// Market card presentation helpers — pure display math only, no Phaser
// import (kept Node-testable, matching market.ts's own convention). Derives
// everything from the existing VisualMarketEntry/history; never touches
// Market simulation/probability/pricing (see PROJECT.md Market V1 and the
// "Market graph clarity pass").
import { TUNING } from '../tuning.ts';
import type { MarketHistoryPoint } from '../types.ts';

/**
 * Shared fixed graph range for every Market card — the same legal Market
 * range the simulation itself already clamps to (TUNING.MARKET_PCT_MIN/MAX),
 * so a +10% entry always reads as "modestly above baseline" rather than each
 * card silently autoscaling to its own recent min/max.
 */
export const CHART_PCT_MIN = TUNING.MARKET_PCT_MIN;
export const CHART_PCT_MAX = TUNING.MARKET_PCT_MAX;

/**
 * Maps a pct value onto a 0..1 fraction of the fixed chart range, where 0 =
 * chart bottom (CHART_PCT_MIN) and 1 = chart top (CHART_PCT_MAX). Clamped,
 * since a pct is always within [MARKET_PCT_MIN, MARKET_PCT_MAX] by
 * construction but display code shouldn't assume that blindly.
 */
export function pctToChartUnit(pct: number): number {
  const span = CHART_PCT_MAX - CHART_PCT_MIN;
  const unit = (pct - CHART_PCT_MIN) / span;
  return Math.max(0, Math.min(1, unit));
}

/** Where the 0% baseline falls as a 0..1 fraction of the fixed chart range (bottom=0, top=1). */
export function zeroLineChartUnit(): number {
  return pctToChartUnit(0);
}

export interface DailyChange {
  /** Whole percentage points moved since the previous history entry, or null if unavailable (fewer than 2 history points). */
  points: number | null;
}

/**
 * Today's movement in percentage POINTS (not relative growth) — derived from
 * the newest two history entries, e.g. yesterday +14%, today +10% => -4.
 * Rounded with the same convention as formatMarketPct so this always agrees
 * with the large displayed current %. Returns { points: null } when fewer
 * than two history points exist rather than inventing a previous-day value.
 */
export function dailyChangeFromHistory(history: MarketHistoryPoint[]): DailyChange {
  if (history.length < 2) return { points: null };
  const today = history[history.length - 1].pct;
  const yesterday = history[history.length - 2].pct;
  const points = Math.round(today * 100) - Math.round(yesterday * 100);
  return { points };
}

/** e.g. "Today -4pt ▼" / "Today +10pt ▲" / "Today 0pt" / "Today —" (unavailable). */
export function formatDailyChange(change: DailyChange): string {
  if (change.points === null) return 'Today —';
  if (change.points === 0) return 'Today 0pt';
  const sign = change.points > 0 ? '+' : '';
  const arrow = change.points > 0 ? ' ▲' : ' ▼';
  return `Today ${sign}${change.points}pt${arrow}`;
}
