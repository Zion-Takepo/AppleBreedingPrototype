// Smallest local Web Audio solution for three subtle, functional UI cues
// (see PROJECT.md "Small day cues / SFX") — no existing audio infrastructure
// was found anywhere in this codebase, so this is a new, deliberately tiny
// module rather than a general audio framework. NOT ambient BGM, NOT a
// harvest SFX library, NOT external/downloaded assets — every tone is a
// short procedural sine blip synthesized at call time.
//
// Exactly one AudioContext is ever created (lazily, on first use) and never
// recreated. Playback is gated behind `unlockAudio()`, which must be called
// from a genuine user gesture (browser autoplay policy — see MainScene's
// one-time pointerdown listener) before any cue actually plays; calling a
// play*() function before that is a silent no-op, never an error. Every
// failure path (no Web Audio support, context creation/resume failure)
// gracefully no-ops instead of throwing.

let ctx: AudioContext | null = null;
let creationFailed = false;
let unlocked = false;

function getContext(): AudioContext | null {
  if (creationFailed) return null;
  if (ctx) return ctx;
  try {
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      creationFailed = true;
      return null;
    }
    ctx = new Ctor();
    return ctx;
  } catch {
    creationFailed = true;
    return null;
  }
}

/**
 * Call from a genuine user gesture (e.g. the first pointerdown anywhere on
 * the game canvas — see MainScene.create()) to satisfy browser autoplay
 * policy. Safe to call repeatedly/redundantly; a failed resume() simply
 * leaves `unlocked` false so a later gesture can retry.
 */
export function unlockAudio(): void {
  if (unlocked) return;
  const c = getContext();
  if (!c) return;
  c.resume()
    .then(() => {
      unlocked = true;
    })
    .catch(() => {
      // Autoplay still blocked or resume failed — a later gesture retries.
    });
}

interface Note {
  freq: number;
  offset: number;
  duration: number;
}

function playNotes(notes: Note[]): void {
  if (!unlocked) return;
  const c = getContext();
  if (!c) return;
  try {
    for (const n of notes) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = n.freq;
      const t0 = c.currentTime + n.offset;
      // Gentle, brief envelope — never a harsh click/pop.
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.05, t0 + 0.02);
      gain.gain.linearRampToValueAtTime(0, t0 + n.duration);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + n.duration + 0.02);
    }
  } catch {
    // Gracefully no-op — a synthesis failure must never break gameplay.
  }
}

/** Pre-Closing warning cue (17:00 — see PROJECT.md "Pre-Closing warning"). */
export function playPreClosingWarningCue(): void {
  playNotes([{ freq: 660, offset: 0, duration: 0.16 }]);
}

/** Closing-begins cue (automatic 18:00 only — see PROJECT.md "18:00 Closing cue"). */
export function playClosingBeginsCue(): void {
  playNotes([
    { freq: 494, offset: 0, duration: 0.14 },
    { freq: 370, offset: 0.15, duration: 0.22 },
  ]);
}

/** Next-day-begins cue (see PROJECT.md "Day transition fade"). */
export function playNextDayBeginsCue(): void {
  playNotes([
    { freq: 523, offset: 0, duration: 0.13 },
    { freq: 659, offset: 0.12, duration: 0.2 },
  ]);
}
