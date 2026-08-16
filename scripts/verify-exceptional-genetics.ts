// Exceptional Specimen genetics — PURE GENETIC CORE focused verification
// (see PROJECT.md "Exceptional Specimen genetics core" / the implementation
// brief's "VERIFICATION" section). Plain-TS script, run directly with
// Node's built-in type stripping (`node scripts/verify-exceptional-
// genetics.ts`), matching scripts/verify-specimens.ts's existing convention.
//
// This module is fully pure (no Phaser, no GameState, no localStorage), so
// unlike verify-specimens.ts this script needs no localStorage polyfill and
// never touches Game.ts.
import { TUNING } from '../src/game/tuning.ts';
import type { CultivationPolicy } from '../src/game/types.ts';
import {
  STAT_KEYS,
  generateEliteOutlier,
  generateExceptionalSpecimen,
  generateHighPotential,
  generateTraitOutlier,
  isValidStatSet,
  selectArchetype,
  selectFocusStat,
  totalOf,
  type ExceptionalArchetype,
  type StatKey,
  type StatSet,
} from '../src/game/systems/exceptional.ts';

let checks = 0;
let failures = 0;
function assert(name: string, cond: boolean, detail?: string): void {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

function constRng(v: number): () => number {
  return () => v;
}

function queueRng(values: number[]): () => number {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error('queueRng exhausted — test miscounted rng() calls');
    return values[i++];
  };
}

// Same mulberry32 family used elsewhere in this codebase (systems/economy.ts, scripts/verify-specimens.ts) — reproducible seeded randomness for statistical trials.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stats(sweetness: number, size: number, yieldStat: number, growth: number, freshness: number): StatSet {
  return { sweetness, size, yieldStat, growth, freshness };
}

function deepEqualStats(a: StatSet, b: StatSet): boolean {
  return STAT_KEYS.every((k) => a[k] === b[k]);
}

const MID_SOURCE = stats(55, 58, 60, 54, 56); // TOTAL 283, the PROJECT.md brief's own worked example

// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------
assert('occurrence chance exactly 0.006', TUNING.EXCEPTIONAL_OCCURRENCE_CHANCE === 0.006);
assert('archetype weight TRAIT_OUTLIER exactly 0.60', TUNING.EXCEPTIONAL_ARCHETYPE_WEIGHTS.TRAIT_OUTLIER === 0.6);
assert('archetype weight HIGH_POTENTIAL exactly 0.35', TUNING.EXCEPTIONAL_ARCHETYPE_WEIGHTS.HIGH_POTENTIAL === 0.35);
assert('archetype weight ELITE_OUTLIER exactly 0.05', TUNING.EXCEPTIONAL_ARCHETYPE_WEIGHTS.ELITE_OUTLIER === 0.05);
{
  const sum = TUNING.EXCEPTIONAL_ARCHETYPE_WEIGHTS.TRAIT_OUTLIER + TUNING.EXCEPTIONAL_ARCHETYPE_WEIGHTS.HIGH_POTENTIAL + TUNING.EXCEPTIONAL_ARCHETYPE_WEIGHTS.ELITE_OUTLIER;
  assert('archetype weights sum to 1', Math.abs(sum - 1) < 1e-12, `got ${sum}`);
}

// selectArchetype threshold behavior
assert('selectArchetype(0) -> TRAIT_OUTLIER', selectArchetype(0) === 'TRAIT_OUTLIER');
assert('selectArchetype(0.5999) -> TRAIT_OUTLIER', selectArchetype(0.5999) === 'TRAIT_OUTLIER');
assert('selectArchetype(0.6) -> HIGH_POTENTIAL', selectArchetype(0.6) === 'HIGH_POTENTIAL');
assert('selectArchetype(0.9499) -> HIGH_POTENTIAL', selectArchetype(0.9499) === 'HIGH_POTENTIAL');
assert('selectArchetype(0.95) -> ELITE_OUTLIER', selectArchetype(0.95) === 'ELITE_OUTLIER');
assert('selectArchetype(0.999999) -> ELITE_OUTLIER', selectArchetype(0.999999) === 'ELITE_OUTLIER');

