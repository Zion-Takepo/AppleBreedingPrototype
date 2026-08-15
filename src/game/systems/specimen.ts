// ============================================================
// Orchard Mutation / Breeding Specimen (see PROJECT.md "Orchard Mutation /
// Breeding Specimen / Breed connection"). Pure, injectable-RNG helpers used
// by Game.ts to decide WHEN a special fruit appears, WHICH Visual it uses,
// and WHAT its five genetic stats are — kept here (rather than inline in
// Game.ts) so they can be exercised deterministically by
// scripts/verify-specimens.ts without needing a full Game/Phaser setup.
// ============================================================
import { TUNING } from '../tuning.ts';
import type { AppleAssetId, AppleRarity } from '../render/appleAssets.ts';
import { APPLE_RARITY } from '../render/appleAssets.ts';
import { EPIC_UNLOCK_DAY, RARE_UNLOCK_DAY, unlockedCommonIds, unlockedEpicIds, unlockedRareIds, weightedPick } from './rarity.ts';
import { clamp, scaleToBudget, type Stats5 } from './breeding.ts';

export type SpecimenTier = AppleRarity;

/**
 * ONE mutually-exclusive Day-3+ per-ripened-fruit tier roll (see
 * PROJECT.md section 4): Common from Day 3, Rare from Day 4, Epic from Day
 * 6, each an independent base rate but rolled together so a single fruit
 * can never become multiple tiers. Null = no specimen this ripening.
 */
export function rollSpecimenTier(day: number, rng: () => number = Math.random): SpecimenTier | null {
  if (day < TUNING.SPECIMEN_RANDOM_START_DAY) return null;
  const epicP = day >= 6 ? TUNING.SPECIMEN_EPIC_CHANCE : 0;
  const rareP = day >= 4 ? TUNING.SPECIMEN_RARE_CHANCE : 0;
  const commonP = TUNING.SPECIMEN_COMMON_CHANCE;
  const roll = rng();
  if (roll < epicP) return 'EPIC';
  if (roll < epicP + rareP) return 'RARE';
  if (roll < epicP + rareP + commonP) return 'COMMON';
  return null;
}

function tierPool(tier: SpecimenTier, day: number): readonly AppleAssetId[] {
  if (tier === 'COMMON') return unlockedCommonIds(day);
  if (tier === 'RARE') return unlockedRareIds(day);
  return unlockedEpicIds(day);
}

function tierBaseChance(tier: SpecimenTier): number {
  if (tier === 'COMMON') return TUNING.SPECIMEN_COMMON_CHANCE;
  if (tier === 'RARE') return TUNING.SPECIMEN_RARE_CHANCE;
  return TUNING.SPECIMEN_EPIC_CHANCE;
}

/**
 * Picks the specific Visual for a Day-3+ random Orchard specimen: must
 * differ from the planted source Line's own ORDINARY visual (its
 * `baseVisualId` — what's actually growing on the tree; see PROJECT.md
 * section 15) so the player can actually notice it, from the day-gated
 * tier pool, undiscovered-weighted 2x. Null = no valid alternate Visual
 * exists — caller must fall back to an ordinary fruit rather than
 * fabricate one.
 */
export function pickOrchardSpecimenVisual(
  tier: SpecimenTier,
  day: number,
  sourceBaseVisualId: AppleAssetId,
  discoveredVisualIds: readonly AppleAssetId[],
  rng: () => number = Math.random,
): AppleAssetId | null {
  const pool = tierPool(tier, day).filter((id) => id !== sourceBaseVisualId);
  if (pool.length === 0) return null;
  return weightedPick(pool, discoveredVisualIds, rng);
}

/**
 * Day-2 guaranteed specimen Visual selection (see PROJECT.md section 3):
 * whichever of #003/#004 is still undiscovered when only one is; 50/50
 * otherwise (both undiscovered, or both already discovered). Deliberately
 * ignores the normal Common day-gating table (C4 doesn't otherwise unlock
 * until Day 3) — this guarantee intentionally supersedes it.
 */
