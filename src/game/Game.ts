import { TUNING } from './tuning.ts';
import type {
  ContestResult,
  CultivationPolicy,
  DayLogEntry,
  Field,
  GameState,
  Variety,
} from './types.ts';
import { breedOffspring } from './systems/breeding.ts';
import {
  activeSlotIndices,
  allSlotsActive,
  dailyExpenses,
  fairCompositeScore,
  fruitRegrowSeconds,
  makeInitialFruitSlots,
  pickNextProductiveSlot,
  priceHarvestedApple,
  sweetnessContestScore,
} from './systems/economy.ts';
import { computeMarketForDay } from './systems/market.ts';
import { clearSave, loadState, saveState } from './systems/save.ts';
import { freshStarterLines, STARTER_GREEN, STARTER_RED } from './systems/starterLines.ts';

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
    recentParentIds: [],
    discoveredColors: ['Red', 'Green'],
    discoveredPatterns: ['Plain'],
    discoveredVisualIds: ['C1', 'C2'],
    processingQueue: [],
    processingTimer: 0,
    breeding: {
      active: false,
      parentAId: null,
      parentBId: null,
      elapsed: 0,
      duration: 0,
      dayStarted: 1,
      ready: false,
      offspring: null,
      everBredOnce: false,
    },
    irrigationLevel: 0,
    shippingLevel: 0,
    marketModifiers: computeMarketForDay(1),
    totalRevenue: 0,
    contestResults: [],
    day4ContestDone: false,
    day7FairDone: false,
    day5MutationGuaranteeUsed: false,
    day1YellowGuaranteeUsed: false,
    lastDayLog: null,
    dayEnded: false,
    weekComplete: false,
    dayHarvestRevenue: 0,
    dayMarketBonus: 0,
    dayContestPrize: 0,
    highestSweetnessEver: Math.max(STARTER_RED.sweetness, STARTER_GREEN.sweetness),
    largestSizeEver: Math.max(STARTER_RED.size, STARTER_GREEN.size),
    hasUnseenDiscovery: false,
  };
}

export type GameEvent =
  | { type: 'shipment'; fieldId: number; revenue: number }
  | { type: 'breedingReady' }
  | { type: 'traitDiscovered' }
  | { type: 'changed' };

type Listener = (event: GameEvent) => void;

export class Game {
  state: GameState;
  private listeners: Listener[] = [];

  constructor() {
    this.state = loadState() ?? createInitialState();
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
    this.notify();
  }

