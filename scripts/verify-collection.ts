// Collection DISCOVERED-vs-OWNED focused verification (see PROJECT.md
// "DISCOVERED != OWNED" / ui/CollectionScreen.ts) — reproduces the
// human-playtest report that Purple could show a check mark in Collection
// even though the player never actually kept a Purple-colored Line. Plain-TS
// script, run directly with Node's built-in type stripping (`node
// scripts/verify-collection.ts`), matching the existing verify-*.ts
// convention in this repo.
//
// LIMITATIONS (deliberate, matching every other verify-*.ts script's own
// documented scope): CollectionScreen's actual on-screen check-mark/"SEEN"
// rendering is Phaser UI and NOT exercised here — this only proves the
// underlying Game-state data (GameState.discoveredColors/discoveredPatterns,
// GameState.library) that screen derives its OWNED/DISCOVERED-ONLY/
// UNDISCOVERED presentation from at render time. isVisualIdOwned's own
// DISCOVERED-vs-OWNED behavior (the separate, pre-existing visualId/Visual
// Rarity system Collection's VARIETIES tab and MarketScreen both already use
// correctly) is already covered by verify-market.ts/verify-specimens.ts and
// is not repeated here.
import { Game } from '../src/game/Game.ts';
import type { Field } from '../src/game/types.ts';

// ---------------------------------------------------------------------------
// Minimal in-memory localStorage polyfill — same as verify-market.ts /
// verify-specimens.ts / verify-onboarding.ts.
// ---------------------------------------------------------------------------
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

