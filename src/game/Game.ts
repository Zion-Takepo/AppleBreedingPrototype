import { TUNING } from './tuning.ts';
import type {
  BreedingSpecimen,
  BreedParentRef,
  ContestState,
  CultivationPolicy,
  DayLogEntry,
  Field,
  FieldFruitSlot,
  GameState,
  OnboardingStep,
  Variety,
} from './types.ts';
import { breedOffspring, statsOf, type BreedParent } from './systems/breeding.ts';
import {
  activeSlotIndices,
  allSlotsActive,
  finalShipmentCadenceSeconds,
  fruitRegrowSeconds,
  makeInitialFruitSlots,
  operatingCost,
  packingCapacityForLevel,
  packingUpgradeCost,
  pickNextProductiveSlot,
  priceHarvestedApple,
  shippingCadenceForLevel,
  shippingSpeedUpgradeCost,
} from './systems/economy.ts';
import {
  contestNumberForDay,
  contestScore,
  contestTypeForDay,
  isContestDay,
  npcTargetsForContestNumber,
  prizeForRank,
  rankContestEntries,
  rollContestLuck,
  rollNpcVariation,
} from './systems/contest.ts';
import { advanceDailyMarket, initVisualMarket, initVisualMarketEntry } from './systems/market.ts';
import { realizedShippingValue } from './systems/freshness.ts';
import { dayTimeRemainingAtClock } from './systems/clock.ts';
import { clearSave, loadState, saveState } from './systems/save.ts';
import { freshStarterLines, STARTER_GREEN, STARTER_RED } from './systems/starterLines.ts';
import {
  chooseDay2GuaranteedVisual,
  chooseGuaranteedSpecimenFieldIndex,
  deriveSpecimenBaseVisualId,
  generateSpecimenStats,
  rollOrchardSpecimen,
} from './systems/specimen.ts';
import { STAT_KEYS, generateExceptionalSpecimen, type StatSet } from './systems/exceptional.ts';
import type { AppleAssetId } from './render/appleAssets.ts';

// Pre-Closing warning threshold, computed once from the digital clock
// mapping (see PROJECT.md "Pre-Closing warning") rather than a second,
// independently tuned real-time duration.
const CLOSING_WARNING_SECONDS = dayTimeRemainingAtClock(TUNING.CLOSING_WARNING_CLOCK.hour, TUNING.CLOSING_WARNING_CLOCK.minute);

// The player's current onboarding goal only ever advances forward through
// this fixed order (see Game.advanceOnboardingTo) — never regresses, and an
// out-of-order action (e.g. finding the Specimen before ever harvesting a
// normal apple) simply jumps past whichever earlier steps it also satisfies.
const ONBOARDING_STEP_ORDER: OnboardingStep[] = ['HARVEST_APPLE', 'FIND_SPECIMEN', 'OPEN_BREED', 'START_BREED', 'KEEP_OFFSPRING', 'COMPLETE'];

function makeField(id: number, unlocked: boolean, varietyId: string | null, fractionGrown: number, variety: Variety | null): Field {
  const active = variety ? activeSlotIndices(variety.id, variety.yieldStat) : allSlotsActive();
  return {
    id,
    unlocked,
    varietyId,
    policy: 'NORMAL',
    pendingPolicy: null,
    slots: makeInitialFruitSlots(fractionGrown, variety?.growth ?? 50, 0, active),
  };
}

function createInitialState(): GameState {
  return {
    day: 1,
    dayTimeRemaining: TUNING.DAY_DURATION_SEC,
    dayActive: true,
    cash: TUNING.STARTING_CASH,
    fields: [
      makeField(1, true, STARTER_RED.id, TUNING.STARTING_FIELD_GROWTH, STARTER_RED),
      makeField(2, false, null, 0, null),
      makeField(3, false, null, 0, null),
      makeField(4, false, null, 0, null),
    ],
    // Fresh, independent copies — never the shared STARTER_RED/GREEN
    // singletons directly (Library entries get mutated in place, e.g.
    // contest awards; see freshStarterLines()'s doc comment).
    library: freshStarterLines(),
    specimens: [],
    day1SpecimenGuaranteeUsed: false,
    day2SpecimenGuaranteeUsed: false,
    recentParentIds: [],
    discoveredColors: ['Red', 'Green'],
    discoveredPatterns: ['Plain'],
    discoveredVisualIds: ['C1', 'C2'],
    processingQueue: [],
    processingTimer: 0,
    breeding: {
      active: false,
      parentAId: null,
      parentAKind: 'LINE',
      parentASpecimenSnapshot: null,
      parentBId: null,
      parentBKind: 'LINE',
      parentBSpecimenSnapshot: null,
      elapsed: 0,
      duration: 0,
      dayStarted: 1,
      ready: false,
      offspring: null,
      everBredOnce: false,
      strongerParentTotal: null,
      breedTargetTotal: null,
    },
    irrigationLevel: 0,
    shippingLevel: 0,
    packingCapacityLevel: 1,
    shippingSpeedLevel: 1,
    // Day 1 starts every already-discovered Visual Variety safely at
    // baseline/STABLE — its first real Market update happens at the Day
    // 1->2 transition (see advanceDayInternal), never here.
    visualMarket: initVisualMarket(['C1', 'C2'], 1),
    totalRevenue: 0,
    contest: null,
    contestHistory: [],
    day5MutationGuaranteeUsed: false,
    day1YellowGuaranteeUsed: false,
    lastDayLog: null,
    dayEnded: false,
    closing: false,
    weekComplete: false,
    dayHarvestRevenue: 0,
    dayMarketBonus: 0,
    dayContestPrize: 0,
    dayFreshnessLoss: 0,
    highestSweetnessEver: Math.max(STARTER_RED.sweetness, STARTER_GREEN.sweetness),
    largestSizeEver: Math.max(STARTER_RED.size, STARTER_GREEN.size),
    hasUnseenDiscovery: false,
    onboarding: { step: 'HARVEST_APPLE', dismissed: false },
    closingWarningShown: false,
    marketHintShown: false,
  };
}

export type GameEvent =
  | { type: 'shipment'; fieldId: number; revenue: number }
  | { type: 'breedingReady' }
  | { type: 'traitDiscovered' }
  | { type: 'dayClosed' }
  | { type: 'specimenAcquired'; specimen: BreedingSpecimen }
  // A normal (non-Specimen) ripe fruit was clicked/swept while the Packing
  // Box was already full — see PROJECT.md "Shipping Infrastructure". Fired
  // from harvestFruitSlot; UI listeners should throttle their own feedback
  // since a hold-and-sweep drag can trigger this repeatedly in one gesture.
  | { type: 'packingFull' }
  // Pre-Closing warning (see PROJECT.md "Pre-Closing warning") — fires at
  // most once per day, at 17:00 (one hour before automatic 18:00 Closing).
  | { type: 'closingWarning' }
  // Fired the instant beginClosing() runs, before its collection sequence —
  // `automatic` distinguishes the timer hitting 0 (18:00) from a manual END
  // DAY click, since only the automatic case needs the surprise-transition
  // cue (see PROJECT.md "18:00 Closing cue").
  | { type: 'closingBegan'; automatic: boolean }
  // First-session onboarding reached its final step (see PROJECT.md
  // "First-session onboarding" section 6/completion).
  | { type: 'onboardingComplete' }
  // Fired at the end of every day transition (advanceDayInternal) — used to
  // anchor the one-time Market discoverability hint's fallback trigger (see
  // PROJECT.md "Market discoverability").
  | { type: 'dayAdvanced' }
  // Contest V1 (see PROJECT.md "Contest"). Fired once Closing's Final
  // Shipment queue has fully drained on a Contest Day and `state.contest`
  // has just been created for today — the UI's cue to show the blocking
  // Contest entry screen (see Game.advanceContestGate).
  | { type: 'contestGateReached' }
  // Fired the instant Game.confirmContestEntry generates the FULL Contest
  // outcome (score/rank/prize) — the UI's cue to show the Results screen.
  // Settlement itself is deliberately NOT triggered by this event; it only
  // ever runs from Game.continueFromContestResults (see PROJECT.md section
  // 11's "do not show EndDayModal before the Contest has completed").
  | { type: 'contestResolved' }
  | { type: 'changed' };

type Listener = (event: GameEvent) => void;

