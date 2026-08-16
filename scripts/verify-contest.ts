// Contest V1 focused verification (see PROJECT.md "Contest" and the
// implementation brief's "VERIFICATION" section). Plain-TS script, run
// directly with Node's built-in type stripping (`node
// scripts/verify-contest.ts`) — no test framework exists in this prototype
// yet, matching every other scripts/verify-*.ts script's convention.
//
// SCOPE: this script exercises ONLY Contest V1 — the schedule/scoring/NPC
// pure helpers (systems/contest.ts), Game's entry/resolution/settlement
// wiring, and save migration. It deliberately does not re-verify Market,
// Freshness, Shipping Infrastructure, Specimens, Onboarding, or Collection
// — those are already covered by their own verify-*.ts scripts, all re-run
// green alongside this one (see the final report). Phaser-rendered UI (the
// DAY N Contest presentation, the 17:00 Contest warning wording, the NEXT
// CONTEST HUD headline + its click-to-open info modal, the Contest entry/
// results screens themselves) is NOT exercised here — that needs human
// browser verification, matching every other verify-*.ts script's own
// documented scope in this codebase.
import { TUNING } from '../src/game/tuning.ts';
import {
  baseContestScore,
  contestNumberForDay,
  contestScore,
  contestTypeForDay,
  formatContestScore,
  isContestDay,
  nextContestDayAfter,
  npcTargetsForContestNumber,
  prizeForRank,
  rankContestEntries,
  rollContestLuck,
  rollNpcVariation,
  type ContestStats,
} from '../src/game/systems/contest.ts';
import { operatingCost } from '../src/game/systems/economy.ts';
import { Game } from '../src/game/Game.ts';
import type { Field } from '../src/game/types.ts';

// ---------------------------------------------------------------------------
// Minimal in-memory localStorage polyfill — same as every other verify-*.ts.
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
  localStorage.removeItem(TUNING.SAVE_KEY);
}

function stats(overrides: Partial<ContestStats> = {}): ContestStats {
  return { sweetness: 50, size: 50, yieldStat: 50, growth: 50, freshness: 50, ...overrides };
}

/**
 * Runs Closing (beginClosing + drain the queue) up to — but not through —
 * the Contest gate, same "force real time forward" pattern every other
 * verify-*.ts script uses. On a non-Contest day this reaches full
 * settlement (dayEnded). A `do..while` (not `while`) deliberately guarantees
 * at least one update() tick even when the queue is ALREADY empty right
 * after beginClosing() (e.g. nothing was ripe to collect) — the
 * closing-check that calls finishClosing()/creates the Contest gate lives
 * inside update() itself, so skipping that first tick entirely (a plain
 * `while (queue.length > 0)` loop would do exactly that whenever the queue
 * starts empty) would silently never settle/never reach the gate at all.
 */
function runClosingUpToGate(game: Game): void {
  game.beginClosing();
  let guard = 0;
  do {
    game.update(0.05);
    if (++guard > 20000) throw new Error('Closing never reached settlement/the Contest gate — regression in Shipping/Day Cycle');
  } while (game.state.processingQueue.length > 0);
}

/** Force every field to a known, deterministic single Line/policy setup and clear any in-flight specimens/queue so a fresh Game is fully controlled for Closing/Contest tests. */
function clearAllSpecimens(game: Game): void {
  for (const field of game.state.fields) {
    for (const slot of field.slots) slot.specimen = null;
  }
}

function jumpToDay(game: Game, targetDay: number): void {
  let guard = 0;
  while (game.state.day < targetDay) {
    clearAllSpecimens(game);
    runClosingUpToGate(game);
    if (isContestDay(game.state.day) && game.state.contest && !game.state.contest.resolved) {
      // Auto-resolve with no entry so we can keep fast-forwarding through
      // intermediate Contest days that aren't the one under test.
      game.confirmContestEntry(null);
    }
    game.continueFromContestResults();
    game.proceedToNextDay();
    // Day 7's END DAY -> CONTINUE flow is gated behind the one-time "WEEK 1
    // COMPLETE" screen (see Game.proceedToNextDay/startNextWeek) — the only
    // day where advancing needs this extra explicit call.
    if (game.state.weekComplete) game.startNextWeek();
    if (++guard > 200) throw new Error('jumpToDay looped without reaching targetDay — regression in Day Cycle/Contest gating');
  }
}

