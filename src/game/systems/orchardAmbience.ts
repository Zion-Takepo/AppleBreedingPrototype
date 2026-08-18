// Orchard environmental audio: wind-driven leaves rustling + 3 independent,
// randomized bird ambiences. Deliberately small and Orchard-scoped, same
// spirit as systems/orchardBgm.ts (the only other Phaser Sound usage in this
// codebase) — not a general ambience-engine.
//
// LEAVES: volume is driven by the SAME shared WindModel signal that already
// drives the visual canopy sway (see render/orchardWind.ts /
// render/OrchardTreeLayer.ts's `windIntensity` getter) — no separate/
// duplicate wind timer. The signal is smoothed with an asymmetric
// exponential fade (fast-ish attack, slower release) so volume can never pop
// on/off, then applied to one persistent looping Sound while audible; once
// genuinely silent for a sustained stretch, that Sound is stopped/destroyed
// rather than left running inaudibly forever.
//
// BIRDS: intentionally independent of wind. A randomized quiet interval,
// then one of the 3 clips (avoiding an immediate repeat where possible) at a
// subtle volume; only one ever plays at a time. A clip longer than
// ORCHARD_BIRD_LONG_CLIP_THRESHOLD_S plays a short, gently faded excerpt
// window instead of running to completion, so a long ambience recording can
// never dominate the soundscape.
//
// Sound CREATION is wrapped in try/catch everywhere below: `scene.sound.add()`
// throws synchronously if the requested key never actually made it into
// Phaser's audio cache (e.g. a decode failure during MainScene.preload() —
// see AudioFile.onProcess in Phaser's own loader, which logs its own
// `console.error('Error decoding audio: ...')` and simply never populates
// the cache entry for that key). Left unguarded, that throw would propagate
// out of the per-frame update chain (leaves) or the bird scheduler callback
// and silently kill ambience for the rest of the session after the first
// attempt. Matches the "never throw, gracefully no-op" rule
// systems/audio.ts already established for this codebase's other audio.

import Phaser from 'phaser';
import { TUNING } from '../tuning.ts';

export const ORCHARD_LEAVES_KEY = 'orchard-leaves-rustling';
export const ORCHARD_LEAVES_PATH = 'assets/audio/sfx/ambience/orchard/orchard_leaves_rustling.mp3';

export const ORCHARD_BIRD_01_KEY = 'orchard-birds-01-chirping-ambience';
export const ORCHARD_BIRD_01_PATH = 'assets/audio/sfx/ambience/orchard/orchard_birds_01_chirping_ambience.mp3';
export const ORCHARD_BIRD_02_KEY = 'orchard-birds-02-backyard-chirp';
export const ORCHARD_BIRD_02_PATH = 'assets/audio/sfx/ambience/orchard/orchard_birds_02_backyard_chirp.mp3';
export const ORCHARD_BIRD_03_KEY = 'orchard-birds-03-birds-chirping';
export const ORCHARD_BIRD_03_PATH = 'assets/audio/sfx/ambience/orchard/orchard_birds_03_birds_chirping.mp3';

const BIRD_KEYS = [ORCHARD_BIRD_01_KEY, ORCHARD_BIRD_02_KEY, ORCHARD_BIRD_03_KEY];