export class Game {
  state: GameState;
  private listeners: Listener[] = [];

  constructor() {
    this.state = loadState() ?? createInitialState();
    // Covers both a brand-new game (Day 1, flags false -> spawns) and an
    // old save reload landing on Day 1/2 with the guarantee not yet
    // recorded as spawned (see PROJECT.md section 16) — already-used flags
    // make this a no-op on every subsequent reload.
    this.maybeSpawnGuaranteedSpecimen();
  }

  on(listener: Listener): void {
    this.listeners.push(listener);
  }

  private emit(event: GameEvent): void {
    for (const l of this.listeners) l(event);
  }

  private notify(): void {
    this.emit({ type: 'changed' });
  }

  save(): void {
    saveState(this.state);
  }

  resetPrototype(): void {
    clearSave();
    this.state = createInitialState();
    this.maybeSpawnGuaranteedSpecimen();
    this.notify();
  }

  getVariety(id: string | null): Variety | undefined {
    if (!id) return undefined;
    return this.state.library.find((v) => v.id === id);
  }

  // ----------------------------------------------------------------
  // First-session onboarding (see PROJECT.md "First-session onboarding")
  // ----------------------------------------------------------------

  /** Advances the onboarding goal to `step` — a no-op if `step` isn't strictly further along than the current one, so calling this from multiple action paths (harvest, breed, keep) is always safe and never regresses progress. */
  private advanceOnboardingTo(step: OnboardingStep): void {
    const cur = ONBOARDING_STEP_ORDER.indexOf(this.state.onboarding.step);
    const next = ONBOARDING_STEP_ORDER.indexOf(step);
    if (next <= cur) return;
    this.state.onboarding.step = step;
    if (step === 'COMPLETE') this.emit({ type: 'onboardingComplete' });
  }

  /** Called by the UI when the player navigates to the BREED tab — advances the OPEN_BREED onboarding goal; a no-op at any other step (including if it's already been passed). */
  onboardingBreedScreenOpened(): void {
    if (this.state.onboarding.step !== 'OPEN_BREED') return;
    this.advanceOnboardingTo('START_BREED');
    this.notify();
  }

  /** SKIP GUIDE — permanently hides the onboarding objective banner for this save. Never alters `step`/game progression/rewards (see PROJECT.md section 4's explicit requirement). */
  skipOnboarding(): void {
    if (this.state.onboarding.dismissed) return;
    this.state.onboarding.dismissed = true;
    this.notify();
  }

  /** One-time-ever Market discoverability hint (see PROJECT.md "Market discoverability") — idempotent, so it's safe for the UI to call this from more than one trigger point. */
  markMarketHintShown(): void {
    if (this.state.marketHintShown) return;
    this.state.marketHintShown = true;
    this.notify();
  }

  // ----------------------------------------------------------------
  // Library (Owned Lines)
  // ----------------------------------------------------------------
  toggleFavorite(lineId: string): void {
    const line = this.getVariety(lineId);
    if (!line) return;
    line.favorite = !line.favorite;
    this.notify();
  }

  // Minimal archive-data-behavior foundation (no management UI yet): an
  // archived Line is excluded from the normal Favorites/Recent/All Parent
  // Picker lists, but is never deleted and can always be unarchived.
  setLineArchived(lineId: string, archived: boolean): void {
    const line = this.getVariety(lineId);
    if (!line) return;
    line.archived = archived;
    this.notify();
  }

  // Most-recently-used-as-parent Lines, most recent first, deduped, capped
  // at 6. A self-cross (same id for both) only counts once.
  private recordRecentParents(idA: string, idB: string): void {
    const ids = idA === idB ? [idA] : [idA, idB];
    for (const id of ids) {
      this.state.recentParentIds = [id, ...this.state.recentParentIds.filter((existing) => existing !== id)];
    }
    this.state.recentParentIds = this.state.recentParentIds.slice(0, 6);
  }

  getField(fieldId: number): Field | undefined {
    return this.state.fields.find((f) => f.id === fieldId);
  }

  unlockedFields(): Field[] {
    return this.state.fields.filter((f) => f.unlocked);
  }

  hasHarvestReady(): boolean {
    return this.state.fields.some((f) => f.unlocked && f.varietyId && f.slots.some((s) => s.ripe));
  }

  hasBreedingResultPending(): boolean {
    return this.state.breeding.ready && this.state.breeding.offspring !== null;
  }

