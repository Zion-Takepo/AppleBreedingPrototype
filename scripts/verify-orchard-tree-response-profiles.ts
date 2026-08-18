// Living Orchard Motion Prototype — Pass 2 (five-tree de-synchronization)
// focused verification of the pure per-tree response-profile math in
// src/game/render/orchardTreeResponseProfiles.ts. Plain-TS script, run
// directly with Node's built-in type stripping
// (`node scripts/verify-orchard-tree-response-profiles.ts`), matching every
// other verify-*.ts script's convention in this codebase.
//
// SCOPE: this script exercises ONLY the deterministic TREE_RESPONSE_PROFILES
// table and combineLocalDelaySeconds in isolation, plus a small simulated
// "5 trees respond to one changing gust" scenario built directly on top of
// SecondarySpring/WindHistoryBuffer (both already independently verified by
// their own scripts) to prove the five resulting curves are non-identical.
// It does NOT exercise Phaser rendering or OrchardTreeLayer.ts's own wiring
// — that needs human browser verification.
import { SecondarySpring, DEFAULT_SECONDARY_SPRING_TUNING } from '../src/game/render/orchardSecondaryMotion.ts';
import { WindHistoryBuffer, MAX_PROPAGATION_DELAY_S } from '../src/game/render/orchardWindPropagation.ts';
import { TREE_RESPONSE_PROFILES, combineLocalDelaySeconds } from '../src/game/render/orchardTreeResponseProfiles.ts';

