// Orchard apple-harvest SFX: a short foliage/rustle one-shot played only
// when a harvest is actually accepted (see render/OrchardTreeLayer.ts's
// shared `hooks.attemptHarvest`, the single choke point every harvest route
// — direct click, hold-and-sweep, and HARVEST ALL — already funnels
// through). Deliberately small and Orchard-scoped, same spirit as
// systems/orchardBgm.ts / systems/orchardAmbience.ts — not a general SFX
// pool/manager.
//
// Two playback modes:
//  - playHarvest(): a single successful direct-click or sweep harvest.
//    Rapid repeats are staggered onto a minimum-spacing grid
//    (TUNING.HARVEST_SFX_MIN_SPACING_MS) rather than either stacking at the
//    exact same instant or being dropped — every accepted harvest still
//    gets an audible voice, just possibly a few ms later.
//  - playBurst(count): HARVEST ALL. Gameplay/state has already fully
//    resolved by the time this is called (see OrchardTreeLayer.
//    harvestAllRemaining) — this only spreads a capped number of voices
//    across a short window so a big harvest reads as one short "rustle-
//    rustle-rustle" impression instead of `count` overlapping copies.
//
// Sound creation is wrapped in try/catch (see orchardAmbience.ts's identical
// comment): `scene.sound.add()` throws synchronously if the key never made
// it into Phaser's audio cache (e.g. a decode failure during preload()) —
// never left to propagate out of a harvest click handler uncaught.

import Phaser from 'phaser';
import { TUNING } from '../tuning.ts';

export const ORCHARD_APPLE_PICK_RUSTLE_KEY = 'orchard-apple-pick-rustle';
export const ORCHARD_APPLE_PICK_RUSTLE_PATH = 'assets/audio/sfx/ambience/orchard/orchard_apple_pick_rustle.mp3';

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function devError(...args: unknown[]): void {
  if (import.meta.env.DEV) console.error('[harvest-sfx]', ...args);
}