// ---------------------------------------------------------------------------
// FOCUS BIAS
// ---------------------------------------------------------------------------
{
  const w = TUNING.EXCEPTIONAL_FOCUS_BIAS.NORMAL;
  assert('NORMAL boundaries produce equal 20% partitions', STAT_KEYS.every((k) => w[k] === 0.2));
}
{
  const w = TUNING.EXCEPTIONAL_FOCUS_BIAS.SWEETEN;
  assert('SWEETEN boundaries produce 60/10/10/10/10', w.sweetness === 0.6 && w.size === 0.1 && w.yieldStat === 0.1 && w.growth === 0.1 && w.freshness === 0.1);
}
{
  const w = TUNING.EXCEPTIONAL_FOCUS_BIAS.GROW_BIG;
  assert('GROW_BIG boundaries produce Size 60%, others 10%', w.size === 0.6 && w.sweetness === 0.1 && w.yieldStat === 0.1 && w.growth === 0.1 && w.freshness === 0.1);
}

// selectFocusStat boundary sweeps — NORMAL: 0.2 partitions in STAT_KEYS order
{
  const cases: Array<[number, StatKey]> = [
    [0, 'sweetness'],
    [0.1999, 'sweetness'],
    [0.2, 'size'],
    [0.3999, 'size'],
    [0.4, 'yieldStat'],
    [0.5999, 'yieldStat'],
    // 0.6 lands exactly on a float-accumulation edge (0.2+0.2+0.2 = 0.6000000000000001 in
    // IEEE754 double), which is <the growth boundary rather than >= it — nudge past it.
    [0.6000001, 'growth'],
    [0.7999, 'growth'],
    [0.8, 'freshness'],
    [0.999999, 'freshness'],
  ];
  for (const [r, expected] of cases) {
    assert(`selectFocusStat(NORMAL, ${r}) -> ${expected}`, selectFocusStat('NORMAL', r) === expected);
  }
}
// SWEETEN: 60/10/10/10/10
{
  const cases: Array<[number, StatKey]> = [
    [0, 'sweetness'],
    [0.5999, 'sweetness'],
    [0.6, 'size'],
    [0.6999, 'size'],
    [0.7, 'yieldStat'],
    [0.7999, 'yieldStat'],
    [0.8, 'growth'],
    [0.8999, 'growth'],
    [0.9, 'freshness'],
    [0.999999, 'freshness'],
  ];
  for (const [r, expected] of cases) {
    assert(`selectFocusStat(SWEETEN, ${r}) -> ${expected}`, selectFocusStat('SWEETEN', r) === expected);
  }
}
// GROW_BIG: 10/60/10/10/10
{
  const cases: Array<[number, StatKey]> = [
    [0, 'sweetness'],
    [0.0999, 'sweetness'],
    [0.1, 'size'],
    [0.6999, 'size'],
    [0.7, 'yieldStat'],
    [0.7999, 'yieldStat'],
    [0.8, 'growth'],
    [0.8999, 'growth'],
    [0.9, 'freshness'],
    [0.999999, 'freshness'],
  ];
  for (const [r, expected] of cases) {
    assert(`selectFocusStat(GROW_BIG, ${r}) -> ${expected}`, selectFocusStat('GROW_BIG', r) === expected);
  }
}

// Focus selection does not alter occurrence probability: archetype roll is a
// fully independent random01 draw from the focus roll — same first rng()
// value always yields the same archetype regardless of policy/second value.
{
  const policies: CultivationPolicy[] = ['NORMAL', 'SWEETEN', 'GROW_BIG'];
  const archetypesSeen = new Set<ExceptionalArchetype>();
  for (const policy of policies) {
    // 4 values: archetype roll, focus roll (policy-dependent), then 2 generation rolls.
    const result = generateExceptionalSpecimen(MID_SOURCE, policy, queueRng([0.1, 0.5, 0.5, 0.5]));
    archetypesSeen.add(result.archetype);
  }
  assert('archetype roll (random01=0.1) is identical across all Cultivation policies', archetypesSeen.size === 1 && archetypesSeen.has('TRAIT_OUTLIER'), [...archetypesSeen].join(','));
}

