// Field Rarity + Line Affinity Probability Model V2 verification (Pass 3A —
// see PROJECT.md "Field Rarity + Line Affinity Probability Model V2" / the
// implementation brief's "VERIFICATION" sections 12-16). Plain-TS script,
// run directly with Node's built-in type stripping (`node
// scripts/verify-field-rarity-model.ts`) — no test framework exists in this
// prototype yet, matching scripts/verify-specimens.ts's own convention.
//
// PROBABILITY ENGINE ONLY: this exercises `systems/fieldRarityModel.ts` in
// isolation. It does NOT touch Game.ts, OrchardTreeLayer, save data, or any
// currently-live gameplay path — none of that reads this module yet (see
// the module's own header). Every check here is deterministic (fixed/queued
// rng or pure math on the returned odds) rather than Monte Carlo, per this
// pass's own instructions.
import { TUNING } from '../src/game/tuning.ts';
import type { AppleAssetId } from '../src/game/render/appleAssets.ts';
import {
  FIELD_RARITY_TABLE,
  advanceFirstRareProtectionState,
  firstRareBonusForState,
  getEffectiveRarityOdds,
  getFieldBaseRarityOdds,
  getWithinTierVisualWeights,
  isEpicEligible,
  isRareEligible,
  rollFieldFruitOutcome,
  rollRarity,
  rollVisualWithinRarity,
  type FirstRareProtectionState,
} from '../src/game/systems/fieldRarityModel.ts';

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