export class HarvestSfxController {
  private readonly scene: Phaser.Scene;
  private destroyed = false;
  // Absolute scene-time (ms) the next voice is allowed to start — every
  // playHarvest()/playBurst() slot reserves and advances this, so requests
  // arriving faster than HARVEST_SFX_MIN_SPACING_MS queue onto the next free
  // slot instead of colliding with the previous one.
  private nextSlotMs = -Infinity;
  // Currently-playing voice count — a hard ceiling independent of scheduling,
  // so even deliberately-staggered voices can never pile up past this if
  // several overlapping schedules land close together.
  private activeVoices = 0;
  private pendingTimers: Phaser.Time.TimerEvent[] = [];
  // Per-voice tail-trim fade tweens (see fire()'s HARVEST_SFX_TAIL_KEEP_FRACTION
  // handling below) — tracked separately so destroy() can stop them without
  // touching the scheduling timers above.
  private tailFadeTweens: Phaser.Tweens.Tween[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** A single successful direct-click or sweep harvest. Safe to call at arbitrary rapid frequency. */
  playHarvest(): void {
    this.scheduleVoice();
  }

  /**
   * HARVEST ALL: `count` apples were just harvested (state already
   * resolved) — plays up to HARVEST_SFX_BURST_MAX_VOICES rustles spread
   * across a short randomized window, never one-voice-per-apple for a large
   * harvest.
   */
  playBurst(count: number): void {
    if (this.destroyed || count <= 0) return;
    const voices = Math.min(count, TUNING.HARVEST_SFX_BURST_MAX_VOICES);
    const spreadMs = rand(TUNING.HARVEST_SFX_BURST_SPREAD_MIN_MS, TUNING.HARVEST_SFX_BURST_SPREAD_MAX_MS);
    for (let i = 0; i < voices; i++) {
      const base = voices > 1 ? (spreadMs * i) / (voices - 1) : 0;
      const jitter = rand(-10, 10);
      this.scheduleVoice(Math.max(0, base + jitter));
    }
  }

  /** Reserves the next legal play slot (respecting min spacing) at least `extraDelayMs` from now, and fires a voice there. */
  private scheduleVoice(extraDelayMs = 0): void {
    if (this.destroyed) return;
    const now = this.scene.time.now;
    const earliest = now + extraDelayMs;
    const playAt = Math.max(earliest, this.nextSlotMs);
    this.nextSlotMs = playAt + TUNING.HARVEST_SFX_MIN_SPACING_MS;
    const delay = playAt - now;
    if (delay <= 0) {
      this.fire();
    } else {
      const timer = this.scene.time.delayedCall(delay, () => {
        this.pendingTimers = this.pendingTimers.filter((t) => t !== timer);
        this.fire();
      });
      this.pendingTimers.push(timer);
    }
  }

  private fire(): void {
    if (this.destroyed) return;
    if (this.activeVoices >= TUNING.HARVEST_SFX_MAX_CONCURRENT) return; // drop silently rather than stack past the ceiling
    const volume = TUNING.HARVEST_SFX_VOLUME * rand(1 - TUNING.HARVEST_SFX_VOLUME_JITTER, 1 + TUNING.HARVEST_SFX_VOLUME_JITTER);
    const rate = rand(1 - TUNING.HARVEST_SFX_RATE_JITTER, 1 + TUNING.HARVEST_SFX_RATE_JITTER);
    const manager = this.scene.sound;

    const begin = () => {
      if (this.destroyed) return;
      try {
        const sound = manager.add(ORCHARD_APPLE_PICK_RUSTLE_KEY, { volume, rate });
        this.activeVoices++;
        let finished = false;
        const release = () => {
          if (finished) return;
          finished = true;
          this.activeVoices = Math.max(0, this.activeVoices - 1);
          sound.destroy();
        };
        sound.once(Phaser.Sound.Events.COMPLETE, release);
        sound.once(Phaser.Sound.Events.STOP, release);
        sound.play();

        // Tail trim (see TUNING.HARVEST_SFX_TAIL_KEEP_FRACTION/_FADE_OUT_MS):
        // plays only the first ~74% of the SOURCE clip's own decoded
        // duration — `sound.duration` is available immediately, decoded
        // during MainScene.preload()'s load.audio() (same established use
        // as orchardAmbience.ts's bird excerpts) — rather than a fixed ms
        // guess, then fades out over a short window right at that cut point
        // so the tail melts away rather than reading as an abrupt cut.
        // Divided by this voice's own randomized `rate` to convert
        // source-clip seconds into real wall-clock ms at that playback speed.
        const sourceDurationS = sound.duration;
        if (sourceDurationS > 0) {
          const audibleMs = ((sourceDurationS * TUNING.HARVEST_SFX_TAIL_KEEP_FRACTION) / rate) * 1000;
          const fadeMs = TUNING.HARVEST_SFX_FADE_OUT_MS;
          const holdMs = Math.max(0, audibleMs - fadeMs);
          const tailTimer = this.scene.time.delayedCall(holdMs, () => {
            this.pendingTimers = this.pendingTimers.filter((t) => t !== tailTimer);
            if (finished) return;
            // Sine.easeOut (fast initial drop, long gentle settle toward
            // silence) reads as a natural "melts away" fade rather than a
            // perceptually abrupt cutoff — sound.stop() only fires once this
            // tween's onComplete runs, i.e. strictly after the fade finishes.
            const tween = this.scene.tweens.add({
              targets: sound,
              volume: 0,
              duration: fadeMs,
              ease: 'Sine.easeOut',
              onComplete: () => {
                this.tailFadeTweens = this.tailFadeTweens.filter((tw) => tw !== tween);
                if (!finished) sound.stop();
              },
            });
            this.tailFadeTweens.push(tween);
          });
          this.pendingTimers.push(tailTimer);
        }
      } catch (err) {
        devError('failed to create/play Sound — likely missing from audio cache (decode failure?)', { key: ORCHARD_APPLE_PICK_RUSTLE_KEY, err });
      }
    };
    if (manager.locked) manager.once(Phaser.Sound.Events.UNLOCKED, begin);
    else begin();
  }

  /** Stops future scheduled voices and tail-trim fades — already-playing one-shots simply finish naturally at that point and self-destroy via their own COMPLETE/STOP handlers. */
  destroy(): void {
    this.destroyed = true;
    this.pendingTimers.forEach((t) => t.remove());
    this.pendingTimers = [];
    this.tailFadeTweens.forEach((tw) => tw.stop());
    this.tailFadeTweens = [];
  }
}
