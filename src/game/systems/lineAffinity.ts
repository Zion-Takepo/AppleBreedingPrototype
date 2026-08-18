// ============================================================
// LINE AFFINITY SYSTEM (see PROJECT.md "Line Affinity System"). Replaces
// the old "Rare/Epic Lines grow a stable Common baseVisual" rule and the
// old absolute-rate Mutation Affinity (×10/×20) that used to live in
// systems/specimen.ts.
//
// Every fruit slot's outcome is a TWO-STAGE roll, evaluated once the instant
// a slot becomes ripe (see Game.ts's ripening block):
//
//   STAGE A — GLOBAL RARITY. Common/Rare/Epic is rolled using the game's
//   existing global rates (TUNING.SPECIMEN_RARE_CHANCE/SPECIMEN_EPIC_CHANCE,
//   Common the complement) — the planted Line NEVER influences this roll.
//
//   STAGE B — WITHIN-TIER VISUAL. Once a tier is decided, the specific
//   visual is chosen from that tier's day-unlocked candidates, each
//   starting at weight 1. The Line's own `visualId` (its Signature Fruit)
//   gets LINE_SIGNATURE_AFFINITY_WEIGHT if the rolled tier matches its own
//   rarity; the Line's `baseVisualId` (its Common Tendency) gets
//   LINE_COMMON_TENDENCY_WEIGHT when COMMON is rolled. A Common-signature
//   Line (visualId === baseVisualId) gets only the stronger Signature
//   weight, never both multiplied/summed together.
//
// A RARE/EPIC outcome is always routed into the existing physical Specimen
// pipeline (see Game.buildSpecimen) — never a mass-produced ordinary visual.
// A COMMON outcome is ordinary fruit; its rolled visual persists on
// FieldFruitSlot.commonVisualId until harvest (see types.ts).
// ============================================================
import { TUNING } from '../tuning.ts';
import type { AppleAssetId, AppleRarity } from '../render/appleAssets.ts';
import { APPLE_RARITY } from '../render/appleAssets.ts';
import { EPIC_UNLOCK_DAY, RARE_UNLOCK_DAY, unlockedCommonIds, unlockedEpicIds, unlockedRareIds } from './rarity.ts';

/** Day-unlocked candidate pool for a rarity tier (see systems/rarity.ts's day-gated unlock tables). */
export function tierPool(tier: AppleRarity, day: number): readonly AppleAssetId[] {
  if (tier === 'COMMON') return unlockedCommonIds(day);
  if (tier === 'RARE') return unlockedRareIds(day);
  return unlockedEpicIds(day);
}

/**
 * STAGE A — rolls GLOBAL Common/Rare/Epic rarity for one ripening fruit.
 * Rare/Epic use the exact existing SPECIMEN_RARE_CHANCE/SPECIMEN_EPIC_CHANCE
 * rates (zero before their own unlock day — probability mass renormalizes
 * into Common, same rule Visual Rarity's day-gate table already uses); the
 * planted Line has no parameter here at all, so it structurally cannot
 * influence this roll (see PROJECT.md section 16's invariant).
 */
export function rollGlobalRarity(day: number, rng: () => number = Math.random): AppleRarity {
  const rareP = day >= RARE_UNLOCK_DAY ? TUNING.SPECIMEN_RARE_CHANCE : 0;
  const epicP = day >= EPIC_UNLOCK_DAY ? TUNING.SPECIMEN_EPIC_CHANCE : 0;
  const roll = rng();
  if (roll < epicP) return 'EPIC';
  if (roll < epicP + rareP) return 'RARE';
  return 'COMMON';
}

/**
 * STAGE B — picks the specific visual within an already-rolled tier,
 * weighted by the planted Line's Signature (its own `visualId`, weight
 * LINE_SIGNATURE_AFFINITY_WEIGHT when the tier matches the Signature's own
 * rarity) and Common Tendency (its `baseVisualId`, weight
 * LINE_COMMON_TENDENCY_WEIGHT, only ever relevant when `tier === 'COMMON'`).
 * When a visual would qualify for both (a Common-signature Line, where
 * visualId === baseVisualId), the Signature weight wins outright — never
 * multiplied/summed with the Common Tendency weight. Every other candidate
 * in the tier stays at weight 1.
 */
export function pickTierVisual(tier: AppleRarity, day: number, signatureVisualId: AppleAssetId, commonTendencyVisualId: AppleAssetId, rng: () => number = Math.random): AppleAssetId {
  const pool = tierPool(tier, day);
  const signatureTier = APPLE_RARITY[signatureVisualId];
  const weights = pool.map((id) => {
    if (tier === signatureTier && id === signatureVisualId) return TUNING.LINE_SIGNATURE_AFFINITY_WEIGHT;
    if (tier === 'COMMON' && id === commonTendencyVisualId) return TUNING.LINE_COMMON_TENDENCY_WEIGHT;
    return 1;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

export interface FruitOutcome {
  tier: AppleRarity;
  visualId: AppleAssetId;
}

/** Runs both stages for one ripening fruit — see this file's header for the exact two-stage contract. */
export function rollFruitOutcome(day: number, signatureVisualId: AppleAssetId, commonTendencyVisualId: AppleAssetId, rng: () => number = Math.random): FruitOutcome {
  const tier = rollGlobalRarity(day, rng);
  const visualId = pickTierVisual(tier, day, signatureVisualId, commonTendencyVisualId, rng);
  return { tier, visualId };
}

/**
 * The Signature's own conditional probability WITHIN its rarity tier, given
 * that tier was already rolled — e.g. a 4-visual Rare tier with Signature
 * weight 3 -> 3/(3+1+1+1) = 50%; a 2-visual Epic tier -> 3/(3+1) = 75%. Used
 * by UI (see ui/LineDetail.ts) to show accurate odds rather than a
 * hard-coded example. Returns 0 for a Common-signature Line (no meaningful
 * "Signature among Rare/Epic" figure to show) or if the tier has no
 * unlocked candidates yet on this day.
 */
export function signatureConditionalPct(signatureVisualId: AppleAssetId, day: number): number {
  const tier = APPLE_RARITY[signatureVisualId];
  const pool = tierPool(tier, day);
  if (pool.length === 0 || !pool.includes(signatureVisualId)) return 0;
  const weight = TUNING.LINE_SIGNATURE_AFFINITY_WEIGHT;
  const total = weight + (pool.length - 1);
  return weight / total;
}

/** The Common Tendency's own conditional probability among Common candidates, given Common was already rolled (e.g. 2/(2+1+1+1) = 40% for the current 4-visual Common tier). */
export function commonTendencyConditionalPct(day: number): number {
  const pool = tierPool('COMMON', day);
  if (pool.length === 0) return 0;
  const weight = TUNING.LINE_COMMON_TENDENCY_WEIGHT;
  const total = weight + (pool.length - 1);
  return weight / total;
}
