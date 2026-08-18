// Living Orchard Motion Prototype — spatial wind PROPAGATION pass. Browser
// feedback found all five trees still read as moving in lockstep even after
// the secondary-spring pass, because every tree sampled the exact same
// INSTANTANEOUS WindModel.value on the exact same frame (see
// OrchardTreeLayer.ts's TreeNode.updateSway before this pass). This module
// adds the missing piece: a short rolling history of that ONE shared signal,
// so each tree can sample a slightly time-delayed version of it based on its
// own physical x position — "one gust arriving at five different trees a
// beat apart," not five independent winds.
//
// Deliberately NOT part of orchardWind.ts: WindModel's own gust-generation
// logic/timing is explicitly out of scope for this pass (see PROJECT.md
// Living Orchard notes) — this module only RECORDS and RE-SAMPLES the
// signal WindModel already produces via its public `value` getter, and
// derives a small per-tree turbulence residual from that same recorded
// history. No independent randomness/gust source is introduced here.
//
// Kept Phaser-free/pure, same separation orchardWind.ts and
// orchardSecondaryMotion.ts already use, so it can be unit-verified without
// a Scene (see scripts/verify-orchard-wind-propagation.ts).

/** Recent history depth kept for delayed sampling — must comfortably exceed MAX_PROPAGATION_DELAY_S below. */
export const WIND_HISTORY_SECONDS = 0.9;

// Starting ceiling for the whole visible five-tree span's left-to-right (or
// right-to-left, see computePropagationDelaySeconds) propagation lag —
// within the requested ~0.35-0.5s band. Subtle enough to still read as one
// gust, large enough that five crowns visibly don't move in lockstep.
export const MAX_PROPAGATION_DELAY_S = 0.42;

// Local turbulence (see localTurbulenceOffset below) — small, subordinate,
// band-limited residual so five trees on nearly the same propagation delay
// still don't trace numerically identical curves. NOT an independent gust:
// its amplitude is always a fraction of that tree's own already-delayed
// local wind value, so it can never flip that value's sign on a meaningful
// gust and collapses to exactly 0 at calm (delayed value 0 -> offset 0).
export const LOCAL_TURBULENCE_FRACTION = 0.07; // ~7% of local wind — within the requested 5-10% band
export const LOCAL_TURBULENCE_FREQ_MIN_HZ = 0.15; // ~6.7s period — slow/band-limited, never frame noise
export const LOCAL_TURBULENCE_FREQ_MAX_HZ = 0.35; // ~2.9s period

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

interface HistorySample {
  t: number;
  value: number;
}

/**
 * Rolling time-history of ONE scalar signal (here, always the shared
 * WindModel.value), sampled once per real frame via record(), and re-sampled
 * at an arbitrary past offset via sampleDelayed() with linear interpolation
 * between the two surrounding recorded samples — so a delayed sample is a
 * continuous function of delaySeconds, never a stepped/quantized one (a
 * literal N-tree "step then stop" look is explicitly the thing this pass
 * must avoid).
 */
export class WindHistoryBuffer {
  private samples: HistorySample[] = [];
  private t = 0;
  private readonly historySeconds: number;

  constructor(historySeconds: number = WIND_HISTORY_SECONDS) {
    this.historySeconds = historySeconds;
  }

  /** Records the shared signal's CURRENT value at the current time and evicts anything older than `historySeconds`. */
  record(dtSeconds: number, value: number): void {
    this.t += Math.max(0, dtSeconds);
    this.samples.push({ t: this.t, value });
    const cutoff = this.t - this.historySeconds;
    // Keep one sample at/before the cutoff so interpolation always has a
    // left bound to work from; only drop samples once a newer one already
    // covers the cutoff.
    while (this.samples.length > 2 && this.samples[1].t < cutoff) {
      this.samples.shift();
    }
  }

  /**
   * The shared signal's value `delaySeconds` in the past, linearly
   * interpolated between the two nearest recorded samples. Clamps to the
   * oldest/newest recorded sample outside the buffered range (e.g. the
   * first ~`historySeconds` after construction, before enough history has
   * accumulated) rather than extrapolating.
   */
  sampleDelayed(delaySeconds: number): number {
    if (this.samples.length === 0) return 0;
    const targetT = this.t - Math.max(0, delaySeconds);
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (targetT <= first.t) return first.value;
    if (targetT >= last.t) return last.value;
    for (let i = 1; i < this.samples.length; i++) {
      const a = this.samples[i - 1];
      const b = this.samples[i];
      if (targetT >= a.t && targetT <= b.t) {
        const span = b.t - a.t;
        const frac = span > 1e-9 ? (targetT - a.t) / span : 0;
        return a.value + (b.value - a.value) * frac;
      }
    }
    return last.value;
  }
}

/**
 * How far in the past (seconds) a tree at `normalizedX` (0 = leftmost tree
 * in the visible span, 1 = rightmost — derived from ACTUAL tree x position,
 * never array index) should sample the shared wind history, given the
 * CURRENT instantaneous shared wind value as a stand-in for "which way the
 * dominant gust is currently blowing."
 *
 * `currentWindValue` is clamped to ±1 and mapped to a 0..1 blend: near +1,
 * the gust reads as moving left->right, so low-normalizedX (left) trees get
 * the SMALLEST delay (they feel it first) and high-normalizedX (right) trees
 * get the largest. Near -1 that ordering inverts continuously — there is no
 * hard direction switch, just a continuous blend through 0, so propagation
 * order reverses smoothly as the dominant direction reverses rather than
 * snapping between two fixed orderings.
 */
export function computePropagationDelaySeconds(
  normalizedX: number,
  currentWindValue: number,
  maxDelaySeconds: number = MAX_PROPAGATION_DELAY_S,
): number {
  const x = clamp(normalizedX, 0, 1);
  const direction = clamp(currentWindValue, -1, 1);
  const rightwardBlend = (direction + 1) / 2; // 0 = fully leftward, 1 = fully rightward
  const delayFactor = rightwardBlend * x + (1 - rightwardBlend) * (1 - x);
  return delayFactor * maxDelaySeconds;
}

/**
 * Small band-limited residual layered onto one tree's already-delayed local
 * wind sample, purely so trees sharing a near-identical propagation delay
 * (e.g. two trees close together left-to-right) still don't trace the exact
 * same curve. `localDelayedWindValue` is that tree's OWN delayed sample
 * (from WindHistoryBuffer.sampleDelayed) — the offset's magnitude is always
 * <= `fraction` of it, so it can never reverse a meaningful gust's sign, and
 * is exactly 0 whenever the local wind itself is 0 (i.e. calm).
 */
export function localTurbulenceOffset(
  localWindTimeSeconds: number,
  freqHz: number,
  phaseRad: number,
  localDelayedWindValue: number,
  fraction: number = LOCAL_TURBULENCE_FRACTION,
): number {
  const wave = Math.sin(localWindTimeSeconds * freqHz * Math.PI * 2 + phaseRad);
  return wave * fraction * Math.abs(localDelayedWindValue);
}