export function chooseDay2GuaranteedVisual(discoveredVisualIds: readonly AppleAssetId[], rng: () => number = Math.random): 'C3' | 'C4' {
  const c3 = discoveredVisualIds.includes('C3');
  const c4 = discoveredVisualIds.includes('C4');
  if (c3 && !c4) return 'C4';
  if (!c3 && c4) return 'C3';
  return rng() < 0.5 ? 'C3' : 'C4';
}

/**
 * Which planted Field a guaranteed Day-1/Day-2 specimen should appear on:
 * prefers a Field whose planted Line's own ordinary visual (its
 * baseVisualId — see PROJECT.md section 15) differs from the target (so
 * the special fruit is visibly different among the ordinary crop), falling
 * back to any planted Field. Returns -1 if no Field is planted at all
 * (shouldn't normally happen — Field 1 always starts planted).
 */
export function chooseGuaranteedSpecimenFieldIndex<F extends { unlocked: boolean; varietyId: string | null }>(
  fields: readonly F[],
  baseVisualIdOf: (varietyId: string) => AppleAssetId | undefined,
  targetVisualId: AppleAssetId,
): number {
  const eligible = fields.map((f, i) => ({ f, i })).filter(({ f }) => f.unlocked && f.varietyId);
  if (eligible.length === 0) return -1;
  const preferred = eligible.find(({ f }) => baseVisualIdOf(f.varietyId!) !== targetVisualId);
  return (preferred ?? eligible[0]).i;
}

/**
 * A Specimen's five genetic stats: a mutation of its source Line (see
 * PROJECT.md section 5) — independent integer +/-4 mutation per stat, one
 * additional major +/-8..12 mutation on a single random stat, then
 * rescaled to a hidden budget target of `sourceTotal + randInt(-3..+5)`
 * (capped 360) via the exact same scaleToBudget helper breeding.ts's own
 * candidates use. Rarity of the Visual has no bearing on this — an Epic
 * specimen can be genetically mediocre and a Common one exceptional.
 */
/**
 * A newly-generated Specimen's baseVisualId (see PROJECT.md section 10 /
 * types.ts's BreedingSpecimen doc comment): a Common-tier specimen is its
 * own fresh stable base; a Rare/Epic-tier specimen inherits its source
 * Line's own baseVisualId, never its visualId. Extracted as its own pure
 * function (used by Game.buildSpecimen) so it's directly unit-testable —
 * see scripts/verify-specimens.ts's BASE VISUAL section.
 */
export function deriveSpecimenBaseVisualId(specimenVisualId: AppleAssetId, sourceBaseVisualId: AppleAssetId): AppleAssetId {
  return APPLE_RARITY[specimenVisualId] === 'COMMON' ? specimenVisualId : sourceBaseVisualId;
}

export function generateSpecimenStats(source: Stats5, rng: () => number = Math.random): Stats5 {
  const randInt = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
  const sourceTotal = source[0] + source[1] + source[2] + source[3] + source[4];

  const raw = source.map((v) => v + randInt(-TUNING.SPECIMEN_STAT_MINOR_MUTATION, TUNING.SPECIMEN_STAT_MINOR_MUTATION)) as Stats5;

  const majorIdx = Math.floor(rng() * 5);
  const magnitude = TUNING.SPECIMEN_STAT_MAJOR_MUTATION_MIN + rng() * (TUNING.SPECIMEN_STAT_MAJOR_MUTATION_MAX - TUNING.SPECIMEN_STAT_MAJOR_MUTATION_MIN);
  raw[majorIdx] += (rng() < 0.5 ? -1 : 1) * magnitude;

  const targetBudget = clamp(sourceTotal + randInt(TUNING.SPECIMEN_BUDGET_DELTA_MIN, TUNING.SPECIMEN_BUDGET_DELTA_MAX), 0, TUNING.SPECIMEN_BUDGET_CAP);
  return scaleToBudget(raw, targetBudget);
}

// ------------------------------------------------------------------
// Rare/Epic Mutation Affinity (see PROJECT.md "Revise Rare / Epic Line
// behavior" and TUNING.RARE_MUTATION_AFFINITY_MULTIPLIER/
// EPIC_MUTATION_AFFINITY_MULTIPLIER). A permanent Rare/Epic Line's own
// special visualId (never a sibling Rare/Epic id, never stacking by
// generation) makes THAT exact Visual more likely to recur as a physical
// Day-3+ Orchard Specimen on fields planted with it.
// ------------------------------------------------------------------

