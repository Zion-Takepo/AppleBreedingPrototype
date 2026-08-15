import { TUNING } from '../tuning.ts';
import type { GameState, Variety } from '../types.ts';
import { activeSlotIndices, allSlotsActive, makeInitialFruitSlots } from './economy.ts';
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

function migrateState(state: GameState): void {
  if (!state.discoveredVisualIds) state.discoveredVisualIds = ['C1', 'C2'];

  // Saves from before the Library pass may have no library at all (or an
  // empty one) — seed the same two starting Lines a brand-new game gets,
  // so the player always has usable breeding parents rather than a dead
  // end. Existing progress elsewhere in the save is untouched.
  if (!Array.isArray(state.library) || state.library.length === 0) {
    state.library = freshStarterLines();
  }
  if (!Array.isArray(state.recentParentIds)) state.recentParentIds = [];

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
  }
  if (state.breeding?.offspring) {
    for (const offspring of state.breeding.offspring) {
      if (!offspring.visualId) offspring.visualId = 'C1';
      if (offspring.isNewVisualId === undefined) offspring.isNewVisualId = false;
      backfillTraits(offspring);
      backfillLineFields(offspring);
    }
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
    } else if (active) {
      for (let i = 0; i < field.slots.length; i++) {
        const slot = field.slots[i];
        if (typeof slot.active !== 'boolean') slot.active = active.has(i);
        if (!slot.active) {
          slot.ripe = false;
          slot.timer = 0;
        }
      }
    }
    if (typeof field.harvestedSinceReward !== 'number') field.harvestedSinceReward = 0;
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
