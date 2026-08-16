// Living Orchard Motion Prototype — shared ambient wind model.
//
// Presentation only: nothing here reads or writes GameState, and none of it
// affects harvest quantity/value, regrowth timing, or any other gameplay
// number (see OrchardTreeLayer.ts's own tuning-scope comment). Kept in its
// own module because the math is pure/deterministic given elapsed time plus
// one scheduled gust, so it can be unit-verified cheaply without Phaser
// (see scripts/verify-orchard-wind.ts) and reused by every tree/fruit
// without each of them re-deriving gust timing themselves.
//
// Model: base = two slow, incommensurate sine waves (avoids the visibly
// repetitive "1-second sine wave" look a single oscillator gives) plus an
// occasional smooth rise/peak/fall gust envelope. The gust's NEXT start time
// is chosen once when scheduled, then simply waited out — never re-rolled
// every frame.

const BASE_FREQ_A = (Math.PI * 2) / 11.3; // ~11.3s slow primary cycle
const BASE_FREQ_B = (Math.PI * 2) / 7.1; // ~7.1s secondary cycle, different period so the two never repeat in sync
const BASE_AMP_A = 0.62;
const BASE_AMP_B = 0.38;
const BASE_PHASE_B = 1.7;

const GUST_INTERVAL_MIN_S = 10;
const GUST_INTERVAL_MAX_S = 25;
const GUST_DURATION_MIN_S = 1.5;
const GUST_DURATION_MAX_S = 3.0;
// Retuned (Living Orchard retune pass) so a gust reads as a clear ~2-2.5x
// jump over the base breeze's own ~1.0 max amplitude, not just a slightly
// stronger ripple — interval/duration/envelope shape are unchanged.
const GUST_PEAK_MIN = 0.85;
const GUST_PEAK_MAX = 1.4;

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Continuous base breeze value at time t (seconds), no gust — roughly -1..1, never sitting still. */
function baseBreeze(t: number): number {
  return Math.sin(t * BASE_FREQ_A) * BASE_AMP_A + Math.sin(t * BASE_FREQ_B + BASE_PHASE_B) * BASE_AMP_B;
}

interface GustState {
  startT: number;
  durationS: number;
  peak: number;
}

/**
 * Shared ambient wind for the whole Orchard. One instance is owned by
 * OrchardTreeLayer and advanced once per real frame via update(dtSeconds);
 * every tree/fruit samples this same underlying time axis (optionally at a
 * small per-object delay via sampleDelayed) so they all belong to the same
 * wind without ever moving identically.
 */
export class WindModel {
  private t = 0;
  private nextGustAtT: number;
  private activeGust: GustState | null = null;

  constructor() {
    this.nextGustAtT = rand(GUST_INTERVAL_MIN_S, GUST_INTERVAL_MAX_S);
  }

  update(dtSeconds: number): void {
    this.t += dtSeconds;
    if (!this.activeGust && this.t >= this.nextGustAtT) {
      this.activeGust = {
        startT: this.t,
        durationS: rand(GUST_DURATION_MIN_S, GUST_DURATION_MAX_S),
        peak: rand(GUST_PEAK_MIN, GUST_PEAK_MAX) * (Math.random() < 0.5 ? -1 : 1),
      };
    }
    if (this.activeGust && this.t >= this.activeGust.startT + this.activeGust.durationS) {
      this.activeGust = null;
      this.nextGustAtT = this.t + rand(GUST_INTERVAL_MIN_S, GUST_INTERVAL_MAX_S);
    }
  }

  /** Current normalized wind value — roughly -1..1, briefly a bit beyond during a gust peak. */
  get value(): number {
    return this.sampleAt(this.t);
  }

  /** Same shared signal sampled `delaySeconds` in the past — gives each tree/fruit its own phase/lag without a second independent oscillator. */
  sampleDelayed(delaySeconds: number): number {
    return this.sampleAt(this.t - delaySeconds);
  }

  private sampleAt(atT: number): number {
    let v = baseBreeze(atT);
    if (this.activeGust) {
      const localT = atT - this.activeGust.startT;
      if (localT >= 0 && localT <= this.activeGust.durationS) {
        const progress = localT / this.activeGust.durationS;
        const envelope = Math.sin(Math.PI * progress); // smooth rise -> peak -> fall
        v += envelope * this.activeGust.peak;
      }
    }
    return v;
  }

  /** True while a gust is currently rising/peaking/falling. Verification/debug only. */
  get gustActive(): boolean {
    return this.activeGust !== null;
  }

  /** DEV-only: force a gust to begin on the very next update() instead of waiting out the scheduled interval. Never called from production/gameplay code. */
  debugTriggerGust(): void {
    this.activeGust = null;
    this.nextGustAtT = this.t;
  }
}