// TEMPORARY dev-only diagnostic logging (see PROJECT.md-in-progress Orchard
// ambience playback-correctness pass) — gated behind import.meta.env.DEV so
// it never runs in a production build; only logs on actually-interesting
// events (a creation failure, or the very first successful start of each
// source), never per-frame. Safe to delete once ambience is confirmed
// audible in-browser.
function devLog(...args: unknown[]): void {
  if (import.meta.env.DEV) console.log('[orchard-ambience]', ...args);
}
function devError(...args: unknown[]): void {
  if (import.meta.env.DEV) console.error('[orchard-ambience]', ...args);
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// Below this instantaneous smoothed volume the leaves loop is considered
// inaudible; a sustained stretch (LEAVES_SILENCE_HOLD_S) below it is what
// actually tears the Sound down, so a brief dip near a wind zero-crossing
// doesn't thrash the Sound object.
const LEAVES_STOP_THRESHOLD = 0.002;
const LEAVES_SILENCE_HOLD_S = 3;

/** Wind-driven leaves rustling — see module doc comment above. */
class OrchardLeavesController {
  private readonly scene: Phaser.Scene;
  private sound: Phaser.Sound.BaseSound | null = null;
  private currentVolume = 0;
  private silenceTimer = 0;
  private awaitingUnlock = false;
  private destroyed = false;
  private loggedFirstStart = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * Called every real frame with the shared WindModel's current intensity
   * (~0..1, briefly higher during a gust — see OrchardTreeLayer.windIntensity)
   * and elapsed seconds. Owns its own smoothing/lifecycle entirely; the
   * caller just forwards the raw signal.
   */
  update(windIntensity: number, dtSeconds: number): void {
    if (this.destroyed) return;
    const target = Phaser.Math.Clamp(windIntensity, 0, 1) * TUNING.ORCHARD_LEAVES_MAX_VOLUME;
    const fadeS = target > this.currentVolume ? TUNING.ORCHARD_LEAVES_FADE_IN_S : TUNING.ORCHARD_LEAVES_FADE_OUT_S;
    const rate = 1 - Math.exp(-dtSeconds / fadeS);
    this.currentVolume += (target - this.currentVolume) * rate;

    if (this.currentVolume > LEAVES_STOP_THRESHOLD) {
      this.silenceTimer = 0;
      this.ensurePlaying();
      this.setSoundVolume(this.currentVolume);
      return;
    }

    if (this.sound) {
      this.setSoundVolume(this.currentVolume);
      this.silenceTimer += dtSeconds;
      if (this.silenceTimer >= LEAVES_SILENCE_HOLD_S) {
        this.sound.stop();
        this.sound.destroy();
        this.sound = null;
      }
    }
  }

  // `volume` is a runtime property of every real Sound backend (WebAudio,
  // HTML5 Audio) but isn't declared on Phaser's generic `BaseSound` type
  // that `scene.sound.add()` returns — same reason the tween-based volume
  // fades below cast through `Phaser.Sound.WebAudioSound`.
  private setSoundVolume(v: number): void {
    if (this.sound) (this.sound as Phaser.Sound.WebAudioSound).volume = v;
  }

  private ensurePlaying(): void {
    if (this.sound || this.awaitingUnlock || this.destroyed) return;
    const begin = () => {
      this.awaitingUnlock = false;
      if (this.destroyed) return;
      try {
        // `loop: true` — the short clip repeats seamlessly for as long as
        // wind stays active, with no hard "file ended" cut at the loop seam.
        const sound = this.scene.sound.add(ORCHARD_LEAVES_KEY, { loop: true, volume: this.currentVolume });
        this.sound = sound;
        const started = sound.play();
        if (!this.loggedFirstStart) {
          this.loggedFirstStart = true;
          devLog('leaves: Sound created and play() called', { key: ORCHARD_LEAVES_KEY, started, volume: this.currentVolume });
        }
      } catch (err) {
        devError('leaves: failed to create/play Sound — likely missing from audio cache (decode failure?)', { key: ORCHARD_LEAVES_KEY, err });
      }
    };
    if (this.scene.sound.locked) {
      this.awaitingUnlock = true;
      this.scene.sound.once(Phaser.Sound.Events.UNLOCKED, begin);
    } else {
      begin();
    }
  }

  /** DEV-only test hook — see OrchardAmbienceController.debugForceLeavesOn(). Forces the leaves loop on immediately at max volume, bypassing wind-driven fade-in, so playback can be verified independent of wind timing. Never called from production/gameplay code. */
  debugForceOn(): void {
    this.currentVolume = TUNING.ORCHARD_LEAVES_MAX_VOLUME;
    this.silenceTimer = 0;
    this.ensurePlaying();
    this.setSoundVolume(this.currentVolume);
  }

  destroy(): void {
    this.destroyed = true;
    this.sound?.stop();
    this.sound?.destroy();
    this.sound = null;
  }
}

/** Independent, randomized bird ambience — see module doc comment above. */
class OrchardBirdController {
  private readonly scene: Phaser.Scene;
  private timer: Phaser.Time.TimerEvent | null = null;
  private currentSound: Phaser.Sound.BaseSound | null = null;
  private lastKeyIndex = -1;

  private destroyed = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  start(): void {
    if (this.timer || this.destroyed) return;
    this.scheduleNext();
  }

  private scheduleNext(): void {
    if (this.destroyed) return;
    const delayMs = rand(TUNING.ORCHARD_BIRD_INTERVAL_MIN_S, TUNING.ORCHARD_BIRD_INTERVAL_MAX_S) * 1000;
    devLog('birds: next event scheduled in', Math.round(delayMs), 'ms');
    this.timer = this.scene.time.delayedCall(delayMs, () => this.playRandomBird());
  }

  /** `forceIndex` (DEV-only test hook — see debugPlayNow) bypasses both the random pick and the immediate-repeat avoidance. */
  private playRandomBird(forceIndex?: number): void {
    if (this.destroyed) return;
    let index = forceIndex ?? Math.floor(Math.random() * BIRD_KEYS.length);
    if (forceIndex === undefined && BIRD_KEYS.length > 1 && index === this.lastKeyIndex) index = (index + 1) % BIRD_KEYS.length;
    this.lastKeyIndex = index;
    const key = BIRD_KEYS[index];

    const begin = () => {
      if (this.destroyed) return;
      try {
        const sound = this.scene.sound.add(key, { volume: 0 });
        this.currentSound = sound;
        // Per-clip multiplier (see TUNING.ORCHARD_BIRD_VOLUME_MULTIPLIERS —
        // indexed in the same order as BIRD_KEYS above) applied on top of
        // the shared MIN/MAX roll, so Bird 01 can stay at its confirmed-good
        // level while Bird 02/03 play louder without touching the shared
        // range or any other bird-scheduling behavior.
        const multiplier = TUNING.ORCHARD_BIRD_VOLUME_MULTIPLIERS[index] ?? 1.0;
        const targetVolume = rand(TUNING.ORCHARD_BIRD_VOLUME_MIN, TUNING.ORCHARD_BIRD_VOLUME_MAX) * multiplier;
        const duration = sound.duration; // seconds — available immediately, decoded during MainScene.preload()'s load.audio()
        devLog('birds: playing', key, { duration, targetVolume });

        const finish = () => {
          sound.destroy();
          if (this.currentSound === sound) this.currentSound = null;
          this.scheduleNext();
        };

        if (duration > TUNING.ORCHARD_BIRD_LONG_CLIP_THRESHOLD_S) {
          // Long ambience recording — play only a short natural excerpt
          // window rather than the full clip, so it can never dominate the
          // soundscape for a minute or more.
          const windowS = rand(TUNING.ORCHARD_BIRD_EXCERPT_MIN_S, TUNING.ORCHARD_BIRD_EXCERPT_MAX_S);
          const maxStart = Math.max(0, duration - windowS);
          sound.play({ seek: rand(0, maxStart) });
          this.scene.tweens.add({ targets: sound, volume: targetVolume, duration: TUNING.ORCHARD_BIRD_FADE_MS, ease: 'Sine.easeInOut' });
          const holdMs = Math.max(0, windowS * 1000 - TUNING.ORCHARD_BIRD_FADE_MS);
          this.scene.time.delayedCall(holdMs, () => {
            if (this.currentSound !== sound) return;
            this.scene.tweens.add({
              targets: sound,
              volume: 0,
              duration: TUNING.ORCHARD_BIRD_FADE_MS,
              ease: 'Sine.easeInOut',
              onComplete: () => {
                sound.stop();
                finish();
              },
            });
          });
        } else {
          // Naturally short clip — let it play out normally.
          sound.once(Phaser.Sound.Events.COMPLETE, finish);
          sound.play();
          this.scene.tweens.add({ targets: sound, volume: targetVolume, duration: TUNING.ORCHARD_BIRD_FADE_MS, ease: 'Sine.easeInOut' });
        }
      } catch (err) {
        devError('birds: failed to create/play Sound — likely missing from audio cache (decode failure?)', { key, err });
        // Still keep the schedule alive so a single bad clip doesn't
        // permanently silence the other two.
        this.scheduleNext();
      }
    };

    if (this.scene.sound.locked) {
      this.scene.sound.once(Phaser.Sound.Events.UNLOCKED, begin);
    } else {
      begin();
    }
  }

  /** DEV-only test hook — see OrchardAmbienceController.debugPlayBirdNow(). Immediately plays the given bird clip (default index 0 = bird 1), bypassing the randomized interval entirely. Never called from production/gameplay code. */
  debugPlayNow(index = 0): void {
    this.timer?.remove();
    this.timer = null;
    this.playRandomBird(Phaser.Math.Clamp(index, 0, BIRD_KEYS.length - 1));
  }

  destroy(): void {
    this.destroyed = true;
    this.timer?.remove();
    this.timer = null;
    this.currentSound?.stop();
    this.currentSound?.destroy();
    this.currentSound = null;
  }
}

/**
 * Owns both Orchard environmental audio sources for the lifetime of the
 * OrchardScreen that constructs it — one leaves controller (continuously
 * fed the shared wind signal via `updateWind`) and one bird scheduler
 * (started once, runs on its own randomized timer). Mirrors
 * OrchardBgmController's ownership pattern: construct once, `destroy()` on
 * teardown, safe to keep ticking regardless of which nav tab is active
 * (matching every other Orchard ambient timer — cloud drift, wind sway,
 * BGM — already doing exactly that).
 */
export class OrchardAmbienceController {
  private readonly leaves: OrchardLeavesController;
  private readonly birds: OrchardBirdController;

  constructor(scene: Phaser.Scene) {
    this.leaves = new OrchardLeavesController(scene);
    this.birds = new OrchardBirdController(scene);
    this.birds.start();
  }

  /** Called every real frame (see OrchardScreen.updateTrees()) with the shared WindModel's current intensity. */
  updateWind(windIntensity: number, dtSeconds: number): void {
    this.leaves.update(windIntensity, dtSeconds);
  }

  /** DEV-only test hook — forces the leaves loop on immediately, bypassing wind-driven fade-in. Reachable via window.__debugOrchard.debugForceLeavesOn() in dev builds. Never called from production/gameplay code. */
  debugForceLeavesOn(): void {
    this.leaves.debugForceOn();
  }

  /** DEV-only test hook — immediately plays one bird clip, bypassing the randomized interval. Reachable via window.__debugOrchard.debugPlayBirdNow(index) in dev builds. Never called from production/gameplay code. */
  debugPlayBirdNow(index = 0): void {
    this.birds.debugPlayNow(index);
  }

  destroy(): void {
    this.leaves.destroy();
    this.birds.destroy();
  }
}