function close(a: number, b: number, tol = 1e-9): boolean {
  return Math.abs(a - b) <= tol;
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

// ---------------------------------------------------------------------------
// SECTION 12 — FIELD TABLE
// ---------------------------------------------------------------------------
console.log('\n=== SECTION 12: Field base rarity table ===');
{
  assert('4 field rows exist', FIELD_RARITY_TABLE.length === 4);

  const expected = [
    { common: 0.984, rare: 0.015, epic: 0.001 },
    { common: 0.9815, rare: 0.017, epic: 0.0015 },
    { common: 0.9775, rare: 0.02, epic: 0.0025 },
    { common: 0.9725, rare: 0.024, epic: 0.0035 },
  ];
  expected.forEach((exp, i) => {
    const got = getFieldBaseRarityOdds(i + 1);
    assert(`Field ${i + 1} common`, close(got.common, exp.common), `${got.common}`);
    assert(`Field ${i + 1} rare`, close(got.rare, exp.rare), `${got.rare}`);
    assert(`Field ${i + 1} epic`, close(got.epic, exp.epic), `${got.epic}`);
    assert(`Field ${i + 1} sums to 1`, close(got.common + got.rare + got.epic, 1, 1e-9));
  });

  assert('Field 2 is only modestly better than Field 1', getFieldBaseRarityOdds(2).rare - getFieldBaseRarityOdds(1).rare < 0.01);

  let threw = false;
  try {
    getFieldBaseRarityOdds(5);
  } catch {
    threw = true;
  }
  assert('getFieldBaseRarityOdds(5) throws (no 5th Field)', threw);
}

// ---------------------------------------------------------------------------
// SECTION 13 — AFFINITY (within-tier visual weighting)
// ---------------------------------------------------------------------------
console.log('\n=== SECTION 13: Within-tier Signature / Common Tendency affinity ===');
{
  // R2 Signature with R1-R4 -> weights 1/1.3/1/1, R2 ~= 30.23%
  const rarePool: AppleAssetId[] = ['R1', 'R2', 'R3', 'R4'];
  const wR = getWithinTierVisualWeights(rarePool, 'RARE', 'R2', 'C1');
  assert('R1..R4 weights are 1/1.3/1/1', wR[0] === 1 && close(wR[1], 1.3) && wR[2] === 1 && wR[3] === 1, JSON.stringify(wR));
  const totalR = wR.reduce((a, b) => a + b, 0);
  assert('R2 conditional %% ~= 30.23%%', Math.abs(wR[1] / totalR - 0.3023) < 0.0001);
  assert('R1/R3/R4 conditional %% ~= 23.26%% each', Math.abs(wR[0] / totalR - 0.2326) < 0.0001);

  // E1 Signature with E1/E2 -> weights 1.3/1, E1 ~= 56.52%
  const epicPool: AppleAssetId[] = ['E1', 'E2'];
  const wE = getWithinTierVisualWeights(epicPool, 'EPIC', 'E1', 'C1');
  assert('E1/E2 weights are 1.3/1', close(wE[0], 1.3) && wE[1] === 1);
  const totalE = wE.reduce((a, b) => a + b, 0);
  assert('E1 conditional %% ~= 56.52%%', close(wE[0] / totalE, 1.3 / 2.3, 1e-9) && Math.abs(wE[0] / totalE - 0.5652) < 0.0001);

  // Common tendency C1 only (signature is something else entirely, e.g. R2) -> 1.15/1/1/1
  const commonPool: AppleAssetId[] = ['C1', 'C2', 'C3', 'C4'];
  const wC1 = getWithinTierVisualWeights(commonPool, 'COMMON', 'R2', 'C1');
  assert('Common-tendency-only weights are 1.15/1/1/1', close(wC1[0], 1.15) && wC1[1] === 1 && wC1[2] === 1 && wC1[3] === 1, JSON.stringify(wC1));
  const totalC1 = wC1.reduce((a, b) => a + b, 0);
  assert('tendency visual %% ~= 27.71%%', Math.abs(wC1[0] / totalC1 - 0.2771) < 0.0001);
  assert('other Common visuals %% ~= 24.10%% each', Math.abs(wC1[1] / totalC1 - 0.241) < 0.0001);

  // Common Signature C1 === tendency C1 -> no stacking, weight stays 1.30 (not 2.45/2.6)
  const wSame = getWithinTierVisualWeights(commonPool, 'COMMON', 'C1', 'C1');
  assert('Signature===Tendency: C1 weight is 1.30 (no stacking)', close(wSame[0], 1.3), `${wSame[0]}`);
  assert('Signature===Tendency: others stay at 1', wSame[1] === 1 && wSame[2] === 1 && wSame[3] === 1);

  // Common Signature C1, tendency C2 -> 1.3/1.15/1/1
  const wDiff = getWithinTierVisualWeights(commonPool, 'COMMON', 'C1', 'C2');
  assert('Signature C1 + Tendency C2: weights are 1.3/1.15/1/1', close(wDiff[0], 1.3) && close(wDiff[1], 1.15) && wDiff[2] === 1 && wDiff[3] === 1, JSON.stringify(wDiff));
  const totalDiff = wDiff.reduce((a, b) => a + b, 0);
  assert('normalized C1 %% is 1.3/4.45', close(wDiff[0] / totalDiff, 1.3 / 4.45, 1e-9));
  assert('normalized C2 %% is 1.15/4.45', close(wDiff[1] / totalDiff, 1.15 / 4.45, 1e-9));

  // Future-proofing: a hypothetical extra visual in a tier — no hard-coded
  // per-tier counts, the function must still "just work".
  const hypotheticalPool: AppleAssetId[] = ['C1', 'C2', 'C3', 'C4', 'R1' as AppleAssetId];
  const wHyp = getWithinTierVisualWeights(hypotheticalPool, 'COMMON', 'C1', 'C1');
  assert('5-visual hypothetical Common tier still applies weight correctly', close(wHyp[0], 1.3) && wHyp.slice(1).every((w) => w === 1), JSON.stringify(wHyp));

  // rollVisualWithinRarity respects weights deterministically via queued rng
  const totalW = wDiff.reduce((a, b) => a + b, 0);
  const justUnderC1 = (1.3 - 1e-9) / totalW;
  const justOverC1 = (1.3 + 1e-9) / totalW;
  assert('rollVisualWithinRarity picks C1 just under its cumulative weight', rollVisualWithinRarity(commonPool, wDiff, constRng(justUnderC1)) === 'C1');
  assert('rollVisualWithinRarity picks C2 just over C1s cumulative weight', rollVisualWithinRarity(commonPool, wDiff, constRng(justOverC1)) === 'C2');
}

// ---------------------------------------------------------------------------
// SECTION 14 — RARITY INVARIANCE
// ---------------------------------------------------------------------------
console.log('\n=== SECTION 14: Rarity invariance (Signature never changes Stage A odds) ===');
{
  // getFieldBaseRarityOdds/getEffectiveRarityOdds structurally take no
  // Signature/visualId parameter at all, so a Line's Signature literally
  // cannot reach Stage A's math — prove it by calling with wildly different
  // Signatures and finding identical results for every Field.
  for (let f = 1; f <= 4; f++) {
    const odds = getFieldBaseRarityOdds(f);
    // Same object identity/values regardless of "which Signature the caller
    // has in mind" — since the function has no such parameter, any caller
    // context (C1 signature vs R2 signature vs E1 signature) produces the
    // exact same result.
    const oddsAgain = getFieldBaseRarityOdds(f);
    assert(`Field ${f} base odds identical across calls (no Signature coupling)`, close(odds.common, oddsAgain.common) && close(odds.rare, oddsAgain.rare) && close(odds.epic, oddsAgain.epic));
  }

  const effC1 = getEffectiveRarityOdds(1);
  const effR2 = getEffectiveRarityOdds(1);
  assert('getEffectiveRarityOdds has no Signature param — identical results regardless of caller intent', close(effC1.odds.rare, effR2.odds.rare) && close(effC1.odds.epic, effR2.odds.epic));
}

// ---------------------------------------------------------------------------
// SECTION 15 — FIRST-RARE PROTECTION
// ---------------------------------------------------------------------------
console.log('\n=== SECTION 15: First-Rare discovery protection ===');
{
  assert('Rare ineligible before RARE_UNLOCK_DAY', !isRareEligible(3));
  assert('Rare eligible from RARE_UNLOCK_DAY', isRareEligible(4));
  assert('Epic ineligible before EPIC_UNLOCK_DAY', !isEpicEligible(5));
  assert('Epic eligible from EPIC_UNLOCK_DAY', isEpicEligible(6));

  let state: FirstRareProtectionState = { hasFoundRare: false, missStreak: 0 };

  // Rolls 1-10 (missStreak 0-9 going in) use normal odds exactly.
  for (let roll = 1; roll <= 10; roll++) {
    const bonus = firstRareBonusForState(state);
    assert(`roll ${roll}: no bonus yet (missStreak=${state.missStreak})`, bonus.kind === 'NONE');
    const odds = getEffectiveRarityOdds(1, { firstRareProtection: state });
    assert(`roll ${roll}: Field 1 Rare odds untouched (1.5%%)`, close(odds.odds.rare, 0.015));
    state = advanceFirstRareProtectionState(state, 'COMMON');
  }
  assert('missStreak is 10 after 10 misses', state.missStreak === 10);

  // Roll 11: +0.75pp -> 2.25% (matches PROJECT.md's worked example)
  {
    const bonus = firstRareBonusForState(state);
    assert('roll 11 bonus kind is BONUS', bonus.kind === 'BONUS');
    if (bonus.kind === 'BONUS') assert('roll 11 bonus is +0.75pp', close(bonus.bonusPct, 0.0075));
    const odds = getEffectiveRarityOdds(1, { firstRareProtection: state });
    assert('roll 11 Field 1 Rare = 2.25%%', close(odds.odds.rare, 0.0225));
    assert('roll 11 Field 1 Common reduced accordingly (97.65%%)', close(odds.odds.common, 0.9765));
    assert('roll 11 Field 1 Epic unchanged (0.10%%)', close(odds.odds.epic, 0.001));
    assert('roll 11 odds still sum to 1', close(odds.odds.common + odds.odds.rare + odds.odds.epic, 1));
    state = advanceFirstRareProtectionState(state, 'COMMON');
  }

  // Roll 12: +1.50pp -> 3.00%
  {
    const odds = getEffectiveRarityOdds(1, { firstRareProtection: state });
    assert('roll 12 Field 1 Rare = 3.00%%', close(odds.odds.rare, 0.03));
    state = advanceFirstRareProtectionState(state, 'COMMON');
  }

  // Roll 13: +2.25pp -> 3.75%
  {
    const odds = getEffectiveRarityOdds(1, { firstRareProtection: state });
    assert('roll 13 Field 1 Rare = 3.75%%', close(odds.odds.rare, 0.0375));
    state = advanceFirstRareProtectionState(state, 'COMMON');
  }

  // Continue missing (an Epic result still counts as a miss, per PROJECT.md)
  // up through the 24th miss so the 25th eligible roll is the guarantee.
  for (let roll = 14; roll <= 24; roll++) {
    state = advanceFirstRareProtectionState(state, roll % 5 === 0 ? 'EPIC' : 'COMMON');
  }
  assert('missStreak is 24 after 24 consecutive non-Rare eligible rolls (Epic counted as a miss)', state.missStreak === 24);
  assert('protection still active (no Rare found yet)', !state.hasFoundRare);

  // Roll 25: guaranteed.
  {
    const bonus = firstRareBonusForState(state);
    assert('roll 25 bonus kind is GUARANTEE', bonus.kind === 'GUARANTEE');
    const odds = getEffectiveRarityOdds(1, { firstRareProtection: state });
    assert('roll 25 is a hard guarantee', odds.guaranteed === true);
    assert('roll 25 Rare = 100%%', odds.odds.rare === 1);
    assert('roll 25 Common = 0', odds.odds.common === 0);
    assert('roll 25 Epic = 0', odds.odds.epic === 0);
  }

  // Epic obtained mid-streak does NOT itself satisfy first-Rare discovery —
  // this codebase has no existing progression semantics equating Epic with
  // Rare discovery (see this module's advanceFirstRareProtectionState doc).
  {
    let epicState: FirstRareProtectionState = { hasFoundRare: false, missStreak: 3 };
    epicState = advanceFirstRareProtectionState(epicState, 'EPIC');
    assert('an Epic result does not set hasFoundRare', epicState.hasFoundRare === false);
    assert('an Epic result still advances the miss streak', epicState.missStreak === 4);
  }

  // Once Rare actually appears, protection ends permanently — counter
  // resets/becomes irrelevant, and it never reactivates even after a long
  // subsequent dry spell.
  {
    let afterRare: FirstRareProtectionState = { hasFoundRare: false, missStreak: 15 };
    afterRare = advanceFirstRareProtectionState(afterRare, 'RARE');
    assert('hasFoundRare true immediately after a Rare result', afterRare.hasFoundRare === true);
    assert('missStreak resets to 0 on the Rare result', afterRare.missStreak === 0);
    for (let i = 0; i < 40; i++) afterRare = advanceFirstRareProtectionState(afterRare, 'COMMON');
    assert('protection never reactivates after many further misses', afterRare.hasFoundRare === true);
    const bonus = firstRareBonusForState(afterRare);
    assert('no bonus/guarantee once hasFoundRare is true, however long the dry spell', bonus.kind === 'NONE');
    const odds = getEffectiveRarityOdds(1, { firstRareProtection: afterRare });
    assert('Field 1 odds are back to exactly normal once protection has ended', close(odds.odds.rare, 0.015) && close(odds.odds.common, 0.984) && close(odds.odds.epic, 0.001));
  }

  // Protection is simply not consulted before Rare eligibility (caller
  // omits firstRareProtection entirely pre-Day-4, or never advances the
  // counter for an ineligible roll) — odds stay exactly the Field's base.
  {
    const odds = getEffectiveRarityOdds(2); // no options passed at all
    assert('omitting firstRareProtection leaves Field odds untouched', close(odds.odds.rare, 0.017) && close(odds.odds.common, 0.9815) && close(odds.odds.epic, 0.0015));
  }
}

// ---------------------------------------------------------------------------
// SECTION 16 — REWARDED BOOST
// ---------------------------------------------------------------------------
console.log('\n=== SECTION 16: Rewarded-ad rarity boost ===');
{
  const f1 = getEffectiveRarityOdds(1, { rewardedRarityBoostActive: true });
  assert('Field 1 boosted Rare = 2.25%%', close(f1.odds.rare, 0.0225));
  assert('Field 1 boosted Epic = 0.15%%', close(f1.odds.epic, 0.0015));
  assert('Field 1 boosted Common = 97.60%%', close(f1.odds.common, 0.976));
  assert('Field 1 boosted odds sum to 1', close(f1.odds.common + f1.odds.rare + f1.odds.epic, 1));

  const f4 = getEffectiveRarityOdds(4, { rewardedRarityBoostActive: true });
  assert('Field 4 boosted Rare = 3.60%%', close(f4.odds.rare, 0.036));
  assert('Field 4 boosted Epic = 0.525%%', close(f4.odds.epic, 0.00525));
  assert('Field 4 boosted Common = 95.875%%', close(f4.odds.common, 0.95875));

  // No double-stacking: boolean flag, not a count/multiplier stack — calling
  // twice with the flag true is identical to calling it once.
  const f1Boosted = getEffectiveRarityOdds(1, { rewardedRarityBoostActive: true });
  const f1BoostedAgain = getEffectiveRarityOdds(1, { rewardedRarityBoostActive: true });
  assert('boost does not compound across repeated calls with the same flag', close(f1Boosted.odds.rare, f1BoostedAgain.odds.rare));

  const f1Unboosted = getEffectiveRarityOdds(1, { rewardedRarityBoostActive: false });
  assert('boost is opt-in — false/omitted leaves Field 1 at normal 1.5%% Rare', close(f1Unboosted.odds.rare, 0.015));

  // Combined: rewarded boost + first-Rare protection, per PROJECT.md's
  // documented combination order (base -> multiplier -> first-Rare bonus ->
  // normalize).
  const combined = getEffectiveRarityOdds(1, {
    rewardedRarityBoostActive: true,
    firstRareProtection: { hasFoundRare: false, missStreak: 10 }, // roll 11 -> +0.75pp
  });
  const expectedCombinedRare = 0.015 * 1.5 + 0.0075;
  assert('combined boost+protection: Rare = base*1.5 + first-Rare bonus', close(combined.odds.rare, expectedCombinedRare));
  assert('combined boost+protection: Epic only multiplied, never touched by first-Rare bonus', close(combined.odds.epic, 0.001 * 1.5));
  assert('combined boost+protection: odds still sum to 1', close(combined.odds.common + combined.odds.rare + combined.odds.epic, 1));
}

// ---------------------------------------------------------------------------
// rollRarity / full-pipeline sanity (deterministic via fixed rng)
// ---------------------------------------------------------------------------
console.log('\n=== rollRarity / rollFieldFruitOutcome determinism ===');
{
  const odds = { common: 0.98, rare: 0.015, epic: 0.005 };
  assert('rollRarity(0) -> EPIC (epic band first)', rollRarity(odds, constRng(0)) === 'EPIC');
  assert('rollRarity(just under epic) -> EPIC', rollRarity(odds, constRng(0.0049)) === 'EPIC');
  assert('rollRarity(just into rare band) -> RARE', rollRarity(odds, constRng(0.006)) === 'RARE');
  assert('rollRarity(just under epic+rare) -> RARE', rollRarity(odds, constRng(0.0199)) === 'RARE');
  assert('rollRarity(just past epic+rare) -> COMMON', rollRarity(odds, constRng(0.0201)) === 'COMMON');
  assert('rollRarity(0.999) -> COMMON', rollRarity(odds, constRng(0.999)) === 'COMMON');

  // Full pipeline on Day 4 (Rare unlocked), Field 1, no modifiers: first rng
  // call (Stage A) forced into the Rare band, second rng call (Stage B)
  // forced to land on the Signature R2 within the 1/1.3/1/1-weighted pool
  // (cumulative range (1, 2.3] of a total-4.3 weighted roll).
  const outcome = rollFieldFruitOutcome(1, 4, 'R2', 'C1', {}, queueRng([0.006, 0.3]));
  assert('full pipeline: forced-Rare roll resolves tier RARE', outcome.tier === 'RARE');
  assert('full pipeline: Stage B rng lands on Signature R2', outcome.visualId === 'R2');
}

console.log(`\n${checks} checks, ${failures} failures`);
if (failures > 0) process.exit(1);
