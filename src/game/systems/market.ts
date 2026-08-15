// Market V1 — per-Visual-Variety pricing (see PROJECT.md Market V1). Price
// exists per illustration/visualId (C1..E2), never per individual owned
// Line: every Line sharing a visualId shares the exact same market entry.
// One update runs per game day, from Game.advanceDayInternal, for every
// currently DISCOVERED visualId.
import { TUNING } from '../tuning.ts';
import type { AppleAssetId } from '../render/appleAssets.ts';
import type { MarketTrend, VisualMarketEntry } from '../types.ts';
import { getDayDef } from './calendar.ts';

const TREND_BIAS: Record<MarketTrend, number> = {
  RISING: TUNING.MARKET_TREND_BIAS,
  FALLING: -TUNING.MARKET_TREND_BIAS,
  STABLE: 0,
};

function clampPct(pct: number): number {
  return Math.max(TUNING.MARKET_PCT_MIN, Math.min(TUNING.MARKET_PCT_MAX, pct));
}

/**
 * Fresh baseline entry for a Visual Variety the moment it's discovered —
 * 0%/STABLE with a single history point, and deliberately NO random move
 * yet. Market updates happen exactly once per day from advanceDailyMarket
 * below; a variety discovered mid-day waits for the next day's transition
 * to receive its first real movement (see PROJECT.md's History section).
 */
export function initVisualMarketEntry(visualId: AppleAssetId, day: number): VisualMarketEntry {
  return { visualId, pct: 0, trend: 'STABLE', history: [{ day, pct: 0 }] };
}

export function initVisualMarket(visualIds: readonly AppleAssetId[], day: number): Record<AppleAssetId, VisualMarketEntry> {
  const out = {} as Record<AppleAssetId, VisualMarketEntry>;
  for (const id of visualIds) out[id] = initVisualMarketEntry(id, day);
  return out;
}

/**
 * Signed direction of today's scripted Calendar market event, if any.
 *
 * LIMITATION (deliberate, see PROJECT.md Calendar Events): the existing
 * WEEK1_CALENDAR scripted events are keyed by genetic Color/Pattern (e.g.
 * "Yellow +30%"), which has no unambiguous mapping onto a Visual Variety's
 * illustration id — a C1 apple can be bred in any color, so "which
 * visualIds are Yellow" isn't a real, derivable fact. Inventing that
 * mapping would be fabricating content the current data model doesn't
 * support. Instead, V1 reuses only the day's *sign* from the existing
 * scripted data and applies one shared TUNING.MARKET_EVENT_SHOCK magnitude
 * as a uniform temporary shock across every discovered Visual Variety on
 * that day — a smaller, honest substitute for a per-color mapping that
 * doesn't exist, not a permanent baseline change.
 */
export function eventShockSignForDay(day: number): number {
  const def = getDayDef(day);
  if (!def?.scriptedMarket) return 0;
  const values = Object.values(def.scriptedMarket) as number[];
  if (values.length === 0) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  return sum === 0 ? 0 : sum > 0 ? 1 : -1;
}

/**
 * One Visual Variety's single daily Market update:
 *   dailyMovement = random noise + bias from the CURRENTLY DISPLAYED trend
 *                  + mean reversion toward baseline + today's Calendar-event shock
 * The result is clamped to a safe range, then that day's own delta is
 * reclassified into the newly displayed RISING/STABLE/FALLING trend, which
 * is what biases the *following* day's movement — trend prediction is real
 * (see TUNING.MARKET_TREND_BIAS) but never a guarantee, since noise can
 * still overcome it. `rng` is injectable for deterministic tests.
 */
export function advanceVisualMarket(
  entry: VisualMarketEntry,
  day: number,
  eventShockSign: number,
  rng: () => number = Math.random,
): VisualMarketEntry {
  const noise = (rng() * 2 - 1) * TUNING.MARKET_NOISE_AMPLITUDE;
  const trendBias = TREND_BIAS[entry.trend];
  const reversion = -entry.pct * TUNING.MARKET_REVERSION_RATE;
  const eventShock = eventShockSign * TUNING.MARKET_EVENT_SHOCK;

  const nextPct = clampPct(entry.pct + noise + trendBias + reversion + eventShock);
  const delta = nextPct - entry.pct;
  const nextTrend: MarketTrend = delta > TUNING.MARKET_TREND_THRESHOLD ? 'RISING' : delta < -TUNING.MARKET_TREND_THRESHOLD ? 'FALLING' : 'STABLE';

  const history = [...entry.history, { day, pct: nextPct }].slice(-TUNING.MARKET_HISTORY_DAYS);
  return { visualId: entry.visualId, pct: nextPct, trend: nextTrend, history };
}

/**
 * Runs exactly one Market update for every currently DISCOVERED Visual
 * Variety. Called exactly once per day transition (Game.advanceDayInternal,
 * after `state.day` has already been incremented) — never on reload, so a
 * reload can never cause a second same-day update. Mutates `visualMarket`
 * in place; missing entries (shouldn't normally happen, since discovery
 * creates one eagerly) are created safely at baseline first rather than
 * throwing.
 */
export function advanceDailyMarket(
  visualMarket: Record<AppleAssetId, VisualMarketEntry>,
  discoveredVisualIds: readonly AppleAssetId[],
  day: number,
  rng: () => number = Math.random,
): void {
  const shockSign = eventShockSignForDay(day);
  for (const id of discoveredVisualIds) {
    const entry = visualMarket[id] ?? initVisualMarketEntry(id, day);
    visualMarket[id] = advanceVisualMarket(entry, day, shockSign, rng);
  }
}

/**
 * Current sale-price multiplier for a Visual Variety — 1.00 at baseline.
 * Every Line sharing this visualId gets exactly this multiplier, never a
 * per-Line value (see PROJECT.md Market V1's "per VISUAL VARIETY" rule).
 * An undiscovered/missing visualId safely reads as baseline (1.00x) rather
 * than throwing — priceHarvestedApple can never be called for one in
 * practice (fields can only be planted with an owned, discovered Line).
 */
export function marketMultiplierForVisual(visualId: AppleAssetId, visualMarket: Record<AppleAssetId, VisualMarketEntry>): number {
  const entry = visualMarket[visualId];
  return 1 + (entry?.pct ?? 0);
}

/**
 * The single most notable discovered mover (largest |pct| vs baseline) —
 * drives the compact HUD Market headline. Null if nothing is discovered.
 */
export function strongestMover(
  visualMarket: Record<AppleAssetId, VisualMarketEntry>,
  discoveredVisualIds: readonly AppleAssetId[],
): VisualMarketEntry | null {
  let best: VisualMarketEntry | null = null;
  for (const id of discoveredVisualIds) {
    const entry = visualMarket[id];
    if (!entry) continue;
    if (!best || Math.abs(entry.pct) > Math.abs(best.pct)) best = entry;
  }
  return best;
}

/** e.g. "+12%" / "-8%" / "+0%" — the single shared percent-vs-baseline formatting used across HUD + Market overview. */
export function formatMarketPct(pct: number): string {
  const rounded = Math.round(pct * 100);
  const sign = rounded >= 0 ? '+' : '';
  return `${sign}${rounded}%`;
}