// ---------------------------------------------------------------------------
// TRAIT OUTLIER
// ---------------------------------------------------------------------------
{
  // focusIncreaseRoll=0.5 -> mid of [10,16] = 13; totalDeltaRoll=0.5 -> mid of [-1,3] = 1
  const result = generateTraitOutlier(MID_SOURCE, 'size', queueRng([0.5, 0.5]));
  const focusDelta = result.stats.size - MID_SOURCE.size;
  assert('typical mid-range source: focus +10..16', focusDelta >= 10 && focusDelta <= 16, `got ${focusDelta}`);
  assert('typical mid-range source: TOTAL delta -1..+3', result.totalDelta >= -1 && result.totalDelta <= 3, `got ${result.totalDelta}`);
  assert('focus is meaningfully elevated (exact expected +13)', result.stats.size === MID_SOURCE.size + 13, `got ${result.stats.size}`);
  assert('exact expected TOTAL delta (+1)', result.totalDelta === 1, `got ${result.totalDelta}`);
  const nonFocusDecreased = STAT_KEYS.filter((k) => k !== 'size').some((k) => result.stats[k] < MID_SOURCE[k]);
  assert('at least some non-focus Stats may decrease', nonFocusDecreased);
  assert('all Stats 0..100', STAT_KEYS.every((k) => result.stats[k] >= 0 && result.stats[k] <= 100));
  assert('TOTAL <= 360', result.total <= 360);
  const allStatsUp = STAT_KEYS.every((k) => result.stats[k] >= MID_SOURCE[k]);
  assert('output is not automatically a universal upgrade', !allStatsUp);
}

// ---------------------------------------------------------------------------
// HIGH POTENTIAL
// ---------------------------------------------------------------------------
{
  // totalDeltaRoll=0.5 -> mid of [4,7] = 5.5
  const result = generateHighPotential(MID_SOURCE, queueRng([0.5]));
  assert('typical mid-range source: TOTAL +4..+7', result.totalDelta >= 4 && result.totalDelta <= 7, `got ${result.totalDelta}`);
  const positiveCount = STAT_KEYS.filter((k) => result.stats[k] > MID_SOURCE[k]).length;
  assert('gain is distributed across multiple Stats', positiveCount >= 3, `only ${positiveCount} Stats increased`);
  const maxSingleGain = Math.max(...STAT_KEYS.map((k) => result.stats[k] - MID_SOURCE[k]));
  assert('no single Stat carries almost all the gain', maxSingleGain < result.totalDelta, `max single gain ${maxSingleGain} vs totalDelta ${result.totalDelta}`);
  assert('all Stats valid', isValidStatSet(result.stats));
  assert('TOTAL <= 360', result.total <= 360);
}

// ---------------------------------------------------------------------------
// ELITE OUTLIER
// ---------------------------------------------------------------------------
{
  // focusIncreaseRoll=0.5 -> mid of [8,14] = 11; totalDeltaRoll=0.5 -> mid of [6,9] = 7.5
  const result = generateEliteOutlier(MID_SOURCE, 'yieldStat', queueRng([0.5, 0.5]));
  const focusDelta = result.stats.yieldStat - MID_SOURCE.yieldStat;
  assert('typical mid-range source: focus +8..14', focusDelta >= 8 && focusDelta <= 14, `got ${focusDelta}`);
  assert('typical mid-range source: TOTAL gains +6..9', result.totalDelta >= 6 && result.totalDelta <= 9, `got ${result.totalDelta}`);
  assert('exact expected focus delta (+11)', focusDelta === 11, `got ${focusDelta}`);
  assert('all Stats valid', isValidStatSet(result.stats));
  assert('TOTAL <= 360', result.total <= 360);
}

// ---------------------------------------------------------------------------
// EDGE CASES
// ---------------------------------------------------------------------------
const EDGE_SOURCES: Array<{ name: string; source: StatSet }> = [
  { name: 'all Stats around 50', source: stats(50, 50, 50, 50, 50) },
  { name: 'one focus Stat already around 95', source: stats(95, 50, 50, 50, 50) },
  { name: 'TOTAL around 350', source: stats(70, 70, 70, 70, 70) },
  { name: 'TOTAL 358', source: stats(72, 72, 72, 71, 71) },
  { name: 'TOTAL exactly 360', source: stats(72, 72, 72, 72, 72) },
  { name: 'one or more Stats already 100', source: stats(100, 100, 60, 40, 40) },
  { name: 'uneven source 90/30/80/40/70', source: stats(90, 30, 80, 40, 70) },
];

