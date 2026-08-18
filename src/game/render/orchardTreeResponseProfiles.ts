// Living Orchard Motion Prototype — Pass 2 (five-tree de-synchronization).
// Browser feedback after Pass 1 (restrained secondary-motion ceilings): the
// five trees still read as moving at essentially the same TIME even though
// each already sampled its own delayed/turbulent local wind value (see
// render/orchardWindPropagation.ts). Root cause: the per-tree amplitude and
// response-speed variation OrchardTreeLayer.ts previously used was rolled
// randomly (Math.random()) EACH SESSION from a shared range, which (a) gives
// no guarantee the 5 draws actually spread across that range and (b) is not
// reproducible for review/verification.
//
// This module replaces that random roll with FIVE FIXED, DETERMINISTIC
// per-tree "response character" profiles — same index order as
// OrchardTreeLayer.ts's TREE_LAYOUT (0 back-left, 1 back-right, 2
// front-left, 3 center/front-middle, 4 front-right; see TREE_LAYOUT's own
// comment for why this is insertion order, not left-to-right order). The
// differences live almost entirely in TIMING/INERTIA/SETTLING (primary
// response rate, secondary spring stiffness/damping, a small additional
// local timing offset) — amplitude multipliers stay small (~±5%) on
// purpose, per the "timing difference must be much stronger than amplitude
// difference" direction: five trees should visibly start/peak/reverse/settle
// at different moments while none leans noticeably farther than another.
//
// Kept Phaser-free/pure (same separation orchardWind.ts,
// orchardSecondaryMotion.ts, and orchardWindPropagation.ts already use) so
// the five profiles' shape can be unit-verified without a Scene — see
// scripts/verify-orchard-tree-response-profiles.ts.

import { DEFAULT_SECONDARY_SPRING_TUNING } from './orchardSecondaryMotion.ts';
import { computePropagationDelaySeconds } from './orchardWindPropagation.ts';

export interface TreeResponseProfile {
  /** Small primary-sway amplitude multiplier — kept near 1.0 (±~5%) so no tree leans noticeably farther than another; timing differences below do the actual de-synchronizing work. */
  ampScale: number;
  /** Primary canopy-sway ease rate (higher = reacts AND settles faster — see OrchardTreeLayer.ts's TreeNode.updateSway exponential filter, which uses one rate for both rise and fall). */
  responseRate: number;
  /** Absolute SecondarySpring stiffness for this tree (higher = a "lighter"/snappier crown; lower = more effective inertia/mass). */
  secondaryStiffness: number;
  /** Absolute SecondarySpring damping for this tree (relative to stiffness this sets the settle character: higher = smoother/heavier settle with less bounce, lower = quicker but slightly livelier settle). */
  secondaryDamping: number;
  /** Small secondary-motion output amplitude multiplier — kept to ~±5%, deliberately much smaller than the timing-related spread above/below. */
  secondaryAmpScale: number;
  /**
   * Small additional per-tree reaction lag/lead (seconds), layered ON TOP OF
   * the spatial propagation delay from this tree's own x position (see
   * combineLocalDelaySeconds below) — NOT a substitute for it. Represents
   * "this tree's own character reacts a beat sooner/later," independent of
   * where it physically stands in the row. Small relative to
   * MAX_PROPAGATION_DELAY_S so the spatial ordering (see
   * render/orchardWindPropagation.ts) still dominates and can still reverse
   * cleanly with gust direction.
   */
  timingOffsetSeconds: number;
}

// Baselines the per-tree multipliers above are applied to. Stiffness/damping
// baselines intentionally reuse orchardSecondaryMotion.ts's own tuned
// defaults rather than re-deriving new magic numbers, so this module can
// never silently drift out of sync with the spring's own reference tuning.
const BASE_TREE_RESPONSE_RATE = 12; // primary canopy ease rate baseline — was randomized 5-20 (Pass 1 and earlier), now a fixed center point every profile below varies ±~15-22% from.
const BASE_SECONDARY_STIFFNESS = DEFAULT_SECONDARY_SPRING_TUNING.stiffness;
const BASE_SECONDARY_DAMPING = DEFAULT_SECONDARY_SPRING_TUNING.damping;

