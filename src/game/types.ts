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
  //
  // `visualId` is the Line's IDENTITY visual (its special lineage — what
  // it's shown as in the Library/Market/Collection, and what OWNED is
  // derived from). `baseVisualId` is the Common Visual it stably PRODUCES
  // as ordinary Orchard fruit and what ordinary sale pricing uses (see
  // PROJECT.md "Revise Rare / Epic Line behavior"). For a Common Line
  // (#001-#004) the two are always identical — Common Visuals are stable
  // cultivars. For a Rare/Epic Line, `baseVisualId` is always a Common id,
  // inherited unchanged through breeding from whichever parent contributed
  // the special `visualId` — planting a Rare/Epic Line grows ordinary
  // `baseVisualId` fruit, with the Line's own Mutation Affinity (see
  // systems/specimen.ts) making its special `visualId` more likely to
  // recur as a physical Orchard Specimen, never as guaranteed mass
  // production.
  visualId: AppleAssetId;
  baseVisualId: AppleAssetId;
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
  // Set the instant this fruit becomes a special mutation fruit — generated
  // when the slot's timer completes (becomes ripe), never later at harvest
  // time, so save/reload can never reroll it (see systems/specimen.ts and
  // Game.maybeGenerateRandomSpecimen/spawnGuaranteedSpecimen). Null for an
  // ordinary fruit slot, growing or ripe.
  specimen: BreedingSpecimen | null;
}

// One physical, one-use special apple obtained from the Orchard (see
// PROJECT.md "Orchard Mutation / Breeding Specimen / Breed connection").
// Distinct from a permanent Library Line: a Specimen is never added to the
// Library, is consumed the instant it's used as a Breed parent, and cannot
// be refunded/rerolled. `sweetness`/`size`/`yieldStat`/`growth`/`freshness`
// use the exact same property names/types as Variety's five genetic stats
// (a mutation of `sourceLineId`'s own stats — see systems/specimen.ts).
export interface BreedingSpecimen {
  id: string;
  visualId: AppleAssetId;
  // Set once at specimen-creation time and never re-derived later (see
  // Game.buildSpecimen) — a Common-tier specimen's baseVisualId is always
  // its own visualId (a freshly found stable cultivar); a Rare/Epic-tier
  // specimen's baseVisualId is inherited from its source Line's own
  // baseVisualId (see Variety's doc comment above), never its visualId.
  baseVisualId: AppleAssetId;
  sweetness: number;
  size: number;
  yieldStat: number;
  growth: number;
  freshness: number;
  foundDay: number;
  sourceLineId: string;
  sourceGeneration: number;
}

export type BreedParentKind = 'LINE' | 'SPECIMEN';

/** A Breed parent selection — either a permanent Library Line or a held Breeding Specimen, disambiguated by `kind` (see Game.startBreeding / ui/LibraryPicker.ts). */
export interface BreedParentRef {
  kind: BreedParentKind;
  id: string;
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
  // Which kind parentAId/parentBId refer to. A Specimen parent is consumed
  // (removed from GameState.specimens) the instant BREED starts, so its
  // full data is snapshotted into parentASpecimenSnapshot/
  // parentBSpecimenSnapshot at that same moment — resolveBreeding() (which
  // runs later, once the breeding timer elapses) reads the snapshot rather
  // than looking the (by-then-consumed) specimen back up by id.
  parentAKind: BreedParentKind;
  parentASpecimenSnapshot: BreedingSpecimen | null;
  parentBId: string | null;
  parentBKind: BreedParentKind;
  parentBSpecimenSnapshot: BreedingSpecimen | null;
  elapsed: number;
  duration: number;
  dayStarted: number;
  ready: boolean;
  offspring: OffspringCandidate[] | null;
  everBredOnce: boolean;
  // Set alongside `offspring`/`ready` in Game.resolveBreeding (see
  // PROJECT.md "Every Breed must improve total genetic strength") — the
  // stronger parent's own TOTAL (Sweetness+Size+Yield+Growth+Freshness)
  // and the single shared target TOTAL every one of the four candidates
  // was rescaled to, purely so the result UI can display "TOTAL x -> y"
  // without re-deriving it from (possibly already-consumed) parent data.
  // Null before any breeding has ever resolved.
  strongerParentTotal: number | null;
  breedTargetTotal: number | null;
}