const EDGE_RNG_ROLLS = [0, 0.25, 0.5, 0.75, 0.999999];

function checkValid(label: string, r: ReturnType<typeof generateHighPotential>): void {
  const finite = STAT_KEYS.every((k) => Number.isFinite(r.stats[k]));
  assert(`${label}: finite values only`, finite);
  const noNaN = STAT_KEYS.every((k) => !Number.isNaN(r.stats[k]));
  assert(`${label}: no NaN`, noNaN);
  const noNegative = STAT_KEYS.every((k) => r.stats[k] >= 0);
  assert(`${label}: no negative`, noNegative);
  const noOverCap = STAT_KEYS.every((k) => r.stats[k] <= 100);
  assert(`${label}: no Stat > 100`, noOverCap);
  assert(`${label}: TOTAL <= 360`, r.total <= 360, `got ${r.total}`);
}

for (const { name, source } of EDGE_SOURCES) {
  for (const roll of EDGE_RNG_ROLLS) {
    let threw = false;
    try {
      const trait = generateTraitOutlier(source, 'sweetness', queueRng([roll, roll]));
      checkValid(`TRAIT_OUTLIER [${name}] roll=${roll}`, trait);
      const elite = generateEliteOutlier(source, 'sweetness', queueRng([roll, roll]));
      checkValid(`ELITE_OUTLIER [${name}] roll=${roll}`, elite);
      const high = generateHighPotential(source, queueRng([roll]));
      checkValid(`HIGH_POTENTIAL [${name}] roll=${roll}`, high);
    } catch {
      threw = true;
    }
    assert(`[${name}] roll=${roll}: no throw / no infinite loop`, !threw);
  }
}

// TOTAL 360-specific behavior
{
  const cap360 = stats(72, 72, 72, 72, 72);
  const trait = generateTraitOutlier(cap360, 'sweetness', queueRng([0.5, 1])); // max totalDelta roll (+3) forces the clamp path
  assert('at TOTAL 360: Trait redistributes without breaking the cap', trait.total <= 360 && trait.stats.sweetness > cap360.sweetness);

  const high = generateHighPotential(cap360, queueRng([1])); // max totalDelta roll (+7) also forces the clamp path
  assert('at TOTAL 360: High Potential returns a valid fallback (TOTAL unchanged)', high.total === 360 && high.totalDelta === 0);
  assert('at TOTAL 360: High Potential fallback stats identical to source', deepEqualStats(high.stats, cap360));

  const elite = generateEliteOutlier(cap360, 'sweetness', queueRng([0.5, 1]));
  assert('at TOTAL 360: Elite returns a valid fallback (TOTAL capped, focus still up)', elite.total <= 360 && elite.stats.sweetness > cap360.sweetness);
}

// ---------------------------------------------------------------------------
// DETERMINISM
// ---------------------------------------------------------------------------
{
  const a = generateExceptionalSpecimen(MID_SOURCE, 'SWEETEN', queueRng([0.1, 0.05, 0.5, 0.5]));
  const b = generateExceptionalSpecimen(MID_SOURCE, 'SWEETEN', queueRng([0.1, 0.05, 0.5, 0.5]));
  assert('same source + same injected random inputs gives identical output', a.archetype === b.archetype && a.focusStat === b.focusStat && deepEqualStats(a.stats, b.stats));
}
{
  // Controlled random inputs force each archetype boundary via generateExceptionalSpecimen.
  const trait = generateExceptionalSpecimen(MID_SOURCE, 'NORMAL', queueRng([0, 0, 0.5, 0.5]));
  assert('controlled input forces TRAIT_OUTLIER', trait.archetype === 'TRAIT_OUTLIER');
  const high = generateExceptionalSpecimen(MID_SOURCE, 'NORMAL', queueRng([0.6, 0.5]));
  assert('controlled input forces HIGH_POTENTIAL', high.archetype === 'HIGH_POTENTIAL');
  const elite = generateExceptionalSpecimen(MID_SOURCE, 'NORMAL', queueRng([0.95, 0, 0.5, 0.5]));
  assert('controlled input forces ELITE_OUTLIER', elite.archetype === 'ELITE_OUTLIER');
  // Controlled input forces a specific focus Stat boundary (SWEETEN -> sweetness at random01=0).
  const focusForced = generateExceptionalSpecimen(MID_SOURCE, 'SWEETEN', queueRng([0, 0, 0.5, 0.5]));
  assert('controlled input forces a specific focus Stat boundary', focusForced.focusStat === 'sweetness');
}

