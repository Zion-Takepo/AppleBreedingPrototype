import { COLORS, PATTERNS, TUNING, type AppleColor, type ApplePattern } from '../tuning.ts';
import type { GameState, OffspringCandidate, Variety } from '../types.ts';
import type { AppleAssetId } from '../render/appleAssets.ts';
import { generateVarietyName } from './names.ts';
import { rollOffspringVisual } from './rarity.ts';

type Slot = 'A' | 'B' | 'C' | 'D';
const SLOTS: Slot[] = ['A', 'B', 'C', 'D'];

// The five genetic traits, in the fixed order used throughout this file's
// stat-vector math — the same order the radar chart displays them in:
// Sweetness, Size, Yield, Growth, Freshness.
type Stats5 = [number, number, number, number, number];

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}

function statsOf(v: Variety): Stats5 {
  return [v.sweetness, v.size, v.yieldStat, v.growth, v.freshness];
}

function sumStats(s: Stats5): number {
  return s[0] + s[1] + s[2] + s[3] + s[4];
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
// Genetic Budget — a hidden, never-shown-to-the-player soft constraint
// (this is the same hidden-potential/tradeoff mechanism the previous
// 3-stat version used, adapted to all five traits and to the exact
// slot-specific ranges this pass specifies) that keeps breeding from
// becoming "every stat goes up every time." Each candidate's own
// five-stat sum is nudged toward the parents' average budget by a small,
// slot-specific delta, then individually clamped to 0..100 — the SHAPE
// (which traits are strong/weak) comes entirely from the blend/tradeoff/
// wildcard logic above; this budget step only controls the total.
// ------------------------------------------------------------------
const BUDGET_DELTA_RANGE: Record<Slot, [number, number]> = {
  A: [-2, 3],
  B: [-2, 3],
  C: [-3, 5],
  D: [-8, 8],
};
const BUDGET_CAP = 360;

function applyBudgetTarget(raw: Stats5, parentBudget: number, slot: Slot): Stats5 {
  const [dMin, dMax] = BUDGET_DELTA_RANGE[slot];
  const targetBudget = clamp(parentBudget + dMin + Math.random() * (dMax - dMin), 0, BUDGET_CAP);
  const rawBudget = sumStats(raw);
  const scale = rawBudget > 0 ? targetBudget / rawBudget : 1;
  return raw.map((v) => clamp(v * scale)) as Stats5;
}

/**
 * Generates one candidate's five raw genetic stats (before rounding).
 * A/B: mostly resemble one parent with a small blend + light mutation.
 * C: 50/50 blend, then an explicit boost/reduce tradeoff twist.
 * D: each trait independently inherits from whichever parent is chosen
 * per-trait, then gets a substantially larger mutation (5-18 points).
 * All four then get nudged toward the parents' average total budget by a
 * small, slot-specific amount (see applyBudgetTarget).
 */
function generateStats(slot: Slot, pA: Stats5, pB: Stats5, parentBudget: number): Stats5 {
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
  return applyBudgetTarget(raw, parentBudget, slot);
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

export interface BreedResult {
  offspring: OffspringCandidate[];
  newlyDiscoveredColors: AppleColor[];
  newlyDiscoveredPatterns: ApplePattern[];
  newlyDiscoveredVisualIds: AppleAssetId[];
}

export function breedOffspring(parentA: Variety, parentB: Variety, day: number, state: GameState): BreedResult {
  const pA5 = statsOf(parentA);
  const pB5 = statsOf(parentB);
  const parentBudget = (sumStats(pA5) + sumStats(pB5)) / 2;

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
    const [rawSweetness, rawSize, rawYield, rawGrowth, rawFreshness] = generateStats(slot, pA5, pB5, parentBudget);

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

    // Visual rarity roll — entirely separate from the color/pattern
    // mutation above. Decides which of the 10 illustrations this offspring
    // uses; day-gated (see systems/rarity.ts) and independent per slot.
    const visualId = rollOffspringVisual(slot, day, parentA.visualId, parentB.visualId, discoveredVisualIdsWorking);
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

  return { offspring, newlyDiscoveredColors, newlyDiscoveredPatterns, newlyDiscoveredVisualIds };
}
