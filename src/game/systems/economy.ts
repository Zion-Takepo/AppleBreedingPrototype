import { TUNING } from '../tuning.ts';
import type { CultivationPolicy, Field, FieldFruitSlot, GameState, Variety } from '../types.ts';
import { marketMultiplierForVisual } from './market.ts';

export function effectiveStats(variety: Variety, policy: CultivationPolicy): { sweetness: number; size: number } {
  let sweetness = variety.sweetness;
  let size = variety.size;
  if (policy === 'SWEETEN') sweetness = Math.min(100, sweetness + TUNING.CULTIVATION.SWEETEN.sweetnessBonus);
  if (policy === 'GROW_BIG') size = Math.min(100, size + TUNING.CULTIVATION.GROW_BIG.sizeBonus);
  return { sweetness, size };
}

export function shippingMultiplier(shippingLevel: number): number {
  return 1 + shippingLevel * TUNING.SHIPPING_BONUS_PER_LEVEL;
}

// value/baseValue are intentionally exact, UNROUNDED dollars — see
// priceHarvestedApple's doc comment for why. Round only at display
// boundaries (shipment popup, day-end/week summaries), never here.
export interface PricedApple {
  value: number;
  baseValue: number;
}

/** Only Sweetness and Size affect an apple's price — Yield/Growth/Freshness never multiply revenue directly. */
export function baseAppleValue(sweetness: number, size: number): number {
  return TUNING.APPLE_VALUE_BASE + sweetness * TUNING.APPLE_VALUE_SWEETNESS_MULT + size * TUNING.APPLE_VALUE_SIZE_MULT;
}

/**
 * Prices exactly one apple at the moment it's harvested, using *effective*
 * (cultivation-adjusted) Sweetness/Size plus the current per-Visual-Variety
 * Market multiplier (see systems/market.ts) and shipping multiplier. The
 * caller locks this result into the apple's ProcessingItem
 * permanently — later changes to cultivation, variety, or market never
 * retroactively reprice an apple already in the Shipping/Processing Queue.
 *
 * Deliberately returns exact, UNROUNDED dollar amounts. The old batch-of-15
 * bridge rounded once, after summing 15 apples' worth of value, so its
 * per-apple "granularity" was effectively ~1/15th of a dollar; rounding
 * every individual apple here to the nearest whole dollar would throw that
 * away — perApple typically only spans about $2-4, so whole-dollar
 * quantization per apple can swing a batch's total by double-digit
 * percentages in either direction and can make small Sweetness/Size
 * improvements invisible (two different stat totals rounding to the same
 * per-apple dollar). Callers accumulate these exact values (cash,
 * totalRevenue, dayHarvestRevenue, dayMarketBonus) and round only where the
 * number is actually displayed. `baseValue` is the pre-market-bonus portion
 * (`perApple * shipMult`, i.e. `value` with marketMult backed out) so the
 * existing day-log harvestRevenue/marketBonus split is preserved.
 */
export function priceHarvestedApple(variety: Variety, field: Field, state: GameState): PricedApple {
  const { sweetness, size } = effectiveStats(variety, field.policy);
  const perApple = baseAppleValue(sweetness, size);
  // Ordinary fruit is priced using the Visual it ACTUALLY is —
  // `baseVisualId` (see types.ts's Variety doc comment) — never the Line's
  // special identity `visualId`. A Rare/Epic lineage's Market multiplier
  // otherwise has no bearing on its everyday harvest, since it never grows
  // that Visual as ordinary fruit (see PROJECT.md "Revise Rare / Epic Line
  // behavior").
  const marketMult = marketMultiplierForVisual(variety.baseVisualId, state.visualMarket);
  const shipMult = shippingMultiplier(state.shippingLevel);
  const baseValue = perApple * shipMult;
  const value = baseValue * marketMult;
  return { value, baseValue };
}

function irrigationReduction(irrigationLevel: number): number {
  return Math.max(0.4, 1 - irrigationLevel * TUNING.IRRIGATION_REDUCTION_PER_LEVEL);
}