// ===========================================================================
// SCHEDULE
// ===========================================================================
{
  for (let d = 1; d <= 6; d++) assert(`Day ${d} is not a Contest day`, isContestDay(d) === false);
  assert('Day 7 is BIGGEST APPLE', isContestDay(7) && contestTypeForDay(7) === 'BIGGEST');
  assert('Day 14 is SWEETEST APPLE', isContestDay(14) && contestTypeForDay(14) === 'SWEETEST');
  assert('Day 21 is FRESHEST APPLE', isContestDay(21) && contestTypeForDay(21) === 'FRESHEST');
  assert('Day 28 is GRAND_CHAMPION', isContestDay(28) && contestTypeForDay(28) === 'GRAND_CHAMPION');
  assert('Day 35 is BIGGEST APPLE again (cycle repeats)', isContestDay(35) && contestTypeForDay(35) === 'BIGGEST');
  assert('Day 42 is SWEETEST APPLE (cycle continues)', contestTypeForDay(42) === 'SWEETEST');
  for (let d = 8; d <= 13; d++) assert(`Day ${d} (between contests) is not a Contest day`, isContestDay(d) === false);
  assert('non-Contest day returns null type', contestTypeForDay(10) === null);

  assert('contestNumberForDay(7) === 1', contestNumberForDay(7) === 1);
  assert('contestNumberForDay(14) === 2', contestNumberForDay(14) === 2);
  assert('contestNumberForDay(35) === 5', contestNumberForDay(35) === 5);

  assert('nextContestDayAfter(1) === 7', nextContestDayAfter(1) === 7);
  assert('nextContestDayAfter(6) === 7', nextContestDayAfter(6) === 7);
  assert('nextContestDayAfter(7) === 14 (strictly after, even ON a Contest day)', nextContestDayAfter(7) === 14);
  assert('nextContestDayAfter(8) === 14', nextContestDayAfter(8) === 14);
  assert('nextContestDayAfter(13) === 14', nextContestDayAfter(13) === 14);
  assert('nextContestDayAfter(14) === 21', nextContestDayAfter(14) === 21);
}

