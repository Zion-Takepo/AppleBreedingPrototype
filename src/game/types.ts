import type { AppleColor, ApplePattern } from './tuning.ts';
import type { AppleAssetId } from './render/appleAssets.ts';

export type CultivationPolicy = 'NORMAL' | 'SWEETEN' | 'GROW_BIG';

// The five visible genetic traits, all 0..100. Sweetness/Size directly set
// price (see systems/economy.ts baseAppleValue); Yield sets how many of a
// field's 15 fruit slots are active; Growth sets mean regrow speed;
// Freshness is tracked but has no gameplay effect yet (reserved for a
// future Shipping decay mechanic).
//
// This is the "Owned Line" record: one specific breeding result the player
// chose to KEEP, permanently stored in `GameState.library` (the Library),
// reusable indefinitely as a breeding parent (never consumed/mutated by
// being selected) and — later — plantable without being consumed either.
// It is intentionally distinct from the future "Visual Variety" concept
// (an eventual fixed official name per visualId, Collection-level) — a
// Line's `customName` is a per-line, currently auto-generated label, not
// that future official name.
export interface Variety {
  id: string;
  customName: string;
  generation: number;
  color: AppleColor;
  pattern: ApplePattern;
  sweetness: number;
  size: number;
  yieldStat: number;
  growth: number;
  freshness: number;
  createdDay: number;
  awards: string[];
  // Which of the 10 painterly illustrations this variety uses (Common/Rare/
  // Epic — see systems/rarity.ts). Independent of color/pattern, which
  // remain genetic traits used elsewhere (market, contests, guarantees).
  // Rarity itself is never stored — always derived from this via
  // APPLE_RARITY to avoid a second source of truth.
  visualId: AppleAssetId;
  favorite: boolean;
  // Archived Lines are excluded from the normal Parent Picker (Favorites/
  // Recent/All) but are not deleted — no destructive deletion exists yet.
  archived: boolean;
}

export interface FieldFruitSlot {
  ripe: boolean;
  /** Seconds remaining until this slot ripens; meaningless while ripe. */
  timer: number;
  // Whether this physical slot can grow fruit at all. Driven by the
  // planted variety's Yield stat (see systems/economy.ts
  // activeSlotIndices) — inactive slots never tick, never ripen, and are
  // never harvestable.
  active: boolean;
}

export interface Field {
  id: number;
  unlocked: boolean;
  varietyId: string | null;
  policy: CultivationPolicy;
  pendingPolicy: CultivationPolicy | null;
  // 15 independent per-fruit regrowth states (one per Orchard fruit slot),
  // replacing the old single whole-field growth cycle.
  slots: FieldFruitSlot[];
}

// One harvested apple sitting in the farm-wide Shipping/Processing Queue
// (GameState.processingQueue below). `value`/`baseValue` are priced and
// locked in at harvest time (see Game.harvestFruitSlot) — later changes to
// cultivation, variety, or market never retroactively reprice an
// already-harvested apple. Both are exact, UNROUNDED dollar amounts (see
// systems/economy.ts priceHarvestedApple) — rounding every individual apple
// to a whole dollar would swamp small Sweetness/Size differences, so
// rounding only happens at display time (shipment popup, day/week
// summaries). `baseValue` (pre-market-bonus) is kept alongside `value`
// (final, post-market-bonus) purely so the existing day-log
// harvestRevenue/marketBonus split can still be reconstructed when this
// item ships.
export interface ProcessingItem {
  fieldId: number;
  value: number;
  baseValue: number;
}

export interface OffspringCandidate extends Variety {
  slot: 'A' | 'B' | 'C' | 'D';
  isNewTraitColor: boolean;
  isNewTraitPattern: boolean;
  isNewVisualId: boolean;
}

export interface BreedingState {
  active: boolean;
  parentAId: string | null;
  parentBId: string | null;
  elapsed: number;
  duration: number;
  dayStarted: number;
  ready: boolean;
  offspring: OffspringCandidate[] | null;
  everBredOnce: boolean;
}

export type MarketModifiers = Partial<Record<AppleColor | ApplePattern, number>>;

export interface ContestResult {
  day: number;
  varietyId: string;
  varietyName: string;
  score: number;
  place: 1 | 2 | 3 | 0;
  prize: number;
}

export interface DayLogEntry {
  day: number;
  harvestRevenue: number;
  marketBonus: number;
  contestPrize: number;
  expenses: number;
  net: number;
}

export interface GameState {
  day: number;
  dayTimeRemaining: number;
  dayActive: boolean;
  cash: number;
  fields: Field[];
  // The Library of Owned Lines (see Variety doc comment above). No slot
  // limit; entries are permanent unless archived.
  library: Variety[];
  // Up to the 6 most-recently-used-as-parent Line ids, most recent first,
  // deduped (a Line reused as a parent moves back to the front rather than
  // creating a second entry). Persisted with the rest of GameState.
  recentParentIds: string[];
  discoveredColors: AppleColor[];
  discoveredPatterns: ApplePattern[];
  discoveredVisualIds: AppleAssetId[];
  // ONE shared farm-wide Shipping/Processing Queue — every Field's harvest
  // feeds this same FIFO (buying more Fields raises production, never the
  // shared line's throughput). `processingTimer` is the seconds remaining
  // on the head item (index 0); other items simply wait their turn.
  processingQueue: ProcessingItem[];
  processingTimer: number;
  breeding: BreedingState;
  irrigationLevel: number;
  shippingLevel: number;
  marketModifiers: MarketModifiers;
  totalRevenue: number;
  contestResults: ContestResult[];
  day4ContestDone: boolean;
  day7FairDone: boolean;
  day5MutationGuaranteeUsed: boolean;
  day1YellowGuaranteeUsed: boolean;
  lastDayLog: DayLogEntry | null;
  dayEnded: boolean;
  weekComplete: boolean;
  dayHarvestRevenue: number;
  dayMarketBonus: number;
  dayContestPrize: number;
  highestSweetnessEver: number;
  largestSizeEver: number;
  hasUnseenDiscovery: boolean;
}
