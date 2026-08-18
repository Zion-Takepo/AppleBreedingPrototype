// ============================================================
// Orchard Mutation / Breeding Specimen (see PROJECT.md "Orchard Mutation /
// Breeding Specimen / Breed connection"). Pure, injectable-RNG helpers used
// by Game.ts to decide WHICH Visual a guaranteed onboarding Specimen uses
// and WHAT any Specimen's five genetic stats are — kept here (rather than
// inline in Game.ts) so they can be exercised deterministically by
// scripts/verify-specimens.ts without needing a full Game/Phaser setup.
//
// The Day-3+ per-ripening roll itself (WHEN a special fruit appears, WHICH
// Visual it uses) now lives in systems/lineAffinity.ts (see PROJECT.md "Line
// Affinity System") — it replaced this file's old rollSpecimenTier/
// pickOrchardSpecimenVisual/mutationAffinityFor trio, which assumed a
// Rare/Epic Line could safely boost its own special Visual's ABSOLUTE
// occurrence rate (×10/×20). That assumption is no longer valid: Line
// Affinity only ever reweights WHICH visual is picked WITHIN an
// already-rolled, Line-independent global rarity tier.
// ============================================================
import { TUNING } from '../tuning.ts';
import type { AppleAssetId } from '../render/appleAssets.ts';
import { APPLE_RARITY } from '../render/appleAssets.ts';
import { clamp, scaleToBudget, type Stats5 } from './breeding.ts';

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

/**
 * A Specimen's five genetic stats: a mutation of its source Line (see
 * PROJECT.md section 5) — independent integer +/-4 mutation per stat, one
 * additional major +/-8..12 mutation on a single random stat, then
 * rescaled to a hidden budget target of `sourceTotal + randInt(-3..+5)`
 * (capped 360) via the exact same scaleToBudget helper breeding.ts's own
 * candidates use. Rarity of the Visual has no bearing on this — an Epic
 * specimen can be genetically mediocre and a Common one exceptional.
 */
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
