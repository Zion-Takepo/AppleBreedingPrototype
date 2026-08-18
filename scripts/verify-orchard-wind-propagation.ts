// Living Orchard Motion Prototype — focused verification of the pure
// spatial wind-propagation math in
// src/game/render/orchardWindPropagation.ts (see PROJECT.md "Living Orchard
// Motion Prototype" spatial wind-propagation pass notes). Plain-TS script,
// run directly with Node's built-in type stripping
// (`node scripts/verify-orchard-wind-propagation.ts`), matching every other
// verify-*.ts script's convention in this codebase.
//
// SCOPE: this script exercises ONLY the deterministic WindHistoryBuffer /
// computePropagationDelaySeconds / localTurbulenceOffset math in isolation.
// It does NOT exercise Phaser rendering, TreeNode/OrchardTreeLayer wiring,
// or browser-visible timing/realism — those need human browser
// verification (see the implementation report). No gameplay state is
// touched by this pass.
import {
  WindHistoryBuffer,
  computePropagationDelaySeconds,
  localTurbulenceOffset,
  MAX_PROPAGATION_DELAY_S,
  LOCAL_TURBULENCE_FRACTION,
} from '../src/game/render/orchardWindPropagation.ts';

let failures = 0;
function check(name: string, cond: boolean): void {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${name}`);
  } else {
    console.log(`ok: ${name}`);
  }
}

// --- WindHistoryBuffer: delayed sampling is continuous (interpolated), not
// a stepped/quantized readout ------------------------------------------
{
  const buf = new WindHistoryBuffer(1.0);
  const dt = 1 / 60;
  // Record a smoothly ramping signal for 1s.
  for (let i = 0; i < 60; i++) {
    buf.record(dt, i / 59); // ramps 0 -> 1
  }
  const a = buf.sampleDelayed(0.3);
  const b = buf.sampleDelayed(0.31);
  const c = buf.sampleDelayed(0.32);
  check('delayed samples change smoothly frame-to-frame (no hard-step jump)', Math.abs(a - b) < 0.05 && Math.abs(b - c) < 0.05);
  check('sampleDelayed(0) matches the most recent recorded value', Math.abs(buf.sampleDelayed(0) - 59 / 59) < 1e-6);
}

// --- WindHistoryBuffer: constant/calm input converges every delayed sample
// to exactly that constant (0 at true calm) ------------------------------
{
  const buf = new WindHistoryBuffer(1.0);
  const dt = 1 / 60;
  for (let i = 0; i < 180; i++) buf.record(dt, 0);
  check('calm (constant-0) history: any delay samples back to exactly 0', buf.sampleDelayed(0.5) === 0 && buf.sampleDelayed(0.9) === 0);
}

// --- WindHistoryBuffer: history depth is bounded (old samples evicted) but
// still long enough to cover the documented max propagation delay --------
{
  const buf = new WindHistoryBuffer(0.9);
  const dt = 1 / 60;
  for (let i = 0; i < 600; i++) buf.record(dt, Math.sin(i * 0.1)); // 10s of history recorded
  const delayed = buf.sampleDelayed(MAX_PROPAGATION_DELAY_S);
  check('buffer can serve the documented max propagation delay after warm-up', Number.isFinite(delayed));
}

// --- computePropagationDelaySeconds: ordering follows ACTUAL x position,
// not an index — leftmost tree gets less delay than rightmost during a
// clearly rightward gust, and the ordering REVERSES for a clearly leftward
// gust (continuous reversal, no hard-coded fixed sequence) --------------
{
  const leftX = 0; // normalizedX = 0 -> leftmost tree
  const rightX = 1; // normalizedX = 1 -> rightmost tree

  const rightwardGust = 1.0; // clearly rightward
  const leftDelayRightward = computePropagationDelaySeconds(leftX, rightwardGust);
  const rightDelayRightward = computePropagationDelaySeconds(rightX, rightwardGust);
  check('rightward gust: left trees react sooner (smaller delay) than right trees', leftDelayRightward < rightDelayRightward);

  const leftwardGust = -1.0; // clearly leftward
  const leftDelayLeftward = computePropagationDelaySeconds(leftX, leftwardGust);
  const rightDelayLeftward = computePropagationDelaySeconds(rightX, leftwardGust);
  check('leftward gust: propagation ordering reverses — right trees react sooner now', rightDelayLeftward < leftDelayLeftward);

  check('max propagation delay stays within the documented ceiling', Math.max(leftDelayRightward, rightDelayRightward, leftDelayLeftward, rightDelayLeftward) <= MAX_PROPAGATION_DELAY_S + 1e-9);
  check('min propagation delay is non-negative', Math.min(leftDelayRightward, rightDelayRightward, leftDelayLeftward, rightDelayLeftward) >= 0);
}

// --- computePropagationDelaySeconds: reversal is continuous, not a snap —
// as wind direction sweeps from -1 to +1, delay for a fixed tree changes
// smoothly, never jumping ---------------------------------------------
{
  const x = 0.15; // some fixed non-center tree position
  let prev = computePropagationDelaySeconds(x, -1);
  let maxStep = 0;
  const steps = 200;
  for (let i = 1; i <= steps; i++) {
    const w = -1 + (2 * i) / steps;
    const d = computePropagationDelaySeconds(x, w);
    maxStep = Math.max(maxStep, Math.abs(d - prev));
    prev = d;
  }
  check('delay varies continuously as wind direction sweeps through 0 (no jump)', maxStep < (MAX_PROPAGATION_DELAY_S / steps) * 5);
}

// --- Tree-local signals are not numerically identical during a changing
// gust, given two different tree x-positions on the same shared history --
{
  const buf = new WindHistoryBuffer(1.0);
  const dt = 1 / 60;
  // A single rightward-moving gust-like ramp, not steady-state.
  for (let i = 0; i < 60; i++) buf.record(dt, Math.sin((i / 60) * Math.PI)); // rises then falls, not constant

  const delayLeft = computePropagationDelaySeconds(0, 1);
  const delayRight = computePropagationDelaySeconds(1, 1);
  const sampleLeft = buf.sampleDelayed(delayLeft);
  const sampleRight = buf.sampleDelayed(delayRight);
  check('two trees at different x positions read numerically different local samples during a changing gust', Math.abs(sampleLeft - sampleRight) > 1e-6);
}

// --- localTurbulenceOffset: exactly 0 at calm (local wind value 0), and
// always subordinate (bounded by `fraction` of the local wind magnitude,
// so it can never flip the sign of a meaningful local wind value) --------
{
  check('turbulence is exactly 0 when the local wind sample itself is 0 (calm)', localTurbulenceOffset(12.34, 0.2, 1.1, 0) === 0);

  let sawNonzero = false;
  let everExceededFraction = false;
  for (let t = 0; t < 20; t += 0.05) {
    const localWind = 0.8; // a meaningful, steady local wind value
    const off = localTurbulenceOffset(t, 0.25, 0.6, localWind);
    if (off !== 0) sawNonzero = true;
    if (Math.abs(off) > LOCAL_TURBULENCE_FRACTION * Math.abs(localWind) + 1e-9) everExceededFraction = true;
  }
  check('turbulence is nonzero at some point against a steady meaningful local wind', sawNonzero);
  check('turbulence magnitude never exceeds the documented fraction of the local wind value', !everExceededFraction);

  // Even at its most adversarial (turbulence pushing directly against the
  // local wind's own sign), the combined local+turbulence value can never
  // cross 0 for a meaningful (non-tiny) local wind, since |offset| <=
  // fraction * |localWind| and fraction < 1.
  const localWind = 0.5;
  const worstCaseOffset = -LOCAL_TURBULENCE_FRACTION * Math.abs(localWind); // most adversarial sign
  check('turbulence cannot reverse the sign of a meaningful local wind value', localWind + worstCaseOffset > 0);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll orchard wind-propagation checks passed.');
}
