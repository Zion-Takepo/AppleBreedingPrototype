// ============================================================
// FIELD RARITY MODEL V2 (see PROJECT.md "Field Rarity + Line Affinity
// Probability Model V2" and TUNING's "FIELD RARITY MODEL V2" block).
//
// LIVE since Pass 3B — Game.ts's rollFruitOutcomeForSlot is the sole caller
// that drives actual Orchard fruit generation (see
// PROJECT.md "Canonical fruit generation order"). systems/lineAffinity.ts's
// own rollFruitOutcome/rollGlobalRarity/pickTierVisual are no longer used to
// generate fruit — that file is kept only because its
// signatureConditionalPct/commonTendencyConditionalPct (and the ×3/×2
// LINE_SIGNATURE_AFFINITY_WEIGHT/LINE_COMMON_TENDENCY_WEIGHT constants they
// read) still back a few UI probability displays (OrchardScreen,
// CollectionScreen, LineDetail) that this pass deliberately left untouched —
// those displays are stale relative to this file's real, live 1.30/1.15
// weights until a later UI pass updates them.
//
// Canonical two-stage sequence this module implements:
//
//   STAGE A — FIELD RARITY. Which Field a fruit grows on determines its
//   Common/Rare/Epic base odds (getFieldBaseRarityOdds). A rewarded-ad
//   boost and/or first-Rare protection may raise Rare's effective share,
//   always taking the extra mass from Common, never from Epic
//   (getEffectiveRarityOdds) — then rollRarity performs the actual roll.
//
//   STAGE B — WITHIN-TIER VISUAL. Once a tier is decided, the specific
//   visual is chosen from that tier's day-unlocked candidates
//   (getWithinTierVisualWeights / rollVisualWithinRarity), weighted toward
//   the planted Line's Signature (visualId) and Common Tendency
//   (baseVisualId). This stage never affects Stage A's odds, and Stage A
//   never takes Signature/Common Tendency as input — the two are fully
//   decoupled by construction (see PROJECT.md's rarity-invariance rule).
// ============================================================
import { TUNING } from '../tuning.ts';
import type { AppleAssetId, AppleRarity } from '../render/appleAssets.ts';
import { APPLE_RARITY } from '../render/appleAssets.ts';
import { RARE_UNLOCK_DAY, EPIC_UNLOCK_DAY } from './rarity.ts';
import { tierPool } from './lineAffinity.ts';

export interface RarityOdds {
  common: number;
  rare: number;
  epic: number;
}

/** Field 1-4's base Common/Rare/Epic odds (see PROJECT.md's explicit table) — index 0 = Field 1. */
export const FIELD_RARITY_TABLE: readonly RarityOdds[] = TUNING.FIELD_RARITY_TABLE;

/**
 * STAGE A, part 1 — a Field's base rarity odds, with no Signature/Common
 * Tendency input at all (see this file's header). `fieldIndex` is 1-based
 * (Field.id's own convention — Field 1..4), matching `Field.id` in types.ts.
 */
export function getFieldBaseRarityOdds(fieldIndex: number): RarityOdds {
  const row = FIELD_RARITY_TABLE[fieldIndex - 1];
  if (!row) throw new Error(`getFieldBaseRarityOdds: no rarity row for fieldIndex ${fieldIndex} (expected 1..${FIELD_RARITY_TABLE.length})`);
  return row;
}

// ------------------------------------------------------------
// First-Rare discovery protection (retention-only; see PROJECT.md).
// ------------------------------------------------------------

/** Whether Rare is structurally eligible to appear at all on `day` — reuses the existing day-gate (see systems/rarity.ts), not a new duplicate gate. */
export function isRareEligible(day: number): boolean {
  return day >= RARE_UNLOCK_DAY;
}

/** Whether Epic is structurally eligible to appear at all on `day`. */
export function isEpicEligible(day: number): boolean {
  return day >= EPIC_UNLOCK_DAY;
}

/**
 * First-Rare protection's own persisted counter shape (caller-owned — this
 * pass does not touch GameState/save data; a later integration pass decides
 * where this lives). `hasFoundRare` permanently and irreversibly disables
 * the protection the instant it becomes true. `missStreak` counts
 * consecutive ELIGIBLE rolls (see isRareEligible) that did NOT produce Rare
 * since the last Rare (or since the start, if none yet) — an Epic result
 * counts as a miss (see advanceFirstRareProtectionState's doc comment).
 */
export interface FirstRareProtectionState {
  hasFoundRare: boolean;
  missStreak: number;
}