/** Mean regrow duration for one fruit slot, driven by genetic Growth (0 -> 12s, 50 -> 10s, 100 -> 8s), before Irrigation or per-roll variance. */
export function meanRegrowSeconds(growth: number): number {
  const clamped = Math.max(0, Math.min(100, growth));
  return TUNING.GROWTH_REGROW_BASE_SEC - clamped * TUNING.GROWTH_REGROW_SLOPE;
}

/** One independent fruit slot's next actual regrow duration: meanRegrowSeconds(Growth) with +/-20% per-roll variance, then shortened by Irrigation the same way the old global cycle was. */
export function fruitRegrowSeconds(growth: number, irrigationLevel: number): number {
  const mean = meanRegrowSeconds(growth);
  const v = TUNING.GROWTH_REGROW_VARIANCE;
  const actual = mean * (1 - v + Math.random() * 2 * v);
  return actual * irrigationReduction(irrigationLevel);
}

function shuffledRange(n: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Deterministic 32-bit hash (FNV-1a) + mulberry32 PRNG, used only for
// active-slot layout below — a given varietyId must always produce the
// exact same active-slot pattern (stable across replants/reloads) without
// needing to persist anything extra, which rules out Math.random() here.
function hashSeed(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

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

function seededShuffle<T>(arr: T[], rng: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const ORCHARD_TREES = 5;
const ORCHARD_SLOTS_PER_TREE = 3;

/** How many of the 15 physical fruit slots are active for a given Yield stat: 0 -> 9, 25 -> 11, 50 -> 12, 75 -> 14, 100 -> 15. */
export function activeSlotCount(yieldStat: number): number {
  const clamped = Math.max(0, Math.min(100, yieldStat));
  return TUNING.YIELD_BASE_ACTIVE_SLOTS + Math.round((clamped * TUNING.YIELD_ACTIVE_SLOTS_RANGE) / 100);
}

/**
 * WHICH of the 15 physical slots (flat index = treeIndex*3 + waveIndex,
 * matching OrchardTreeLayer) are active for this variety. Deterministic
 * from the variety's own id, so the same variety always has the same
 * layout (no reshuffling per replant/regrowth) while different varieties
 * still look visually varied. Every tree keeps at least one active slot,
 * and active slots are distributed round-robin across trees (with a
 * seeded-random pick of which trees get an extra slot) rather than
 * clustered onto one side.
 */
export function activeSlotIndices(varietyId: string, yieldStat: number): Set<number> {
  const count = activeSlotCount(yieldStat);
  const rng = mulberry32(hashSeed(varietyId));
  const base = Math.floor(count / ORCHARD_TREES);
  const extra = count - base * ORCHARD_TREES;
  const bonusTrees = new Set(
    seededShuffle(
      Array.from({ length: ORCHARD_TREES }, (_, i) => i),
      rng,
    ).slice(0, extra),
  );

  const active = new Set<number>();
  for (let tree = 0; tree < ORCHARD_TREES; tree++) {
    const treeActiveCount = Math.min(ORCHARD_SLOTS_PER_TREE, base + (bonusTrees.has(tree) ? 1 : 0));
    const waveOrder = seededShuffle([0, 1, 2], rng);
    for (let k = 0; k < treeActiveCount; k++) {
      active.add(tree * ORCHARD_SLOTS_PER_TREE + waveOrder[k]);
    }
  }
  return active;
}

/** All 15 slots active — used for locked/unplanted fields where Yield doesn't apply yet. */
export function allSlotsActive(): Set<number> {
  return new Set(Array.from({ length: TUNING.FRUIT_PER_BATCH }, (_, i) => i));
}

/**
 * Picks which currently-dormant physical slot should become productive
 * next, after `justHarvestedIndex` leaves the productive set. The
 * productive set is not fixed for a Line's lifetime — every harvest
 * rotates it by exactly one, so no physical position stays permanently
 * dark just because Yield < 100. Prefers a slot other than the one just
 * harvested (so the visible pattern actually moves), and among the
 * remaining dormant candidates prefers whichever tree currently has the
 * fewest productive slots (keeps the productive set spread across all
 * five trees rather than drifting onto one side). Falls back to
 * reactivating the same slot when it's the only dormant one (Yield=100,
 * capacity=15 — nothing to rotate to, same as the old fixed behavior).
 */
export function pickNextProductiveSlot(slots: FieldFruitSlot[], justHarvestedIndex: number): number {
  const isDormant = (i: number) => !slots[i].active;
  const others = slots.map((_, i) => i).filter((i) => i !== justHarvestedIndex && isDormant(i));
  const pool = others.length > 0 ? others : slots.map((_, i) => i).filter(isDormant);
  if (pool.length === 0) return justHarvestedIndex;

  const activePerTree = new Array(ORCHARD_TREES).fill(0) as number[];
  slots.forEach((s, i) => {
    if (s.active) activePerTree[Math.floor(i / ORCHARD_SLOTS_PER_TREE)]++;
  });
  const minCount = Math.min(...pool.map((i) => activePerTree[Math.floor(i / ORCHARD_SLOTS_PER_TREE)]));
  const best = pool.filter((i) => activePerTree[Math.floor(i / ORCHARD_SLOTS_PER_TREE)] === minCount);
  return best[Math.floor(Math.random() * best.length)];
}

/**
 * Builds a fresh field's 15 fruit slots. `fractionGrown` (0..1) decides how
 * many of the *active* slots start already ripe (chosen via shuffle so
 * it's not always the same physical slots); the rest get timers staggered
 * across the regrow window (plus light jitter) instead of all sharing one
 * value, so a freshly created/purchased field doesn't reveal its remaining
 * crop in one simultaneous burst. Slots outside `activeIndices` are
 * permanently inactive — never ripe, never ticked.
 */
export function makeInitialFruitSlots(
  fractionGrown: number,
  growth: number,
  irrigationLevel: number,
  activeIndices: Set<number>,
): FieldFruitSlot[] {
  const n = TUNING.FRUIT_PER_BATCH;
  const maxSpread = meanRegrowSeconds(growth) * (1 + TUNING.GROWTH_REGROW_VARIANCE) * irrigationReduction(irrigationLevel);
  const activeList = Array.from(activeIndices);
  const ripeCount = Math.round(activeList.length * fractionGrown);
  const order = shuffledRange(activeList.length).map((i) => activeList[i]);
  const slots: FieldFruitSlot[] = Array.from({ length: n }, (_, i) => ({ ripe: false, timer: 0, active: activeIndices.has(i), specimen: null }));

  order.slice(0, ripeCount).forEach((i) => {
    slots[i].ripe = true;
  });
  const remaining = order.slice(ripeCount);
  remaining.forEach((i, j) => {
    const base = ((j + 1) / (remaining.length + 1)) * maxSpread;
    slots[i].timer = Math.max(0.5, base + (Math.random() - 0.5) * 1.5);
  });
  return slots;
}

/**
 * The ONE Daily Operating Cost number, settled once per day during Closing
 * (see Game.finishClosing) — deliberately a single small, transparent linear
 * formula, never split into itemized expense categories. Two additive
 * components: a per-Field term (owning more Fields raises the cost of
 * running the farm) and a gentle per-day progression term (`day` is
 * 1-based, so Day 1 has zero progression bonus) that rises with time
 * without ever compounding/accelerating.
 */
export function operatingCost(day: number, fieldCount: number): number {
  const progression = TUNING.OPERATING_COST_PER_DAY * Math.max(0, day - 1);
  return TUNING.OPERATING_COST_BASE + fieldCount * TUNING.OPERATING_COST_PER_FIELD + progression;
}

const RARITY_POINTS: Record<string, number> = {
  Red: 0,
  Green: 2,
  Yellow: 5,
  Purple: 10,
  Plain: 0,
  Speckled: 5,
  Striped: 10,
};

export function rarityScore(variety: Variety): number {
  return (RARITY_POINTS[variety.color] ?? 0) + (RARITY_POINTS[variety.pattern] ?? 0);
}

export function fairCompositeScore(variety: Variety, policy: CultivationPolicy): number {
  const { sweetness, size } = effectiveStats(variety, policy);
  return sweetness * 0.4 + size * 0.3 + rarityScore(variety);
}

export function sweetnessContestScore(variety: Variety, policy: CultivationPolicy): number {
  return effectiveStats(variety, policy).sweetness;
}