  getVariety(id: string | null): Variety | undefined {
    if (!id) return undefined;
    return this.state.library.find((v) => v.id === id);
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
  update(dtSeconds: number): void {
    let changed = false;

    if (this.state.dayActive) {
      this.state.dayTimeRemaining = Math.max(0, this.state.dayTimeRemaining - dtSeconds);
      if (this.state.dayTimeRemaining <= 0) {
        this.state.dayActive = false;
      }
      changed = true;
    }

    // Each of the 15 fruit slots per field regrows on its own independent
    // timer now — there's no whole-field "growth cycle" to freeze, so
    // slots keep regrowing continuously regardless of which field tab is
    // selected or whether the day is still active (dayActive=false, e.g.
    // the timer simply ran out). Once the day is actually SETTLED
    // (dayEnded — the player clicked END DAY and it resolved), growth
    // freezes: already-ripe fruit stays ripe (skipped below regardless),
    // and partially-grown fruit stops advancing and stays frozen at its
    // current progress rather than silently ripening while the END DAY
    // summary is on screen. This is deliberately narrower than the future
    // Day Cycle/Final Shipment — it only stops new fruit from appearing.
    if (!this.state.dayEnded) {
      for (const field of this.state.fields) {
        if (!field.unlocked || !field.varietyId) continue;
        for (const slot of field.slots) {
          if (!slot.active || slot.ripe) continue;
          slot.timer -= dtSeconds;
          if (slot.timer <= 0) {
            slot.ripe = true;
            changed = true;
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
      this.state.processingTimer -= dtSeconds;
      while (this.state.processingTimer <= 0 && this.state.processingQueue.length > 0) {
        const item = this.state.processingQueue.shift()!;
        // Cash/totalRevenue are always paid — this money was genuinely
        // earned the instant the apple was harvested/priced, regardless of
        // day state. dayHarvestRevenue/dayMarketBonus, however, exist only
        // to feed the CURRENT day's END DAY summary snapshot and get reset
        // to 0 on the next advanceDayInternal(); once the day is already
        // settled (dayEnded) that snapshot has already been taken and shown,
        // so continuing to add to them here would just leak revenue that
        // never appears in any summary. Guarding this (not the queue/cash
        // itself) keeps the queue draining continuously exactly like fruit
        // regrow already does, with no new Day Cycle/Final Shipment logic.
        this.state.cash += item.value;
        this.state.totalRevenue += item.value;
        if (!this.state.dayEnded) {
          this.state.dayHarvestRevenue += item.baseValue;
          this.state.dayMarketBonus += item.value - item.baseValue;
        }
        // Exact, unrounded value — the HUD feedback now displays money to
        // two decimal places, so no rounding belongs here (see HUD.ts).
        this.emit({ type: 'shipment', fieldId: item.fieldId, revenue: item.value });
        changed = true;
        this.state.processingTimer += TUNING.PROCESSING_SECONDS_PER_APPLE;
      }
      if (this.state.processingQueue.length === 0) this.state.processingTimer = 0;
    }

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

  private resolveBreeding(): void {
    const breeding = this.state.breeding;
    const parentA = this.getVariety(breeding.parentAId);
    const parentB = this.getVariety(breeding.parentBId);
    if (!parentA || !parentB) return;

    const result = breedOffspring(parentA, parentB, breeding.dayStarted, this.state);
    breeding.offspring = result.offspring;
    breeding.ready = true;
    breeding.everBredOnce = true;

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
      if (!this.state.discoveredVisualIds.includes(visualId)) {
        this.state.discoveredVisualIds.push(visualId);
        discoveredSomething = true;
      }
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
   */
  harvestFruitSlot(fieldId: number, slotIndex: number): void {
    const field = this.getField(fieldId);
    if (!field || !field.varietyId) return;
    const slot = field.slots[slotIndex];
    if (!slot || !slot.active || !slot.ripe) return;
    const variety = this.getVariety(field.varietyId);
    if (!variety) return;

    slot.ripe = false;
    slot.active = false;
    slot.timer = 0;

    const nextIndex = pickNextProductiveSlot(field.slots, slotIndex);
    const nextSlot = field.slots[nextIndex];
    nextSlot.active = true;
    nextSlot.ripe = false;
    nextSlot.timer = fruitRegrowSeconds(variety.growth, this.state.irrigationLevel);

    const { value, baseValue } = priceHarvestedApple(variety, field, this.state);
    this.state.processingQueue.push({ fieldId, value, baseValue });
    // Only (re)arm the timer when the queue was empty — an apple arriving
    // behind others already in line must not reset the head's remaining
    // processing time.
    if (this.state.processingQueue.length === 1) {
      this.state.processingTimer = TUNING.PROCESSING_SECONDS_PER_APPLE;
    }

    this.notify();
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

  startBreeding(parentAId: string, parentBId: string): boolean {
    if (!this.canStartBreeding()) return false;
    const cost = this.breedingCost();
    if (this.state.cash < cost) return false;
    if (!this.getVariety(parentAId) || !this.getVariety(parentBId)) return false;

    this.state.cash -= cost;
    this.recordRecentParents(parentAId, parentBId);
    this.state.breeding = {
      active: true,
      parentAId,
      parentBId,
      elapsed: 0,
      duration: this.breedingDuration(),
      dayStarted: this.state.day,
      ready: false,
      offspring: null,
      everBredOnce: this.state.breeding.everBredOnce,
    };
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
      parentBId: null,
      elapsed: 0,
      duration: 0,
      dayStarted: this.state.day,
      ready: false,
      offspring: null,
      everBredOnce: true,
    };
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
  // Contests
  // ----------------------------------------------------------------
  submitSweetnessContest(fieldId: number): ContestResult | null {
    if (this.state.day !== TUNING.CONTEST_DAY4.day || this.state.day4ContestDone) return null;
    const field = this.getField(fieldId);
    if (!field || !field.varietyId) return null;
    const variety = this.getVariety(field.varietyId);
    if (!variety) return null;

    const score = Math.round(sweetnessContestScore(variety, field.policy));
    const t = TUNING.CONTEST_DAY4;
    let place: 1 | 2 | 3 | 0 = 0;
    let prize = 0;
    if (score >= t.tier1) {
      place = 1;
      prize = t.prize1;
    } else if (score >= t.tier2) {
      place = 2;
      prize = t.prize2;
    } else if (score >= t.tier3) {
      place = 3;
      prize = t.prize3;
    }

    const result: ContestResult = { day: this.state.day, varietyId: variety.id, varietyName: variety.customName, score, place, prize };
    this.state.contestResults.push(result);
    this.state.day4ContestDone = true;
    if (prize > 0) {
      this.state.cash += prize;
      this.state.dayContestPrize += prize;
      const label = place === 1 ? '🏆 Sweetness Champion' : place === 2 ? '🥈 Sweetness Runner-up' : '🥉 Sweetness Finalist';
      variety.awards.push(`${label} — Day ${this.state.day}`);
    }
    this.notify();
    return result;
  }

  submitFair(fieldId: number): ContestResult | null {
    if (this.state.day !== TUNING.FAIR_DAY7.day || this.state.day7FairDone) return null;
    const field = this.getField(fieldId);
    if (!field || !field.varietyId) return null;
    const variety = this.getVariety(field.varietyId);
    if (!variety) return null;

    const score = Math.round(fairCompositeScore(variety, field.policy));
    const t = TUNING.FAIR_DAY7;
    let place: 1 | 2 | 3 | 0 = 0;
    let prize = 0;
    if (score >= t.tier1) {
      place = 1;
      prize = t.prize1;
    } else if (score >= t.tier2) {
      place = 2;
      prize = t.prize2;
    } else if (score >= t.tier3) {
      place = 3;
      prize = t.prize3;
    }

    const result: ContestResult = { day: this.state.day, varietyId: variety.id, varietyName: variety.customName, score, place, prize };
    this.state.contestResults.push(result);
    this.state.day7FairDone = true;
    if (prize > 0) {
      this.state.cash += prize;
      this.state.dayContestPrize += prize;
      const label = place === 1 ? '🏆 Apple Fair Champion' : place === 2 ? '🥈 Apple Fair Runner-up' : '🥉 Apple Fair Finalist';
      variety.awards.push(`${label} — Day ${this.state.day}`);
    }
    this.notify();
    return result;
  }

  // ----------------------------------------------------------------
  // Day cycle
  // ----------------------------------------------------------------
  canEndDay(): boolean {
    return this.state.dayTimeRemaining <= 0 && !this.state.dayEnded;
  }

  endDay(): DayLogEntry | null {
    if (!this.canEndDay()) return null;
    const expenses = dailyExpenses(this.unlockedFields().length);
    this.state.cash -= expenses;

    // dayHarvestRevenue/dayMarketBonus accumulate exact, unrounded per-apple
    // dollars all day (see priceHarvestedApple) — round only here, for the
    // summary. Round the combined total once, then derive harvestRevenue by
    // rounding just that component and marketBonus as the remainder, so the
    // two displayed line items always sum to the rounded whole rather than
    // each independently rounding away a few cents in the same direction
    // (which could otherwise silently drift net by a dollar).
    const combined = this.state.dayHarvestRevenue + this.state.dayMarketBonus;
    const harvestRevenue = Math.round(this.state.dayHarvestRevenue);
    const marketBonus = Math.round(combined) - harvestRevenue;
    const net = harvestRevenue + marketBonus + this.state.dayContestPrize - expenses;

    const log: DayLogEntry = {
      day: this.state.day,
      harvestRevenue,
      marketBonus,
      contestPrize: this.state.dayContestPrize,
      expenses,
      net,
    };
    this.state.lastDayLog = log;
    this.state.dayEnded = true;
    this.notify();
    return log;
  }

  proceedToNextDay(): void {
    if (!this.state.dayEnded) return;
    if (this.state.day >= 7) {
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
    this.state.marketModifiers = computeMarketForDay(this.state.day);
    this.state.dayHarvestRevenue = 0;
    this.state.dayMarketBonus = 0;
    this.state.dayContestPrize = 0;
    this.notify();
  }
}
