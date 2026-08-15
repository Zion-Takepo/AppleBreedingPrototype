import { TUNING } from '../tuning.ts';
import type { BreedingSpecimen, DayLogEntry, GameState, Variety } from '../types.ts';
import { APPLE_RARITY } from '../render/appleAssets.ts';
import { activeSlotIndices, allSlotsActive, makeInitialFruitSlots } from './economy.ts';
import { initVisualMarketEntry } from './market.ts';
import { freshStarterLines, STARTER_GREEN } from './starterLines.ts';

export function saveState(state: GameState): void {
  try {
    localStorage.setItem(TUNING.SAVE_KEY, JSON.stringify(state));
  } catch {
    // storage unavailable — ignore in prototype
  }
}

// Saves written before the visual-rarity pass don't have `visualId` on
// their varieties or a `discoveredVisualIds` list. Backfill both with a
// safe, always-unlocked default (C1) rather than crashing on load — exact
// visual fidelity for old saves isn't important, just not breaking them.
// Backfills a Variety-shaped object with the two traits (Growth, Freshness)
// added in the five-trait pass, without resetting any existing Sweetness/
// Size/Yield. Applied to library varieties and any in-flight offspring.
function backfillTraits(variety: Partial<Variety>): void {
  if (typeof variety.growth !== 'number') variety.growth = 50;
  if (typeof variety.freshness !== 'number') variety.freshness = 50;
}

// Backfills the Library-pass fields: the `name` -> `customName` rename
// (old saves have `name`; safe even though the current type no longer
// declares it) and the new favorite/archived flags, defaulted off so no
// existing Line silently becomes a favorite or gets hidden from pickers.
function backfillLineFields(variety: Partial<Variety> & { name?: string }): void {
  if (typeof variety.customName !== 'string') variety.customName = variety.name ?? 'UNNAMED';
  if (typeof variety.favorite !== 'boolean') variety.favorite = false;
  if (typeof variety.archived !== 'boolean') variety.archived = false;
}

// Saves from before the "Revise Rare / Epic Line behavior" pass have no
// `baseVisualId` at all. A Common Line's is always its own visualId — that
// part is always exactly recoverable. A Rare/Epic Line's true historical
// baseVisualId depends on parent lineage this codebase has never tracked
// on a Variety (Lines don't record parentIds), so there's no real
// provenance to recover for THOSE specifically — falling back to its own
// visualId is the same "safe fallback over fabrication" the rest of this
// file already uses (e.g. the very old visualId backfill below), not a
// perfect reconstruction, but never a crash and never invented data.
function backfillLineBaseVisual(variety: Partial<Variety>): void {
  if (typeof variety.baseVisualId !== 'string' && variety.visualId) {
    variety.baseVisualId = variety.visualId;
  }
}

// Specimens DO record `sourceLineId`, so — unlike Lines — a Rare/Epic
// Specimen's baseVisualId can actually be recovered from its still-present
// source Line (already migrated by the time this runs; see migrateState's
// ordering) rather than merely falling back to its own visualId.
function backfillSpecimenBaseVisual(specimen: Partial<BreedingSpecimen> | null | undefined, library: Variety[]): void {
  if (!specimen || typeof specimen.baseVisualId === 'string' || !specimen.visualId) return;
  if (APPLE_RARITY[specimen.visualId] === 'COMMON') {
    specimen.baseVisualId = specimen.visualId;
    return;
  }
  const sourceLine = library.find((v) => v.id === specimen.sourceLineId);
  specimen.baseVisualId = sourceLine?.baseVisualId ?? specimen.visualId;
}

