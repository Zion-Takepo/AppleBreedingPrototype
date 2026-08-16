// ============================================================
// Exceptional Specimen genetics — PURE GENETIC GENERATION CORE ONLY (see
// PROJECT.md "Exceptional Specimen genetics core"). This module answers
// exactly one question: "given a source Line's five Stats, can we generate
// interesting, valid Exceptional genetic outliers with deterministic/
// testable rules?"
//
// This is a small foundation pass — deliberately NOT wired into Orchard,
// FruitSlot, Specimen inventory, Breed, save, or any UI. No Phaser imports,
// no GameState mutation, no save logic. See scripts/verify-exceptional-
// genetics.ts for the test suite and PROJECT.md for what's NOT yet
// implemented.
//
// Follows this codebase's existing injectable-RNG convention
// (`rng: () => number = Math.random`, see systems/specimen.ts /
// systems/breeding.ts) rather than a bespoke RNG framework, so every
// generator here is exercisable with a queued/seeded function for
// repeatable tests.
// ============================================================
import { TUNING } from '../tuning.ts';
import type { CultivationPolicy } from '../types.ts';
import { clamp } from './breeding.ts';

// The five genetic Stat field names, in the same fixed order used
// throughout the codebase (systems/breeding.ts's Stats5 / the radar chart):
// Sweetness, Size, Yield, Growth, Freshness.
export const STAT_KEYS = ['sweetness', 'size', 'yieldStat', 'growth', 'freshness'] as const;
export type StatKey = (typeof STAT_KEYS)[number];

/** A plain Stat record using the project's existing Variety/BreedingSpecimen field names (never a bespoke tuple type here — see StatKey above). */
export type StatSet = Record<StatKey, number>;

/** Display label per Stat, in STAT_KEYS order — reused by the reveal/UI labeling described above. */
export const STAT_LABELS: Record<StatKey, string> = {
  sweetness: 'SWEETNESS',
  size: 'SIZE',
  yieldStat: 'YIELD',
  growth: 'GROWTH',
  freshness: 'FRESHNESS',
};

export type ExceptionalArchetype = 'TRAIT_OUTLIER' | 'HIGH_POTENTIAL' | 'ELITE_OUTLIER';

/** Human-readable archetype/Stat labels shared by every reveal/UI surface (SpecimenCard, SpecimenDetail, the acquisition toast) — plain data, no Phaser/UI dependency, so this stays reusable without pulling any presentation code into this pure genetics module. */
export const EXCEPTIONAL_ARCHETYPE_LABELS: Record<ExceptionalArchetype, string> = {
  TRAIT_OUTLIER: 'TRAIT OUTLIER',
  HIGH_POTENTIAL: 'HIGH POTENTIAL',
  ELITE_OUTLIER: 'ELITE OUTLIER',
};

/**
 * Pure result metadata for the later integration pass (see PROJECT.md
 * section 10 of the implementation brief) — intentionally NOT added to
 * BreedingSpecimen/Variety yet; this pass owns only this standalone shape.
 */
export interface ExceptionalGenerationResult {
  archetype: ExceptionalArchetype;
  focusStat: StatKey | null;
  stats: StatSet;
  sourceTotal: number;
  total: number;
  totalDelta: number;
}

const TOTAL_CAP: number = TUNING.EXCEPTIONAL_TOTAL_CAP;

function toVector(s: StatSet): number[] {
  return STAT_KEYS.map((k) => s[k]);
}

function fromVector(v: readonly number[]): StatSet {
  const out = {} as StatSet;
  STAT_KEYS.forEach((k, i) => {
    out[k] = v[i];
  });
  return out;
}

export function totalOf(s: StatSet): number {
  return toVector(s).reduce((a, b) => a + b, 0);
}

/** Finite, 0..100 per Stat, TOTAL <= cap — the invariant every generator below must always satisfy. */
export function isValidStatSet(s: StatSet, cap: number = TOTAL_CAP): boolean {
  const v = toVector(s);
  if (v.some((n) => !Number.isFinite(n) || n < 0 || n > 100)) return false;
  return v.reduce((a, b) => a + b, 0) <= cap;
}

function randRange(min: number, max: number, rng: () => number): number {
  return min + rng() * (max - min);
}

/**
 * Uniformly scales `raw` values so their sum matches a (0..raw.length*100
 * clamped) targetBudget, each individually clamped 0..100 — the same hidden-
 * budget mechanism systems/breeding.ts's scaleToBudget already uses,
 * reimplemented locally for variable-length groups (used here on both the
 * full 5-Stat vector and a 4-Stat "every Stat except the focus" subset)
 * since that helper's Stats5 type is a fixed 5-tuple. No unbounded retries —
 * one direct scale-and-clamp pass.
 */