  // ----------------------------------------------------------------
  // Tick
  // ----------------------------------------------------------------
  /**
   * `pauseFarmSimulation` is the Strategic Pause gate (see PROJECT.md
   * "Breed is a strategic pause" — set by MainScene while BREED is the
   * active screen, false during Closing/dayEnded so an already-started
   * settlement can never be suspended). It freezes only the farm/day
   * simulation below (day clock, fruit growth/ripening, Specimen rolls,
   * shipping queue, Closing-by-time) — NOT the Breed operation itself: an
   * in-progress breeding's own countdown must keep advancing (and resolve)
   * even while the player stays on the BREED screen the whole time, so
   * that block always runs regardless of this flag.
   */
  update(dtSeconds: number, pauseFarmSimulation = false): void {
    let changed = false;

    if (!pauseFarmSimulation) {
      if (this.state.dayActive) {
        this.state.dayTimeRemaining = Math.max(0, this.state.dayTimeRemaining - dtSeconds);
        changed = true;

        // Pre-Closing warning (see PROJECT.md "Pre-Closing warning") — fires
        // at most once per day (guarded by its own persisted flag, reset in
        // advanceDayInternal), keyed off the digital clock via
        // dayTimeRemainingAtClock rather than real wall-clock seconds.
        // Gated on `dayActive` (this whole block), so a manual END DAY that
        // closes the day before the threshold is reached can never fire it
        // afterward — dayActive is already false by then and this block
        // simply stops decrementing/checking.
        if (!this.state.closingWarningShown && this.state.dayTimeRemaining <= CLOSING_WARNING_SECONDS) {
          this.state.closingWarningShown = true;
          this.emit({ type: 'closingWarning' });
        }
      }
      // 18:00 (dayTimeRemaining hits 0) triggers the exact same Closing
      // procedure a manual END DAY click does (see beginClosing) — idempotent,
      // so this firing again on a later frame (or DebugPanel's "Skip Day
      // Timer" setting dayTimeRemaining=0 directly) can't double-close.
      // `true` marks this as the AUTOMATIC trigger (see PROJECT.md "18:00
      // Closing cue") — a manual END DAY click goes through MainScene calling
      // beginClosing() with no argument (defaults to false) instead.
      if (this.state.dayActive && this.state.dayTimeRemaining <= 0) {
        this.beginClosing(true);
        changed = true;
      }

      // Each of the 15 fruit slots per field regrows on its own independent
      // timer now — there's no whole-field "growth cycle" to freeze, so
      // slots keep regrowing continuously regardless of which field tab is
      // selected or whether the day is still active (dayActive=false, e.g.
      // the timer simply ran out). Once Closing has begun (state.closing —
      // automatic 18:00 or manual END DAY) or the day is fully SETTLED
      // (dayEnded), growth freezes: already-ripe fruit stays ripe (skipped
      // below regardless), and partially-grown fruit stops advancing and
      // stays frozen at its current progress.
      if (!this.state.dayEnded && !this.state.closing) {
        for (const field of this.state.fields) {
          if (!field.unlocked || !field.varietyId) continue;
          const sourceVariety = this.getVariety(field.varietyId);
          for (const slot of field.slots) {
            if (!slot.active || slot.ripe) continue;
            slot.timer -= dtSeconds;
            if (slot.timer <= 0) {
              slot.ripe = true;
              changed = true;
              // Day-3+ random Specimen appearance (see PROJECT.md section 4):
              // rolled the instant this fruit becomes ripe, never later at
              // harvest time, so save/reload can never reroll it.
              if (sourceVariety) this.maybeGenerateRandomSpecimen(slot, sourceVariety, field.policy);
            }
          }
        }
      }

      // ONE shared farm-wide Shipping/Processing Queue: only the head item
      // (index 0) has an active timer — the rest simply wait their turn, so
      // buying more Fields raises production but never speeds up this shared
      // line. A `while` (not `if`) lets a single large dt — e.g. the debug
      // speed multiplier — ship several ready apples in one tick, each still
      // emitting its own 'shipment' event exactly as if shipped individually.
      if (this.state.processingQueue.length > 0) {
        // Freshness V1 (see PROJECT.md "Freshness"): EVERY item in the
        // queue ages while the farm simulation genuinely runs, not just the
        // head — this whole block only executes when !pauseFarmSimulation
        // (Breed's strategic pause), so a queued apple never loses value
        // while the player is merely thinking on the BREED screen, and
        // there is no catch-up delta on resuming since the wait simply
        // wasn't advanced meanwhile. Continues advancing during Closing
        // (state.closing) exactly the same way, since Closing never sets
        // pauseFarmSimulation.
        for (const item of this.state.processingQueue) item.packingWaitSeconds += dtSeconds;

        this.state.processingTimer -= dtSeconds;
        while (this.state.processingTimer <= 0 && this.state.processingQueue.length > 0) {
          const item = this.state.processingQueue.shift()!;
          // Freshness retention is applied to the item's already-locked
          // harvest value right here, at Shipping realization time — never
          // earlier. `realizedValue` (not the locked `item.value`) is what
          // the player actually receives; the difference is tracked as
          // Freshness Loss (see PROJECT.md "Freshness" section 10).
          const realizedValue = realizedShippingValue(item.value, item.freshness, item.packingWaitSeconds);
          const freshnessLoss = item.value - realizedValue;
          // Cash/totalRevenue are always paid — this money was genuinely
          // earned (after Freshness) the instant the apple shipped,
          // regardless of day state. dayHarvestRevenue/dayMarketBonus/
          // dayFreshnessLoss, however, exist only to feed the CURRENT day's
          // settlement snapshot (finishClosing) and get reset to 0 on the
          // next advanceDayInternal(); once the day is already settled
          // (dayEnded) that snapshot has already been taken and shown, so
          // continuing to add to them here would just leak revenue/loss
          // that never appears in any summary. During Closing itself
          // dayEnded is still false (it only flips true once the queue is
          // fully drained — see finishClosing below), so Final Shipment
          // revenue/loss is correctly still counted into the closing day's
          // own summary, never the next day's.
          this.state.cash += realizedValue;
          this.state.totalRevenue += realizedValue;
          if (!this.state.dayEnded) {
            this.state.dayHarvestRevenue += item.baseValue;
            this.state.dayMarketBonus += item.value - item.baseValue;
            this.state.dayFreshnessLoss += freshnessLoss;
          }
          // Exact, unrounded value — the HUD feedback now displays money to
          // two decimal places, so no rounding belongs here (see HUD.ts).
          this.emit({ type: 'shipment', fieldId: item.fieldId, revenue: realizedValue });
          changed = true;
          this.state.processingTimer += this.processingCadenceSeconds();
        }
        if (this.state.processingQueue.length === 0) this.state.processingTimer = 0;
      }

      // Closing (state.closing) stays true until the accelerated Final
      // Shipment drain above has fully emptied the shared queue. On a
      // normal day, settlement runs immediately — same as before Contest
      // V1. On a Contest Day, settlement is deliberately deferred: it only
      // ever runs from continueFromContestResults(), called by the UI once
      // the player has actually seen the Results screen (see PROJECT.md
      // section 11) — so Final Shipment revenue is still always folded into
      // the closing day's own summary (see finishClosing), just not until
      // the Contest itself has fully played out.
      if (this.state.closing && this.state.processingQueue.length === 0) {
        if (isContestDay(this.state.day)) {
          if (this.advanceContestGate()) changed = true;
        } else {
          this.finishClosing();
          changed = true;
        }
      }
    }

    // Breed progression is deliberately NOT gated by pauseFarmSimulation —
    // only farm/day time freezes while the player is on the BREED screen,
    // never the Breed operation itself (see PROJECT.md "Breed is a
    // strategic pause").
    const breeding = this.state.breeding;
    if (breeding.active && !breeding.ready) {
      breeding.elapsed += dtSeconds;
      if (breeding.elapsed >= breeding.duration) {
        this.resolveBreeding();
        changed = true;
      }
    }

    if (changed) this.notify();
  }

  // Normal daytime Shipping runs at the currently-owned Shipping Speed
  // level's cadence; Closing (state.closing) switches the SAME queue to the
  // faster, derived Final Shipment cadence — never a second queue, never a
  // pricing change (see PROJECT.md "Shipping Infrastructure").
  private processingCadenceSeconds(): number {
    return this.state.closing ? this.currentFinalShipmentCadenceSeconds() : this.shippingCadenceSeconds();
  }

  /** Current normal (non-Closing) per-apple processing cadence, seconds — driven by the owned Shipping Speed level. */
  shippingCadenceSeconds(): number {
    return shippingCadenceForLevel(this.state.shippingSpeedLevel);
  }

  /** Current Final Shipment (Closing) cadence — max(FINAL_SHIPMENT_CADENCE_MIN, shippingCadenceSeconds() * FINAL_SHIPMENT_CADENCE_MULT); see PROJECT.md section 12. */
  private currentFinalShipmentCadenceSeconds(): number {
    return finalShipmentCadenceSeconds(this.shippingCadenceSeconds());
  }

  /** Current Packing Box capacity — the finite processingQueue length cap (see PROJECT.md "Shipping Infrastructure"). */
  packingCapacity(): number {
    return packingCapacityForLevel(this.state.packingCapacityLevel);
  }

  private resolveBreeding(): void {
    const breeding = this.state.breeding;
    // A SPECIMEN parent was already consumed (removed from
    // state.specimens) the instant BREED started, so its data is read from
    // the snapshot taken at that moment — never looked up live here.
    const parentA =
      breeding.parentAKind === 'SPECIMEN'
        ? breeding.parentASpecimenSnapshot && this.breedParentFromSpecimen(breeding.parentASpecimenSnapshot)
        : this.getVariety(breeding.parentAId);
    const parentB =
      breeding.parentBKind === 'SPECIMEN'
        ? breeding.parentBSpecimenSnapshot && this.breedParentFromSpecimen(breeding.parentBSpecimenSnapshot)
        : this.getVariety(breeding.parentBId);
    if (!parentA || !parentB) return;

    const result = breedOffspring(parentA, parentB, breeding.dayStarted, this.state);
    breeding.offspring = result.offspring;
    breeding.ready = true;
    breeding.everBredOnce = true;
    // Every one of the four candidates was rescaled to this exact shared
    // TOTAL (see PROJECT.md section 2) — persisted here so the result UI
    // can display "TOTAL x -> y" without re-deriving it (see
    // BreedScreen.ts).
    breeding.strongerParentTotal = result.strongerParentTotal;
    breeding.breedTargetTotal = result.breedTargetTotal;

    if (breeding.dayStarted === 1) this.state.day1YellowGuaranteeUsed = true;
    if (breeding.dayStarted === 5) this.state.day5MutationGuaranteeUsed = true;

    let discoveredSomething = false;
    for (const color of result.newlyDiscoveredColors) {
      if (!this.state.discoveredColors.includes(color)) {
        this.state.discoveredColors.push(color);
        discoveredSomething = true;
      }
    }
    for (const pattern of result.newlyDiscoveredPatterns) {
      if (!this.state.discoveredPatterns.includes(pattern)) {
        this.state.discoveredPatterns.push(pattern);
        discoveredSomething = true;
      }
    }
    for (const visualId of result.newlyDiscoveredVisualIds) {
      if (this.registerVisualDiscovery(visualId)) discoveredSomething = true;
    }

    if (discoveredSomething) this.state.hasUnseenDiscovery = true;

    this.emit({ type: 'breedingReady' });
    if (discoveredSomething) this.emit({ type: 'traitDiscovered' });
  }

  markDiscoveriesSeen(): void {
    if (this.state.hasUnseenDiscovery) {
      this.state.hasUnseenDiscovery = false;
      this.notify();
    }
  }

  /**
   * Registers a Visual Variety as DISCOVERED (see PROJECT.md section 7),
   * safely at baseline/STABLE Market state with no random move on the
   * discovery day — the single shared path both breeding discovery
   * (resolveBreeding) and Orchard Specimen discovery
   * (maybeGenerateRandomSpecimen/spawnGuaranteedSpecimen) go through.
   * Returns whether it was actually newly discovered (false = already
   * known, a safe no-op).
   */
  private registerVisualDiscovery(visualId: AppleAssetId): boolean {
    if (this.state.discoveredVisualIds.includes(visualId)) return false;
    this.state.discoveredVisualIds.push(visualId);
    this.state.visualMarket[visualId] = initVisualMarketEntry(visualId, this.state.day);
    return true;
  }

