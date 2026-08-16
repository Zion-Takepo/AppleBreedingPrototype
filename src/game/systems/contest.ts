// Contest V1 (see PROJECT.md "Contest") — pure schedule/scoring/NPC-
// progression helpers, no Phaser/UI/GameState mutation anywhere in this
// file (Game.ts owns wiring this into persisted state; ui/*.ts owns
// presentation). Mirrors the existing systems/economy.ts and
// systems/market.ts convention of small, independently-testable pure
// functions over gameplay math.
import { CONTEST_TYPES, TUNING, type ContestType } from '../tuning.ts';

export type { ContestType };
export { CONTEST_TYPES };

// ----------------------------------------------------------------------
// Schedule — Contest begins Day 7, then every CONTEST_INTERVAL_DAYS (7)
// days, in a fixed four-type cycle. Never randomized — the whole point is
// that the player can see what's coming and Breed toward it.
// ----------------------------------------------------------------------

export function isContestDay(day: number): boolean {
  return day >= TUNING.CONTEST_START_DAY && (day - TUNING.CONTEST_START_DAY) % TUNING.CONTEST_INTERVAL_DAYS === 0;
}

/** 1-indexed Contest number: Day 7 -> 1, Day 14 -> 2, Day 21 -> 3, ... Meaningless (but still computed) for a non-Contest day — callers should guard with isContestDay first. */
export function contestNumberForDay(day: number): number {
  return Math.floor((day - TUNING.CONTEST_START_DAY) / TUNING.CONTEST_INTERVAL_DAYS) + 1;
}

/** null if `day` isn't a Contest day; otherwise the fixed rotation type for it. */
export function contestTypeForDay(day: number): ContestType | null {
  if (!isContestDay(day)) return null;
  const idx = (contestNumberForDay(day) - 1) % CONTEST_TYPES.length;
  return CONTEST_TYPES[idx];
}

/** Smallest Contest day strictly AFTER `day` — works whether or not `day` itself is a Contest day. */
export function nextContestDayAfter(day: number): number {
  if (day < TUNING.CONTEST_START_DAY) return TUNING.CONTEST_START_DAY;
  const n = Math.floor((day - TUNING.CONTEST_START_DAY) / TUNING.CONTEST_INTERVAL_DAYS) + 1;
  return TUNING.CONTEST_START_DAY + n * TUNING.CONTEST_INTERVAL_DAYS;
}

const CONTEST_LABELS: Record<ContestType, string> = {
  BIGGEST: 'BIGGEST APPLE',
  SWEETEST: 'SWEETEST APPLE',
  FRESHEST: 'FRESHEST APPLE',
  GRAND_CHAMPION: 'GRAND CHAMPION',
};

/** e.g. "BIGGEST APPLE" — the all-caps display name used everywhere (HUD, Calendar, entry/results screens). */
export function contestTypeLabel(type: ContestType): string {
  return CONTEST_LABELS[type];
}

const CONTEST_SHORT_LABELS: Record<ContestType, string> = {
  BIGGEST: 'Biggest Apple',
  SWEETEST: 'Sweetest Apple',
  FRESHEST: 'Freshest Apple',
  GRAND_CHAMPION: 'Grand Champion',
};

/** Title-case compact label for the Calendar's day-chip strip. */
export function contestShortLabel(type: ContestType): string {
  return CONTEST_SHORT_LABELS[type];
}

// Player-facing scoring explanation (see PROJECT.md section 5) — plain
// English, never exposing the implementation's exact variable names.
const CONTEST_CRITERIA: Record<ContestType, string[]> = {
  BIGGEST: ['85% Size', '15% Overall Quality', 'Small Luck Factor'],
  SWEETEST: ['85% Sweetness', '15% Overall Quality', 'Small Luck Factor'],
  FRESHEST: ['85% Freshness', '15% Overall Quality', 'Small Luck Factor'],
  GRAND_CHAMPION: ['80% Overall Quality', '20% Balance', 'Small Luck Factor'],
};

export function contestCriteriaLines(type: ContestType): string[] {
  return CONTEST_CRITERIA[type];
}

// ----------------------------------------------------------------------
// Scoring — a Contest entry needs only the five genetic stats (a Variety
// satisfies this structurally as-is, same "small structural interface"
// convention as systems/breeding.ts's BreedParent).
// ----------------------------------------------------------------------

export interface ContestStats {
  sweetness: number;
  size: number;
  yieldStat: number;
  growth: number;
  freshness: number;
}

const SPECIALIZED_MAIN_STAT_KEY: Record<Exclude<ContestType, 'GRAND_CHAMPION'>, keyof ContestStats> = {
  BIGGEST: 'size',
  SWEETEST: 'sweetness',
  FRESHEST: 'freshness',
};

/** The single genetic stat a specialized Contest (everything but GRAND_CHAMPION) judges on. */
export function contestMainStatKey(type: ContestType): keyof ContestStats | null {
  return type === 'GRAND_CHAMPION' ? null : SPECIALIZED_MAIN_STAT_KEY[type];
}

