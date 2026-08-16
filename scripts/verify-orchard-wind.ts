// Living Orchard Motion Prototype — focused verification of the pure wind
// math in src/game/render/orchardWind.ts (see PROJECT.md "Living Orchard
// Motion Prototype"). Plain-TS script, run directly with Node's built-in
// type stripping (`node scripts/verify-orchard-wind.ts`), matching every
// other verify-*.ts script's convention in this codebase.
//
// SCOPE: this script exercises ONLY the deterministic wind signal itself
// (base breeze shape, gust scheduling/envelope, delayed sampling). It does
// NOT exercise Phaser rendering, tree/fruit transforms, hitbox alignment,
// or screen-switch lifecycle — those need human browser verification (see
// the implementation report). No gameplay state (harvest, economy, saves)
// is touched by this pass at all, so no other verify-*.ts script is
// affected.
import { WindModel } from '../src/game/render/orchardWind.ts';

let failures = 0;
function check(name: string, cond: boolean): void {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${name}`);
  } else {
    console.log(`ok: ${name}`);
  }
}

// --- Base breeze never sits still, stays roughly bounded, isn't a single
// repetitive 1-second sine wave ------------------------------------------
{
  const wind = new WindModel();
  const samples: number[] = [];
  // Stay under the documented minimum gust interval (10s) so this block is
  // guaranteed gust-free — it's testing the base breeze shape in isolation.
  for (let i = 0; i < 9 * 60; i++) {
    wind.update(1 / 60);
    samples.push(wind.value);
  }
  const distinctRounded = new Set(samples.map((v) => Math.round(v * 1000))).size;
  check('base breeze produces continuously varying values, not a static value', distinctRounded > 100);
  check('base breeze stays within a sane range absent any gust', samples.every((v) => Math.abs(v) <= 1.05));

  // No exact repetition at a 1-second period (60 frames @ 60fps) — guards
  // against an accidentally-too-simple single-oscillator signal.
  let matches = 0;
  for (let i = 0; i < samples.length - 60; i++) {
    if (Math.abs(samples[i] - samples[i + 60]) < 0.0005) matches++;
  }
  check('signal is not a rigid 1-second-period repeat', matches < samples.length * 0.5);
}

// --- Gust scheduling: fires once within the documented 10-25s window, not
// every frame, and its own duration falls in the documented 1.5-3s range --
{
  const wind = new WindModel();
  let gustFrames = 0;
  let sawGustStart = false;
  let firstGustAtT = -1;
  let lastGustAtT = -1;
  const dt = 1 / 30;
  const totalS = 30;
  let t = 0;
  for (let i = 0; i < totalS / dt; i++) {
    const wasActive = wind.gustActive;
    wind.update(dt);
    t += dt;
    if (wind.gustActive && !wasActive) {
      sawGustStart = true;
      if (firstGustAtT < 0) firstGustAtT = t;
      lastGustAtT = t;
    }
    if (wind.gustActive) gustFrames++;
  }
  check('a gust actually starts within a 30s window', sawGustStart);
  check('first gust starts within the documented 10-25s scheduling window', firstGustAtT >= 10 && firstGustAtT <= 25.5);
  check('gust is only active a minority of the time (occasional, not constant)', gustFrames < (totalS / dt) * 0.5);
  void lastGustAtT;
}

// --- Gust envelope: smooth rise -> peak -> smooth fall, duration in range,
// and it deterministically ends (never stuck active forever) -------------
{
  const wind = new WindModel();
  const dt = 1 / 60;
  wind.update(dt);
  const preGustBaseline = wind.value; // captured just before forcing the gust
  wind.debugTriggerGust();
  const deviations: number[] = [];
  let sawActive = false;
  let framesActive = 0;
  for (let i = 0; i < 60 * 6; i++) {
    wind.update(dt);
    if (wind.gustActive) {
      sawActive = true;
      framesActive++;
      deviations.push(Math.abs(wind.value - preGustBaseline));
    } else if (sawActive) {
      break; // gust ended
    }
  }
  const durationS = framesActive / 60;
  check('debugTriggerGust() starts a gust immediately', sawActive);
  check('gust duration falls within the documented 1.5-3s range', durationS >= 1.4 && durationS <= 3.1);
  check('gust naturally ends (not stuck active)', !wind.gustActive || durationS < 3.1);

  // Envelope shape (deviation from the pre-gust baseline): starts small,
  // rises to a clear peak in the middle, comes back down by the end —
  // never a hard instant jump straight to full strength.
  const maxDeviation = Math.max(...deviations);
  const startDeviation = deviations[0];
  const endDeviation = deviations[deviations.length - 1];
  check(
    'gust deviation rises to a peak well above its own start/end (smooth envelope, not a step)',
    maxDeviation > startDeviation + 0.2 && maxDeviation > endDeviation + 0.2,
  );
}

// --- Delayed sampling: gives a different (but related) value than the
// current instant, which is what per-tree/per-fruit phase offsets rely on -
{
  const wind = new WindModel();
  for (let i = 0; i < 300; i++) wind.update(1 / 60);
  const now = wind.value;
  const delayed = wind.sampleDelayed(1.5);
  check('sampleDelayed(1.5s) differs from the current instant value', Math.abs(now - delayed) > 1e-6);
  check('sampleDelayed(0) matches the current instant value', Math.abs(wind.sampleDelayed(0) - now) < 1e-9);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll orchard wind checks passed.');
}