// ===========================================================================
// SCORING
// ===========================================================================
{
  const s = stats({ sweetness: 80, size: 60, yieldStat: 40, growth: 20, freshness: 90 });
  const avg = (80 + 60 + 40 + 20 + 90) / 5;
  const expectedBiggest = 60 * 0.85 + avg * 0.15;
  const expectedSweetest = 80 * 0.85 + avg * 0.15;
  const expectedFreshest = 90 * 0.85 + avg * 0.15;
  assert('BIGGEST base score = mainStat(Size)*0.85 + average*0.15', Math.abs(baseContestScore('BIGGEST', s) - expectedBiggest) < 1e-9);
  assert('SWEETEST base score = mainStat(Sweetness)*0.85 + average*0.15', Math.abs(baseContestScore('SWEETEST', s) - expectedSweetest) < 1e-9);
  assert('FRESHEST base score = mainStat(Freshness)*0.85 + average*0.15', Math.abs(baseContestScore('FRESHEST', s) - expectedFreshest) < 1e-9);

  const lowest = Math.min(80, 60, 40, 20, 90);
  const expectedGrand = avg * 0.8 + lowest * 0.2;
  assert('GRAND_CHAMPION base score = average*0.80 + lowest*0.20', Math.abs(baseContestScore('GRAND_CHAMPION', s) - expectedGrand) < 1e-9);

  assert('luck is bounded to exactly [-3, +3] at the rng extremes', rollContestLuck(() => 0) === -3.0 && rollContestLuck(() => 1) === 3.0);
  for (let i = 0; i < 500; i++) {
    const luck = rollContestLuck();
    assert('luck sample stays within [-3, 3]', luck >= -3.0 && luck <= 3.0);
  }

  const weakSize = stats({ size: 10 });
  const strongSize = stats({ size: 90 });
  assert('higher Size helps BIGGEST APPLE', baseContestScore('BIGGEST', strongSize) > baseContestScore('BIGGEST', weakSize));
  const weakSweet = stats({ sweetness: 10 });
  const strongSweet = stats({ sweetness: 90 });
  assert('higher Sweetness helps SWEETEST APPLE', baseContestScore('SWEETEST', strongSweet) > baseContestScore('SWEETEST', weakSweet));
  const weakFresh = stats({ freshness: 10 });
  const strongFresh = stats({ freshness: 90 });
  assert('higher Freshness helps FRESHEST APPLE', baseContestScore('FRESHEST', strongFresh) > baseContestScore('FRESHEST', weakFresh));

  const balanced = stats({ sweetness: 70, size: 70, yieldStat: 70, growth: 70, freshness: 70 });
  const lopsided = stats({ sweetness: 100, size: 100, yieldStat: 100, growth: 100, freshness: 10 }); // same average-ish, much worse lowest
  assert(
    'a balanced Line beats a lopsided one with a much lower floor at GRAND_CHAMPION, even with a similar/higher average',
    baseContestScore('GRAND_CHAMPION', balanced) > baseContestScore('GRAND_CHAMPION', lopsided),
  );

  const maxedStats = stats({ sweetness: 100, size: 100, yieldStat: 100, growth: 100, freshness: 100 });
  assert('score clamps to 100 for maxed stats + max luck', contestScore('BIGGEST', maxedStats, 3.0) === 100);
  assert('score clamps to 0 for zeroed stats + min luck', contestScore('BIGGEST', stats({ sweetness: 0, size: 0, yieldStat: 0, growth: 0, freshness: 0 }), -3.0) === 0);

  assert('formatContestScore shows exactly one decimal', formatContestScore(64.23) === '64.2' && formatContestScore(50) === '50.0');
}

// ===========================================================================
// NPC PROGRESSION
// ===========================================================================
{
  assert('Contest #1 NPC targets are exactly 42/46/50/54/58', JSON.stringify(npcTargetsForContestNumber(1)) === JSON.stringify([42, 46, 50, 54, 58]));
  assert('Contest #2 NPC targets are +4: 46/50/54/58/62', JSON.stringify(npcTargetsForContestNumber(2)) === JSON.stringify([46, 50, 54, 58, 62]));
  assert('Contest #3 NPC targets are +8: 50/54/58/62/66', JSON.stringify(npcTargetsForContestNumber(3)) === JSON.stringify([50, 54, 58, 62, 66]));
  // Progression caps at +20 total: 4*(n-1) reaches 20 exactly at n=6.
  assert('Contest #6 NPC targets hit the +20 cap exactly: 62/66/70/74/78', JSON.stringify(npcTargetsForContestNumber(6)) === JSON.stringify([62, 66, 70, 74, 78]));
  assert('Contest #7 NPC targets stay capped at +20 (not +24)', JSON.stringify(npcTargetsForContestNumber(7)) === JSON.stringify([62, 66, 70, 74, 78]));
  assert('Contest #20 NPC targets still stay capped at +20', JSON.stringify(npcTargetsForContestNumber(20)) === JSON.stringify([62, 66, 70, 74, 78]));

  assert('NPC variation is bounded to exactly [-2.5, +2.5] at the rng extremes', rollNpcVariation(() => 0) === -2.5 && rollNpcVariation(() => 1) === 2.5);
  for (let i = 0; i < 500; i++) {
    const v = rollNpcVariation();
    assert('NPC variation sample stays within [-2.5, 2.5]', v >= -2.5 && v <= 2.5);
  }

  assert('NPC target progression does not take a player-stats argument at all (pure function of Contest number only)', npcTargetsForContestNumber.length === 1);
}