  // ----------------------------------------------------------------
  // Orchard Mutation / Breeding Specimen
  // ----------------------------------------------------------------

  /**
   * A Specimen's five stats mutated from `sourceVariety`'s own genetics
   * (see systems/specimen.ts generateSpecimenStats) — never from the
   * Visual's rarity. `baseVisualId` (see types.ts's BreedingSpecimen doc
   * comment) is set once, here, and never re-derived later: a Common-tier
   * specimen is its own stable base; a Rare/Epic-tier specimen inherits
   * the planted source Line's OWN baseVisualId (never its visualId) — see
   * PROJECT.md section 10.
   */
  private buildSpecimen(visualId: AppleAssetId, sourceVariety: Variety): BreedingSpecimen {
    const baseVisualId = deriveSpecimenBaseVisualId(visualId, sourceVariety.baseVisualId);
    const [sweetness, size, yieldStat, growth, freshness] = generateSpecimenStats(statsOf(sourceVariety));
    return {
      id: crypto.randomUUID(),
      visualId,
      baseVisualId,
      sweetness: Math.round(sweetness),
      size: Math.round(size),
      yieldStat: Math.round(yieldStat),
      growth: Math.round(growth),
      freshness: Math.round(freshness),
      foundDay: this.state.day,
      sourceLineId: sourceVariety.id,
      sourceGeneration: sourceVariety.generation,
    };
  }

  /** Day-1/Day-2 guaranteed onboarding Specimen (see PROJECT.md section 3) — idempotent via the day1/day2SpecimenGuaranteeUsed flags, so this is always safe to call on every load/day-transition. */
  private maybeSpawnGuaranteedSpecimen(): void {
    if (this.state.day === 1 && !this.state.day1SpecimenGuaranteeUsed) {
      this.spawnGuaranteedSpecimen('C2');
      this.state.day1SpecimenGuaranteeUsed = true;
    } else if (this.state.day === 2 && !this.state.day2SpecimenGuaranteeUsed) {
      const visualId = chooseDay2GuaranteedVisual(this.state.discoveredVisualIds);
      this.spawnGuaranteedSpecimen(visualId);
      this.state.day2SpecimenGuaranteeUsed = true;
    }
  }

  /** Forces one existing active fruit slot on a planted Field ripe immediately (the one tutorial exception — see PROJECT.md section 3) and attaches a freshly generated Specimen to it, no new productive-slot capacity added. */
  private spawnGuaranteedSpecimen(visualId: AppleAssetId): void {
    const fieldIndex = chooseGuaranteedSpecimenFieldIndex(this.state.fields, (varietyId) => this.getVariety(varietyId)?.baseVisualId, visualId);
    if (fieldIndex < 0) return;
    const field = this.state.fields[fieldIndex];
    const sourceVariety = this.getVariety(field.varietyId);
    if (!sourceVariety) return;
    const activeIndex = field.slots.findIndex((s) => s.active);
    if (activeIndex < 0) return;

    const slot = field.slots[activeIndex];
    slot.ripe = true;
    slot.timer = 0;
    slot.specimen = this.buildSpecimen(visualId, sourceVariety);
    if (this.registerVisualDiscovery(visualId)) this.state.hasUnseenDiscovery = true;
  }

  /**
   * Day-3+ per-ripened-fruit random Specimen roll (see PROJECT.md section
   * 4) — called the instant an ordinary fruit slot becomes ripe. Folds in
   * the planted Line's own Rare/Epic Mutation Affinity, if any (see
   * systems/specimen.ts rollOrchardSpecimen). Safe no-op (ordinary fruit)
   * if nothing fires or no valid alternate Visual exists. The Genetic
   * Exceptional roll (see maybeGenerateExceptionalSpecimen below) is only
   * ever attempted when this existing Visual Mutation roll does NOT fire —
   * a single fruit can never be both (see PROJECT.md "Exceptional Specimen
   * genetics core" integration, section 2).
   */
  private maybeGenerateRandomSpecimen(slot: FieldFruitSlot, sourceVariety: Variety, policy: CultivationPolicy): void {
    const roll = rollOrchardSpecimen(this.state.day, sourceVariety.baseVisualId, sourceVariety.visualId, this.state.discoveredVisualIds);
    if (roll) {
      slot.specimen = this.buildSpecimen(roll.visualId, sourceVariety);
      if (this.registerVisualDiscovery(roll.visualId)) this.state.hasUnseenDiscovery = true;
      return;
    }
    const exceptional = this.maybeGenerateExceptionalSpecimen(sourceVariety, policy);
    if (exceptional) slot.specimen = exceptional;
  }

  /**
   * Day-3+ Genetic Exceptional roll (see PROJECT.md "Exceptional Specimen
   * genetics core" and systems/exceptional.ts) — a separate, independent
   * 0.6% (`TUNING.EXCEPTIONAL_OCCURRENCE_CHANCE`) roll attempted only when
   * the ripened fruit did NOT already produce a Visual Mutation specimen
   * above. Source genetics are the planted Line's own five Stats; the
   * Field's current Cultivation policy is passed straight through so the
   * genetics core's own focus-bias applies (see selectFocusStat) — it never
   * changes the occurrence chance itself. A result identical to the source
   * Line's own Stats (the genetics core's valid 360-cap HIGH_POTENTIAL
   * fallback) is deliberately treated as an ordinary, non-Specimen fruit
   * rather than a hollow "EXCEPTIONAL" reveal — no reroll/retry. Visual
   * identity is always the source Line's own ordinary production visual
   * (`baseVisualId`), never its special `visualId` — an Exceptional apple
   * looks exactly like the rest of the crop (see PROJECT.md section 6).
   */
  private maybeGenerateExceptionalSpecimen(sourceVariety: Variety, policy: CultivationPolicy): BreedingSpecimen | null {
    if (this.state.day < TUNING.EXCEPTIONAL_START_DAY) return null;
    if (Math.random() >= TUNING.EXCEPTIONAL_OCCURRENCE_CHANCE) return null;

    const source: StatSet = {
      sweetness: sourceVariety.sweetness,
      size: sourceVariety.size,
      yieldStat: sourceVariety.yieldStat,
      growth: sourceVariety.growth,
      freshness: sourceVariety.freshness,
    };
    const result = generateExceptionalSpecimen(source, policy);
    if (STAT_KEYS.every((k) => result.stats[k] === source[k])) return null;

    return {
      id: crypto.randomUUID(),
      visualId: sourceVariety.baseVisualId,
      baseVisualId: sourceVariety.baseVisualId,
      sweetness: result.stats.sweetness,
      size: result.stats.size,
      yieldStat: result.stats.yieldStat,
      growth: result.stats.growth,
      freshness: result.stats.freshness,
      foundDay: this.state.day,
      sourceLineId: sourceVariety.id,
      sourceGeneration: sourceVariety.generation,
      exceptionalArchetype: result.archetype,
      exceptionalFocusStat: result.focusStat,
    };
  }

  /** Builds a breeding-parent view of a held Specimen — color/pattern are borrowed from its source Line (a Specimen doesn't persist its own; see types.ts's BreedingSpecimen doc comment), falling back to a neutral default only if that Line is somehow gone. `baseVisualId` is already correct on the specimen itself (set once at creation — see buildSpecimen), so it's simply passed through. */
  private breedParentFromSpecimen(specimen: BreedingSpecimen): BreedParent {
    const sourceLine = this.getVariety(specimen.sourceLineId);
    return {
      visualId: specimen.visualId,
      baseVisualId: specimen.baseVisualId,
      color: sourceLine?.color ?? 'Red',
      pattern: sourceLine?.pattern ?? 'Plain',
      sweetness: specimen.sweetness,
      size: specimen.size,
      yieldStat: specimen.yieldStat,
      growth: specimen.growth,
      freshness: specimen.freshness,
      generation: specimen.sourceGeneration,
    };
  }