function scaleGroupToBudget(raw: readonly number[], targetBudget: number): number[] {
  const rawSum = raw.reduce((a, b) => a + b, 0);
  const cappedTarget = clamp(targetBudget, 0, raw.length * 100);
  const scale = rawSum > 0 ? cappedTarget / rawSum : 1;
  return raw.map((v) => clamp(v * scale));
}

/**
 * Rounds a raw 5-vector to integers and, in the rare case rounding pushes
 * the sum over `cap` (every upstream budget passed in is already clamped to
 * `cap`, so this only ever corrects a rounding artifact of a point or two),
 * deterministically shaves 1 point at a time off whichever Stat is
 * currently largest until the sum is back at/under cap. Bounded by the
 * (always small) rounding excess and a hard floor at 0 per Stat — never an
 * unbounded or regenerate-and-retry loop.
 */
function finalizeVector(raw: readonly number[], cap: number): number[] {
  const rounded = raw.map((v) => clamp(Math.round(v)));
  let excess = rounded.reduce((a, b) => a + b, 0) - cap;
  while (excess > 0) {
    let maxIdx = 0;
    for (let i = 1; i < rounded.length; i++) if (rounded[i] > rounded[maxIdx]) maxIdx = i;
    if (rounded[maxIdx] <= 0) break; // safety net — nothing left to reduce
    rounded[maxIdx] -= 1;
    excess -= 1;
  }
  return rounded;
}

function buildResult(archetype: ExceptionalArchetype, focusStat: StatKey | null, source: StatSet, rawVector: readonly number[]): ExceptionalGenerationResult {
  const sourceTotal = totalOf(source);
  const finalVector = finalizeVector(rawVector, TOTAL_CAP);
  const stats = fromVector(finalVector);
  const total = finalVector.reduce((a, b) => a + b, 0);
  return { archetype, focusStat, stats, sourceTotal, total, totalDelta: total - sourceTotal };
}

// ------------------------------------------------------------------
// Archetype / focus selection — deterministic cumulative-threshold checks
// against a single injected random01 in [0,1), never a Math.random() call
// buried inside generation logic.
// ------------------------------------------------------------------

/** TRAIT_OUTLIER 60% / HIGH_POTENTIAL 35% / ELITE_OUTLIER 5%, in that cumulative order (see TUNING.EXCEPTIONAL_ARCHETYPE_WEIGHTS). */
export function selectArchetype(random01: number): ExceptionalArchetype {
  const w = TUNING.EXCEPTIONAL_ARCHETYPE_WEIGHTS;
  if (random01 < w.TRAIT_OUTLIER) return 'TRAIT_OUTLIER';
  if (random01 < w.TRAIT_OUTLIER + w.HIGH_POTENTIAL) return 'HIGH_POTENTIAL';
  return 'ELITE_OUTLIER';
}

/**
 * Cultivation-biased focus Stat selection for TRAIT_OUTLIER/ELITE_OUTLIER
 * (see TUNING.EXCEPTIONAL_FOCUS_BIAS's per-policy weight table). A
 * completely separate roll/random01 from selectArchetype above — Cultivation
 * only ever biases WHICH Stat becomes the focus once an Exceptional
 * occurrence has already been decided elsewhere; it never touches
 * EXCEPTIONAL_OCCURRENCE_CHANCE or the archetype weights.
 */
export function selectFocusStat(policy: CultivationPolicy, random01: number): StatKey {
  const weights = TUNING.EXCEPTIONAL_FOCUS_BIAS[policy];
  let cumulative = 0;
  for (const key of STAT_KEYS) {
    cumulative += weights[key];
    if (random01 < cumulative) return key;
  }
  return STAT_KEYS[STAT_KEYS.length - 1]; // float-rounding safety net for random01 ~= 1
}

// ------------------------------------------------------------------
// Archetype generators
// ------------------------------------------------------------------

/**
 * Shared engine behind TRAIT_OUTLIER and ELITE_OUTLIER: raises `focus` by a
 * rolled amount (clamped 0..100 — degrades gracefully, applying only the
 * maximum feasible increase, if the Stat is already near its cap), targets
 * a TOTAL equal to source + a rolled delta (clamped to [the new focus value,
 * EXCEPTIONAL_TOTAL_CAP] — never below the focus Stat alone, never above the
 * hard cap), then redistributes the remaining budget across the other 4
 * Stats proportional to their own source values. At the 360 cap this
 * naturally pulls the other Stats down to compensate for the focus Stat's
 * rise rather than failing — the exact "raise focus, compensate elsewhere"
 * behavior both archetypes need there. TRAIT_OUTLIER passes a small
 * (possibly negative) total-delta range; ELITE_OUTLIER passes a larger,
 * always-positive one — otherwise identical mechanism.
 */
