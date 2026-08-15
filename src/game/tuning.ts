// ============================================================
// TUNING — all gameplay-balance numbers live here.
// Keep this file the single source of truth for prototype math.
// ============================================================

export const TUNING = {
  DAY_DURATION_SEC: 90,

  // Each of the 15 Orchard fruit slots regrows independently. Mean regrow
  // time is driven by the planted variety's genetic Growth stat:
  // meanRegrowSeconds = GROWTH_REGROW_BASE_SEC - Growth * GROWTH_REGROW_SLOPE
  // (Growth 0 -> 12s, 50 -> 10s, 100 -> 8s), then each individual regrow
  // rolls +/-GROWTH_REGROW_VARIANCE (20%) around that mean, then Irrigation
  // shortens it further the same way it always has.
  GROWTH_REGROW_BASE_SEC: 12.0,
  GROWTH_REGROW_SLOPE: 0.04,
  GROWTH_REGROW_VARIANCE: 0.2,
  // Yield's production advantage: more simultaneously-active fruit slots,
  // not a separate quantity-per-harvest multiplier (see systems/economy.ts
  // activeSlotCount). Yield 0 -> 9/15 active, 100 -> 15/15.
  YIELD_BASE_ACTIVE_SLOTS: 9,
  YIELD_ACTIVE_SLOTS_RANGE: 6,
  // Temporary economy bridge until a real Shipping system replaces it:
  // every this-many individually-harvested fruit from a field triggers the
  // existing single field-harvest reward once. Matches the 15 physical
  // fruit slots (5 trees x 3 slots) in OrchardTreeLayer.
  FRUIT_PER_BATCH: 15,
  STARTING_FIELD_GROWTH: 0.6,
  NEW_FIELD_GROWTH: 0.5,

  STARTING_CASH: 50,

  BREED_FIRST_COST: 0,
  BREED_FIRST_DURATION_SEC: 6,
  BREED_COST: 35,
  BREED_DURATION_SEC: 18,

  // Field N price, index 0 unused (field 1 is free/starting)
  FIELD_PRICES: [0, 0, 300, 850, 1800] as const,
  FIELD2_UNLOCK_DAY: 2,
  MAX_FIELDS: 4,

  IRRIGATION_PRICES: [250, 700],
  IRRIGATION_REDUCTION_PER_LEVEL: 0.12,
  IRRIGATION_MAX_LEVEL: 2,

  SHIPPING_PRICES: [400, 1000],
  SHIPPING_BONUS_PER_LEVEL: 0.1,
  SHIPPING_MAX_LEVEL: 2,

  DAILY_EXPENSE_BASE: 15,
  DAILY_EXPENSE_PER_FIELD: 20,

  // Cultivation only ever adjusts *effective* Sweetness/Size used for
  // price/contests — it never touches genetic stats, and (since this pass)
  // never multiplies harvest quantity either, since quantity is now fixed
  // at FRUIT_PER_BATCH per reward and Yield's effect is active-slot count.
  CULTIVATION: {
    SWEETEN: { sweetnessBonus: 12 },
    GROW_BIG: { sizeBonus: 12 },
    NORMAL: {},
  },

  // baseAppleValue = APPLE_VALUE_BASE + Sweetness*MULT + Size*MULT.
  // Only Sweetness/Size affect price — Yield/Growth/Freshness do not.
  APPLE_VALUE_BASE: 2.0,
  APPLE_VALUE_SWEETNESS_MULT: 0.01,
  APPLE_VALUE_SIZE_MULT: 0.005,

  MARKET_MULTIPLIER_CAP: 1.6,
  MARKET_MILD_MIN: -0.15,
  MARKET_MILD_MAX: 0.4,

  CONTEST_DAY4: {
    day: 4,
    tier3: 65,
    tier2: 72,
    tier1: 79,
    prize1: 350,
    prize2: 180,
    prize3: 80,
  },

  FAIR_DAY7: {
    day: 7,
    tier3: 35,
    tier2: 50,
    tier1: 65,
    prize1: 400,
    prize2: 200,
    prize3: 90,
  },

  // Mutation chance for offspring visual traits, by child slot
  MUTATION_CHANCE: {
    A: 0.05,
    B: 0.05,
    C: 0.08,
    D: 0.22,
  },

  SAVE_KEY: 'apple-breeding-prototype-save-v1',
} as const;

export const COLORS = ['Red', 'Green', 'Yellow', 'Purple'] as const;
export type AppleColor = (typeof COLORS)[number];

export const PATTERNS = ['Plain', 'Speckled', 'Striped'] as const;
export type ApplePattern = (typeof PATTERNS)[number];

// Hex swatches used for procedural apple rendering + UI accents
export const COLOR_HEX: Record<AppleColor, number> = {
  Red: 0xd6392a,
  Green: 0x5a9c3f,
  Yellow: 0xe0b62b,
  Purple: 0x7a4ba0,
};

export const COLOR_HEX_DARK: Record<AppleColor, number> = {
  Red: 0x8f2419,
  Green: 0x3a6b28,
  Yellow: 0x9c7a15,
  Purple: 0x4d2e66,
};
