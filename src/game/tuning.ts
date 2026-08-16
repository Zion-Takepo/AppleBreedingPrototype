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
  // Revised V1 table (see PROJECT.md "First-session onboarding" section 11
  // — the original Level 1 (12) was found too restrictive for a new
  // player's first session; only these tuning numbers changed, the
  // capacity/upgrade mechanics themselves are unchanged).
  PACKING_CAPACITY_LEVELS: [18, 24, 32, 40, 50] as const,
  PACKING_CAPACITY_UPGRADE_COSTS: [100, 225, 450, 850] as const,
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

  // Contest V1 (see PROJECT.md "Contest" and systems/contest.ts). Fixed
  // four-type rotation starting Day 7, repeating every 7 days (Day 7, 14,
  // 21, 28, 35...) — see CONTEST_TYPES near the bottom of this file for the
  // type enum + rotation order itself, kept as a standalone export (like
  // AppleColor/ApplePattern above) rather than nested here so
  // systems/contest.ts and types.ts can both import just the type/order
  // without pulling in the rest of TUNING.
  CONTEST_START_DAY: 7,
  CONTEST_INTERVAL_DAYS: 7,
  // Specialized Contests (BIGGEST/SWEETEST/FRESHEST): baseScore = mainStat *
  // MAIN_WEIGHT + averageStat * AVERAGE_WEIGHT.
  CONTEST_SPECIALIZED_MAIN_WEIGHT: 0.85,
  CONTEST_SPECIALIZED_AVERAGE_WEIGHT: 0.15,
  // GRAND CHAMPION: baseScore = averageStat * AVERAGE_WEIGHT + lowestStat *
  // LOWEST_WEIGHT — rewards overall quality AND balance across all five
  // genetic stats, never just one.
  CONTEST_GRAND_AVERAGE_WEIGHT: 0.8,
  CONTEST_GRAND_LOWEST_WEIGHT: 0.2,
  // One shared luck roll per entry (player and each NPC alike), uniform in
  // this range, added to the base score before the final 0..100 clamp.
  CONTEST_LUCK_MIN: -3.0,
  CONTEST_LUCK_MAX: 3.0,
  CONTEST_SCORE_MIN: 0,
  CONTEST_SCORE_MAX: 100,
  // Five stable, fixed NPC farm names — no online/network features, just a
  // deterministic roster (see PROJECT.md section 14).
  CONTEST_NPC_NAMES: ['Riverbend', 'Hillcrest', 'Maple Hollow', 'Stonebridge', 'Cedar Creek'] as const,
  // Target scores for Contest #1 (Day 7), one per NPC above, in order.
  // Every later Contest adds CONTEST_NPC_PROGRESSION_PER_CONTEST points to
  // ALL five targets, capped at a total progression bonus of
  // CONTEST_NPC_PROGRESSION_CAP — this scaling is a pure function of the
  // Contest number alone and must never read the player's own stats (see
  // systems/contest.ts npcTargetsForContestNumber).
  CONTEST_NPC_BASE_TARGETS: [42, 46, 50, 54, 58] as const,
  CONTEST_NPC_PROGRESSION_PER_CONTEST: 4,
  CONTEST_NPC_PROGRESSION_CAP: 20,
  // Each NPC also gets one small, one-time result variation in this range,
  // generated/persisted exactly once alongside the rest of that Contest's
  // result (see PROJECT.md section 14/19 — no reroll on reload).
  CONTEST_NPC_VARIATION_MIN: -2.5,
  CONTEST_NPC_VARIATION_MAX: 2.5,
  // Same fixed prize table for every Contest in V1 (see PROJECT.md section
  // 16) — index 0 = 1st place, 1 = 2nd, 2 = 3rd; 4th-6th place = $0.
  CONTEST_PRIZES: [250, 150, 75] as const,

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

  // Pre-Closing warning (see PROJECT.md "Pre-Closing warning" and
  // systems/clock.ts dayTimeRemainingAtClock) — fires once, keyed off the
  // existing digital day clock (not real wall-clock seconds), reset every
  // day. Automatic 18:00 Closing itself is unchanged; this is a pure
  // UI/audio heads-up cue layered on top of it. Revised from the original
  // two-warning (17:30 + 17:50) table to a single 17:00 warning — human
  // playtesting found two warnings unnecessary.
  CLOSING_WARNING_CLOCK: { hour: 17, minute: 0 },

  // Exceptional Specimen genetics — PURE GENETIC CORE ONLY (see PROJECT.md
  // "Exceptional Specimen genetics core" and systems/exceptional.ts). NOT
  // YET connected to gameplay: nothing currently rolls
  // EXCEPTIONAL_OCCURRENCE_CHANCE — it's defined/tested here only so the
  // later Orchard->Specimen integration pass has an agreed-upon constant to
  // read rather than inventing one then.
  // Exceptional eligibility's OWN start day — deliberately separate from
  // SPECIMEN_RANDOM_START_DAY (the unrelated Visual Mutation Common/Rare/
  // Epic gate) even though both currently equal 3, so tuning one can never
  // silently retune the other. Gameplay integration (Game.ts
  // maybeGenerateExceptionalSpecimen) reads ONLY this constant.
  EXCEPTIONAL_START_DAY: 3,
  EXCEPTIONAL_OCCURRENCE_CHANCE: 0.006, // 0.6%, unused by current gameplay
  // Cumulative-threshold weights consumed in this exact order by
  // systems/exceptional.ts's selectArchetype — must sum to 1.
  EXCEPTIONAL_ARCHETYPE_WEIGHTS: { TRAIT_OUTLIER: 0.6, HIGH_POTENTIAL: 0.35, ELITE_OUTLIER: 0.05 },
  // TRAIT_OUTLIER: one Stat strongly elevated, TOTAL roughly unchanged.
  EXCEPTIONAL_TRAIT_FOCUS_INCREASE_MIN: 10,
  EXCEPTIONAL_TRAIT_FOCUS_INCREASE_MAX: 16,
  EXCEPTIONAL_TRAIT_TOTAL_DELTA_MIN: -1,
  EXCEPTIONAL_TRAIT_TOTAL_DELTA_MAX: 3,
  // HIGH_POTENTIAL: no focus Stat, broadly stronger TOTAL.
  EXCEPTIONAL_HIGH_POTENTIAL_TOTAL_DELTA_MIN: 4,
  EXCEPTIONAL_HIGH_POTENTIAL_TOTAL_DELTA_MAX: 7,
  // ELITE_OUTLIER: one Stat strongly elevated AND TOTAL meaningfully up.
  EXCEPTIONAL_ELITE_FOCUS_INCREASE_MIN: 8,
  EXCEPTIONAL_ELITE_FOCUS_INCREASE_MAX: 14,
  EXCEPTIONAL_ELITE_TOTAL_DELTA_MIN: 6,
  EXCEPTIONAL_ELITE_TOTAL_DELTA_MAX: 9,
  // Same absolute genetic budget ceiling breeding/Specimens already use
  // (BREED's GENETIC_BUDGET_CAP / SPECIMEN_BUDGET_CAP above).
  EXCEPTIONAL_TOTAL_CAP: 360,
  // Cultivation focus-selection bias for TRAIT_OUTLIER/ELITE_OUTLIER only
  // (HIGH_POTENTIAL has no focus Stat) — each policy's five weights must sum
  // to 1. Does NOT change EXCEPTIONAL_OCCURRENCE_CHANCE or the archetype
  // weights above; it only biases WHICH Stat becomes the focus once an
  // Exceptional roll (elsewhere, later pass) has already happened.
  EXCEPTIONAL_FOCUS_BIAS: {
    NORMAL: { sweetness: 0.2, size: 0.2, yieldStat: 0.2, growth: 0.2, freshness: 0.2 },
    SWEETEN: { sweetness: 0.6, size: 0.1, yieldStat: 0.1, growth: 0.1, freshness: 0.1 },
    GROW_BIG: { sweetness: 0.1, size: 0.6, yieldStat: 0.1, growth: 0.1, freshness: 0.1 },
  },
} as const;

export const COLORS = ['Red', 'Green', 'Yellow', 'Purple'] as const;
export type AppleColor = (typeof COLORS)[number];

export const PATTERNS = ['Plain', 'Speckled', 'Striped'] as const;
export type ApplePattern = (typeof PATTERNS)[number];

// Contest V1's fixed four-type rotation, in cycle order (see PROJECT.md
// "Contest" and systems/contest.ts) — a standalone export (like AppleColor/
// ApplePattern above) so systems/contest.ts and types.ts can both import
// just the type/order without pulling in the rest of TUNING.
export const CONTEST_TYPES = ['BIGGEST', 'SWEETEST', 'FRESHEST', 'GRAND_CHAMPION'] as const;
export type ContestType = (typeof CONTEST_TYPES)[number];

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