export const INITIAL_FIRST_RARE_PROTECTION_STATE: FirstRareProtectionState = { hasFoundRare: false, missStreak: 0 };

export type FirstRareBonus = { kind: 'NONE' } | { kind: 'BONUS'; bonusPct: number } | { kind: 'GUARANTEE' };

/**
 * Computes what (if anything) first-Rare protection should do to THIS next
 * eligible roll, given the state going into it. Rolls 1-10 (missStreak 0-9)
 * are untouched; roll 11 (missStreak 10) begins the +0.75pp-per-miss ramp;
 * roll 25 (missStreak 24) guarantees Rare outright. Returns NONE
 * unconditionally once `hasFoundRare` is true — protection never reactivates.
 */
export function firstRareBonusForState(state: FirstRareProtectionState): FirstRareBonus {
  if (state.hasFoundRare) return { kind: 'NONE' };
  const rollNumber = state.missStreak + 1;
  if (rollNumber >= TUNING.FIRST_RARE_GUARANTEE_ROLL) return { kind: 'GUARANTEE' };
  if (rollNumber <= TUNING.FIRST_RARE_PROTECTION_ROLLS) return { kind: 'NONE' };
  const bonusPct = TUNING.FIRST_RARE_BONUS_PER_MISS * (rollNumber - TUNING.FIRST_RARE_PROTECTION_ROLLS);
  return { kind: 'BONUS', bonusPct };
}

/**
 * Advances first-Rare protection state AFTER an eligible roll's tier is
 * known. A Rare result ends protection permanently (hasFoundRare: true,
 * counter reset/irrelevant from then on). An Epic result counts as a miss
 * for the streak (it is a "special" outcome for the roll itself, but this
 * codebase has no existing progression semantics that treat obtaining Epic
 * as satisfying Rare discovery — see PROJECT.md) — Common also counts as a
 * miss. Only call this for rolls where isRareEligible(day) was true; do not
 * advance the streak for pre-eligibility rolls.
 */
export function advanceFirstRareProtectionState(state: FirstRareProtectionState, rolledTier: AppleRarity): FirstRareProtectionState {
  if (state.hasFoundRare) return state;
  if (rolledTier === 'RARE') return { hasFoundRare: true, missStreak: 0 };
  return { hasFoundRare: false, missStreak: state.missStreak + 1 };
}

// ------------------------------------------------------------
// STAGE A, part 2 — combining Field base odds with optional modifiers.
// ------------------------------------------------------------

export interface EffectiveRarityOptions {
  /** Future rewarded-ad bonus (see TUNING.REWARDED_RARITY_MULTIPLIER) — never stacks with itself; pass a plain boolean, not a count. */
  rewardedRarityBoostActive?: boolean;
  /** First-Rare protection's current state, if this roll is eligible and protection should be consulted; omit entirely for an ineligible roll. */
  firstRareProtection?: FirstRareProtectionState;
  /**
   * Current calendar day — Pass 3B's live-integration day-gate (see
   * PROJECT.md section "Canonical fruit generation order" / isRareEligible/
   * isEpicEligible above). When provided, Rare and/or Epic are zeroed (their
   * mass folding back into Common) until their own unlock day, exactly
   * mirroring the pre-V2 lineAffinity.ts day-gating — never a second,
   * independently tuned gate. Omit for a day-agnostic Field-odds query (e.g.
   * a UI display of a Field's "full" odds table, or this file's own
   * Pass-3A tests, none of which pass `day`).
   */
  day?: number;
}

export interface EffectiveRarityResult {
  odds: RarityOdds;
  /** True only for the 25th-eligible-roll-without-a-Rare hard guarantee. */
  guaranteed: boolean;
}

/**
 * STAGE A, part 2 — Field base odds -> rewarded-ad multiplier (if active)
 * -> first-Rare bonus/guarantee (if provided) -> normalized, clamped to
 * [0,1] and summing to 1. Order matches PROJECT.md's documented combination
 * order exactly. Epic is only ever touched by the rewarded multiplier —
 * first-Rare protection always takes its extra mass from Common alone.
 */