// PASS 3 (timing-separation retune — browser feedback: even with Pass 2's
// spatial propagation + fixed per-tree profiles in place, the five trees'
// RESPONSE TIMING still read as too similar; movement magnitude itself was
// explicitly approved and must stay untouched). This pass only widens the
// spread of the fields below — ampScale/secondaryAmpScale stay pinned to the
// same small ~±3-5% band as Pass 2 (movement magnitude is out of scope), and
// the amplitude ceilings in OrchardTreeLayer.ts (CANOPY_SWAY_MAX_DEG,
// CANOPY_DRIFT_MAX_PX, FRUIT_SWAY_MAX_DEG, SECONDARY_ROTATION_MAX_DEG,
// SECONDARY_DRIFT_MAX_PX, SECONDARY_VERTICAL_MAX_PX, FRUIT_SECONDARY_MAX_DEG)
// are untouched by this pass entirely. What widens: timingOffsetSeconds now
// spans roughly -110ms..+120ms (was -50ms..+50ms) for a ~220-240ms total
// spread instead of ~100ms, responseRate now spans roughly ±29% of baseline
// (was ±22%) so the fastest/slowest primary reactions differ more visibly,
// and secondaryStiffness/secondaryDamping spans widen to roughly ±24%/±18-24%
// (were ±18-20%/±15-18%) for a stronger inertia/settle-character difference.
// Values are hand-picked (not a formula over index) specifically to avoid an
// evenly-spaced/"animation-delay" look — see this pass's spec for the
// intentional-irregularity requirement.
//
// Five fixed profiles, one per TREE_LAYOUT index — see this module's doc
// comment for the index<->tree mapping. Each row's inline comment states its
// intended qualitative character alongside the actual % deviation from the
// baselines above, so the numbers stay traceable to the design intent
// instead of reading as arbitrary.
export const TREE_RESPONSE_PROFILES: readonly TreeResponseProfile[] = [
  // index 0 — TREE 4 (back-left): QUICKEST reacting tree of the five, fairly
  // quick settle. responseRate +29% (fastest primary response), secondary
  // stiffness +24% (snappiest/lightest crown), secondary damping -21%
  // (underdamped side -> quicker settle), amplitude +4% only, reacts 108ms
  // earlier than its spatial delay alone — the largest lead of the five.
  {
    ampScale: 1.04,
    responseRate: BASE_TREE_RESPONSE_RATE * 1.29,
    secondaryStiffness: BASE_SECONDARY_STIFFNESS * 1.24,
    secondaryDamping: BASE_SECONDARY_DAMPING * 0.79,
    secondaryAmpScale: 1.04,
    timingOffsetSeconds: -0.108,
  },
  // index 1 — TREE 5 (back-right): slow/heavy reaction, slower/heavier
  // settle. responseRate -24%, secondary stiffness -21% (heavier effective
  // mass), secondary damping +22% (heavier/slower settle), amplitude -4%
  // only, reacts 82ms later than its spatial delay alone.
  {
    ampScale: 0.96,
    responseRate: BASE_TREE_RESPONSE_RATE * 0.76,
    secondaryStiffness: BASE_SECONDARY_STIFFNESS * 0.79,
    secondaryDamping: BASE_SECONDARY_DAMPING * 1.22,
    secondaryAmpScale: 0.96,
    timingOffsetSeconds: 0.082,
  },
  // index 2 — TREE 1 (front-left): fairly quick reaction, stronger damping.
  // responseRate +16% (quick, but noticeably less extreme than back-left's
  // +29%), secondary stiffness +15%, secondary damping +20% (stronger
  // damping -> reacts promptly but settles with minimal bounce), amplitude
  // +3% only, reacts 46ms earlier than its spatial delay alone.
  {
    ampScale: 1.03,
    responseRate: BASE_TREE_RESPONSE_RATE * 1.16,
    secondaryStiffness: BASE_SECONDARY_STIFFNESS * 1.15,
    secondaryDamping: BASE_SECONDARY_DAMPING * 1.2,
    secondaryAmpScale: 1.03,
    timingOffsetSeconds: -0.046,
  },
  // index 3 — TREE 2 (center/front-middle): heaviest / smoothest response.
  // responseRate -18%, secondary stiffness -19% (most effective inertia of
  // the five), secondary damping +24% (overdamped -> smooth, no bounce),
  // amplitude unchanged — reacts a small 14ms later than its spatial delay
  // alone (no longer the fixed zero-offset "anchor" profile Pass 2 used).
  {
    ampScale: 1.0,
    responseRate: BASE_TREE_RESPONSE_RATE * 0.82,
    secondaryStiffness: BASE_SECONDARY_STIFFNESS * 0.81,
    secondaryDamping: BASE_SECONDARY_DAMPING * 1.24,
    secondaryAmpScale: 1.0,
    timingOffsetSeconds: 0.014,
  },
  // index 4 — TREE 3 (front-right): LATEST-responding tree of the five, and
  // the longest residual settle. responseRate -29% (slowest primary
  // response, tied with back-left's lead as the most extreme deviation),
  // secondary stiffness -24%, secondary damping -23% (softest -> the most
  // residual motion before settling), amplitude -3% only, reacts 121ms
  // later than its spatial delay alone — the largest lag of the five.
  {
    ampScale: 0.97,
    responseRate: BASE_TREE_RESPONSE_RATE * 0.71,
    secondaryStiffness: BASE_SECONDARY_STIFFNESS * 0.76,
    secondaryDamping: BASE_SECONDARY_DAMPING * 0.77,
    secondaryAmpScale: 0.97,
    timingOffsetSeconds: 0.121,
  },
];

/**
 * This tree's full local sampling delay: the existing x-position-driven
 * spatial propagation delay (see render/orchardWindPropagation.ts's
 * computePropagationDelaySeconds — UNCHANGED by this module, still derived
 * from actual x position and still reverses with gust direction) plus this
 * tree's own small fixed `timingOffsetSeconds` character trait, clamped to
 * never go negative (WindHistoryBuffer only samples the past). The spatial
 * term still dominates (it can reach MAX_PROPAGATION_DELAY_S, currently
 * several times any single profile's offset), so overall propagation
 * ordering/reversal behavior is unchanged — this only nudges each tree's own
 * timing a small, fixed amount around that spatial baseline.
 */
export function combineLocalDelaySeconds(
  normalizedX: number,
  currentWindValue: number,
  timingOffsetSeconds: number,
  maxDelaySeconds?: number,
): number {
  const spatialDelay = computePropagationDelaySeconds(normalizedX, currentWindValue, maxDelaySeconds);
  return Math.max(0, spatialDelay + timingOffsetSeconds);
}
