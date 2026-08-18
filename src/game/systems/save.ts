import { TUNING } from '../tuning.ts';
import type { BreedingSpecimen, DayLogEntry, GameState, OnboardingStep, Variety } from '../types.ts';
import { APPLE_RARITY } from '../render/appleAssets.ts';
import { activeSlotIndices, allSlotsActive, makeInitialFruitSlots } from './economy.ts';
import { INITIAL_FIRST_RARE_PROTECTION_STATE } from './fieldRarityModel.ts';
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
// Field Rarity Model V2's first-Rare discovery protection (see
// systems/fieldRarityModel.ts and migrateState below) must never re-grant
// pity to a save that has already proven it found a Rare, by any historical
// means (the old lineAffinity roll, a bred discovery, whatever) — checks
// every place a RARE-tier visualId can persist: discovered visuals, the
// Library, held Specimens, an in-flight breeding snapshot, and a Specimen
// still sitting unharvested on a fruit slot. Called from migrateState AFTER
// all of those are already migrated/backfilled above, so every field it
// reads is safe to trust.
function hasEverFoundRareVisual(state: GameState): boolean {
  const isRare = (id: string | undefined | null): boolean => !!id && APPLE_RARITY[id as keyof typeof APPLE_RARITY] === 'RARE';
  if (state.discoveredVisualIds?.some((id) => isRare(id))) return true;
  if (state.library?.some((v) => isRare(v.visualId))) return true;
  if (state.specimens?.some((s) => isRare(s.visualId))) return true;
  if (state.breeding && (isRare(state.breeding.parentASpecimenSnapshot?.visualId) || isRare(state.breeding.parentBSpecimenSnapshot?.visualId))) return true;
  if (state.fields?.some((f) => f.slots?.some((s) => isRare(s.specimen?.visualId)))) return true;
  return false;
}

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

  // Freshness V1 (see PROJECT.md "Freshness" section 17): a save written
  // before this pass has queued ProcessingItems with no `freshness`/
  // `packingWaitSeconds` at all. Per the explicit migration guidance, a
  // missing `freshness` backfills to a neutral 50 (never fabricates the
  // apple's real historical genetic Freshness) and a missing
  // `packingWaitSeconds` backfills to 0 (never retroactively punishes an
  // old save for unknown historical waiting time). `dayFreshnessLoss`
  // itself is a fresh running accumulator, safe to default to 0 regardless
  // of day.
  for (const item of state.processingQueue) {
    const legacyItem = item as { freshness?: number; packingWaitSeconds?: number };
    if (typeof legacyItem.freshness !== 'number') legacyItem.freshness = 50;
    if (typeof legacyItem.packingWaitSeconds !== 'number') legacyItem.packingWaitSeconds = 0;
  }
  if (typeof state.dayFreshnessLoss !== 'number') state.dayFreshnessLoss = 0;

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
    // A settled lastDayLog persisted before Freshness V1 has no
    // freshnessLoss at all — 0 is exactly correct here (that day genuinely
    // had none), unlike the queue backfill above which uses a neutral
    // non-zero default for unknown per-apple state.
    if (typeof legacyLog.freshnessLoss !== 'number') legacyLog.freshnessLoss = 0;
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
      // Line Affinity System (see PROJECT.md "Line Affinity System") —
      // saves from before this pass have no `commonVisualId` at all;
      // backfill null first (never fabricate a historical roll). A slot
      // that's already RIPE, ordinary (no specimen), and still has no
      // persisted roll (a genuinely pre-existing ripe apple, not merely an
      // old save shape) gets ONE roll backfilled here — never re-rolled on
      // a later load — using the safest, non-exploitable "valid result":
      // the planted Line's own baseVisualId, exactly what it was already
      // visually showing/pricing under the old model, never a fresh random
      // (possibly Rare/Epic) roll on mere reload.
      for (const slot of field.slots) {
        if (typeof slot.commonVisualId === 'undefined') slot.commonVisualId = null;
        if (slot.ripe && !slot.specimen && !slot.commonVisualId && variety) {
          slot.commonVisualId = variety.baseVisualId;
        }
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

  // Field Rarity Model V2's first-Rare discovery protection (see
  // systems/fieldRarityModel.ts and PROJECT.md "Field Rarity + Line
  // Affinity Probability Model V2") — a save written before this pass has
  // no `firstRareProtection` at all. Per this pass's own migration
  // guidance: a save that already proves the player found a Rare (by any
  // historical means) initializes protection as permanently completed
  // (never re-grant pity to a veteran save); otherwise the miss streak
  // starts safely at 0, same as a brand-new game. An existing valid
  // `firstRareProtection` object (a save already written by this pass) is
  // trusted as-is, never reinferred.
  if (typeof state.firstRareProtection !== 'object' || state.firstRareProtection === null) {
    state.firstRareProtection = hasEverFoundRareVisual(state) ? { hasFoundRare: true, missStreak: 0 } : { ...INITIAL_FIRST_RARE_PROTECTION_STATE };
  }

  // First-session onboarding (see PROJECT.md "First-session onboarding")
  // — a save written before this pass has no `onboarding` at all. Rather
  // than always restarting an experienced save's tutorial from step 1 (a
  // confusing regression for someone already deep into the game), infer
  // "already experienced" from existing save data — having ever bred, or
  // owning more Lines than the two starters — and skip straight to
  // COMPLETE for those saves; a save that's still genuinely fresh (Day 1,
  // only the two starter Lines, never bred) starts the guide normally. Only
  // ever runs for a save with no `onboarding` field at all — an existing
  // in-progress onboarding save (post-this-pass) is validated, not
  // reinferred.
  const legacyOnboarding = (state as Partial<GameState>).onboarding;
  if (!legacyOnboarding || typeof legacyOnboarding !== 'object') {
    const alreadyExperienced = state.breeding?.everBredOnce === true || (Array.isArray(state.library) && state.library.length > 2);
    state.onboarding = { step: alreadyExperienced ? 'COMPLETE' : 'HARVEST_APPLE', dismissed: false };
    if (typeof state.marketHintShown !== 'boolean') state.marketHintShown = alreadyExperienced;
  } else {
    const validSteps: OnboardingStep[] = ['HARVEST_APPLE', 'FIND_SPECIMEN', 'OPEN_BREED', 'START_BREED', 'KEEP_OFFSPRING', 'COMPLETE'];
    if (!validSteps.includes(legacyOnboarding.step)) state.onboarding.step = 'HARVEST_APPLE';
    if (typeof legacyOnboarding.dismissed !== 'boolean') state.onboarding.dismissed = false;
  }
  if (typeof state.marketHintShown !== 'boolean') state.marketHintShown = false;

  // Pre-Closing warning consolidation (see PROJECT.md "Pre-Closing
  // warning") — replaced the old two-flag (17:30/17:50) pair with one
  // clean `closingWarningShown` flag. A save written before this pass has
  // no `closingWarningShown` at all; if either legacy flag was already
  // true, the player is already past 17:00 too (17:00 is strictly earlier
  // than both old thresholds), so the new flag safely starts true to avoid
  // a surprise late-day warning firing on reload — otherwise it starts
  // false exactly like a save that predates the whole pre-closing-warning
  // feature.
  if (typeof state.closingWarningShown !== 'boolean') {
    const legacy = state as unknown as { closingWarning30Shown?: boolean; closingWarning10Shown?: boolean };
    state.closingWarningShown = legacy.closingWarning30Shown === true || legacy.closingWarning10Shown === true;
  }

  // Contest V1 (see PROJECT.md "Contest") replaced the old Day 4 Sweetness
  // Contest / Day 7 Apple Fair placeholder entirely — a save written before
  // this pass has no `contest`/`contestHistory` at all (its old
  // `contestResults`/`day4ContestDone`/`day7FairDone` fields, if present,
  // are simply left as harmless unread JSON residue rather than explicitly
  // migrated, since nothing in the new system reads them). `contest: null`
  // is exactly correct regardless of which day the save is on — the new
  // gate only ever creates a non-null ContestState from inside
  // Game.update()'s own Contest Day Closing flow, never here.
  if (typeof state.contest === 'undefined') state.contest = null;
  if (!Array.isArray(state.contestHistory)) state.contestHistory = [];
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
