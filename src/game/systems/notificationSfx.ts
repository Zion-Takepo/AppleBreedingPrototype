// The single approved positive-notification sound, wired to the existing
// shared toast presentation path (ui/modals.ts ToastQueue) rather than a
// parallel notification system — see ToastQueue.show()'s `playSound` param.
// Same lock-aware playback pattern as systems/orchardBgm.ts: Phaser's own
// Sound Manager unlock handling, not a second gesture-detection path.
//
// Wrapped in try/catch (see systems/orchardAmbience.ts's identical comment
// for why): `scene.sound.play()` creates a Sound via `add()` internally,
// which throws synchronously if the key never made it into Phaser's audio
// cache (e.g. a decode failure during MainScene.preload()) — never left to
// propagate out of a toast's presentation path uncaught.

import Phaser from 'phaser';
import { TUNING } from '../tuning.ts';

export const NOTIFICATION_POSITIVE_KEY = 'notification-positive';
export const NOTIFICATION_POSITIVE_PATH = 'assets/audio/sfx/ui/notification_positive.mp3';

// TEMPORARY dev-only diagnostic logging (see systems/orchardAmbience.ts's
// identical devLog/devError — gated behind import.meta.env.DEV, safe to
// delete once the notification cue is confirmed audible in-browser).
function devLog(...args: unknown[]): void {
  if (import.meta.env.DEV) console.log('[notification-sfx]', ...args);
}
function devError(...args: unknown[]): void {
  if (import.meta.env.DEV) console.error('[notification-sfx]', ...args);
}

/** Plays the notification cue once. `scene.sound.play()` creates and self-destroys its own one-off Sound instance, so no manual instance tracking is needed here. */
export function playNotificationSfx(scene: Phaser.Scene): void {
  const manager = scene.sound;
  const play = () => {
    try {
      const started = manager.play(NOTIFICATION_POSITIVE_KEY, { volume: TUNING.NOTIFICATION_SFX_VOLUME });
      devLog('play() called', { key: NOTIFICATION_POSITIVE_KEY, started, volume: TUNING.NOTIFICATION_SFX_VOLUME });
    } catch (err) {
      devError('failed to create/play Sound — likely missing from audio cache (decode failure?)', { key: NOTIFICATION_POSITIVE_KEY, err });
    }
  };
  if (manager.locked) {
    manager.once(Phaser.Sound.Events.UNLOCKED, play);
  } else {
    play();
  }
}
