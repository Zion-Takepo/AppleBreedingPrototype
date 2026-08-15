import type { Variety } from '../types.ts';

// The two starting Owned Lines — used both for a brand-new game
// (Game.ts createInitialState) and to backfill a Library for saves written
// before the Library existed at all (save.ts migrateState). Kept in their
// own module (rather than defined in Game.ts) so save.ts can import them
// without a Game.ts <-> save.ts circular dependency.
export const STARTER_RED: Variety = {
  id: 'starter-red',
  customName: 'RED BASIC',
  generation: 1,
  color: 'Red',
  pattern: 'Plain',
  visualId: 'C1',
  baseVisualId: 'C1',
  sweetness: 50,
  size: 50,
  yieldStat: 50,
  growth: 50,
  freshness: 50,
  createdDay: 1,
  awards: [],
  favorite: false,
  archived: false,
};

export const STARTER_GREEN: Variety = {
  id: 'starter-green',
  customName: 'GREEN BASIC',
  generation: 1,
  color: 'Green',
  pattern: 'Plain',
  visualId: 'C2',
  baseVisualId: 'C2',
  sweetness: 55,
  size: 45,
  yieldStat: 55,
  growth: 50,
  freshness: 50,
  createdDay: 1,
  awards: [],
  favorite: false,
  archived: false,
};

/**
 * Fresh, independent copies of both starters (own `awards` array too, not
 * a shared reference) for inserting into a live GameState.library. Do NOT
 * put the STARTER_RED/STARTER_GREEN module-level consts directly into a
 * GameState — they're shared singletons, and Library entries get mutated
 * in place (e.g. `variety.awards.push(...)` on a contest win); pushing the
 * singleton itself would let that mutation leak into every future
 * resetPrototype()/new-game within the same page session.
 */
export function freshStarterLines(): [Variety, Variety] {
  return [
    { ...STARTER_RED, awards: [] },
    { ...STARTER_GREEN, awards: [] },
  ];
}
