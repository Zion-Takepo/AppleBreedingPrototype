// Living Orchard secondary motion pass — a small, pure, unit-testable
// spring/damper used to derive inertial "crown lag" from the shared
// WindModel's CHANGE (its frame-to-frame value delta), not its absolute
// value. Kept separate from OrchardTreeLayer.ts's Phaser-coupled classes so
// its math can be verified without a Scene (see
// scripts/verify-orchard-secondary-motion.ts) — the same separation
// orchardWind.ts already uses for the primary wind signal.
//
// NOT a second/independent wind source: every SecondarySpring instance must
// be driven from the ONE shared WindModel's own frame-to-frame value change
// (computed once in OrchardTreeLayer.sync() and passed to every tree) — see
// PROJECT.md "Living Orchard Motion Prototype" and the secondary-motion
// pass notes there.

const SNAP_EPS = 0.0005;

export interface SecondarySpringTuning {
  /** Spring stiffness — higher pulls `disp` back toward 0 faster. */
  stiffness: number;
  /** Spring damping — higher means less overshoot/ringing. */
  damping: number;
  /** Wind-velocity magnitude (signal units/second) treated as "the strongest ordinary gust transition" for normalization — see DEFAULT_SECONDARY_SPRING_TUNING. */
  referenceVelocity: number;
  /** Clamp on the normalized excitation, so a stray dt spike or unusually sharp gust can never overdrive the spring. */
  excitationClamp: number;
  /** Defensive clamp on `disp` itself, independent of excitation — guards against any residual runaway. */
  dispClamp: number;
  /** Max dt fed into the integration step — guards a frame-rate hitch/tab-switch from destabilizing the spring. */
  maxDtSeconds: number;
}

// referenceVelocity ≈ the peak rate-of-change orchardWind.ts's own gust
// envelope can produce: envelope(t) = peak * sin(pi * t / duration), whose
// derivative peaks at peak * pi / duration. With GUST_PEAK_MAX (1.4) and
// GUST_DURATION_MIN_S (1.5) that's ~2.9/s; 3.0 leaves a little headroom.
// stiffness/damping give a damping ratio of damping / (2 * sqrt(stiffness))
// ≈ 0.85 — close to critical, so a strong transition produces only a small,
// quick overshoot rather than a visible bounce (see PROJECT.md anti-jelly
// rules).
export const DEFAULT_SECONDARY_SPRING_TUNING: SecondarySpringTuning = {
  stiffness: 30,
  damping: 9.3,
  referenceVelocity: 3.0,
  excitationClamp: 1.5,
  dispClamp: 1.2,
  maxDtSeconds: 0.1,
};

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * One damped spring-mass excited by wind CHANGE. `value` settles to EXACTLY
 * 0 whenever `windVelocity` has been 0 for a little while (steady or calm
 * wind) and only moves away from 0 while the wind is actively changing — it
 * never oscillates on its own under a sustained, unchanging excitation, and
 * a constant/steady wind (windVelocity ~ 0) never produces perpetual motion.
 */
export class SecondarySpring {
  private disp = 0;
  private vel = 0;
  private readonly tuning: SecondarySpringTuning;

  constructor(tuning: SecondarySpringTuning = DEFAULT_SECONDARY_SPRING_TUNING) {
    this.tuning = tuning;
  }

  /**
   * Advances the spring one frame given the shared wind's current rate of
   * change (signal units/second — e.g. WindModel.value delta / dt) and
   * returns the resulting normalized displacement (bounded to roughly
   * ±dispClamp, exactly 0 at rest).
   */
  update(windVelocity: number, dtSeconds: number): number {
    const { stiffness, damping, referenceVelocity, excitationClamp, dispClamp, maxDtSeconds } = this.tuning;
    const dt = clamp(dtSeconds, 0, maxDtSeconds);
    const normalized = clamp(windVelocity / referenceVelocity, -excitationClamp, excitationClamp);
    // Semi-implicit (symplectic) Euler — update velocity first, then use the
    // NEW velocity to update position. Numerically stable for oscillators at
    // the dt ranges this project runs at, unlike naive explicit Euler.
    const accel = normalized * stiffness - stiffness * this.disp - damping * this.vel;
    this.vel += accel * dt;
    this.disp += this.vel * dt;
    this.disp = clamp(this.disp, -dispClamp, dispClamp);
    if (Math.abs(this.disp) < SNAP_EPS && Math.abs(this.vel) < SNAP_EPS) {
      this.disp = 0;
      this.vel = 0;
    }
    return this.disp;
  }

  get value(): number {
    return this.disp;
  }
}