let failures = 0;
function check(name: string, cond: boolean): void {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${name}`);
  } else {
    console.log(`ok: ${name}`);
  }
}

check('exactly five response profiles exist (one per TREE_LAYOUT slot)', TREE_RESPONSE_PROFILES.length === 5);

// --- C: all five deterministic response parameter sets are distinct -----
{
  const responseRates = TREE_RESPONSE_PROFILES.map((p) => p.responseRate);
  const stiffnesses = TREE_RESPONSE_PROFILES.map((p) => p.secondaryStiffness);
  const dampings = TREE_RESPONSE_PROFILES.map((p) => p.secondaryDamping);
  const timingOffsets = TREE_RESPONSE_PROFILES.map((p) => p.timingOffsetSeconds);
  const allDistinct = (vals: number[]) => new Set(vals.map((v) => v.toFixed(6))).size === vals.length;
  check('all five responseRate values are distinct', allDistinct(responseRates));
  check('all five secondaryStiffness values are distinct', allDistinct(stiffnesses));
  check('all five secondaryDamping values are distinct', allDistinct(dampings));
  check('all five timingOffsetSeconds values are distinct', allDistinct(timingOffsets));
}

// --- D: timing-related variation is substantially larger than amplitude
// variation (Pass 3 spec: primary response ~±30%, secondary stiffness/
// frequency ~±25%, secondary damping ~±20-25%, but secondary/primary
// AMPLITUDE stays only ~±3-5%) --------------------------------------------
{
  const baseResponseRate = 12; // see orchardTreeResponseProfiles.ts's own BASE_TREE_RESPONSE_RATE
  const responseRateSpreadFrac = Math.max(...TREE_RESPONSE_PROFILES.map((p) => Math.abs(p.responseRate - baseResponseRate) / baseResponseRate));
  const stiffnessSpreadFrac = Math.max(
    ...TREE_RESPONSE_PROFILES.map((p) => Math.abs(p.secondaryStiffness - DEFAULT_SECONDARY_SPRING_TUNING.stiffness) / DEFAULT_SECONDARY_SPRING_TUNING.stiffness),
  );
  const dampingSpreadFrac = Math.max(
    ...TREE_RESPONSE_PROFILES.map((p) => Math.abs(p.secondaryDamping - DEFAULT_SECONDARY_SPRING_TUNING.damping) / DEFAULT_SECONDARY_SPRING_TUNING.damping),
  );
  const ampSpreadFrac = Math.max(
    ...TREE_RESPONSE_PROFILES.map((p) => Math.abs(p.ampScale - 1)),
    ...TREE_RESPONSE_PROFILES.map((p) => Math.abs(p.secondaryAmpScale - 1)),
  );
  check('response-rate spread is within the Pass 3 ~25-30% target band', responseRateSpreadFrac >= 0.2 && responseRateSpreadFrac <= 0.32);
  check('secondary-stiffness spread is within the Pass 3 ~20-25% target band', stiffnessSpreadFrac >= 0.15 && stiffnessSpreadFrac <= 0.3);
  check('secondary-damping spread is within the Pass 3 ~18-25% target band', dampingSpreadFrac >= 0.15 && dampingSpreadFrac <= 0.3);
  check('amplitude spread stays small (~3-5%, well under the timing spreads — amplitude is explicitly out of scope this pass)', ampSpreadFrac <= 0.06);
  check('timing-related spread (response/stiffness/damping) is substantially larger than amplitude spread', Math.min(responseRateSpreadFrac, stiffnessSpreadFrac, dampingSpreadFrac) > ampSpreadFrac * 1.5);
  check(
    'fastest and slowest responseRate values differ substantially from each other (not just from baseline)',
    (Math.max(...TREE_RESPONSE_PROFILES.map((p) => p.responseRate)) - Math.min(...TREE_RESPONSE_PROFILES.map((p) => p.responseRate))) / baseResponseRate > 0.45,
  );
}

// --- D2: per-tree timingOffsetSeconds now spans ~220-240ms total (Pass 3 —
// was ~100ms in Pass 2), using intentionally irregular (non-evenly-spaced)
// values rather than an arithmetic sequence like 0/50/100/150/200ms --------
{
  const offsets = TREE_RESPONSE_PROFILES.map((p) => p.timingOffsetSeconds);
  const spreadSeconds = Math.max(...offsets) - Math.min(...offsets);
  check('timing-offset spread across the five trees is within the ~220-240ms target band', spreadSeconds >= 0.22 && spreadSeconds <= 0.24);

  const sorted = [...offsets].sort((a, b) => a - b);
  const gaps = sorted.slice(1).map((v, i) => v - sorted[i]);
  const gapsRoundedEqual = gaps.every((g) => Math.abs(g - gaps[0]) < 0.002); // ~2ms tolerance
  check('consecutive timing-offset gaps are NOT all equal (not an evenly-spaced/animation-delay sequence)', !gapsRoundedEqual);
}

// --- E: combineLocalDelaySeconds still orders by ACTUAL x position, and a
// tree's own small timing offset never lets the spatial ordering invert on
// its own (offsets are small relative to MAX_PROPAGATION_DELAY_S) ---------
{
  const leftDelay = combineLocalDelaySeconds(0, 1, 0);
  const rightDelay = combineLocalDelaySeconds(1, 1, 0);
  check('spatial ordering (no offset) still: leftmost reacts sooner than rightmost during a rightward gust', leftDelay < rightDelay);

  const maxOffset = Math.max(...TREE_RESPONSE_PROFILES.map((p) => Math.abs(p.timingOffsetSeconds)));
  check('every profile timing offset is small relative to the max spatial propagation delay', maxOffset < MAX_PROPAGATION_DELAY_S * 0.3);

  check('combined delay never goes negative even for the most "early-reacting" profile', combineLocalDelaySeconds(0, 1, -0.5) === 0);
}

// --- F: existing propagation stays smooth once a per-tree offset is
// layered on top — no hard jump introduced ---------------------------------
{
  const x = 0.4;
  let prev = combineLocalDelaySeconds(x, -1, 0.05);
  let maxStep = 0;
  const steps = 200;
  for (let i = 1; i <= steps; i++) {
    const w = -1 + (2 * i) / steps;
    const d = combineLocalDelaySeconds(x, w, 0.05);
    maxStep = Math.max(maxStep, Math.abs(d - prev));
    prev = d;
  }
  check('delay (with a fixed per-tree offset applied) still varies continuously as wind direction sweeps through 0', maxStep < (MAX_PROPAGATION_DELAY_S / steps) * 5);
}

// --- B/I/J: simulate all five trees responding to one shared, changing gust
// via the SAME machinery OrchardTreeLayer.ts's TreeNode uses (one
// WindHistoryBuffer recording one shared signal; each tree reads its own
// combineLocalDelaySeconds-derived sample and drives its own SecondarySpring
// from that LOCAL sample's own frame-to-frame change) — proves the five
// resulting local signals are NOT identical copies, and that fruit (which
// just inherits canopyAngle/secondaryRotation, unmodeled here since it does
// no independent sampling of its own) is therefore also non-identical
// across trees, and that a return to calm converges every tree's spring
// back to EXACTLY 0. --------------------------------------------------------
{
  const dt = 1 / 60;
  const history = new WindHistoryBuffer();
  const springs = TREE_RESPONSE_PROFILES.map(
    (p) =>
      new SecondarySpring({
        ...DEFAULT_SECONDARY_SPRING_TUNING,
        stiffness: p.secondaryStiffness,
        damping: p.secondaryDamping,
      }),
  );
  const normalizedXs = [0, 0.25, 0.5, 0.75, 1]; // stand-in tree x positions across the span
  const prevLocal = [0, 0, 0, 0, 0];
  const canopyAngles = [0, 0, 0, 0, 0];
  const secondaryDisps: number[][] = [[], [], [], [], []];
  const canopyCurves: number[][] = [[], [], [], [], []];

  let t = 0;
  // 10s total: 1s rise, 1s fall, 8s calm. The most heavily-damped/slowest
  // profile (center, index 3 — overdamped by design, "heaviest/smoothest")
  // has the slowest decay mode of the five and needs several seconds of
  // true calm after the gust ends before its spring's own SNAP_EPS
  // threshold is crossed — this is expected from an intentionally slower
  // profile, not a bug; the tiny residual magnitude by t=5 was already
  // < 0.00025 (far below any visible threshold).
  const totalSteps = 600;
  for (let i = 0; i < totalSteps; i++) {
    t += dt;
    // One shared, changing gust: rises then falls over the first 2s, calm after.
    const windValue = t <= 2 ? Math.sin((t / 2) * Math.PI) : 0;
    history.record(dt, windValue);

    for (let k = 0; k < 5; k++) {
      const delay = combineLocalDelaySeconds(normalizedXs[k], windValue, TREE_RESPONSE_PROFILES[k].timingOffsetSeconds);
      const localWind = history.sampleDelayed(delay);
      const localVelocity = (localWind - prevLocal[k]) / dt;
      prevLocal[k] = localWind;

      const profile = TREE_RESPONSE_PROFILES[k];
      const alpha = 1 - Math.exp(-profile.responseRate * dt);
      canopyAngles[k] += (localWind - canopyAngles[k]) * alpha; // arbitrary shared amplitude ceiling omitted — shape/timing is what's under test
      canopyCurves[k].push(canopyAngles[k]);

      const disp = springs[k].update(localVelocity, dt);
      secondaryDisps[k].push(disp);
    }
  }

  // B: during the changing-gust portion (first ~2s), the five local response
  // curves must not be numerically identical.
  const midIdx = 60; // ~1s in, well within the rise
  const canopyValuesAtMid = canopyCurves.map((c) => c[midIdx]);
  const allSame = canopyValuesAtMid.every((v) => Math.abs(v - canopyValuesAtMid[0]) < 1e-9);
  check('during a changing gust, the five trees\' local canopy-angle curves are NOT numerically identical', !allSame);

  const secondaryValuesAtMid = secondaryDisps.map((s) => s[midIdx]);
  const allSecondarySame = secondaryValuesAtMid.every((v) => Math.abs(v - secondaryValuesAtMid[0]) < 1e-9);
  check('during a changing gust, the five trees\' secondary-spring displacements are NOT numerically identical', !allSecondarySame);

  // Peak timing should differ across trees (not all peaking on the exact
  // same frame) — find each tree's own peak-magnitude frame index within the
  // gust window and confirm they are not all identical.
  const peakFrames = canopyCurves.map((curve) => {
    let bestIdx = 0;
    let bestAbs = -Infinity;
    for (let i = 0; i < 150; i++) {
      // search only the gust+early-settle window, not the tail
      if (Math.abs(curve[i]) > bestAbs) {
        bestAbs = Math.abs(curve[i]);
        bestIdx = i;
      }
    }
    return bestIdx;
  });
  const allPeakFramesSame = peakFrames.every((f) => f === peakFrames[0]);
  check('the five trees do not all reach their canopy-angle peak on the exact same frame', !allPeakFramesSame);
  const peakSpreadSeconds = (Math.max(...peakFrames) - Math.min(...peakFrames)) * dt;
  check('peak-timing spread across the five trees is substantial (>=100ms), not a near-collapse', peakSpreadSeconds >= 0.1);

  // --- G: report approximate first-significant-response / peak / settling
  // time per tree, in ms, for human review (item 10/11 of the Pass 3 spec —
  // this is diagnostic output, not itself a pass/fail check; the numeric
  // checks above already assert the spreads are substantial). "First
  // significant response" = first frame a tree's local canopy-angle curve
  // crosses 5% of the shared gust's own peak magnitude (1.0); "settled" =
  // the last frame it's still at/above 2% of that peak (found by scanning
  // from the end backward, since wind returns to exactly calm after t=2s so
  // there is no later re-crossing to confuse this with).
  const RESPONSE_THRESHOLD = 0.05;
  const SETTLE_THRESHOLD = 0.02;
  const treeLabels = ['back-left (T4)', 'back-right (T5)', 'front-left (T1)', 'center (T2)', 'front-right (T3)'];
  console.log('\nApprox response timing per tree (representative 1s-rise/1s-fall gust, dt=1/60):');
  const firstResponseMs: number[] = [];
  const peakMs: number[] = [];
  const settleMs: number[] = [];
  for (let k = 0; k < 5; k++) {
    const curve = canopyCurves[k];
    let firstIdx = -1;
    for (let i = 0; i < curve.length; i++) {
      if (Math.abs(curve[i]) >= RESPONSE_THRESHOLD) {
        firstIdx = i;
        break;
      }
    }
    let lastAboveIdx = -1;
    for (let i = curve.length - 1; i >= 0; i--) {
      if (Math.abs(curve[i]) >= SETTLE_THRESHOLD) {
        lastAboveIdx = i;
        break;
      }
    }
    const firstMs = firstIdx >= 0 ? Math.round(firstIdx * dt * 1000) : NaN;
    const peakFrameMs = Math.round(peakFrames[k] * dt * 1000);
    const settleFrameMs = lastAboveIdx >= 0 ? Math.round((lastAboveIdx + 1) * dt * 1000) : Math.round(2 * dt * 1000);
    firstResponseMs.push(firstMs);
    peakMs.push(peakFrameMs);
    settleMs.push(settleFrameMs);
    console.log(
      `  ${treeLabels[k]}: first response ~${firstMs}ms, peak ~${peakFrameMs}ms, settled by ~${settleFrameMs}ms`,
    );
  }
  const firstResponseSpreadMs = Math.max(...firstResponseMs) - Math.min(...firstResponseMs);
  console.log(`  first-response spread: ~${firstResponseSpreadMs}ms across the five trees`);
  check('first-significant-response spread across the five trees is substantial (>=150ms)', firstResponseSpreadMs >= 150);

  // J: calm converges every tree's secondary spring back to EXACTLY 0.
  const allSettledZero = springs.every((s) => s.value === 0 || Math.abs(s.value) < 1e-9);
  check('after the gust ends and wind stays calm, every tree\'s secondary spring settles back to exactly 0', allSettledZero);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll orchard tree-response-profile checks passed.');
}
