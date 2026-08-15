// The 10 final painterly apple illustrations. IDs are the technical asset
// IDs from the art pass — no permanent variety names have been decided yet,
// so screens should keep displaying the existing variety name/id, not an
// asset-derived name.
export type AppleAssetId = 'C1' | 'C2' | 'C3' | 'C4' | 'R1' | 'R2' | 'R3' | 'R4' | 'E1' | 'E2';

export const APPLE_ASSET_IDS: readonly AppleAssetId[] = ['C1', 'C2', 'C3', 'C4', 'R1', 'R2', 'R3', 'R4', 'E1', 'E2'];

export type AppleRarity = 'COMMON' | 'RARE' | 'EPIC';

// No Uncommon or Legendary tier exists yet — do not add one here.
export const APPLE_RARITY: Record<AppleAssetId, AppleRarity> = {
  C1: 'COMMON',
  C2: 'COMMON',
  C3: 'COMMON',
  C4: 'COMMON',
  R1: 'RARE',
  R2: 'RARE',
  R3: 'RARE',
  R4: 'RARE',
  E1: 'EPIC',
  E2: 'EPIC',
};

export function appleTextureKey(id: AppleAssetId): string {
  return `apple-${id}`;
}

export function appleAssetPath(id: AppleAssetId): string {
  return `assets/apples/${id}.png`;
}

// UI/catalog-only stable display index for the 10 visual varieties — never
// used for save data, rarity odds, or anything gameplay-facing; purely a
// friendlier stand-in for the internal C1/R1/E1 ids on Line cards (see
// LineCard.ts). Order matches APPLE_ASSET_IDS.
export const APPLE_CATALOG_NUMBER: Record<AppleAssetId, number> = {
  C1: 1,
  C2: 2,
  C3: 3,
  C4: 4,
  R1: 5,
  R2: 6,
  R3: 7,
  R4: 8,
  E1: 9,
  E2: 10,
};

/** e.g. "COMMON · #001" — the compact top-left catalog label shown on Line cards instead of the raw technical id. */
export function catalogLabel(id: AppleAssetId): string {
  const num = String(APPLE_CATALOG_NUMBER[id]).padStart(3, '0');
  return `${APPLE_RARITY[id]} · #${num}`;
}