function generateFocusVariant(
  archetype: 'TRAIT_OUTLIER' | 'ELITE_OUTLIER',
  source: StatSet,
  focus: StatKey,
  focusIncreaseRange: readonly [number, number],
  totalDeltaRange: readonly [number, number],
  rng: () => number,
): ExceptionalGenerationResult {
  const sourceTotal = totalOf(source);
  const focusIncrease = randRange(focusIncreaseRange[0], focusIncreaseRange[1], rng);
  const newFocusValue = clamp(source[focus] + focusIncrease);

  const totalDelta = randRange(totalDeltaRange[0], totalDeltaRange[1], rng);
  const targetTotal = clamp(sourceTotal + totalDelta, newFocusValue, TOTAL_CAP);

  const otherKeys = STAT_KEYS.filter((k) => k !== focus);
  const otherRaw = otherKeys.map((k) => source[k]);
  const otherScaled = scaleGroupToBudget(otherRaw, targetTotal - newFocusValue);

  const rawVector = STAT_KEYS.map((k) => (k === focus ? newFocusValue : otherScaled[otherKeys.indexOf(k)]));
  return buildResult(archetype, focus, source, rawVector);
}

/** One Stat becomes strongly elevated (+10..+16, or the max feasible amount) without TOTAL becoming a universal upgrade (target TOTAL delta -1..+3, clamped 0..360). */
export function generateTraitOutlier(source: StatSet, focus: StatKey, rng: () => number = Math.random): ExceptionalGenerationResult {
  return generateFocusVariant(
    'TRAIT_OUTLIER',
    source,
    focus,
    [TUNING.EXCEPTIONAL_TRAIT_FOCUS_INCREASE_MIN, TUNING.EXCEPTIONAL_TRAIT_FOCUS_INCREASE_MAX],
    [TUNING.EXCEPTIONAL_TRAIT_TOTAL_DELTA_MIN, TUNING.EXCEPTIONAL_TRAIT_TOTAL_DELTA_MAX],
    rng,
  );
}

/** Rare jackpot: one Stat strongly elevated (+8..+14) AND TOTAL meaningfully up (+6..+9), both clamped/degraded gracefully near caps. */
export function generateEliteOutlier(source: StatSet, focus: StatKey, rng: () => number = Math.random): ExceptionalGenerationResult {
  return generateFocusVariant(
    'ELITE_OUTLIER',
    source,
    focus,
    [TUNING.EXCEPTIONAL_ELITE_FOCUS_INCREASE_MIN, TUNING.EXCEPTIONAL_ELITE_FOCUS_INCREASE_MAX],
    [TUNING.EXCEPTIONAL_ELITE_TOTAL_DELTA_MIN, TUNING.EXCEPTIONAL_ELITE_TOTAL_DELTA_MAX],
    rng,
  );
}

/**
 * Broadly stronger genetics instead of one specialist Stat: proportionally
 * scales every Stat by the same factor toward a target TOTAL (source +
 * EXCEPTIONAL_HIGH_POTENTIAL_TOTAL_DELTA_MIN..MAX, clamped 0..360). Because
 * the scale is uniform, every nonzero Stat moves in the same direction by an
 * amount proportional to its own current value — the gain is naturally
 * spread rather than concentrated in one Stat. At the 360 cap the scale
 * factor is exactly 1 (source unchanged, totalDelta 0) — the graceful
 * "strongest valid fallback" the brief calls for, since TOTAL genuinely
 * cannot increase further.
 */
export function generateHighPotential(source: StatSet, rng: () => number = Math.random): ExceptionalGenerationResult {
  const sourceTotal = totalOf(source);
  const totalDelta = randRange(TUNING.EXCEPTIONAL_HIGH_POTENTIAL_TOTAL_DELTA_MIN, TUNING.EXCEPTIONAL_HIGH_POTENTIAL_TOTAL_DELTA_MAX, rng);
  const targetTotal = clamp(sourceTotal + totalDelta, 0, TOTAL_CAP);
  const rawVector = scaleGroupToBudget(toVector(source), targetTotal);
  return buildResult('HIGH_POTENTIAL', null, source, rawVector);
}

/**
 * Top-level entry point matching the shape a future integration pass will
 * call: assumes an Exceptional occurrence has already been decided
 * elsewhere (see TUNING.EXCEPTIONAL_OCCURRENCE_CHANCE, not consumed here),
 * and rolls WHICH archetype and (for TRAIT_OUTLIER/ELITE_OUTLIER) WHICH
 * focus Stat before generating. Draws at most 2 random01 values from `rng`,
 * in this fixed order (archetype, then focus if needed), so a queued/seeded
 * `rng` produces fully deterministic, reproducible results.
 */
export function generateExceptionalSpecimen(source: StatSet, policy: CultivationPolicy, rng: () => number = Math.random): ExceptionalGenerationResult {
  const archetype = selectArchetype(rng());
  if (archetype === 'HIGH_POTENTIAL') return generateHighPotential(source, rng);
  const focus = selectFocusStat(policy, rng());
  return archetype === 'TRAIT_OUTLIER' ? generateTraitOutlier(source, focus, rng) : generateEliteOutlier(source, focus, rng);
}