export function averageStat(stats: ContestStats): number {
  return (stats.sweetness + stats.size + stats.yieldStat + stats.growth + stats.freshness) / 5;
}

export function lowestStat(stats: ContestStats): number {
  return Math.min(stats.sweetness, stats.size, stats.yieldStat, stats.growth, stats.freshness);
}

export function totalStat(stats: ContestStats): number {
  return stats.sweetness + stats.size + stats.yieldStat + stats.growth + stats.freshness;
}

export function clampContestScore(score: number): number {
  return Math.max(TUNING.CONTEST_SCORE_MIN, Math.min(TUNING.CONTEST_SCORE_MAX, score));
}

/** One shared luck roll, uniform in [CONTEST_LUCK_MIN, CONTEST_LUCK_MAX]. `rng` injectable for deterministic tests. */
export function rollContestLuck(rng: () => number = Math.random): number {
  return TUNING.CONTEST_LUCK_MIN + rng() * (TUNING.CONTEST_LUCK_MAX - TUNING.CONTEST_LUCK_MIN);
}

/**
 * Pre-luck base score for one entry's five genetic stats (see PROJECT.md
 * section 4):
 *   specialized (BIGGEST/SWEETEST/FRESHEST): mainStat*0.85 + average*0.15
 *   GRAND_CHAMPION: average*0.80 + lowest*0.20
 */
export function baseContestScore(type: ContestType, stats: ContestStats): number {
  if (type === 'GRAND_CHAMPION') {
    return averageStat(stats) * TUNING.CONTEST_GRAND_AVERAGE_WEIGHT + lowestStat(stats) * TUNING.CONTEST_GRAND_LOWEST_WEIGHT;
  }
  const mainKey = SPECIALIZED_MAIN_STAT_KEY[type];
  return stats[mainKey] * TUNING.CONTEST_SPECIALIZED_MAIN_WEIGHT + averageStat(stats) * TUNING.CONTEST_SPECIALIZED_AVERAGE_WEIGHT;
}

/** Full contest score: baseContestScore + luck, clamped to 0..100. */
export function contestScore(type: ContestType, stats: ContestStats, luck: number): number {
  return clampContestScore(baseContestScore(type, stats) + luck);
}

/** e.g. "64.2" — display precision only; ranking always uses full internal precision (see rankContestEntries). */
export function formatContestScore(score: number): string {
  return score.toFixed(1);
}

// ----------------------------------------------------------------------
// NPC competitors — PLAYER + 5 fixed NPC farms = 6 total entries (see
// PROJECT.md section 14). Target progression is a pure function of the
// Contest number alone and must never read the player's own stats/state.
// ----------------------------------------------------------------------

/** Target scores for the Nth Contest (1-indexed), one per TUNING.CONTEST_NPC_NAMES entry, in order. */
export function npcTargetsForContestNumber(contestNumber: number): number[] {
  const progression = Math.min(TUNING.CONTEST_NPC_PROGRESSION_CAP, TUNING.CONTEST_NPC_PROGRESSION_PER_CONTEST * (contestNumber - 1));
  return TUNING.CONTEST_NPC_BASE_TARGETS.map((base) => base + progression);
}

/** One NPC's small one-time result variation, uniform in [CONTEST_NPC_VARIATION_MIN, MAX]. `rng` injectable for deterministic tests. */
export function rollNpcVariation(rng: () => number = Math.random): number {
  return TUNING.CONTEST_NPC_VARIATION_MIN + rng() * (TUNING.CONTEST_NPC_VARIATION_MAX - TUNING.CONTEST_NPC_VARIATION_MIN);
}

/** Same fixed V1 prize table for every Contest (see PROJECT.md section 16) — 1st $250 / 2nd $150 / 3rd $75 / 4th-6th $0. */
export function prizeForRank(rank: number): number {
  if (rank === 1) return TUNING.CONTEST_PRIZES[0];
  if (rank === 2) return TUNING.CONTEST_PRIZES[1];
  if (rank === 3) return TUNING.CONTEST_PRIZES[2];
  return 0;
}

export interface RankedContestEntry {
  id: string;
  score: number;
}

/**
 * Ranks entries by score descending, using full internal precision — never
 * the rounded display string. `Array.prototype.sort` is a stable sort, so
 * an exact internal tie keeps the entries' original relative (build) order
 * as its deterministic tie-break, the same convention
 * Game.beginClosing's own highest-value-first collection pass already uses.
 * Generic over any entry shape carrying at least `score`, so callers (e.g.
 * ui/ContestResultsModal.ts) can rank their own richer display-row objects
 * directly without a separate id-lookup pass afterward.
 */
export function rankContestEntries<T extends RankedContestEntry>(entries: T[]): T[] {
  return entries.slice().sort((a, b) => b.score - a.score);
}
