// Living Orchard secondary motion pass — focused verification of the pure
// spring math in src/game/render/orchardSecondaryMotion.ts (see PROJECT.md
// "Living Orchard Motion Prototype" secondary-motion pass notes). Plain-TS
// script, run directly with Node's built-in type stripping
// (`node scripts/verify-orchard-secondary-motion.ts`), matching every other
// verify-*.ts script's convention in this codebase.
//
// SCOPE: this script exercises ONLY the deterministic SecondarySpring math
// in isolation (rest/calm convergence, boundedness under adversarial input,
// determinism, NaN/dt-spike safety). It does NOT exercise Phaser rendering,
// TreeNode/FruitSlot transforms, or the shared WindModel wiring in
// OrchardTreeLayer.ts's sync() — those need human browser verification (see
// the implementation report). No gameplay state is touched by this pass.
import { SecondarySpring, DEFAULT_SECONDARY_SPRING_TUNING } from '../src/game/render/orchardSecondaryMotion.ts';

let failures = 0;
function check(name: string, cond: boolean): void {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${name}`);
  } else {
    console.log(`ok: ${name}`);
  }
}

// --- At rest (zero excitation forever), the spring never moves ----------
{
  const spring = new SecondarySpring();
  let everNonZero = false;
  for (let i = 0; i < 600; i++) {
    const v = spring.update(0, 1 / 60);
    if (v !== 0) everNonZero = true;
  }
  check('zero wind-velocity forever never produces any displacement', !everNonZero);
}

// --- A single strong transition excites it, then it converges back to
// EXACTLY zero once the excitation stops ---------------------------------
{
  const spring = new SecondarySpring();
  const dt = 1 / 60;
  const peak = spring.update(DEFAULT_SECONDARY_SPRING_TUNING.referenceVelocity, dt);
  check('a strong wind-change excitation moves displacement away from 0', peak !== 0);
  check('displacement stays within the documented normalized ceiling', Math.abs(peak) <= 1.05);

  let lastAbs = Math.abs(peak);
  let sawSmallOvershoot = false;
  let settledExactlyZero = false;
  for (let i = 0; i < 600; i++) {
    const v = spring.update(0, dt);
    if (Math.abs(v) > lastAbs + 1e-6) sawSmallOvershoot = true; // a small bounce past monotonic decay is allowed (spec: "small overshoot")
    lastAbs = Math.abs(v);
    if (v === 0) {
      settledExactlyZero = true;
      break;
    }
  }
  check('displacement converges back to EXACTLY 0 once excitation stops (calm = exact rest)', settledExactlyZero);
  void sawSmallOvershoot; // informational only — a damped-near-critical spring may or may not visibly overshoot; either is valid
}

// --- Sustained (non-transient) excitation settles to a stable, bounded
// value rather than oscillating forever — "steady wind should settle" ----
{
  const spring = new SecondarySpring();
  const dt = 1 / 60;
  const samples: number[] = [];
  for (let i = 0; i < 600; i++) {
    samples.push(spring.update(1.5, dt)); // sustained, unchanging excitation
  }
  const last60 = samples.slice(-60);
  const min = Math.min(...last60);
  const max = Math.max(...last60);
  check('sustained constant excitation settles to a stable value, not endless oscillation', max - min < 0.01);
  check('settled value stays bounded', Math.abs(last60[last60.length - 1]) <= DEFAULT_SECONDARY_SPRING_TUNING.dispClamp + 1e-6);
}

// --- Robustness: adversarial inputs (huge velocity spikes, huge dt from a
// frame hitch, negative dt) never produce NaN/Infinity or an unbounded
// displacement -------------------------------------------------------------
{
  const spring = new SecondarySpring();
  const adversarialVelocities = [1e6, -1e6, Infinity, -Infinity, 0, 500];
  const adversarialDts = [5, 1, -1, 0, 1 / 240];
  let sawBad = false;
  let sawUnbounded = false;
  for (let i = 0; i < adversarialVelocities.length; i++) {
    const v = spring.update(adversarialVelocities[i], adversarialDts[i % adversarialDts.length]);
    if (!Number.isFinite(v)) sawBad = true;
    if (Math.abs(v) > DEFAULT_SECONDARY_SPRING_TUNING.dispClamp + 1e-6) sawUnbounded = true;
  }
  check('adversarial velocity/dt inputs never produce NaN/Infinity', !sawBad);
  check('adversarial velocity/dt inputs never exceed the defensive displacement clamp', !sawUnbounded);
}

// --- Determinism: identical tuning + identical input sequence produces
// identical output sequence (no hidden randomness inside the spring itself,
// e.g. from Math.random) ---------------------------------------------------
{
  const inputs: [number, number][] = Array.from({ length: 120 }, (_, i) => [Math.sin(i * 0.3) * 2, 1 / 60]);
  const a = new SecondarySpring();
  const b = new SecondarySpring();
  const outA = inputs.map(([v, dt]) => a.update(v, dt));
  const outB = inputs.map(([v, dt]) => b.update(v, dt));
  check('identical input sequences produce identical output sequences (pure/deterministic)', outA.every((v, i) => v === outB[i]));
}

// --- Per-tree variation shape: different stiffness/damping tuning (as
// OrchardTreeLayer.ts's ±10% per-tree roll would produce) still converges to
// exactly 0 at calm and stays bounded, i.e. the class is safe across the
// whole ±10% tuning range, not just the exact default -------------------
{
  const variations = [0.9, 1.0, 1.1];
  for (const mult of variations) {
    const spring = new SecondarySpring({
      ...DEFAULT_SECONDARY_SPRING_TUNING,
      stiffness: DEFAULT_SECONDARY_SPRING_TUNING.stiffness * mult,
      damping: DEFAULT_SECONDARY_SPRING_TUNING.damping * mult,
    });
    const dt = 1 / 60;
    for (let i = 0; i < 30; i++) spring.update(2.5, dt); // excite
    let settledExactlyZero = false;
    for (let i = 0; i < 600; i++) {
      if (spring.update(0, dt) === 0) {
        settledExactlyZero = true;
        break;
      }
    }
    check(`±10%-varied tuning (x${mult}) still converges to exactly 0 at calm`, settledExactlyZero);
  }
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll orchard secondary-motion checks passed.');
}