  private resolveBreedParentRef(ref: BreedParentRef): BreedParent | undefined {
    if (ref.kind === 'LINE') return this.getVariety(ref.id);
    const specimen = this.state.specimens.find((s) => s.id === ref.id);
    return specimen ? this.breedParentFromSpecimen(specimen) : undefined;
  }

  /** Removes and returns the specimen with this id from the held inventory — the atomic consumption step (see startBreeding). Null if it's already gone (shouldn't normally happen; defensive against a stale ref). */
  private consumeSpecimen(id: string): BreedingSpecimen | null {
    const idx = this.state.specimens.findIndex((s) => s.id === id);
    if (idx < 0) return null;
    const [specimen] = this.state.specimens.splice(idx, 1);
    return specimen;
  }

  // ----------------------------------------------------------------
  // Orchard actions
  // ----------------------------------------------------------------
  /**
   * Harvests a single ripe fruit slot on a field. That slot goes dormant
   * (leaves the productive set) and a different currently-dormant physical
   * slot is rotated in to take its place in the productive set (see
   * `pickNextProductiveSlot`) — the productive-slot *count* always stays
   * exactly at the Line's Yield-defined capacity, but *which* 15 physical
   * positions are currently productive keeps shifting over time, so no
   * position is permanently dead just because Yield < 100. Harvesting never
   * awards cash directly: the apple is priced right now (locking in this
   * field's current cultivation policy plus the current market/shipping
   * multipliers — see `priceHarvestedApple`) and pushed onto the ONE shared
   * farm-wide `state.processingQueue`; it ships (and actually pays out)
   * later, from `update()`, once it reaches the front of that queue.
   *
   * A normal (non-Specimen) apple can only enter the queue while it has
   * free Packing capacity (see PROJECT.md "Shipping Infrastructure",
   * `packingCapacity()`) — if it's already full, this is a no-op: the
   * exact fruit stays ripe on its exact slot (no regrow-slot rotation, no
   * queue item, no revenue), a `'packingFull'` event fires for UI feedback,
   * and this returns false. A Specimen is NEVER capacity-gated. Returns
   * true iff the fruit was actually removed from the tree (either into the
   * Specimen inventory or the processing queue) — callers (the Orchard's
   * click/sweep visuals in particular) use this to decide whether to play
   * the harvest-pop animation at all.
   */
  harvestFruitSlot(fieldId: number, slotIndex: number): boolean {
    const field = this.getField(fieldId);
    if (!field || !field.varietyId) return false;
    const slot = field.slots[slotIndex];
    if (!slot || !slot.active || !slot.ripe) return false;
    const variety = this.getVariety(field.varietyId);
    if (!variety) return false;

    // Captured before this slot's own specimen field is cleared below —
    // this is the ONE path every harvest route (direct click/sweep,
    // HARVEST ALL, Closing's automatic ripe-fruit collection) shares, so a
    // Specimen is preserved into the inventory identically no matter which
    // route reached it (see PROJECT.md section 8).
    const specimen = slot.specimen;

    // Packing Capacity gate — Specimens are exempt (see PROJECT.md
    // "Shipping Infrastructure" section 3). Checked BEFORE any mutation so
    // a blocked normal apple is left in every respect exactly as it was.
    if (!specimen && this.state.processingQueue.length >= this.packingCapacity()) {
      this.emit({ type: 'packingFull' });
      return false;
    }

    slot.ripe = false;
    slot.active = false;
    slot.timer = 0;
    slot.specimen = null;

    const nextIndex = pickNextProductiveSlot(field.slots, slotIndex);
    const nextSlot = field.slots[nextIndex];
    nextSlot.active = true;
    nextSlot.ripe = false;
    nextSlot.specimen = null;
    nextSlot.timer = fruitRegrowSeconds(variety.growth, this.state.irrigationLevel);

    if (specimen) {
      // Never sold, never shipped, never repriced/rerolled — the exact
      // specimen generated when this fruit appeared is what's kept.
      this.state.specimens.push(specimen);
      this.emit({ type: 'specimenAcquired', specimen });
      // Satisfies both onboarding step A (harvest an apple) and step B (find
      // the Specimen) at once if the player finds the Specimen first — see
      // PROJECT.md "Onboarding robustness" (advanceOnboardingTo only ever
      // moves forward, so this is safe regardless of which step is current).
      this.advanceOnboardingTo('OPEN_BREED');
      this.notify();
      return true;
    }

    const { value, baseValue } = priceHarvestedApple(variety, field, this.state);
    // Freshness V1: the apple's exact genetic Freshness is frozen here,
    // alongside its Market-adjusted value, the instant it enters the queue —
    // never re-derived later from whatever Line currently happens to be
    // planted (see PROJECT.md "Freshness" section 4). Packing wait starts
    // at 0 and only advances once this item is actually sitting in the
    // queue (see update()).
    this.state.processingQueue.push({ fieldId, value, baseValue, freshness: variety.freshness, packingWaitSeconds: 0 });
    // Only (re)arm the timer when the queue was empty — an apple arriving
    // behind others already in line must not reset the head's remaining
    // processing time.
    if (this.state.processingQueue.length === 1) {
      this.state.processingTimer = this.processingCadenceSeconds();
    }

    // Onboarding step A: harvest a normal apple (see PROJECT.md
    // "First-session onboarding").
    this.advanceOnboardingTo('FIND_SPECIMEN');
    this.notify();
    return true;
  }

  plantVariety(fieldId: number, varietyId: string): void {
    const field = this.getField(fieldId);
    if (!field || !field.unlocked) return;
    const variety = this.getVariety(varietyId);
    field.varietyId = varietyId;
    field.slots = makeInitialFruitSlots(
      0,
      variety?.growth ?? 50,
      this.state.irrigationLevel,
      variety ? activeSlotIndices(variety.id, variety.yieldStat) : allSlotsActive(),
    );
    if (field.pendingPolicy) {
      field.policy = field.pendingPolicy;
      field.pendingPolicy = null;
    }
    this.notify();
  }

  setFieldPolicy(fieldId: number, policy: CultivationPolicy): void {
    const field = this.getField(fieldId);
    if (!field) return;
    // Each apple now locks in its cultivation-adjusted price the instant
    // it's harvested (see priceHarvestedApple), so there's no "batch"
    // boundary left to defer a policy change across — it simply applies to
    // whichever fruit is harvested next.
    field.policy = policy;
    field.pendingPolicy = null;
    this.notify();
  }

  buyField(fieldId: number): boolean {
    const field = this.getField(fieldId);
    if (!field || field.unlocked) return false;
    const prevField = this.getField(fieldId - 1);
    if (!prevField?.unlocked) return false;
    if (fieldId === 2 && this.state.day < TUNING.FIELD2_UNLOCK_DAY) return false;
    const price = TUNING.FIELD_PRICES[fieldId];
    if (this.state.cash < price) return false;

    this.state.cash -= price;
    field.unlocked = true;
    field.varietyId = this.state.fields[0].varietyId ?? this.state.library[0].id;
    const newVariety = this.getVariety(field.varietyId);
    field.slots = makeInitialFruitSlots(
      TUNING.NEW_FIELD_GROWTH,
      newVariety?.growth ?? 50,
      this.state.irrigationLevel,
      newVariety ? activeSlotIndices(newVariety.id, newVariety.yieldStat) : allSlotsActive(),
    );
    field.policy = 'NORMAL';
    field.pendingPolicy = null;
    this.notify();
    return true;
  }

  buyUpgrade(kind: 'IRRIGATION' | 'SHIPPING'): boolean {
    if (kind === 'IRRIGATION') {
      if (this.state.irrigationLevel >= TUNING.IRRIGATION_MAX_LEVEL) return false;
      const price = TUNING.IRRIGATION_PRICES[this.state.irrigationLevel];
      if (this.state.cash < price) return false;
      this.state.cash -= price;
      this.state.irrigationLevel += 1;
    } else {
      if (this.state.shippingLevel >= TUNING.SHIPPING_MAX_LEVEL) return false;
      const price = TUNING.SHIPPING_PRICES[this.state.shippingLevel];
      if (this.state.cash < price) return false;
      this.state.cash -= price;
      this.state.shippingLevel += 1;
    }
    this.notify();
    return true;
  }

