// ============================================================
// Visual rarity system — which of the 10 painterly illustrations an
// offspring gets, and when each one becomes discoverable.
//
// This is entirely separate from the harvest interaction (15 fruit slots
// are presentation only, see OrchardTreeLayer) and from the existing
// genetic Color/Pattern traits (Sweetness/Size/Yield inheritance and the
// Color/Pattern mutation system in breeding.ts are untouched). Rarity is
// rolled exactly once per offspring candidate, at breeding time.
// ============================================================

import type { AppleAssetId } from '../render/appleAssets.ts';
import { APPLE_RARITY } from '../render/appleAssets.ts';

export type BreedSlot = 'A' | 'B' | 'C' | 'D';

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

// Base per-offspring-slot Rare/Epic probabilities, before day-gating.
// D (wildcard) is exactly 2x A/B/C. Whatever isn't Rare/Epic is Common.
const BASE_PROBS: Record<BreedSlot, { rare: number; epic: number }> = {
  A: { rare: 0.012, epic: 0.0006 },
  B: { rare: 0.012, epic: 0.0006 },
  C: { rare: 0.012, epic: 0.0006 },
  D: { rare: 0.024, epic: 0.0018 },
};

// On a Common result, chance to pick an unlocked-but-undiscovered Common ID
// instead of the normal parent-inheritance behavior.
const COMMON_DISCOVERY_CHANCE: Record<BreedSlot, number> = {
  A: 0.06,
  B: 0.06,
  C: 0.06,
  D: 0.15,
};

/** Rare/Epic probabilities for this slot on this day, after day-gating. Common = 1 - rare - epic (auto-renormalized since locked tiers are simply zeroed). */
export function rarityOdds(slot: BreedSlot, day: number): { common: number; rare: number; epic: number } {
  const base = BASE_PROBS[slot];
  const rare = day >= RARE_UNLOCK_DAY ? base.rare : 0;
  const epic = day >= EPIC_UNLOCK_DAY ? base.epic : 0;
  return { common: 1 - rare - epic, rare, epic };
}

function weightedPick(ids: readonly AppleAssetId[], discovered: readonly AppleAssetId[]): AppleAssetId {
  // Undiscovered IDs are twice as likely as already-discovered ones, so a
  // rare event is a little less likely to immediately duplicate — but
  // never guaranteed new.
  const weights = ids.map((id) => (discovered.includes(id) ? 1 : 2));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < ids.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return ids[i];
  }
  return ids[ids.length - 1];
}

/**
 * Rolls this offspring's illustration. Numeric genetics (Sweetness/Size/
 * Yield) and the existing Color/Pattern traits are computed entirely
 * separately in breeding.ts — this only decides which of the 10 PNGs it
 * uses.
 */
export function rollOffspringVisual(
  slot: BreedSlot,
  day: number,
  parentAVisualId: AppleAssetId,
  parentBVisualId: AppleAssetId,
  discoveredVisualIds: readonly AppleAssetId[],
): AppleAssetId {
  const odds = rarityOdds(slot, day);
  const roll = Math.random();

  if (roll < odds.epic) {
    return weightedPick(unlockedEpicIds(day), discoveredVisualIds);
  }
  if (roll < odds.epic + odds.rare) {
    return weightedPick(unlockedRareIds(day), discoveredVisualIds);
  }

  // Common result.
  const unlockedCommons = unlockedCommonIds(day);
  const undiscoveredCommons = unlockedCommons.filter((id) => !discoveredVisualIds.includes(id));
  if (undiscoveredCommons.length > 0 && Math.random() < COMMON_DISCOVERY_CHANCE[slot]) {
    return undiscoveredCommons[Math.floor(Math.random() * undiscoveredCommons.length)];
  }

  // Normal inheritance: prefer a parent's own Common visual if it's within
  // the currently-unlocked Common set, biased the same way the rest of
  // breeding treats each slot (A leans to parent A, B to parent B, C/D
  // even) so a Common result usually looks like one of its parents.
  const parentCandidates = [parentAVisualId, parentBVisualId].filter(
    (id) => APPLE_RARITY[id] === 'COMMON' && unlockedCommons.includes(id),
  );
  if (parentCandidates.length === 0) {
    return unlockedCommons[Math.floor(Math.random() * unlockedCommons.length)];
  }
  if (parentCandidates.length === 1) return parentCandidates[0];

  let biasA: number;
  switch (slot) {
    case 'A':
      biasA = 0.8;
      break;
    case 'B':
      biasA = 0.2;
      break;
    default:
      biasA = 0.5;
  }
  return Math.random() < biasA ? parentAVisualId : parentBVisualId;
}