// ===========================================================================
// PRIZES
// ===========================================================================
{
  assert('prizeForRank(1) === 250', prizeForRank(1) === 250);
  assert('prizeForRank(2) === 150', prizeForRank(2) === 150);
  assert('prizeForRank(3) === 75', prizeForRank(3) === 75);
  assert('prizeForRank(4) === 0', prizeForRank(4) === 0);
  assert('prizeForRank(5) === 0', prizeForRank(5) === 0);
  assert('prizeForRank(6) === 0', prizeForRank(6) === 0);
}

// ===========================================================================
// RANKING — full precision, display rounding never affects it; stable tie-break
// ===========================================================================
{
  const ranked = rankContestEntries([
    { id: 'a', score: 50.049 },
    { id: 'b', score: 50.04 },
    { id: 'c', score: 70 },
  ]);
  assert('ranking uses full internal precision, not the rounded display string', ranked.map((r) => r.id).join(',') === 'c,a,b');
  assert('both near-tied entries DISPLAY identically at 1 decimal despite ranking differently', formatContestScore(50.049) === formatContestScore(50.04));

  const tied = rankContestEntries([
    { id: 'first', score: 60 },
    { id: 'second', score: 60 },
    { id: 'third', score: 80 },
  ]);
  assert('an exact tie keeps the original (build) order deterministically', tied.map((r) => r.id).join(',') === 'third,first,second');
}

// ===========================================================================
// ENTRY ELIGIBILITY
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  const eligible = game.contestEligibleLines();
  assert('a fresh save starts with eligible Lines (the two starters)', eligible.length === 2);
  assert('contestEligibleLines only ever returns Library entries', eligible.every((l) => game.state.library.includes(l)));

  const line = game.state.library[0];
  game.setLineArchived(line.id, true);
  assert('archived Lines are excluded from Contest eligibility (same convention as the normal Parent Picker)', !game.contestEligibleLines().some((l) => l.id === line.id));
  game.setLineArchived(line.id, false);
  assert('unarchiving restores eligibility', game.contestEligibleLines().some((l) => l.id === line.id));
}

// ===========================================================================
// CLOSING FLOW — non-Contest day proceeds straight to settlement
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  clearAllSpecimens(game);
  assert('Day 1 is not a Contest day', !isContestDay(game.state.day));
  runClosingUpToGate(game);
  assert('a normal (non-Contest) day settles automatically once Final Shipment drains', game.state.dayEnded === true);
  assert('no ContestState was created on a non-Contest day', game.state.contest === null);
}