  /**
   * Permanent Packing Capacity upgrade (see PROJECT.md "Shipping
   * Infrastructure" section 9) — deducts the exact cost immediately,
   * persists the new level, never refunds, never exceeds
   * TUNING.PACKING_MAX_LEVEL. Never touches Operating Cost, and never
   * deletes/truncates existing processingQueue items even though it can
   * only ever grow capacity. Purchasing itself is instantaneous — no game
   * time is consumed (see PROJECT.md section 15).
   */
  buyPackingCapacityUpgrade(): boolean {
    const cost = packingUpgradeCost(this.state.packingCapacityLevel);
    if (cost === null || this.state.cash < cost) return false;
    this.state.cash -= cost;
    this.state.packingCapacityLevel += 1;
    this.notify();
    return true;
  }

  /**
   * Permanent Shipping Speed upgrade (see PROJECT.md "Shipping
   * Infrastructure" section 10) — same purchasing rules as
   * buyPackingCapacityUpgrade. Deliberately does NOT touch
   * `processingTimer`: a mid-processing head item already has its own
   * remaining-time countdown running (see update()'s Shipping drain), and
   * the new, faster cadence is only read the next time an interval is
   * scheduled (`processingCadenceSeconds()`/shippingCadenceSeconds()), so
   * the currently-running item is never retroactively rescaled.
   */
  buyShippingSpeedUpgrade(): boolean {
    const cost = shippingSpeedUpgradeCost(this.state.shippingSpeedLevel);
    if (cost === null || this.state.cash < cost) return false;
    this.state.cash -= cost;
    this.state.shippingSpeedLevel += 1;
    this.notify();
    return true;
  }

  // ----------------------------------------------------------------
  // Breeding actions
  // ----------------------------------------------------------------
  canStartBreeding(): boolean {
    return this.state.dayActive && !this.state.breeding.active;
  }

  breedingCost(): number {
    return this.state.breeding.everBredOnce ? TUNING.BREED_COST : TUNING.BREED_FIRST_COST;
  }

  breedingDuration(): number {
    return this.state.breeding.everBredOnce ? TUNING.BREED_DURATION_SEC : TUNING.BREED_FIRST_DURATION_SEC;
  }

  /**
   * Starts breeding from either a permanent Library Line or a held
   * Breeding Specimen in each slot (see PROJECT.md section 9). The same
   * Specimen id cannot occupy both slots; Line self-cross remains fully
   * allowed. A Specimen parent is consumed here, atomically with starting
   * breeding — not later on KEEP (see PROJECT.md section 10) — so its data
   * is snapshotted into breeding.parentA/BSpecimenSnapshot for
   * resolveBreeding to use once it can no longer be looked up live.
   */
  startBreeding(parentA: BreedParentRef, parentB: BreedParentRef): boolean {
    if (!this.canStartBreeding()) return false;
    const cost = this.breedingCost();
    if (this.state.cash < cost) return false;
    if (parentA.kind === 'SPECIMEN' && parentB.kind === 'SPECIMEN' && parentA.id === parentB.id) return false;

    const resolvedA = this.resolveBreedParentRef(parentA);
    const resolvedB = this.resolveBreedParentRef(parentB);
    if (!resolvedA || !resolvedB) return false;

    this.state.cash -= cost;

    const specimenSnapshotA = parentA.kind === 'SPECIMEN' ? this.consumeSpecimen(parentA.id) : null;
    const specimenSnapshotB = parentB.kind === 'SPECIMEN' ? this.consumeSpecimen(parentB.id) : null;

    // recentParentIds tracks permanent Lines only (see types.ts doc
    // comment) — recordRecentParents already collapses a repeated id into
    // one entry, which is exactly the behavior wanted when only one side is
    // a Line.
    if (parentA.kind === 'LINE' && parentB.kind === 'LINE') this.recordRecentParents(parentA.id, parentB.id);
    else if (parentA.kind === 'LINE') this.recordRecentParents(parentA.id, parentA.id);
    else if (parentB.kind === 'LINE') this.recordRecentParents(parentB.id, parentB.id);

    this.state.breeding = {
      active: true,
      parentAId: parentA.id,
      parentAKind: parentA.kind,
      parentASpecimenSnapshot: specimenSnapshotA,
      parentBId: parentB.id,
      parentBKind: parentB.kind,
      parentBSpecimenSnapshot: specimenSnapshotB,
      elapsed: 0,
      duration: this.breedingDuration(),
      dayStarted: this.state.day,
      ready: false,
      offspring: null,
      everBredOnce: this.state.breeding.everBredOnce,
      strongerParentTotal: null,
      breedTargetTotal: null,
    };
    // Onboarding step D: choose parents and start breeding.
    this.advanceOnboardingTo('KEEP_OFFSPRING');
    this.notify();
    return true;
  }

  /**
   * True if the Library already contains at least one kept Line with this
   * visualId. Deliberately derived from the Library rather than tracked as
   * separate state — "OWNED" has exactly one source of truth.
   */
  isVisualIdOwned(visualId: Variety['visualId']): boolean {
    return this.state.library.some((v) => v.visualId === visualId);
  }

  /**
   * Commits exactly one of the four pending offspring candidates as a new
   * permanent Library Line, discards the other three (their stats/budget
   * are never persisted — only whichever visualIds they revealed remain
   * DISCOVERED, already recorded back in resolveBreeding()), and clears
   * the pending breeding result. Returns the created Line, or null if
   * there was nothing to keep — which also makes this naturally safe
   * against double-invocation: the first call clears
   * `breeding.ready`/`breeding.offspring`, so a second call (rapid
   * double-click, a stray repeated handler) sees `!breeding.ready` and
   * no-ops instead of inserting a second Line.
   */
  keepOffspring(slot: 'A' | 'B' | 'C' | 'D'): Variety | null {
    const breeding = this.state.breeding;
    if (!breeding.ready || !breeding.offspring) return null;
    const chosen = breeding.offspring.find((o) => o.slot === slot);
    if (!chosen) return null;

    const variety: Variety = {
      id: chosen.id,
      customName: chosen.customName,
      generation: chosen.generation,
      color: chosen.color,
      pattern: chosen.pattern,
      visualId: chosen.visualId,
      baseVisualId: chosen.baseVisualId,
      sweetness: chosen.sweetness,
      size: chosen.size,
      yieldStat: chosen.yieldStat,
      growth: chosen.growth,
      freshness: chosen.freshness,
      createdDay: chosen.createdDay,
      awards: [],
      favorite: false,
      archived: false,
    };
    this.state.library.push(variety);
    this.state.highestSweetnessEver = Math.max(this.state.highestSweetnessEver, variety.sweetness);
    this.state.largestSizeEver = Math.max(this.state.largestSizeEver, variety.size);

    this.state.breeding = {
      active: false,
      parentAId: null,
      parentAKind: 'LINE',
      parentASpecimenSnapshot: null,
      parentBId: null,
      parentBKind: 'LINE',
      parentBSpecimenSnapshot: null,
      elapsed: 0,
      duration: 0,
      dayStarted: this.state.day,
      ready: false,
      offspring: null,
      everBredOnce: true,
      strongerParentTotal: null,
      breedTargetTotal: null,
    };
    // Onboarding step E: keep an offspring — the final onboarding step (see
    // advanceOnboardingTo, which emits 'onboardingComplete' on this exact
    // transition).
    this.advanceOnboardingTo('COMPLETE');
    this.notify();
    return variety;
  }

  /**
   * Renames only `customName` on an existing Library Line — never
   * visualId/rarity/catalog number. Trims whitespace and caps length;
   * rejects an empty-after-trim name (returns false, leaving the existing
   * name untouched) rather than silently no-oping.
   */
  renameLine(lineId: string, newName: string): boolean {
    const line = this.getVariety(lineId);
    if (!line) return false;
    const trimmed = newName.trim().slice(0, 24);
    if (trimmed.length === 0) return false;
    line.customName = trimmed;
    this.notify();
    return true;
  }

  // ----------------------------------------------------------------
  // Contests (see PROJECT.md "Contest")
  // ----------------------------------------------------------------

  /**
   * Eligible Contest entries: permanent Library Lines only (see PROJECT.md
   * section 6) — never a held Specimen, never a merely-DISCOVERED Visual
   * with no owned Line. Archived Lines are excluded, same convention as the
   * normal Parent Picker (see types.ts's Variety.archived doc comment) —
   * they're never deleted, just hidden from normal selection contexts.
   */
  contestEligibleLines(): Variety[] {
    return this.state.library.filter((l) => !l.archived);
  }