export interface MutationAffinity {
  tier: 'RARE' | 'EPIC';
  visualId: AppleAssetId;
  multiplier: number;
}

/** Which Mutation Affinity (if any) a Line's own special Visual identity grants. Common Lines have none. */
export function mutationAffinityFor(lineVisualId: AppleAssetId): MutationAffinity | null {
  const rarity = APPLE_RARITY[lineVisualId];
  if (rarity === 'RARE') return { tier: 'RARE', visualId: lineVisualId, multiplier: TUNING.RARE_MUTATION_AFFINITY_MULTIPLIER };
  if (rarity === 'EPIC') return { tier: 'EPIC', visualId: lineVisualId, multiplier: TUNING.EPIC_MUTATION_AFFINITY_MULTIPLIER };
  return null;
}

/**
 * The approximate equal-split baseline per-specific-visual chance within a
 * tier on a given day (e.g. Rare 0.05%/4 visuals ~= 0.0125% each) — the
 * reference point Affinity's multiplier is measured against (see
 * PROJECT.md's worked example). Zero if the tier has no unlocked visuals
 * yet on this day.
 */
export function basePerSpecificChance(tier: SpecimenTier, day: number): number {
  const pool = tierPool(tier, day);
  return pool.length > 0 ? tierBaseChance(tier) / pool.length : 0;
}

/**
 * The ADDITIONAL independent per-ripening chance an Affinity Visual gets
 * ABOVE its normal within-tier baseline share — NOT a reweighting of the
 * existing tier roll, an extra opportunity layered on top of it, so the
 * Visual's absolute occurrence rate (baseline + this bonus) approaches
 * `multiplier` times the non-affinity baseline (see PROJECT.md section
 * 14's worked example: Rare ~0.1125% additional on a ~0.0125% baseline for
 * a ~0.125% / 10x total; Epic ~0.0475% additional on a ~0.0025% baseline
 * for a ~0.05% / 20x total). Zero before the tier's own unlock day (Rare
 * Day 4, Epic Day 6) — Affinity can never bypass those gates.
 */
export function affinityBonusChance(tier: 'RARE' | 'EPIC', day: number, multiplier: number): number {
  if (tier === 'RARE' && day < RARE_UNLOCK_DAY) return 0;
  if (tier === 'EPIC' && day < EPIC_UNLOCK_DAY) return 0;
  const base = basePerSpecificChance(tier, day);
  return base * (multiplier - 1);
}

export interface SpecimenRoll {
  tier: SpecimenTier;
  visualId: AppleAssetId;
}

/**
 * Rolls whether one ripening ordinary fruit becomes a Specimen, folding in
 * the source Line's own Mutation Affinity. Checks the affinity bonus
 * FIRST — an independent, ADDITIONAL chance for the Line's own special
 * Visual, layered on top of (not instead of) its normal within-tier
 * baseline share — and only falls through to the existing normal
 * mutually-exclusive tier roll (rollSpecimenTier + pickOrchardSpecimenVisual,
 * both unchanged) if the bonus doesn't fire, so a single fruit can still
 * become at most one Specimen: either the direct affinity hit, or whatever
 * (if anything) the normal roll independently produces — never both.
 */
export function rollOrchardSpecimen(
  day: number,
  sourceBaseVisualId: AppleAssetId,
  sourceLineVisualId: AppleAssetId,
  discoveredVisualIds: readonly AppleAssetId[],
  rng: () => number = Math.random,
): SpecimenRoll | null {
  if (day < TUNING.SPECIMEN_RANDOM_START_DAY) return null;

  const affinity = mutationAffinityFor(sourceLineVisualId);
  if (affinity) {
    const bonus = affinityBonusChance(affinity.tier, day, affinity.multiplier);
    if (bonus > 0 && rng() < bonus) {
      return { tier: affinity.tier, visualId: affinity.visualId };
    }
  }

  const tier = rollSpecimenTier(day, rng);
  if (!tier) return null;
  const visualId = pickOrchardSpecimenVisual(tier, day, sourceBaseVisualId, discoveredVisualIds, rng);
  if (!visualId) return null;
  return { tier, visualId };
}