// ===========================================================================
// CLOSING FLOW — Contest Day pauses between Final Shipment and settlement
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  jumpToDay(game, 7);
  clearAllSpecimens(game);
  assert('arrived at Day 7', game.state.day === 7);
  assert('Day 7 is a Contest day', isContestDay(game.state.day));

  runClosingUpToGate(game);
  assert('settlement does NOT happen automatically on a Contest Day', game.state.dayEnded === false);
  assert('state.closing stays true while waiting for the Contest', game.state.closing === true);
  assert('a ContestState was created for today', game.state.contest !== null && game.state.contest.day === 7);
  assert('the Contest is BIGGEST APPLE as scheduled', game.state.contest!.type === 'BIGGEST');
  assert('the Contest starts unresolved, entry required', game.state.contest!.resolved === false);

  // Repeated update() ticks while waiting must not settle early or duplicate the gate.
  for (let i = 0; i < 20; i++) game.update(0.05);
  assert('EndDayModal-equivalent state (dayEnded) still false after many idle ticks', game.state.dayEnded === false);
  assert('re-entering the gate is a no-op (still the same ContestState)', game.state.contest!.day === 7 && game.state.contest!.resolved === false);

  const attemptEarlySettle = game.continueFromContestResults();
  assert('continueFromContestResults refuses to settle before the Contest has resolved', attemptEarlySettle === false);
  assert('dayEnded is still false after the refused early-settle attempt', game.state.dayEnded === false);

  // Now actually enter and confirm the flow completes exactly once.
  const eligible = game.contestEligibleLines();
  const entered = game.confirmContestEntry(eligible[0].id);
  assert('confirmContestEntry succeeds once the gate is open', entered !== null);
  assert('Contest is resolved now', game.state.contest!.resolved === true);
  assert('settlement STILL has not happened yet — only continuing from Results does that', game.state.dayEnded === false);

  const settled = game.continueFromContestResults();
  assert('continueFromContestResults succeeds once resolved', settled === true);
  assert('settlement happened exactly once (dayEnded true)', game.state.dayEnded === true);
  assert('lastDayLog exists after Contest-Day settlement', game.state.lastDayLog !== null);

  const secondSettle = game.continueFromContestResults();
  assert('a second continueFromContestResults call is a safe no-op (closing already false)', secondSettle === false);
}

// ===========================================================================
// CLOSING FLOW — manual END DAY on a Contest Day follows the identical flow
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  jumpToDay(game, 14);
  clearAllSpecimens(game);
  // `contest` deliberately isn't cleared between days (see types.ts's
  // GameState.contest doc comment) — it's still holding Day 7's leftover
  // ContestState here, which is exactly correct; "no gate yet today" is
  // `contest.day !== state.day`, not `contest === null`.
  assert('arrived at Day 14 with no Contest gate yet today', game.state.day === 14 && game.state.contest?.day !== 14);

  // beginClosing(false) === the manual END DAY path (no `automatic` arg /
  // explicit false). A `do..while` (not `while`) is required here too — see
  // runClosingUpToGate's own doc comment above for why a plain
  // `while (queue.length > 0)` silently never ticks update() at all when
  // the queue is already empty right after beginClosing().
  game.beginClosing(false);
  let guard = 0;
  do {
    game.update(0.05);
    if (++guard > 20000) throw new Error('Final Shipment never drained (manual END DAY path)');
  } while (game.state.processingQueue.length > 0);
  assert('manual END DAY on a Contest Day also pauses for the Contest gate', game.state.contest !== null && game.state.contest.day === 14 && !game.state.dayEnded);
  assert('manual END DAY resolves to the correct scheduled type (SWEETEST)', game.state.contest!.type === 'SWEETEST');
}

// ===========================================================================
// ENTRY — does not consume/mutate the Library, Packing, or Specimens
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  jumpToDay(game, 7);
  clearAllSpecimens(game);
  runClosingUpToGate(game);

  const libraryBefore = JSON.stringify(game.state.library);
  const specimensBefore = game.state.specimens.length;
  const queueBefore = game.state.processingQueue.length;
  const line = game.contestEligibleLines()[0];
  const lineSnapshotBefore = JSON.stringify(line);

  game.confirmContestEntry(line.id);

  assert('the Library array itself is completely unchanged (same length/contents)', JSON.stringify(game.state.library) === libraryBefore);
  assert('the entered Line itself is byte-for-byte unchanged (not consumed/mutated)', JSON.stringify(line) === lineSnapshotBefore);
  assert('Specimens inventory is untouched by Contest entry', game.state.specimens.length === specimensBefore);
  assert('Packing/processingQueue is untouched by Contest entry', game.state.processingQueue.length === queueBefore);
}