  /**
   * Creates today's ContestState the first time Closing's Final Shipment
   * queue empties on a Contest Day (called only from update() — see the
   * `isContestDay` branch there), and no-ops on every later call the same
   * day. Returns whether it actually created (changed) anything, so the
   * caller can fold that into its own `changed`/notify() bookkeeping.
   */
  private advanceContestGate(): boolean {
    if (this.state.contest && this.state.contest.day === this.state.day) return false;
    this.state.contest = {
      day: this.state.day,
      type: contestTypeForDay(this.state.day)!,
      resolved: false,
      entryLineId: null,
      playerScore: null,
      npcResults: null,
      rank: null,
      prize: 0,
    };
    this.emit({ type: 'contestGateReached' });
    return true;
  }

  /**
   * Locks the player's Contest entry (or explicitly no entry — `lineId =
   * null`, the defensive fallback for a corrupted/legacy save with zero
   * eligible Lines, see PROJECT.md section 12's "do not softlock" note) and
   * generates the ENTIRE Contest outcome in this one call: the player's
   * score (base formula + one luck roll), all 5 NPC scores (fixed
   * per-Contest target + one small variation roll each), rank, and prize.
   * Everything is persisted onto `state.contest` before this returns, so a
   * reload after this point can never re-roll luck/NPC results (see
   * PROJECT.md sections 13/19) — calling this again once `resolved` is
   * already true is therefore a safe no-op (returns null), not a reroll.
   * The selected Line itself is never consumed/mutated/removed — Contest
   * entry only ever reads a Line's genetics (see PROJECT.md section 6/21).
   */
  confirmContestEntry(lineId: string | null): ContestState | null {
    const contest = this.state.contest;
    if (!contest || contest.day !== this.state.day || contest.resolved) return null;
    const line = lineId ? this.getVariety(lineId) : undefined;
    if (lineId !== null && (!line || line.archived)) return null;

    contest.entryLineId = lineId;
    contest.playerScore = line ? contestScore(contest.type, line, rollContestLuck()) : null;

    const npcTargets = npcTargetsForContestNumber(contestNumberForDay(contest.day));
    contest.npcResults = TUNING.CONTEST_NPC_NAMES.map((name, i) => ({
      name,
      score: Math.max(TUNING.CONTEST_SCORE_MIN, Math.min(TUNING.CONTEST_SCORE_MAX, npcTargets[i] + rollNpcVariation())),
    }));

    const entries = [
      ...(contest.playerScore !== null ? [{ id: 'PLAYER', score: contest.playerScore }] : []),
      ...contest.npcResults.map((n) => ({ id: n.name, score: n.score })),
    ];
    const ranked = rankContestEntries(entries);
    const rank = contest.playerScore !== null ? ranked.findIndex((e) => e.id === 'PLAYER') + 1 : null;
    const prize = rank !== null ? prizeForRank(rank) : 0;

    contest.rank = rank;
    contest.prize = prize;
    contest.resolved = true;

    // The selected Line itself is never mutated by entering (see PROJECT.md
    // section 21 — Contest entry only ever READS a Line's genetics) — a
    // placing result is recorded in contestHistory below instead of on the
    // Line's own `awards` array.
    if (prize > 0) {
      this.state.cash += prize;
      this.state.dayContestPrize += prize;
    }
    this.state.contestHistory.push({ day: contest.day, type: contest.type, rank, prize });

    this.emit({ type: 'contestResolved' });
    this.notify();
    return contest;
  }

  /**
   * The ONLY path that runs Closing's deferred settlement on a Contest Day
   * — called by the UI once the player has clicked past the Results screen
   * (see PROJECT.md section 11/17). Deliberately requires `contest.resolved`
   * so EndDayModal can never appear before the Contest has completed, and
   * requires `state.closing` (finishClosing() flips it false) so a second
   * click/call can never settle twice. Returns whether it actually ran.
   */
  continueFromContestResults(): boolean {
    if (!this.state.closing || !this.state.contest || this.state.contest.day !== this.state.day || !this.state.contest.resolved) return false;
    this.finishClosing();
    return true;
  }

  // ----------------------------------------------------------------
  // Day cycle
  // ----------------------------------------------------------------
  // A manual END DAY click is allowed any time the day is actually playable
  // — early ending sacrifices remaining growth time by design (see
  // beginClosing) rather than being blocked until 18:00.
  canEndDay(): boolean {
    return !this.state.dayEnded && !this.state.closing;
  }

  /**
   * The ONE shared Closing procedure — triggered automatically at 18:00
   * (dayTimeRemaining hits 0, see update()) and by a manual END DAY click,
   * always through this exact same method. Idempotent: a second call while
   * already closing/ended is a no-op, so repeated clicks/calls can never
   * collect or pay twice. See PROJECT.md "Shipping Infrastructure" sections
   * 6-8 for the full capacity-aware sequence this implements:
   *
   *  1. Freezes growth immediately (state.closing also gates the regrow
   *     loop in update()) — partially-grown fruit is left untouched, never
   *     force-ripened.
   *  2. Secures every currently-ripe Specimen across all unlocked/planted
   *     Fields FIRST, through the same harvestFruitSlot() path normal
   *     harvesting uses — Packing Capacity never applies to a Specimen, so
   *     this can never be blocked by a full queue.
   *  3. ONE normal-fruit collection pass: computes the Packing Box's
   *     currently-free slots (capacity minus whatever's already queued),
   *     ranks every remaining ripe normal apple by its CURRENT harvest sale
   *     value (highest first, ties broken by field order then slot index —
   *     both already the natural iteration/array order below, and
   *     Array.sort is stable), and harvests only that many, highest-value
   *     first. Any normal ripe apple that doesn't fit stays ripe on its
   *     exact slot, untouched, and survives into the next day (see
   *     PROJECT.md section 8 — it is priced at whatever Market rate is
   *     current WHEN it's eventually actually harvested, never today's).
   *
   * Collected fruit joins the existing shared Processing Queue; update()
   * then drains it at the accelerated Final Shipment cadence
   * (processingCadenceSeconds) and calls finishClosing() once it's empty —
   * settlement itself is deliberately NOT done here, so Final Shipment
   * revenue is always included before the day's summary is computed. This
   * is a single collection pass only: nothing here ever goes back to the
   * trees for a second round after the queue drains (see finishClosing),
   * which is what keeps Packing Capacity meaningful during Closing instead
   * of a repeated collect-then-flush loop erasing it.
   */
  beginClosing(automatic = false): boolean {
    if (this.state.closing || this.state.dayEnded) return false;
    this.state.dayActive = false;
    this.state.closing = true;
    // See PROJECT.md "18:00 Closing cue" — `automatic` distinguishes the
    // 18:00 timer trigger (update() above) from a manual END DAY click, so
    // the UI can show the surprise-transition cue only for the former.
    this.emit({ type: 'closingBegan', automatic });

    // A still-running normal-cadence head timer is clamped DOWN to the
    // (faster) Final Shipment cadence the instant Closing begins — never
    // lengthened if it was already shorter (see PROJECT.md section 12).
    if (this.state.processingQueue.length > 0) {
      this.state.processingTimer = Math.min(this.state.processingTimer, this.currentFinalShipmentCadenceSeconds());
    }

    // STEP 2 — secure every ripe Specimen first, regardless of Packing
    // capacity (harvestFruitSlot() never capacity-gates a Specimen slot).
    for (const field of this.state.fields) {
      if (!field.unlocked || !field.varietyId) continue;
      const specimenIndices: number[] = [];
      field.slots.forEach((slot, i) => {
        if (slot.ripe && slot.specimen) specimenIndices.push(i);
      });
      for (const i of specimenIndices) this.harvestFruitSlot(field.id, i);
    }

    // STEP 3 — ONE normal-fruit collection pass, highest current sale value
    // first, limited to whatever Packing capacity remains free right now
    // (see PROJECT.md section 7).
    const freeSlots = Math.max(0, this.packingCapacity() - this.state.processingQueue.length);
    if (freeSlots > 0) {
      const candidates: { fieldId: number; slotIndex: number; value: number }[] = [];
      for (const field of this.state.fields) {
        if (!field.unlocked || !field.varietyId) continue;
        const variety = this.getVariety(field.varietyId);
        if (!variety) continue;
        field.slots.forEach((slot, i) => {
          if (!slot.ripe || slot.specimen) return;
          const { value } = priceHarvestedApple(variety, field, this.state);
          candidates.push({ fieldId: field.id, slotIndex: i, value });
        });
      }
      // Descending by value only — Array.sort is stable, so ties keep this
      // array's own build order, which is already field order then slot
      // index (deterministic tie-break per PROJECT.md section 7).
      candidates.sort((a, b) => b.value - a.value);
      for (const c of candidates.slice(0, freeSlots)) {
        this.harvestFruitSlot(c.fieldId, c.slotIndex);
      }
    }

    this.notify();
    return true;
  }

