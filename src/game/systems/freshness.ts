import { TUNING } from '../tuning.ts';

// Freshness V1 (see PROJECT.md "Freshness") — pure, Phaser-independent
// retention math applied to an already-harvest-locked apple value. Freshness
// only ever protects a locked value that's waiting in the shared Packing
// queue; it has no bearing on anything still on the tree.

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Fraction (0..FRESHNESS_MAX_LOSS) of a locked harvest value lost to Packing wait, given genetic Freshness (0..100) and accumulated wait seconds. Never negative, never exceeds the cap. */
export function freshnessLossFraction(freshness: number, waitSeconds: number): number {
  const freshness01 = clamp01(freshness / 100);
  const effectiveWaitSeconds = Math.max(0, waitSeconds - TUNING.FRESHNESS_GRACE_SECONDS);
  const protection = TUNING.FRESHNESS_MAX_PROTECTION * freshness01;
  const lossRatePerSecond = TUNING.FRESHNESS_BASE_LOSS_PER_SECOND * (1 - protection);
  return Math.min(TUNING.FRESHNESS_MAX_LOSS, effectiveWaitSeconds * lossRatePerSecond);
}

/** 1 - freshnessLossFraction — always in [1 - FRESHNESS_MAX_LOSS, 1]. */
export function freshnessRetention(freshness: number, waitSeconds: number): number {
  return 1 - freshnessLossFraction(freshness, waitSeconds);
}

/** The actual dollar amount realized at Shipping time for one queued apple — its already-locked harvest value times Freshness retention. */
export function realizedShippingValue(lockedValue: number, freshness: number, waitSeconds: number): number {
  return lockedValue * freshnessRetention(freshness, waitSeconds);
}
