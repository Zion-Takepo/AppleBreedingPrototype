// Orchard BGM playback (see PROJECT.md-in-progress "Orchard BGM" pass and
// CLAUDE.md's `systems/` convention). Deliberately small and Orchard-scoped
// rather than a general music-manager architecture — the only Phaser Sound
// usage in the codebase so far; the existing systems/audio.ts stays a
// separate, unrelated procedural Web Audio module for short UI cues.
//
// Plays an ORDERED PLAYLIST of BGM keys, one track at a time, never
// `loop: true`: a track plays once, then after ORCHARD_BGM_GAP_MS of
// silence the next playlist entry begins (wrapping back to the first once
// the list is exhausted). Today the playlist holds only track 1 — adding
// tracks 2-4 later is just: preload their keys in MainScene.preload() the
// same way as track 1, then append their keys to ORCHARD_BGM_PLAYLIST below
// in the intended play order. Nothing else here needs to change.

import Phaser from 'phaser';
import { TUNING } from '../tuning.ts';

export const ORCHARD_BGM_01_LAUREL_VILLAGE_KEY = 'orchard-bgm-01-laurel-village';
export const ORCHARD_BGM_01_LAUREL_VILLAGE_PATH = 'assets/audio/music/orchard/orchard_bgm_01_laurel_village.mp3';

// Future tracks (files not yet added — do NOT preload these keys until the
// corresponding assets actually exist under public/assets/audio/music/orchard/):
//   orchard-bgm-02-midsummer-garden
//   orchard-bgm-03-peaceful-acoustic
//   orchard-bgm-04-rustic-cottage

/** Ordered Orchard BGM playlist + current index — only track 1 today. */
const ORCHARD_BGM_PLAYLIST: string[] = [ORCHARD_BGM_01_LAUREL_VILLAGE_KEY];

/**
 * Owns exactly one Sound object and one pending gap timer for the Orchard
 * BGM playlist. Meant to be constructed ONCE per persistent OrchardScreen
 * instance and reused across every render()/setVisible() toggle — calling
 * `start()` repeatedly (e.g. every time the ORCHARD tab is reselected) is a
 * safe no-op once playback has already begun, so switching Orchard UI
 * panels or nav tabs never restarts the song or creates a duplicate Sound/
 * listener/timer.
 */
export class OrchardBgmController {
  private readonly scene: Phaser.Scene;
  private sound: Phaser.Sound.BaseSound | null = null;
  private gapTimer: Phaser.Time.TimerEvent | null = null;
  private trackIndex = 0;
  private started = false;
  private destroyed = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** Begins the playlist if it hasn't already started. Safe to call repeatedly. */
  start(): void {
    if (this.started || this.destroyed || ORCHARD_BGM_PLAYLIST.length === 0) return;
    this.started = true;
    // Respect browser autoplay restrictions via Phaser's own Sound Manager
    // unlock handling rather than inventing a second gesture-detection path
    // (systems/audio.ts's unlockAudio() only unlocks its own separate
    // Web Audio cues, not Phaser's Sound Manager) — if still locked, wait
    // for the one 'unlocked' event Phaser fires after the first genuine
    // user gesture, then begin playback normally.
    if (this.scene.sound.locked) {
      this.scene.sound.once(Phaser.Sound.Events.UNLOCKED, () => this.playCurrentTrack());
    } else {
      this.playCurrentTrack();
    }
  }

  private playCurrentTrack(): void {
    if (this.destroyed) return;
    const key = ORCHARD_BGM_PLAYLIST[this.trackIndex];
    const sound = this.scene.sound.add(key, { volume: TUNING.ORCHARD_BGM_VOLUME });
    this.sound = sound;
    // Never `loop: true` — one listener, fired once per track, schedules
    // the gap-then-next-track step itself rather than looping in place.
    sound.once(Phaser.Sound.Events.COMPLETE, () => this.onTrackComplete());
    sound.play();
  }

  private onTrackComplete(): void {
    if (this.destroyed) return;
    this.sound?.destroy();
    this.sound = null;
    this.trackIndex = (this.trackIndex + 1) % ORCHARD_BGM_PLAYLIST.length;
    this.gapTimer = this.scene.time.delayedCall(TUNING.ORCHARD_BGM_GAP_MS, () => this.playCurrentTrack());
  }

  /** Stops playback and clears the pending gap timer — call on teardown so nothing keeps playing/rescheduling after the owning screen/scene is gone. */
  destroy(): void {
    this.destroyed = true;
    this.gapTimer?.remove();
    this.gapTimer = null;
    this.sound?.stop();
    this.sound?.destroy();
    this.sound = null;
  }
}