export type MarketModifiers = Partial<Record<AppleColor | ApplePattern, number>>;

export type MarketTrend = 'RISING' | 'STABLE' | 'FALLING';

export interface MarketHistoryPoint {
  day: number;
  // Percent above/below baseline at this point, e.g. 0.12 = +12%.
  pct: number;
}

// One Visual Variety's persistent Market state (see PROJECT.md Market V1).
// Keyed by AppleAssetId (C1..E2) in GameState.visualMarket below — price is
// per Visual Variety, NEVER per individual owned Line: every Line sharing a
// visualId shares this exact entry. Only DISCOVERED visualIds ever get one.
export interface VisualMarketEntry {
  visualId: AppleAssetId;
  // Percent above/below baseline (0 = baseline/1.00x multiplier).
  pct: number;
  trend: MarketTrend;
  // Oldest-first, capped to roughly TUNING.MARKET_HISTORY_DAYS entries.
  history: MarketHistoryPoint[];
}

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
  // The day's single Operating Cost figure (see systems/economy.ts
  // operatingCost) — gross day revenue (harvestRevenue + marketBonus +
  // contestPrize) minus this equals `net`.
  operatingCost: number;
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
  // Held one-use Breeding Specimens (see BreedingSpecimen doc comment
  // above) — physical special apples harvested from the Orchard, not yet
  // used as a Breed parent. Consumed (removed from this array) the instant
  // BREED starts with one selected as a parent; never restored on
  // save/reload once consumed, and never refunded if the offspring isn't
  // KEPT.
  specimens: BreedingSpecimen[];
  // Guaranteed-onboarding bookkeeping (see PROJECT.md section 3): each flag
  // flips true the moment that day's guaranteed Specimen is spawned, so a
  // reload — or simply playing on past that day — can never spawn it a
  // second time. Never retroactively backfilled for a save already past
  // that day (see systems/save.ts).
  day1SpecimenGuaranteeUsed: boolean;
  day2SpecimenGuaranteeUsed: boolean;
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
  // on the head item (index 0); other items simply wait their turn. This is
  // also the Packing Box's physical storage (see PROJECT.md "Shipping
  // Infrastructure") — its length is finite, capped by
  // Game.packingCapacity(); a normal apple may only be harvested into this
  // queue while `processingQueue.length < packingCapacity()` (Specimens
  // never count against it — see BreedingSpecimen/FieldFruitSlot above).
  processingQueue: ProcessingItem[];
  processingTimer: number;
  breeding: BreedingState;
  irrigationLevel: number;
  shippingLevel: number;
  // Shipping Infrastructure V1 (see PROJECT.md "Shipping Infrastructure") —
  // permanent farm upgrades, independent of each other and of the existing
  // `shippingLevel` sale-value bonus above. Both start at 1 (owned by
  // default) and cap at their own TUNING MAX_LEVEL. packingCapacityLevel
  // sets processingQueue's finite capacity; shippingSpeedLevel sets the
  // queue's normal per-apple processing cadence (see
  // Game.packingCapacity()/shippingCadenceSeconds()).
  packingCapacityLevel: number;
  shippingSpeedLevel: number;
  // Market V1 state — one entry per DISCOVERED Visual Variety (see
  // systems/market.ts). Undiscovered visualIds never get an entry.
  visualMarket: Record<AppleAssetId, VisualMarketEntry>;
  totalRevenue: number;
  contestResults: ContestResult[];
  day4ContestDone: boolean;
  day7FairDone: boolean;
  day5MutationGuaranteeUsed: boolean;
  day1YellowGuaranteeUsed: boolean;
  lastDayLog: DayLogEntry | null;
  dayEnded: boolean;
  // True from the moment Closing begins (automatic 18:00 or manual END DAY)
  // until Final Shipment drains the Processing Queue and settlement
  // finishes (see Game.beginClosing/finishClosing) — growth freezes for
  // this whole window, same as dayEnded, but dayEnded itself only flips
  // true once settlement actually completes (see PROJECT.md Day Cycle).
  closing: boolean;
  weekComplete: boolean;
  dayHarvestRevenue: number;
  dayMarketBonus: number;
  dayContestPrize: number;
  highestSweetnessEver: number;
  largestSizeEver: number;
  hasUnseenDiscovery: boolean;
}