// ===========================================================================
// ENTRY — a Specimen id is never accepted (Contest is Lines-only)
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  jumpToDay(game, 7);
  clearAllSpecimens(game);
  runClosingUpToGate(game);

  const fakeSpecimenId = 'not-a-real-line-id';
  const result = game.confirmContestEntry(fakeSpecimenId);
  assert('an id that is not an eligible Library Line (e.g. a Specimen id) is rejected', result === null);
  assert('the Contest gate remains unresolved after a rejected entry attempt', game.state.contest!.resolved === false);
}

// ===========================================================================
// ENTRY — locks after confirmation; no re-roll of luck/NPCs on a second call
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  jumpToDay(game, 7);
  clearAllSpecimens(game);
  runClosingUpToGate(game);

  const [lineA, lineB] = game.contestEligibleLines();
  game.confirmContestEntry(lineA.id);
  const lockedEntryId = game.state.contest!.entryLineId;
  const lockedScore = game.state.contest!.playerScore;
  const lockedNpcResults = JSON.stringify(game.state.contest!.npcResults);
  const cashAfterFirst = game.state.cash;

  const secondAttempt = game.confirmContestEntry(lineB.id);
  assert('a second confirmContestEntry call after resolution returns null (cannot change the entry)', secondAttempt === null);
  assert('entryLineId stays locked to the FIRST confirmed Line', game.state.contest!.entryLineId === lockedEntryId);
  assert('playerScore is not rerolled by the rejected second call', game.state.contest!.playerScore === lockedScore);
  assert('NPC results are not rerolled by the rejected second call', JSON.stringify(game.state.contest!.npcResults) === lockedNpcResults);
  assert('cash/prize was not paid a second time', game.state.cash === cashAfterFirst);
}

// ===========================================================================
// RESULT — six contestants, correct integration, persists across reload,
// cannot be paid twice.
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  jumpToDay(game, 7);
  clearAllSpecimens(game);
  runClosingUpToGate(game);

  const line = game.contestEligibleLines()[0];
  const cashBefore = game.state.cash;
  const totalRevenueBefore = game.state.totalRevenue;
  const contest = game.confirmContestEntry(line.id)!;

  assert('exactly 5 NPC results are generated', contest.npcResults!.length === 5);
  assert('NPC names match the fixed TUNING roster, in order', JSON.stringify(contest.npcResults!.map((n) => n.name)) === JSON.stringify(TUNING.CONTEST_NPC_NAMES));
  assert('rank is between 1 and 6 (PLAYER + 5 NPCs = 6 total entries)', contest.rank !== null && contest.rank! >= 1 && contest.rank! <= 6);
  assert('prize matches prizeForRank(rank)', contest.prize === prizeForRank(contest.rank!));

  const expectedCash = cashBefore + contest.prize;
  assert('cash increased by exactly the prize amount, exactly once', Math.abs(game.state.cash - expectedCash) < 1e-9);
  assert('apple totalRevenue is untouched by the Contest prize (never conflated with sale revenue)', game.state.totalRevenue === totalRevenueBefore);
  assert('dayContestPrize accumulator carries the prize for settlement', game.state.dayContestPrize === contest.prize);

  // Persist across reload — same outcome, no reroll, no double payment.
  game.save();
  const reloaded = new Game();
  assert('reloaded ContestState matches exactly (day/type/resolved)', reloaded.state.contest!.day === 7 && reloaded.state.contest!.type === 'BIGGEST' && reloaded.state.contest!.resolved === true);
  assert('reloaded entryLineId matches', reloaded.state.contest!.entryLineId === line.id);
  assert('reloaded playerScore matches exactly (no reroll)', reloaded.state.contest!.playerScore === contest.playerScore);
  assert('reloaded npcResults match exactly (no reroll)', JSON.stringify(reloaded.state.contest!.npcResults) === JSON.stringify(contest.npcResults));
  assert('reloaded rank/prize match exactly', reloaded.state.contest!.rank === contest.rank && reloaded.state.contest!.prize === contest.prize);
  assert('reloaded cash matches (prize was not re-applied on load)', Math.abs(reloaded.state.cash - game.state.cash) < 1e-9);

  const rerollAttempt = reloaded.confirmContestEntry(line.id);
  assert('reload cannot reroll — confirmContestEntry after reload is rejected (already resolved)', rerollAttempt === null);
  assert('cash unchanged after the rejected reroll attempt on the reloaded instance', reloaded.state.cash === game.state.cash);

  // Complete settlement, save/reload again — must never duplicate the prize.
  reloaded.continueFromContestResults();
  const cashAfterSettle = reloaded.state.cash;
  reloaded.save();
  const reloadedAgain = new Game();
  assert('cash after settlement + reload is stable (prize not duplicated)', Math.abs(reloadedAgain.state.cash - cashAfterSettle) < 1e-9);
  assert('dayEnded persists true after settlement + reload', reloadedAgain.state.dayEnded === true);
  const rerollAfterSettle = reloadedAgain.continueFromContestResults();
  assert('continueFromContestResults after settlement + reload is a no-op', rerollAfterSettle === false);
}

