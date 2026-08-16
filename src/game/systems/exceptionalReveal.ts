// ============================================================
// Genetic Exceptional acquisition-reveal TEXT ONLY — pure string logic, no
// Phaser/GameState (see PROJECT.md "Exceptional discovery/reveal UX"). This
// module answers exactly one question: "given a harvested Exceptional
// Specimen and its source Line's CURRENT five Stats (or none, if that Line
// can no longer be found), what should the one-shot acquisition toast say?"
//
// Deliberately separate from systems/exceptional.ts (the genetics core,
// which generates the Specimen's Stats) — this only formats a message from
// an ALREADY-GENERATED Specimen, never rerolls or recomputes genetics.
// ============================================================
import type { BreedingSpecimen } from '../types.ts';
import { EXCEPTIONAL_ARCHETYPE_LABELS, STAT_LABELS, totalOf, type StatSet } from './exceptional.ts';

function statsOfSpecimen(s: BreedingSpecimen): StatSet {
  return { sweetness: s.sweetness, size: s.size, yieldStat: s.yieldStat, growth: s.growth, freshness: s.freshness };
}

function signed(n: number): string {
  const rounded = Math.round(n);
  return rounded >= 0 ? `+${rounded}` : `${rounded}`;
}

/**
 * Multi-line acquisition-reveal text (`\n`-joined — the caller's toast
 * renderer is responsible for actually drawing multiple lines) for a
 * Genetic Exceptional Specimen. `sourceStats` is the source Line's CURRENT
 * five Stats, looked up live by the caller (never a value frozen at
 * generation time) — so the comparison reads as "how does this Specimen
 * compare to what the Line grows today." Pass `undefined` when the source
 * Line can no longer be found (deleted/corrupt save) — this degrades safely
 * to the Specimen's own absolute values instead of a delta, per this pass's
 * explicit "fail safely, never crash" requirement; it never throws.
 *
 * Returns an empty string for a non-Exceptional Specimen (no archetype) —
 * callers should only invoke this once `specimen.exceptionalArchetype` is
 * already known to be set (see MainScene's 'specimenAcquired' handler).
 */
export function formatExceptionalReveal(specimen: BreedingSpecimen, sourceStats: StatSet | undefined): string {
  const archetype = specimen.exceptionalArchetype;
  if (!archetype) return '';

  const specStats = statsOfSpecimen(specimen);
  const specimenTotal = totalOf(specStats);
  const focus = specimen.exceptionalFocusStat ?? null;

  const lines: string[] = ['EXCEPTIONAL APPLE!', '', EXCEPTIONAL_ARCHETYPE_LABELS[archetype]];

  if (sourceStats) {
    const totalDelta = specimenTotal - totalOf(sourceStats);
    if (focus) lines.push(`${STAT_LABELS[focus]} ${signed(specStats[focus] - sourceStats[focus])}`);
    lines.push(`TOTAL ${signed(totalDelta)}`);
  } else {
    // Safe degradation: show absolute values rather than a delta that can't
    // be computed, instead of crashing or hiding the reveal entirely.
    if (focus) lines.push(`${STAT_LABELS[focus]} ${Math.round(specStats[focus])}`);
    lines.push(`TOTAL ${Math.round(specimenTotal)}`);
  }

  lines.push('', 'SAVED AS BREEDING SPECIMEN');
  return lines.join('\n');
}