  /**
   * Runs once the Processing Queue has fully drained after beginClosing()
   * (called only from update() — see the `state.closing` check there),
   * completing the settlement ordering: Closing begins -> ripe fruit
   * collected -> Final Shipment queue finishes -> Operating Cost deducted
   * -> day accounting finalizes -> dayEnded becomes the completed
   * closed-day state. Flipping `closing` false and `dayEnded` true
   * together here (rather than `dayEnded` at the start of Closing, as the
   * old same-tick endDay() did) is what keeps Final Shipment revenue
   * attributed to the closing day instead of leaking into the next one
   * (see the dayHarvestRevenue/dayMarketBonus guard in update()) — and, by
   * the same construction, guarantees Operating Cost is only ever deducted
   * here, exactly once, strictly after Final Shipment has fully paid out.
   */
  private finishClosing(): void {
    // dayHarvestRevenue/dayMarketBonus accumulate exact, unrounded per-apple
    // LOCKED dollars all day (see priceHarvestedApple) — i.e. before
    // Freshness decay; dayFreshnessLoss (see PROJECT.md "Freshness" section
    // 10) is the exact, unrounded sum of what Freshness decay took back out
    // of those same shipments; dayContestPrize is always an exact
    // whole-dollar amount (see Game.confirmContestEntry / TUNING.CONTEST_PRIZES).
    // Round the LOCKED shipment total to the nearest CENT (not whole
    // dollar) once, then derive harvestRevenue by rounding just that
    // component and marketBonus as the remainder, so the two displayed line
    // items always sum exactly to the rounded locked whole — exactly as
    // before this pass. Separately round the REALIZED (post-Freshness)
    // total once too, and derive freshnessLoss as the remainder between the
    // two rounded totals, so harvestRevenue + marketBonus - freshnessLoss
    // reconciles to the rounded realized total exactly, to the cent, by the
    // same "round once, derive the rest as a remainder" construction used
    // throughout this method — never two independently-rounded figures that
    // could disagree by a cent.
    const dayShipmentRevenueLocked = this.state.dayHarvestRevenue + this.state.dayMarketBonus;
    const dayShipmentRevenueRealized = dayShipmentRevenueLocked - this.state.dayFreshnessLoss;
    const combinedLockedCents = Math.round(dayShipmentRevenueLocked * 100);
    const harvestRevenueCents = Math.round(this.state.dayHarvestRevenue * 100);
    const marketBonusCents = combinedLockedCents - harvestRevenueCents;
    const harvestRevenue = harvestRevenueCents / 100;
    const marketBonus = marketBonusCents / 100;
    const combinedRealizedCents = Math.round(dayShipmentRevenueRealized * 100);
    const freshnessLossCents = combinedLockedCents - combinedRealizedCents;
    const freshnessLoss = freshnessLossCents / 100;
    const contestPrize = this.state.dayContestPrize;

    const operatingCostAmount = operatingCost(this.state.day, this.unlockedFields().length);
    const net = harvestRevenue + marketBonus - freshnessLoss + contestPrize - operatingCostAmount;

    // `cash` has been accumulating today's exact, unrounded REALIZED
    // (post-Freshness) shipment revenue in real time all day, plus contest
    // revenue (see update()'s Shipping drain and the contest-submission
    // methods) — full fractional precision is preserved there deliberately,
    // and untouched by this pass beyond paying `realizedValue` instead of
    // the locked `item.value` per shipment. Here, at the one settlement
    // boundary per day, subtract that exact raw REALIZED revenue
    // (dayShipmentRevenueRealized, not the locked total) back out and
    // replace it with `net` — built from the exact same rounded
    // harvestRevenue/marketBonus/freshnessLoss/contestPrize figures the
    // summary above displays — so the displayed cash change for this settlement is
    // guaranteed to equal displayed Net to the cent BY CONSTRUCTION (both
    // derive from the identical rounded numbers), not merely "usually":
    // independently re-rounding a separately-accumulated cash total here
    // instead (as a first pass at this fix did) can disagree with the
    // summary by exactly $0.01 on adversarial fractional inputs landing on
    // a half-cent boundary, since floating-point addition isn't
    // associative — two differently-ordered sums of the same values don't
    // always land on the same side of a rounding boundary. `Math.round`
    // here only re-snaps negligible floating-point residue (real apple
    // economy inputs are nowhere near that boundary) — it never touches
    // whatever ELSE moved cash today (Field/Irrigation/Shipping purchases,
    // breeding costs — already exact whole-dollar amounts).
    const nonRevenueCash = Math.round((this.state.cash - dayShipmentRevenueRealized - contestPrize) * 100) / 100;
    this.state.cash = nonRevenueCash + net;

    const log: DayLogEntry = {
      day: this.state.day,
      harvestRevenue,
      marketBonus,
      freshnessLoss,
      contestPrize,
      operatingCost: operatingCostAmount,
      net,
    };
    this.state.lastDayLog = log;
    this.state.closing = false;
    this.state.dayEnded = true;
    this.emit({ type: 'dayClosed' });
  }

  proceedToNextDay(): void {
    if (!this.state.dayEnded) return;
    // The one-time "WEEK 1 COMPLETE" gate fires exactly on the Day 7 -> 8
    // transition (`=== 7`, not `>= 7`) — Contest V1 needs every later day
    // (8, 9, ..., 35, ...) to advance normally through this same method
    // instead of re-triggering that gate forever after Day 7, which is what
    // the original `>= 7` check did (it's true on every day from 7 onward,
    // so every single day-end past Day 7 would re-show the Week Summary
    // modal and refuse to actually advance the day until STARTWEEK2 was
    // clicked again). See PROJECT.md "Contest" for why continuous play
    // through Day 35+ is required.
    if (this.state.day === 7) {
      this.state.weekComplete = true;
      this.notify();
      return;
    }
    this.advanceDayInternal();
  }

  startNextWeek(): void {
    this.state.weekComplete = false;
    this.advanceDayInternal();
  }

  private advanceDayInternal(): void {
    this.state.day += 1;
    this.state.dayTimeRemaining = TUNING.DAY_DURATION_SEC;
    this.state.dayActive = true;
    this.state.dayEnded = false;
    this.state.closing = false;
    // ONE Market update per game day, for every currently DISCOVERED Visual
    // Variety (see systems/market.ts advanceDailyMarket) — belongs to this
    // day transition, not a realtime ticker, and never runs again until the
    // next transition (a reload can't trigger a second same-day update
    // since this method only runs from proceedToNextDay/startNextWeek).
    advanceDailyMarket(this.state.visualMarket, this.state.discoveredVisualIds, this.state.day);
    this.state.dayHarvestRevenue = 0;
    this.state.dayMarketBonus = 0;
    this.state.dayContestPrize = 0;
    this.state.dayFreshnessLoss = 0;
    // Pre-Closing warning resets every day (see PROJECT.md "Pre-Closing
    // warning") — may fire at most once per NEW day.
    this.state.closingWarningShown = false;
    // Handles the Day 1->2 transition spawning the Day-2 guarantee
    // immediately (rather than only on the next reload) — safe/idempotent
    // on every other day transition since it's gated on day===1/day===2.
    this.maybeSpawnGuaranteedSpecimen();
    // Anchors the Market discoverability hint's fallback trigger (see
    // PROJECT.md "Market discoverability") — the UI shows it at most once
    // ever, guarded by state.marketHintShown, regardless of how many times
    // this event fires.
    this.emit({ type: 'dayAdvanced' });
    this.notify();
  }
}