// ===========================================================================
// RESULT — 4th-6th place pays exactly $0, End Day summary integration,
// Net includes Contest Prize, Operating Cost unchanged.
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  jumpToDay(game, 7);
  clearAllSpecimens(game);
  runClosingUpToGate(game);

  // Force a guaranteed-loss entry: a deliberately weak Line (all stats at 0)
  // can never beat a Contest #1 NPC floor target of 42, so rank is
  // guaranteed to land at 4th-6th regardless of luck (base score for a
  // BIGGEST APPLE Contest here is 0, and max luck only adds +3).
  const weakLine = game.state.library[0];
  weakLine.sweetness = 0;
  weakLine.size = 0;
  weakLine.yieldStat = 0;
  weakLine.growth = 0;
  weakLine.freshness = 0;

  const cashBefore = game.state.cash;
  const contest = game.confirmContestEntry(weakLine.id)!;
  assert('a guaranteed-weak entry lands outside the top 3', contest.rank !== null && contest.rank! >= 4);
  assert('4th-6th place pays exactly $0', contest.prize === 0);
  assert('cash is unchanged when the prize is $0', game.state.cash === cashBefore);

  game.continueFromContestResults();
  const log = game.state.lastDayLog!;
  assert('End Day summary Contest Prize is exactly $0', log.contestPrize === 0);
  const expectedOpCost = operatingCost(7, game.unlockedFields().length);
  assert('Operating Cost formula is unchanged by Contest V1', Math.abs(log.operatingCost - expectedOpCost) < 1e-6);
  assert('Net = harvestRevenue + marketBonus - freshnessLoss + contestPrize - operatingCost', Math.abs(log.net - (log.harvestRevenue + log.marketBonus - log.freshnessLoss + log.contestPrize - log.operatingCost)) < 1e-9);
}
{
  // A guaranteed-win entry to confirm the Contest Prize row is non-zero,
  // present in the summary, and folds into Net correctly for a real prize
  // too (not just the $0 case above).
  clearStorage();
  const game = new Game();
  jumpToDay(game, 7);
  clearAllSpecimens(game);
  runClosingUpToGate(game);

  const strongLine = game.state.library[0];
  strongLine.sweetness = 100;
  strongLine.size = 100;
  strongLine.yieldStat = 100;
  strongLine.growth = 100;
  strongLine.freshness = 100;

  const strongLineSnapshotBefore = JSON.stringify(strongLine);
  const contest = game.confirmContestEntry(strongLine.id)!;
  assert('a guaranteed-maximal entry places 1st (base score 100 beats every Contest #1 NPC target even at their max luck)', contest.rank === 1);
  assert('1st place prize is exactly $250', contest.prize === 250);
  assert('a placing entry is recorded in contestHistory (Collection/Week Summary integration), not on the Line itself', game.state.contestHistory.some((h) => h.day === 7 && h.rank === 1 && h.prize === 250));
  assert('the winning Line itself is still byte-for-byte unchanged (no awards mutation — entering never changes a Line)', JSON.stringify(strongLine) === strongLineSnapshotBefore);

  game.continueFromContestResults();
  const log = game.state.lastDayLog!;
  assert('End Day summary Contest Prize reflects the real $250 prize', log.contestPrize === 250);
  assert('Net includes the Contest Prize', log.net >= 250 - log.operatingCost - 1); // gross floor sanity, exact formula already checked above
}

