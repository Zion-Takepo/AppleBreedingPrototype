import { COLORS, PATTERNS, TUNING, type AppleColor, type ApplePattern } from '../tuning.ts';
import type { GameState, OffspringCandidate } from '../types.ts';
import type { AppleAssetId } from '../render/appleAssets.ts';
import { generateVarietyName } from './names.ts';
import { unlockedCommonIds, weightedPick } from './rarity.ts';

type Slot = 'A' | 'B' | 'C' | 'D';
const SLOTS: Slot[] = ['A', 'B', 'C', 'D'];

// The five genetic traits, in the fixed order used throughout this file's
// stat-vector math — the same order the radar chart displays them in:
// Sweetness, Size, Yield, Growth, Freshness.
export type Stats5 = [number, number, number, number, number];

// A breeding parent needs only these fields — a permanent Library Line
// (Variety) satisfies this structurally as-is, and Game.ts builds one of
// these directly from a one-use Breeding Specimen (borrowing color/pattern
// from the Specimen's source Line, since a Specimen doesn't persist its
// own — see PROJECT.md section 9/11) without needing a large parent-model
// rewrite. See Game.breedParentFromSpecimen.
export interface BreedParent {
  visualId: AppleAssetId;
  // The Common Visual this parent's lineage actually produces as ordinary
  // fruit — see types.ts's Variety doc comment. Always identical to
  // visualId for a Common parent.
  baseVisualId: AppleAssetId;
  color: AppleColor;
  pattern: ApplePattern;
  sweetness: number;
  size: number;
  yieldStat: number;
  growth: number;
  freshness: number;
  generation: number;
}

export function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}

export function statsOf(v: BreedParent): Stats5 {
  return [v.sweetness, v.size, v.yieldStat, v.growth, v.freshness];
}

export function sumStats(s: Stats5): number {
  return s[0] + s[1] + s[2] + s[3] + s[4];
}

/** Uniformly scales `raw` stats so their sum matches targetBudget, individually clamped 0..100 — the shared hidden-budget mechanism reused by both breeding candidates (below) and Orchard Specimen mutation (see systems/specimen.ts). */
export function scaleToBudget(raw: Stats5, targetBudget: number): Stats5 {
  const rawBudget = sumStats(raw);
  const scale = rawBudget > 0 ? targetBudget / rawBudget : 1;
  return raw.map((v) => clamp(v * scale)) as Stats5;
}

function noise(amt: number): number {
  return (Math.random() * 2 - 1) * amt;
}