// ---------------------------------------------------------------------------
// OPTIONAL: bulk distribution sanity check
// ---------------------------------------------------------------------------
{
  const N = 1000;
  const rng = mulberry32(1234567);
  const counts: Record<ExceptionalArchetype, number> = { TRAIT_OUTLIER: 0, HIGH_POTENTIAL: 0, ELITE_OUTLIER: 0 };
  let anyInvalid = false;
  let anyOverCap = false;
  let traitFocusElevatedCount = 0;
  let highSpreadCount = 0;
  let eliteFocusElevatedCount = 0;

  for (let i = 0; i < N; i++) {
    // Vary the source and policy a little across trials for broader sanity coverage.
    const base = 40 + (i % 40);
    const source = stats(base, base + (i % 7), base - (i % 5), base + (i % 3), base - (i % 4));
    const policy: CultivationPolicy = i % 3 === 0 ? 'SWEETEN' : i % 3 === 1 ? 'GROW_BIG' : 'NORMAL';
    const result = generateExceptionalSpecimen(source, policy, rng);
    counts[result.archetype]++;
    if (!isValidStatSet(result.stats)) anyInvalid = true;
    if (result.total > 360) anyOverCap = true;

    if (result.archetype === 'TRAIT_OUTLIER' && result.focusStat) {
      if (result.stats[result.focusStat] > source[result.focusStat]) traitFocusElevatedCount++;
    }
    if (result.archetype === 'HIGH_POTENTIAL') {
      const positiveCount = STAT_KEYS.filter((k) => result.stats[k] >= source[k]).length;
      if (positiveCount >= 3) highSpreadCount++;
    }
    if (result.archetype === 'ELITE_OUTLIER' && result.focusStat) {
      if (result.stats[result.focusStat] > source[result.focusStat]) eliteFocusElevatedCount++;
    }
  }

  assert(`archetype counts approximately follow 60/35/5 (N=${N})`, counts.TRAIT_OUTLIER > 500 && counts.TRAIT_OUTLIER < 700 && counts.HIGH_POTENTIAL > 280 && counts.HIGH_POTENTIAL < 420 && counts.ELITE_OUTLIER > 10 && counts.ELITE_OUTLIER < 100, JSON.stringify(counts));
  assert('Elite remains rare relative to Trait/High Potential', counts.ELITE_OUTLIER < counts.TRAIT_OUTLIER && counts.ELITE_OUTLIER < counts.HIGH_POTENTIAL);
  assert('no invalid Stats across bulk trial', !anyInvalid);
  assert('no TOTAL > 360 across bulk trial', !anyOverCap);
  assert('Trait outputs usually behave specialist-like (focus elevated)', counts.TRAIT_OUTLIER === 0 || traitFocusElevatedCount / counts.TRAIT_OUTLIER > 0.9, `${traitFocusElevatedCount}/${counts.TRAIT_OUTLIER}`);
  assert('High Potential outputs usually behave broadly improved', counts.HIGH_POTENTIAL === 0 || highSpreadCount / counts.HIGH_POTENTIAL > 0.7, `${highSpreadCount}/${counts.HIGH_POTENTIAL}`);
  assert('Elite outputs usually behave specialist-like (focus elevated)', counts.ELITE_OUTLIER === 0 || eliteFocusElevatedCount / counts.ELITE_OUTLIER > 0.9, `${eliteFocusElevatedCount}/${counts.ELITE_OUTLIER}`);
}

// ---------------------------------------------------------------------------
console.log(`\n${checks - failures}/${checks} checks passed.`);
if (failures > 0) {
  console.error(`${failures} FAILURE(S)`);
  process.exit(1);
} else {
  console.log('All exceptional-genetics checks passed.');
}