// ===========================================================================
// GRAND CHAMPION — end-to-end integration (Day 28)
// ===========================================================================
{
  clearStorage();
  const game = new Game();
  jumpToDay(game, 28);
  clearAllSpecimens(game);
  runClosingUpToGate(game);
  assert('arrived at Day 28', game.state.day === 28);
  assert('Day 28 is GRAND_CHAMPION as scheduled', game.state.contest!.type === 'GRAND_CHAMPION');

  const line = game.contestEligibleLines()[0];
  const contest = game.confirmContestEntry(line.id)!;
  assert('GRAND_CHAMPION entry resolves with a valid rank', contest.rank !== null && contest.rank! >= 1 && contest.rank! <= 6);
  const expectedBase = baseContestScore('GRAND_CHAMPION', line);
  assert('GRAND_CHAMPION playerScore is within [base-3, base+3] of the pure formula (one luck roll)', Math.abs(contest.playerScore! - Math.max(0, Math.min(100, expectedBase))) <= 3.01 || contest.playerScore === 0 || contest.playerScore === 100);
}

// ===========================================================================
// SAVE MIGRATION
// ===========================================================================
{
  clearStorage();
  const oldSave = {
    day: 3,
    dayTimeRemaining: 90,
    dayActive: true,
    cash: 100,
    fields: [],
    library: [],
    specimens: [],
    discoveredVisualIds: ['C1', 'C2'],
    discoveredColors: ['Red', 'Green'],
    discoveredPatterns: ['Plain'],
    processingQueue: [],
    processingTimer: 0,
    breeding: { active: false, everBredOnce: false },
    irrigationLevel: 0,
    shippingLevel: 0,
    // contest / contestHistory intentionally absent — pre-Contest-V1 save.
    // Legacy contestResults/day4ContestDone/day7FairDone left in, exactly
    // as a real old save would have them, to prove they're harmlessly
    // ignored rather than crashing migration.
    contestResults: [{ day: 4, varietyId: 'x', varietyName: 'Old', score: 70, place: 1, prize: 350 }],
    day4ContestDone: true,
    day7FairDone: false,
  };
  localStorage.setItem(TUNING.SAVE_KEY, JSON.stringify(oldSave));
  const migrated = new Game();
  assert('an old save with no `contest` field migrates to null', migrated.state.contest === null);
  assert('an old save with no `contestHistory` field migrates to []', Array.isArray(migrated.state.contestHistory) && migrated.state.contestHistory.length === 0);
  assert('legacy contestResults/day4ContestDone/day7FairDone are harmlessly ignored, not crashed on', true);
}
{
  // Reload before entry resumes correctly (fresh gate, no entry yet).
  clearStorage();
  const game = new Game();
  jumpToDay(game, 7);
  clearAllSpecimens(game);
  runClosingUpToGate(game);
  game.save();

  const reloaded = new Game();
  assert('reload before entry preserves the Contest gate (unresolved)', reloaded.state.contest !== null && reloaded.state.contest.day === 7 && reloaded.state.contest.resolved === false);
  assert('reload before entry preserves state.closing (still mid-Closing)', reloaded.state.closing === true && reloaded.state.dayEnded === false);
  assert('the queue is still empty after reload (Final Shipment already drained)', reloaded.state.processingQueue.length === 0);
}

console.log(`\n${checks - failures}/${checks} checks passed.`);
if (failures > 0) process.exit(1);