function shuffledRange(n: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Direct per-trait blend of two parents' raw stat vectors: tA=1 fully
// favors parent A, tA=0 fully favors parent B.
function blendStats(a: Stats5, b: Stats5, tA: number): Stats5 {
  return a.map((av, i) => av * tA + b[i] * (1 - tA)) as Stats5;
}

// Candidate C's redistribution twist: boosts 1-2 traits by ~6-12 points
// combined and reduces 1-2 different traits by a comparable amount, so its
// radar shape reads as a deliberate specialization rather than a flat
// average of both parents. Which traits move is randomized per breed.
function applyTradeoff(stats: Stats5): Stats5 {
  const result = stats.slice() as Stats5;
  const order = shuffledRange(5);
  const boostCount = Math.random() < 0.5 ? 1 : 2;
  const reduceCount = Math.random() < 0.5 ? 1 : 2;
  const boostIdx = order.slice(0, boostCount);
  const reduceIdx = order.slice(boostCount, boostCount + reduceCount);
  const boostTotal = 6 + Math.random() * 6; // 6..12
  const reduceTotal = 6 + Math.random() * 6; // 6..12
  boostIdx.forEach((i) => {
    result[i] += boostTotal / boostIdx.length;
  });
  reduceIdx.forEach((i) => {
    result[i] -= reduceTotal / reduceIdx.length;
  });
  return result;
}

// ------------------------------------------------------------------
// Genetic Budget / TOTAL progression — every Breed operation now rolls
// exactly ONE improvement value (see breedOffspring below) and rescales
// ALL FOUR candidates to that identical shared target TOTAL
// (Sweetness+Size+Yield+Growth+Freshness), hard-capped at 360 — so the
// player's choice among A/B/C/D is about stat DISTRIBUTION/Visual/risk,
// never "which one happened to roll the bigger total." The SHAPE (which
// traits are strong/weak) still comes entirely from the blend/tradeoff/
// wildcard logic below; scaleToBudget only controls the total.
// ------------------------------------------------------------------
const GENETIC_BUDGET_CAP = 360;

/**
 * Generates one candidate's five raw genetic stats (before rounding),
 * rescaled to the Breed operation's single shared target TOTAL.
 * A/B: mostly resemble one parent with a small blend + light mutation.
 * C: 50/50 blend, then an explicit boost/reduce tradeoff twist.
 * D: each trait independently inherits from whichever parent is chosen
 * per-trait, then gets a substantially larger mutation (5-18 points).
 */
function generateStats(slot: Slot, pA: Stats5, pB: Stats5, targetTotal: number): Stats5 {
  let raw: Stats5;
  switch (slot) {
    case 'A':
      raw = blendStats(pA, pB, 0.7).map((v) => v + noise(3)) as Stats5;
      break;
    case 'B':
      raw = blendStats(pA, pB, 0.3).map((v) => v + noise(3)) as Stats5;
      break;
    case 'C':
      raw = applyTradeoff(blendStats(pA, pB, 0.5).map((v) => v + noise(5)) as Stats5);
      break;
    case 'D':
      raw = pA.map((_, i) => {
        const source = Math.random() < 0.5 ? pA[i] : pB[i];
        const magnitude = 5 + Math.random() * 13; // 5..18
        return source + (Math.random() < 0.5 ? -1 : 1) * magnitude;
      }) as Stats5;
      break;
  }
  return scaleToBudget(raw, targetTotal);
}

function pickVisualTrait<T extends string>(
  slot: Slot,
  valueA: T,
  valueB: T,
  pool: readonly T[],
  discovered: T[],
  forcedMutation: T | null,
): T {
  if (forcedMutation) return forcedMutation;

  const mutationChance = TUNING.MUTATION_CHANCE[slot];
  if (Math.random() < mutationChance) {
    const undiscovered = pool.filter((t) => !discovered.includes(t));
    const candidates = undiscovered.length > 0 ? undiscovered : pool.filter((t) => t !== valueA && t !== valueB);
    if (candidates.length > 0) {
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
  }

  let biasA: number;
  switch (slot) {
    case 'A':
      biasA = 0.8;
      break;
    case 'B':
      biasA = 0.2;
      break;
    case 'C':
      biasA = 0.5;
      break;
    default:
      biasA = 0.5;
  }
  return Math.random() < biasA ? valueA : valueB;
}

// ------------------------------------------------------------------
// Visual (visualId + baseVisualId) inheritance — replaces the old
// independent per-candidate rarity roll (see systems/rarity.ts's doc
// comment). A/B are guaranteed to preserve their matching parent's
// COMPLETE visual identity (visualId AND baseVisualId together, never
// mixed — see PROJECT.md section 11), so a hard-won rare Specimen used as
// a parent can never lose its Visual across all four candidates; C
// recombines with no mutation; D is the only "wild miracle" chance, small
// and Common-only — Rare/Epic Visuals can no longer be spontaneously
// created by breeding at all (see PROJECT.md "Revise Rare / Epic Line
// behavior"); they only enter the player's genetics as physical Orchard
// Specimens (see systems/specimen.ts).
// ------------------------------------------------------------------
export interface VisualPair {
  visualId: AppleAssetId;
  baseVisualId: AppleAssetId;
}

/** Candidate D's mutation roll: a Common Visual different from both parents' (where possible), undiscovered-weighted, respecting the existing Common day-gating (Day 1 only C1/C2, Day 2+ all four — see systems/rarity.ts unlockedCommonIds). Null = no valid alternate Visual exists — caller falls back to ordinary parent inheritance rather than inventing one. */
function rollDMutationVisual(day: number, parentAVisualId: AppleAssetId, parentBVisualId: AppleAssetId, discovered: readonly AppleAssetId[]): AppleAssetId | null {
  const pool = unlockedCommonIds(day).filter((id) => id !== parentAVisualId && id !== parentBVisualId);
  if (pool.length === 0) return null;
  return weightedPick(pool, discovered);
}

function pickCandidateVisualPair(slot: Slot, day: number, a: VisualPair, b: VisualPair, discovered: readonly AppleAssetId[]): VisualPair {
  switch (slot) {
    case 'A':
      return a;
    case 'B':
      return b;
    case 'C':
      return Math.random() < 0.5 ? a : b;
    case 'D': {
      if (Math.random() < TUNING.SPECIMEN_D_VISUAL_MUTATION_CHANCE) {
        const mutated = rollDMutationVisual(day, a.visualId, b.visualId, discovered);
        // A mutated Common Visual is always its own stable base — see
        // types.ts's Variety doc comment ("Common Visuals are stable
        // cultivars").
        if (mutated) return { visualId: mutated, baseVisualId: mutated };
      }
      return Math.random() < 0.5 ? a : b;
    }
  }
}

export interface BreedResult {
  offspring: OffspringCandidate[];
  newlyDiscoveredColors: AppleColor[];
  newlyDiscoveredPatterns: ApplePattern[];
  newlyDiscoveredVisualIds: AppleAssetId[];
  // The stronger parent's own TOTAL and the single shared target TOTAL
  // every candidate was rescaled to (see PROJECT.md section 2) — surfaced
  // here so Game.resolveBreeding can persist them for the result UI
  // without needing to re-resolve (possibly already-consumed) parent data.
  strongerParentTotal: number;
  breedTargetTotal: number;
}

export function breedOffspring(parentA: BreedParent, parentB: BreedParent, day: number, state: GameState): BreedResult {
  const pA5 = statsOf(parentA);
  const pB5 = statsOf(parentB);

  // Every Breed operation must improve total genetic strength (see
  // PROJECT.md section 2): roll ONE +2..+6 improvement for the whole
  // operation, applied to the STRONGER parent's own TOTAL, capped at the
  // absolute genetic budget ceiling. All four candidates share this exact
  // target — a candidate can still be genetically WEAKER than the
  // stronger parent in one trait, but its own TOTAL always lands here.
  const parentATotal = sumStats(pA5);
  const parentBTotal = sumStats(pB5);
  const strongerParentTotal = Math.max(parentATotal, parentBTotal);
  const improvement = TUNING.BREED_IMPROVEMENT_MIN + Math.floor(Math.random() * (TUNING.BREED_IMPROVEMENT_MAX - TUNING.BREED_IMPROVEMENT_MIN + 1));
  const breedTargetTotal = Math.min(GENETIC_BUDGET_CAP, strongerParentTotal + improvement);

  const generation = Math.max(parentA.generation, parentB.generation) + 1;

  // Scripted Week-1 guarantees -----------------------------------------
  const isFirstEverBreeding = !state.breeding.everBredOnce;
  let forceColorSlot: Slot | null = null;
  let forceColorValue: AppleColor | null = null;
  if (day === 1 && isFirstEverBreeding && !state.day1YellowGuaranteeUsed && !state.discoveredColors.includes('Yellow')) {
    forceColorSlot = SLOTS[2 + Math.floor(Math.random() * 2)]; // C or D
    forceColorValue = 'Yellow';
  }

  let day5ForceSlot: Slot | null = null;
  let day5ForceColor: AppleColor | null = null;
  let day5ForcePattern: ApplePattern | null = null;
  if (day === 5 && !state.day5MutationGuaranteeUsed) {
    const purpleKnown = state.discoveredColors.includes('Purple');
    const stripedKnown = state.discoveredPatterns.includes('Striped');
    if (!purpleKnown || !stripedKnown) {
      const options: Array<'Purple' | 'Striped'> = [];
      if (!purpleKnown) options.push('Purple');
      if (!stripedKnown) options.push('Striped');
      const choice = options[Math.floor(Math.random() * options.length)];
      day5ForceSlot = SLOTS[1 + Math.floor(Math.random() * 3)]; // B, C, or D
      if (choice === 'Purple') day5ForceColor = 'Purple';
      else day5ForcePattern = 'Striped';
    }
  }

  const discoveredColorsWorking = [...state.discoveredColors];
  const discoveredPatternsWorking = [...state.discoveredPatterns];
  const discoveredVisualIdsWorking = [...state.discoveredVisualIds];
  const newlyDiscoveredColors: AppleColor[] = [];
  const newlyDiscoveredPatterns: ApplePattern[] = [];
  const newlyDiscoveredVisualIds: AppleAssetId[] = [];

  const offspring: OffspringCandidate[] = SLOTS.map((slot) => {
    const [rawSweetness, rawSize, rawYield, rawGrowth, rawFreshness] = generateStats(slot, pA5, pB5, breedTargetTotal);

    let forcedColor: AppleColor | null = null;
    if (forceColorSlot === slot) forcedColor = forceColorValue;
    if (day5ForceSlot === slot && day5ForceColor) forcedColor = day5ForceColor;

    let forcedPattern: ApplePattern | null = null;
    if (day5ForceSlot === slot && day5ForcePattern) forcedPattern = day5ForcePattern;

    const color = pickVisualTrait<AppleColor>(
      slot,
      parentA.color,
      parentB.color,
      COLORS,
      discoveredColorsWorking,
      forcedColor,
    );
    const pattern = pickVisualTrait<ApplePattern>(
      slot,
      parentA.pattern,
      parentB.pattern,
      PATTERNS,
      discoveredPatternsWorking,
      forcedPattern,
    );

    const isNewTraitColor = !discoveredColorsWorking.includes(color);
    if (isNewTraitColor) {
      discoveredColorsWorking.push(color);
      newlyDiscoveredColors.push(color);
    }
    const isNewTraitPattern = !discoveredPatternsWorking.includes(pattern);
    if (isNewTraitPattern) {
      discoveredPatternsWorking.push(pattern);
      newlyDiscoveredPatterns.push(pattern);
    }

    const traits = { color, pattern, sweetness: rawSweetness, size: rawSize, yieldStat: rawYield };

    // Visual inheritance — entirely separate from the color/pattern
    // mutation above. See pickCandidateVisualPair's doc comment / PROJECT.md
    // for the exact A/B/C/D rules; visualId and baseVisualId always come
    // from the SAME parent (or the same fresh Common mutation), never mixed.
    const { visualId, baseVisualId } = pickCandidateVisualPair(
      slot,
      day,
      { visualId: parentA.visualId, baseVisualId: parentA.baseVisualId },
      { visualId: parentB.visualId, baseVisualId: parentB.baseVisualId },
      discoveredVisualIdsWorking,
    );
    const isNewVisualId = !discoveredVisualIdsWorking.includes(visualId);
    if (isNewVisualId) {
      discoveredVisualIdsWorking.push(visualId);
      newlyDiscoveredVisualIds.push(visualId);
    }

    const candidate: OffspringCandidate = {
      id: crypto.randomUUID(),
      customName: generateVarietyName(traits),
      generation,
      color,
      pattern,
      visualId,
      baseVisualId,
      sweetness: Math.round(rawSweetness),
      size: Math.round(rawSize),
      yieldStat: Math.round(rawYield),
      growth: Math.round(rawGrowth),
      freshness: Math.round(rawFreshness),
      createdDay: day,
      awards: [],
      favorite: false,
      archived: false,
      slot,
      isNewTraitColor,
      isNewTraitPattern,
      isNewVisualId,
    };
    return candidate;
  });

  return { offspring, newlyDiscoveredColors, newlyDiscoveredPatterns, newlyDiscoveredVisualIds, strongerParentTotal, breedTargetTotal };
}