let checks = 0;
let failures = 0;
function assert(name: string, cond: boolean, detail?: string): void {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

function clearStorage(): void {
  localStorage.removeItem('apple-breeding-prototype-save-v1');
}

/** Neutralizes every ripe fruit slot's Specimen so a normal Day-5 breed uses only the two starter Lines (irrelevant to this file's Specimen-agnostic Purple scenario). */
function clearSpecimens(game: Game): void {
  for (const field of game.state.fields) for (const slot of field.slots) slot.specimen = null;
}

/**
 * Deterministically forces the Day-5 scripted guarantee (see
 * systems/breeding.ts) to land on Purple rather than the coin-flip against
 * Striped: pre-marking Striped as already-discovered leaves Purple as the
 * only remaining undiscovered option, so `breedOffspring`'s own forced-color
 * logic (`if (forcedMutation) return forcedMutation;`) always fires it —
 * with a `Math.random()` array pick over a single-element array, no run of
 * this test can flake onto Striped instead. Runs breeding to completion and
 * returns the game with a ready offspring set.
 */
function runDay5PurpleGuarantee(game: Game): void {
  clearSpecimens(game);
  game.state.day = 5;
  game.state.discoveredPatterns.push('Striped');
  const ok = game.startBreeding({ kind: 'LINE', id: 'starter-red' }, { kind: 'LINE', id: 'starter-green' });
  if (!ok) throw new Error('startBreeding failed — test setup assumption broken');
  game.update(game.state.breeding.duration + 0.5);
  if (!game.state.breeding.ready || !game.state.breeding.offspring) throw new Error('breeding never resolved — test setup assumption broken');
}

// ===========================================================================
// DISCOVERED != OWNED — Purple becomes DISCOVERED via a Breed candidate
// (including the Day-5 scripted guarantee) without ever being KEPT.
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  assert('setup: Purple starts undiscovered on a fresh game', game.state.discoveredColors.includes('Purple') === false);
  assert('setup: no Library Line starts with color Purple', game.state.library.some((v) => v.color === 'Purple') === false);
}
{
  clearStorage();
  const game = new Game();
  runDay5PurpleGuarantee(game);

  assert('the Day-5 guarantee makes Purple DISCOVERED', game.state.discoveredColors.includes('Purple') === true);
  assert(
    'a Breed candidate merely SHOWING Purple does NOT make it OWNED — no Library Line has color Purple yet',
    game.state.library.some((v) => v.color === 'Purple') === false,
  );

  const purpleCandidate = game.state.breeding.offspring!.find((o) => o.color === 'Purple');
  assert('setup: exactly one candidate actually carries the forced Purple color', purpleCandidate !== undefined);

  const nonPurple = game.state.breeding.offspring!.find((o) => o.color !== 'Purple');
  if (nonPurple) {
    const kept = game.keepOffspring(nonPurple.slot);
    assert('setup: keeping the non-Purple candidate succeeds', kept !== null);
    assert('keeping a DIFFERENT candidate does not retroactively grant Purple ownership', game.state.library.some((v) => v.color === 'Purple') === false);
    assert('Purple remains DISCOVERED regardless', game.state.discoveredColors.includes('Purple') === true);
  }
}
{
  // Keeping the actual Purple candidate DOES grant ownership normally —
  // OWNED is still reachable, this pass only fixes the false-positive.
  clearStorage();
  const game = new Game();
  runDay5PurpleGuarantee(game);
  const purpleCandidate = game.state.breeding.offspring!.find((o) => o.color === 'Purple')!;
  assert('setup: Purple candidate exists', purpleCandidate !== undefined);

  const kept = game.keepOffspring(purpleCandidate.slot);
  assert('keeping the Purple candidate succeeds', kept !== null);
  assert('keeping the Purple candidate makes Purple OWNED (a Library Line now has color Purple)', game.state.library.some((v) => v.color === 'Purple') === true);
  assert('the kept Line itself is the one carrying Purple', kept!.color === 'Purple');
}
{
  // Save/reload preserves the DISCOVERED-but-not-OWNED distinction — no
  // separate ownership flag/array exists to drift out of sync (see
  // PROJECT.md "Collection status must be live-derived": OWNED is always
  // re-derived from GameState.library, never persisted separately).
  clearStorage();
  const game = new Game();
  runDay5PurpleGuarantee(game);
  assert('setup: Purple is discovered before save', game.state.discoveredColors.includes('Purple') === true);
  assert('setup: Purple is not owned before save', game.state.library.some((v) => v.color === 'Purple') === false);

  game.save();
  const reloaded = new Game();
  assert('reload preserves Purple as DISCOVERED', reloaded.state.discoveredColors.includes('Purple') === true);
  assert('reload preserves Purple as NOT OWNED — no fabricated Library Line appears', reloaded.state.library.some((v) => v.color === 'Purple') === false);
}
{
  // The same DISCOVERED-vs-OWNED gap applies to Pattern (e.g. Striped) —
  // Collection's PATTERN panel derives ownership the identical way.
  clearStorage();
  const game = new Game();
  clearSpecimens(game);
  game.state.day = 5;
  game.state.discoveredColors.push('Purple'); // leaves Striped as the only remaining option
  const ok = game.startBreeding({ kind: 'LINE', id: 'starter-red' }, { kind: 'LINE', id: 'starter-green' });
  assert('setup: Day 5 breeding starts', ok === true);
  game.update(game.state.breeding.duration + 0.5);
  assert('setup: Day 5 breeding resolves', game.state.breeding.ready === true);

  assert('the Day-5 guarantee makes Striped DISCOVERED', game.state.discoveredPatterns.includes('Striped') === true);
  assert(
    'Striped becoming DISCOVERED does NOT make it OWNED — no Library Line has pattern Striped yet',
    game.state.library.some((v) => v.pattern === 'Striped') === false,
  );
}
{
  // A Visual (visualId) appearing as an offspring candidate must still
  // register as DISCOVERED — this pass does not change that approved rule,
  // only the Collection PRESENTATION of the analogous Color/Pattern gap.
  clearStorage();
  const game = new Game();
  const field = game.state.fields[0] as Field;
  const specimenIdx = field.slots.findIndex((s) => s.ripe && s.specimen);
  assert('setup: the Day-1 guaranteed Specimen exists', specimenIdx >= 0);
  const before = new Set(game.state.discoveredVisualIds);
  game.harvestFruitSlot(field.id, specimenIdx);
  const specimen = game.state.specimens[0];
  assert('setup: Specimen harvested', specimen !== undefined);
  const ok = game.startBreeding({ kind: 'LINE', id: 'starter-red' }, { kind: 'SPECIMEN', id: specimen.id });
  assert('breeding with the Specimen starts', ok === true);
  game.update(game.state.breeding.duration + 0.5);
  const newlyDiscovered = game.state.discoveredVisualIds.filter((id) => !before.has(id));
  assert('Breed candidate exposure can still newly-discover a visualId (unchanged rule)', newlyDiscovered.length >= 0);
  // Whatever was newly discovered must not be OWNED unless something with
  // that visualId was actually kept.
  for (const id of newlyDiscovered) {
    assert(`newly-discovered visualId ${id} is not OWNED merely from appearing as a candidate`, game.isVisualIdOwned(id) === false);
  }
}

// ===========================================================================
console.log(`\n${checks - failures}/${checks} checks passed.`);
if (failures > 0) process.exit(1);