export function getEffectiveRarityOdds(fieldIndex: number, options: EffectiveRarityOptions = {}): EffectiveRarityResult {
  const base = getFieldBaseRarityOdds(fieldIndex);
  let rare = options.day != null && !isRareEligible(options.day) ? 0 : base.rare;
  let epic = options.day != null && !isEpicEligible(options.day) ? 0 : base.epic;

  if (options.rewardedRarityBoostActive) {
    rare *= TUNING.REWARDED_RARITY_MULTIPLIER;
    epic *= TUNING.REWARDED_RARITY_MULTIPLIER;
  }

  if (options.firstRareProtection) {
    const bonus = firstRareBonusForState(options.firstRareProtection);
    if (bonus.kind === 'GUARANTEE') {
      return { odds: { common: 0, rare: 1, epic: 0 }, guaranteed: true };
    }
    if (bonus.kind === 'BONUS') {
      rare += bonus.bonusPct;
    }
  }

  rare = Math.min(Math.max(rare, 0), 1 - epic);
  const common = Math.max(0, 1 - rare - epic);
  return { odds: { common, rare, epic }, guaranteed: false };
}

/** Performs the actual Common/Rare/Epic roll for already-computed odds. */
export function rollRarity(odds: RarityOdds, rng: () => number = Math.random): AppleRarity {
  const roll = rng();
  if (roll < odds.epic) return 'EPIC';
  if (roll < odds.epic + odds.rare) return 'RARE';
  return 'COMMON';
}

// ------------------------------------------------------------
// STAGE B — within-tier visual selection (Signature / Common Tendency).
// ------------------------------------------------------------

/** Re-exported for convenience — the day-unlocked visual pool for a tier (see systems/rarity.ts's day-gated unlock tables), the project's actual rarity-to-visual registry. No hard-coded per-tier counts anywhere in this module. */
export { tierPool };

/**
 * STAGE B — per-candidate weights for `pool` (already the correct
 * day-unlocked pool for `tier`). The Signature (`signatureVisualId`) gets
 * FIELD_LINE_SIGNATURE_WEIGHT when `tier` matches the Signature's own
 * rarity; the Common Tendency (`commonTendencyVisualId`) gets
 * FIELD_LINE_COMMON_TENDENCY_WEIGHT when `tier === 'COMMON'`. A visual that
 * qualifies for both (Signature === Common Tendency) gets only the
 * (larger) Signature weight — the Signature check runs first and returns
 * immediately, so the two can never stack. Works for any pool size/order,
 * so it needs no changes if a tier ever gains another visual.
 */
export function getWithinTierVisualWeights(pool: readonly AppleAssetId[], tier: AppleRarity, signatureVisualId: AppleAssetId, commonTendencyVisualId: AppleAssetId): number[] {
  const signatureTier = APPLE_RARITY[signatureVisualId];
  return pool.map((id) => {
    if (tier === signatureTier && id === signatureVisualId) return TUNING.FIELD_LINE_SIGNATURE_WEIGHT;
    if (tier === 'COMMON' && id === commonTendencyVisualId) return TUNING.FIELD_LINE_COMMON_TENDENCY_WEIGHT;
    return 1;
  });
}

/** STAGE B — rolls a specific visual from `pool` given parallel `weights` (see getWithinTierVisualWeights). */
export function rollVisualWithinRarity(pool: readonly AppleAssetId[], weights: readonly number[], rng: () => number = Math.random): AppleAssetId {
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

export interface FieldFruitOutcome {
  tier: AppleRarity;
  visualId: AppleAssetId;
}

/**
 * Convenience full-pipeline roll (Stage A + Stage B) for tests/one-shot
 * callers — NOT what Game.ts's live rollFruitOutcomeForSlot calls, since
 * that needs to thread `GameState.firstRareProtection` through
 * advanceFirstRareProtectionState between Stage A and Stage B (this
 * function has no way to return the advanced state); Game.ts instead calls
 * getEffectiveRarityOdds/rollRarity/getWithinTierVisualWeights/
 * rollVisualWithinRarity directly, in the same order this function does.
 * `options` covers Stage A's optional modifiers (rewarded boost / first-Rare
 * protection); Stage B always reads `day`'s own unlocked pool via
 * `tierPool`, matching the currently-live lineAffinity.ts's own day-gating.
 */
export function rollFieldFruitOutcome(fieldIndex: number, day: number, signatureVisualId: AppleAssetId, commonTendencyVisualId: AppleAssetId, options: EffectiveRarityOptions = {}, rng: () => number = Math.random): FieldFruitOutcome {
  const { odds } = getEffectiveRarityOdds(fieldIndex, options);
  const tier = rollRarity(odds, rng);
  const pool = tierPool(tier, day);
  const weights = getWithinTierVisualWeights(pool, tier, signatureVisualId, commonTendencyVisualId);
  const visualId = rollVisualWithinRarity(pool, weights, rng);
  return { tier, visualId };
}
