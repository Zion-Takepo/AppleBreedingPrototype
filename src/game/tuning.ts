// ============================================================
// TUNING — all gameplay-balance numbers live here.
// Keep this file the single source of truth for prototype math.
// ============================================================

export const TUNING = {
  DAY_DURATION_SEC: 90,
  // Digital day clock, shown in the HUD as "DAY N · HH:MM" — purely a
  // display mapping onto the existing DAY_DURATION_SEC pacing above (no
  // separate duration to balance here; see systems/clock.ts).
  DAY_START_HOUR: 9,
  DAY_END_HOUR: 18,

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
  // Count of physical fruit slots per field (5 trees x 3 slots in
  // OrchardTreeLayer) — Yield's active-slot math is expressed as a
  // fraction of this. No longer tied to any cash-batching rule (see
  // PROCESSING_SECONDS_PER_APPLE / GameState.processingQueue below).
  FRUIT_PER_BATCH: 15,
  STARTING_FIELD_GROWTH: 0.6,
  NEW_FIELD_GROWTH: 0.5,

  // Shipping Pipeline: ONE global farm-wide processing queue (GameState.
  // processingQueue), not one per Field — buying more Fields increases
  // production but never speeds up the shared shipping line. Seconds the
  // queue's head item spends processing before it ships and pays out is now
  // driven by the Shipping Speed upgrade level (SHIPPING_SPEED_LEVELS
  // below) rather than a fixed constant — see Game.shippingCadenceSeconds().

  // Shipping Infrastructure V1 (see PROJECT.md "Shipping Infrastructure"):
  // PACKING = the finite processingQueue capacity. Index 0 = Level 1.
  // *_UPGRADE_COSTS[i] is the cost to go from Level i+1 to Level i+2 (i.e.
  // costs[0] = Lv1->Lv2 price), one entry shorter than the level table
  // since Level 1 is owned by default and MAX has no further upgrade.
  PACKING_CAPACITY_LEVELS: [12, 18, 24, 32, 40] as const,
  PACKING_CAPACITY_UPGRADE_COSTS: [150, 350, 700, 1200] as const,
  PACKING_MAX_LEVEL: 5,

  // SHIPPING SPEED = seconds the queue's head item spends processing per
  // apple during normal (non-Closing) play. Closing's own faster Final
  // Shipment cadence is always derived from whichever of these is currently
  // active (see FINAL_SHIPMENT_CADENCE_MIN/MULT below and
  // Game.finalShipmentCadenceSeconds()) rather than being a separate table.
  SHIPPING_SPEED_LEVELS: [1.0, 0.8, 0.65, 0.52, 0.42] as const,
  SHIPPING_SPEED_UPGRADE_COSTS: [200, 450, 900, 1600] as const,
  SHIPPING_SPEED_MAX_LEVEL: 5,

  // Closing (see Game.beginClosing/finalShipmentCadenceSeconds) accelerates
  // the same queue to max(FINAL_SHIPMENT_CADENCE_MIN, normalCadence *
  // FINAL_SHIPMENT_CADENCE_MULT) so a typical remaining queue finishes in
  // roughly a couple of seconds instead of trickling in at the normal
  // daytime rate, while still rewarding a faster owned Shipping Speed level.
  FINAL_SHIPMENT_CADENCE_MIN: 0.08,
  FINAL_SHIPMENT_CADENCE_MULT: 0.2,

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

  // Daily Operating Cost (see systems/economy.ts operatingCost) — ONE
  // number per day, settled once during Closing after Final Shipment
  // finishes (see Game.finishClosing). Replaces the old flat
  // DAILY_EXPENSE_BASE/PER_FIELD bridge rather than stacking a second
  // expense on top of it; BASE/PER_FIELD keep their old values so Day 1 on
  // the starting 1-Field farm costs exactly what it always has ($35), with
  // OPERATING_COST_PER_DAY adding a small, purely linear day-over-day
  // progression term so pure time passage stays gentle (Day 7 on the same
  // 1-Field farm: $35 -> $53).
  OPERATING_COST_BASE: 15,
  OPERATING_COST_PER_FIELD: 20,
  OPERATING_COST_PER_DAY: 3,

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

  // Market V1 — per-Visual-Variety pricing, one update per game day (see
  // PROJECT.md Market V1 and systems/market.ts advanceVisualMarket):
  //   dailyMovement = noise + trendBias + meanReversion + eventShock
  // clamped to [MARKET_PCT_MIN, MARKET_PCT_MAX], then that day's own delta
  // is reclassified into RISING/STABLE/FALLING, which biases the FOLLOWING
  // day's movement (a real but non-guaranteed nudge).
  MARKET_NOISE_AMPLITUDE: 0.06, // uniform +/-6% random daily noise
  MARKET_TREND_BIAS: 0.025, // +/-2.5% nudge from yesterday's displayed trend
  MARKET_REVERSION_RATE: 0.15, // pulls 15% of the current distance-from-baseline back toward 0 each day
  MARKET_EVENT_SHOCK: 0.12, // +/-12% shared shock applied to every discovered variety on a scripted Calendar market-event day (see market.ts eventShockSignForDay)
  MARKET_TREND_THRESHOLD: 0.02, // a day's own delta must exceed this magnitude to register as RISING/FALLING rather than STABLE
  MARKET_PCT_MIN: -0.5, // safe clamp floor: multiplier never below 0.50x
  MARKET_PCT_MAX: 0.6, // safe clamp ceiling: multiplier never above 1.60x
  MARKET_HISTORY_DAYS: 5,

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

  // Orchard Mutation / Breeding Specimen (see PROJECT.md "Orchard Mutation /
  // Breeding Specimen / Breed connection" and systems/specimen.ts). A
  // Specimen's five stats are a mutation of its source Line: an independent
  // integer mutation per stat, one extra major mutation on a random stat,
  // then rescaled to a hidden budget target — reusing the exact same
  // scaleToBudget mechanism breeding.ts's candidates use.
  SPECIMEN_STAT_MINOR_MUTATION: 4, // each of the 5 stats: independent +/-4 integer mutation
  SPECIMEN_STAT_MAJOR_MUTATION_MIN: 8, // the one extra major mutation applied to a single random stat: magnitude 8..12
  SPECIMEN_STAT_MAJOR_MUTATION_MAX: 12,
  SPECIMEN_BUDGET_DELTA_MIN: -3, // hidden budget target = source total + randInt(-3..+5)
  SPECIMEN_BUDGET_DELTA_MAX: 5,
  SPECIMEN_BUDGET_CAP: 360, // same absolute cap as breeding's own hidden budget

  // Day 3+ random per-ripened-fruit specimen appearance chance — ONE
  // mutually-exclusive tier roll per ripening (see Game.maybeGenerateRandomSpecimen).
  SPECIMEN_RANDOM_START_DAY: 3,
  SPECIMEN_COMMON_CHANCE: 0.003, // 0.30%, from Day 3
  SPECIMEN_RARE_CHANCE: 0.0005, // 0.05%, from Day 4
  SPECIMEN_EPIC_CHANCE: 0.00005, // 0.005%, from Day 6

  // Breed Candidate D's own small "wild miracle" Visual-mutation chance (see
  // breeding.ts pickCandidateVisualId). Revised: D's mutation target is now
  // Common-only (#001-#004) — Rare/Epic Visuals can no longer be
  // spontaneously created by breeding at all; they only ever enter the
  // player's genetics as physical Orchard Specimens (see
  // systems/specimen.ts's Mutation Affinity below).
  SPECIMEN_D_VISUAL_MUTATION_CHANCE: 0.1, // 10% of the time, D rolls a mutated Common visual instead of inheriting a parent's

  // Breed TOTAL progression (see breeding.ts breedOffspring / PROJECT.md
  // "Every Breed must improve total genetic strength"). ONE improvement
  // roll per Breed operation (not per candidate) — every candidate A/B/C/D
  // is then rescaled to the SAME resulting target total, so the player's
  // choice among them is about distribution/Visual, never "which one
  // rolled the bigger number."
  BREED_IMPROVEMENT_MIN: 2,
  BREED_IMPROVEMENT_MAX: 6,

  // Rare/Epic Mutation Affinity (see systems/specimen.ts
  // mutationAffinityFor/affinityBonusChance and PROJECT.md "Revise Rare /
  // Epic Line behavior"). A permanent Rare/Epic Line makes ITS OWN special
  // Visual (never sibling Rare/Epic ids) more likely to recur as a Day-3+
  // Orchard Specimen on fields it's planted on — applied as an ADDITIONAL
  // independent per-ripening chance on top of that Visual's normal
  // within-tier baseline share, targeting an absolute occurrence rate
  // roughly this many times the non-affinity baseline. Never stacks by
  // generation — always exactly this flat multiplier for the Line's own
  // visualId, however many generations deep.
  RARE_MUTATION_AFFINITY_MULTIPLIER: 10,
  EPIC_MUTATION_AFFINITY_MULTIPLIER: 20,

  // Freshness V1 (see PROJECT.md "Freshness" and systems/freshness.ts). A
  // normal apple's genetic Freshness + accumulated Packing wait time are
  // locked onto its ProcessingItem the instant it's harvested; Freshness
  // only ever reduces how much of that already-locked harvest value
  // survives until it actually ships — it has no effect before harvest.
  FRESHNESS_GRACE_SECONDS: 2.0, // no loss at all for the first 2s of Packing wait
  FRESHNESS_BASE_LOSS_PER_SECOND: 0.02, // 2%/s of locked value after grace, at Freshness 0
  FRESHNESS_MAX_PROTECTION: 0.8, // Freshness 100 cuts the loss rate by 80%
  FRESHNESS_MAX_LOSS: 0.3, // an apple can never lose more than 30% of its locked value, however long it waits
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