function migrateState(state: GameState): void {
  if (!state.discoveredVisualIds) state.discoveredVisualIds = ['C1', 'C2'];

  // Market V1 replaces the old temporary color/pattern-based
  // marketModifiers bridge with per-Visual-Variety Market state. Old saves
  // have no `visualMarket` at all (or it may be missing entries for a
  // visualId discovered after the save was last written) — there is no
  // unambiguous mapping from the old bridge's values onto this new
  // per-visual shape, so per PROJECT.md's migration guidance every
  // currently DISCOVERED Visual Variety is simply initialized safely at
  // baseline/STABLE and begins normal Market updates from the next day
  // transition onward, exactly like a freshly discovered variety would.
  if (typeof state.visualMarket !== 'object' || state.visualMarket === null) {
    state.visualMarket = {} as GameState['visualMarket'];
  }
  for (const visualId of state.discoveredVisualIds) {
    if (!state.visualMarket[visualId]) state.visualMarket[visualId] = initVisualMarketEntry(visualId, state.day);
  }

  // Saves from before the Library pass may have no library at all (or an
  // empty one) — seed the same two starting Lines a brand-new game gets,
  // so the player always has usable breeding parents rather than a dead
  // end. Existing progress elsewhere in the save is untouched.
  if (!Array.isArray(state.library) || state.library.length === 0) {
    state.library = freshStarterLines();
  }
  if (!Array.isArray(state.recentParentIds)) state.recentParentIds = [];

  // Saves from before the Orchard Mutation / Breeding Specimen pass have no
  // specimen inventory or guarantee bookkeeping at all. Per PROJECT.md
  // section 16, a save still on Day 1 or Day 2 is allowed to receive that
  // day's still-applicable guarantee once (handled by
  // Game.maybeSpawnGuaranteedSpecimen, gated on these same flags — never
  // here) — a Day 3+ save simply never gets a Day-1/Day-2 specimen
  // retroactively, which falling through to `false` here already ensures.
  if (!Array.isArray(state.specimens)) state.specimens = [];
  if (typeof state.day1SpecimenGuaranteeUsed !== 'boolean') state.day1SpecimenGuaranteeUsed = false;
  if (typeof state.day2SpecimenGuaranteeUsed !== 'boolean') state.day2SpecimenGuaranteeUsed = false;
  if (state.breeding) {
    const breeding = state.breeding as GameState['breeding'] & { parentAKind?: unknown; parentBKind?: unknown };
    if (breeding.parentAKind !== 'LINE' && breeding.parentAKind !== 'SPECIMEN') state.breeding.parentAKind = 'LINE';
    if (breeding.parentBKind !== 'LINE' && breeding.parentBKind !== 'SPECIMEN') state.breeding.parentBKind = 'LINE';
    if (state.breeding.parentASpecimenSnapshot === undefined) state.breeding.parentASpecimenSnapshot = null;
    if (state.breeding.parentBSpecimenSnapshot === undefined) state.breeding.parentBSpecimenSnapshot = null;
    // Saves from before the Breed TOTAL-progression pass have neither field.
    if (typeof state.breeding.strongerParentTotal !== 'number') state.breeding.strongerParentTotal = null;
    if (typeof state.breeding.breedTargetTotal !== 'number') state.breeding.breedTargetTotal = null;
  }

  // Saves from before the global Shipping Pipeline pass have no farm-wide
  // processing queue at all (they used a since-removed per-field
  // harvestedSinceReward counter instead) — start with an empty line rather
  // than losing/crashing on load. Nothing meaningful can be reconstructed
  // for any fruit that was mid-batch under the old bridge.
  if (!Array.isArray(state.processingQueue)) state.processingQueue = [];
  if (typeof state.processingTimer !== 'number') state.processingTimer = 0;

  // Saves from before the Shipping Infrastructure pass have no
  // packingCapacityLevel/shippingSpeedLevel at all — both default to Level
  // 1 (see PROJECT.md "Shipping Infrastructure" section 17). Deliberately
  // does NOT delete/truncate an existing over-capacity `processingQueue`
  // (a save written before this pass could have more items queued than
  // Level 1's capacity) — harvestFruitSlot's capacity gate only blocks NEW
  // items from entering while occupancy >= capacity, so an over-capacity
  // legacy queue simply drains naturally instead of losing history.
  if (typeof state.packingCapacityLevel !== 'number') state.packingCapacityLevel = 1;
  if (typeof state.shippingSpeedLevel !== 'number') state.shippingSpeedLevel = 1;

  // Saves from before the Day Cycle pass have no `closing` flag at all —
  // default to false (not mid-Closing). A save written WHILE `closing` was
  // already true resumes safely as-is: update() keeps draining the
  // Processing Queue at the Final Shipment cadence and calls finishClosing()
  // once it's empty, exactly as it would have without the reload — no
  // duplicate collection/payout and no permanent Closing stall.
  if (typeof state.closing !== 'boolean') state.closing = false;

  // Saves from before the Operating Cost pass persisted the settled day's
  // expense figure under `lastDayLog.expenses`; the field was renamed to
  // `operatingCost` (same value, no formula change to the already-settled
  // number) when the flat dailyExpenses() bridge was replaced. A reload
  // landing between Closing finishing and the summary modal being clicked
  // through re-displays this exact persisted object (see MainScene.create())
  // without recomputing it, so remap the old key rather than showing a
  // corrupted/undefined Operating Cost row.
  if (state.lastDayLog) {
    const legacyLog = state.lastDayLog as DayLogEntry & { expenses?: number };
    if (typeof legacyLog.operatingCost !== 'number' && typeof legacyLog.expenses === 'number') {
      legacyLog.operatingCost = legacyLog.expenses;
    }
  }

  // Root-cause fix for GREEN BASIC visually showing the red C1 apple: this
  // fallback used to blindly assign 'C1' to *any* Line missing a visualId
  // (from saves written before the visual-rarity pass existed at all),
  // which incorrectly overwrote the legacy starter-green entry too. Target
  // it narrowly by the starter Line's own stable id instead of blanket-
  // defaulting everything to C1 — a bred Line never has this id (bred
  // Lines get a fresh crypto.randomUUID()), so this can't misfire onto a
  // legitimate bred Line that merely happens to be named "GREEN BASIC".
  for (const variety of state.library) {
    if (!variety.visualId) variety.visualId = variety.id === STARTER_GREEN.id ? STARTER_GREEN.visualId : 'C1';
    backfillTraits(variety);
    backfillLineFields(variety);
    backfillLineBaseVisual(variety);
  }
  if (state.breeding?.offspring) {
    for (const offspring of state.breeding.offspring) {
      if (!offspring.visualId) offspring.visualId = 'C1';
      if (offspring.isNewVisualId === undefined) offspring.isNewVisualId = false;
      backfillTraits(offspring);
      backfillLineFields(offspring);
      backfillLineBaseVisual(offspring);
    }
  }

  // Specimen baseVisualId backfill — deliberately AFTER the library loop
  // above, since Rare/Epic specimens recover their baseVisualId from their
  // (by-then-already-migrated) source Line where possible. Covers every
  // place a Specimen can persist: the held inventory, an in-flight
  // breeding snapshot, and one still sitting unharvested on a fruit slot
  // (the latter is backfilled below, alongside this pass's other per-slot
  // migration work).
  for (const specimen of state.specimens) backfillSpecimenBaseVisual(specimen, state.library);
  if (state.breeding) {
    backfillSpecimenBaseVisual(state.breeding.parentASpecimenSnapshot, state.library);
    backfillSpecimenBaseVisual(state.breeding.parentBSpecimenSnapshot, state.library);
  }

  // Saves written before the continuous-orchard pass have a single
  // `growth`/`ready` pair per field instead of 15 independent fruit-slot
  // timers; saves written before the five-trait pass have `slots` but no
  // per-slot `active` flag (every slot was implicitly active). Both are
  // backfilled here rather than crashing or losing the field. Variety
  // traits are migrated above first, so `variety.growth`/`yieldStat` are
  // always safe to read by this point.
  for (const field of state.fields) {
    const variety = field.varietyId ? state.library.find((v) => v.id === field.varietyId) : undefined;
    const active = variety ? activeSlotIndices(variety.id, variety.yieldStat) : null;

    const legacy = field as unknown as { growth?: number; ready?: boolean };
    if (!Array.isArray(field.slots)) {
      const fractionGrown = legacy.ready ? 1 : (legacy.growth ?? 0);
      field.slots = makeInitialFruitSlots(fractionGrown, variety?.growth ?? 50, state.irrigationLevel ?? 0, active ?? allSlotsActive());
    } else {
      if (active) {
        for (let i = 0; i < field.slots.length; i++) {
          const slot = field.slots[i];
          if (typeof slot.active !== 'boolean') slot.active = active.has(i);
          if (!slot.active) {
            slot.ripe = false;
            slot.timer = 0;
          }
        }
      }
      // Saves from before the Specimen pass have no per-slot `specimen`
      // field at all — backfill null (never fabricate a historical
      // specimen) regardless of whether `active` could be computed above.
      // A specimen that DOES already exist here (an unharvested special
      // fruit) gets its own baseVisualId backfilled too, same as any other
      // Specimen.
      for (const slot of field.slots) {
        if (typeof slot.specimen === 'undefined') slot.specimen = null;
        else backfillSpecimenBaseVisual(slot.specimen, state.library);
      }
    }
    // The old per-field batch-deferral rule (pendingPolicy waiting for a
    // 15-fruit boundary) no longer exists — fold any stale pending value
    // from an old save straight into `policy` rather than leaving it
    // permanently stuck and never applied.
    if (field.pendingPolicy) {
      field.policy = field.pendingPolicy;
      field.pendingPolicy = null;
    }
  }
}

export function loadState(): GameState | null {
  try {
    const raw = localStorage.getItem(TUNING.SAVE_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw) as GameState;
    migrateState(state);
    return state;
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(TUNING.SAVE_KEY);
  } catch {
    // ignore
  }
}
