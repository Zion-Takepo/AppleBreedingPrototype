// ============================================================
// Visual rarity system — which of the 10 painterly illustrations a Visual
// Variety is, and when each one becomes naturally discoverable/obtainable.
//
// This is entirely separate from the harvest interaction (15 fruit slots
// are presentation only, see OrchardTreeLayer) and from the existing
// genetic Color/Pattern traits (Sweetness/Size/Yield inheritance and the
// Color/Pattern mutation system in breeding.ts are untouched).
//
// The old independent per-offspring-candidate A/B/C/D rarity ROLL
// (rollOffspringVisual/rarityOdds/BASE_PROBS/COMMON_DISCOVERY_CHANCE) was
// removed by the Orchard Mutation / Breeding Specimen pass — Breed's Visual
// inheritance is now the deterministic A/always-A, B/always-B, C/50-50,
// D/mostly-50-50-with-a-small-mutation-chance rule (see breeding.ts
// pickCandidateVisualId), and Rare/Epic Visuals are now mainly found as
// physical Orchard Specimens (see systems/specimen.ts) instead. The
// day-gated unlock tables and `weightedPick` below are shared by both
// systems.
// ============================================================

import type { AppleAssetId } from '../render/appleAssets.ts';

const COMMON_IDS: readonly AppleAssetId[] = ['C1', 'C2', 'C3', 'C4'];
const RARE_IDS: readonly AppleAssetId[] = ['R1', 'R2', 'R3', 'R4'];
const EPIC_IDS: readonly AppleAssetId[] = ['E1', 'E2'];

// Week-1 scripted unlock progression. Before its day, an ID/rarity has
// exactly zero natural appearance chance.
export const RARE_UNLOCK_DAY = 4;
export const EPIC_UNLOCK_DAY = 6;

const COMMON_UNLOCK_DAY: Record<AppleAssetId, number> = {
  C1: 1,
  C2: 1,
  C3: 2,
  C4: 3,
  R1: RARE_UNLOCK_DAY,
  R2: RARE_UNLOCK_DAY,
  R3: RARE_UNLOCK_DAY,
  R4: RARE_UNLOCK_DAY,
  E1: EPIC_UNLOCK_DAY,
  E2: EPIC_UNLOCK_DAY,
};

export function unlockedCommonIds(day: number): AppleAssetId[] {
  return COMMON_IDS.filter((id) => day >= COMMON_UNLOCK_DAY[id]);
}

export function unlockedRareIds(day: number): AppleAssetId[] {
  return day >= RARE_UNLOCK_DAY ? [...RARE_IDS] : [];
}

export function unlockedEpicIds(day: number): AppleAssetId[] {
  return day >= EPIC_UNLOCK_DAY ? [...EPIC_IDS] : [];
}

/**
 * Weighted random pick among `ids` — undiscovered ones are twice as likely
 * as already-discovered ones (a soft nudge toward new content, never a
 * duplicate-protection guarantee). Shared by Breed's Candidate D mutation
 * (see breeding.ts) and Orchard's Day-3+ random Specimen appearance (see
 * systems/specimen.ts). `rng` is injectable for deterministic tests.
 */
export function weightedPick(ids: readonly AppleAssetId[], discovered: readonly AppleAssetId[], rng: () => number = Math.random): AppleAssetId {
  const weights = ids.map((id) => (discovered.includes(id) ? 1 : 2));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (let i = 0; i < ids.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return ids[i];
  }
  return ids[ids.length - 1];
}
