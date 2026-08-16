import type { MarketModifiers } from '../types.ts';
import type { ContestType } from '../tuning.ts';
import { contestShortLabel, contestTypeForDay, contestTypeLabel, nextContestDayAfter } from './contest.ts';

export type DayEvent = 'NONE' | 'CONTEST';

export interface DayDef {
  day: number;
  title: string;
  shortLabel: string;
  event: DayEvent;
  // Only set when event === 'CONTEST' (see systems/contest.ts).
  contestType?: ContestType;
  scriptedMarket?: MarketModifiers;
}

// Week-1 scripted flavor for the handful of days that still have bespoke
// text (see PROJECT.md "Calendar") — Day 4's old Sweetness Contest and Day
// 7's old Apple Fair are gone, replaced by Contest V1 (Day 7 onward, see
// systems/contest.ts); every other day not listed here (including every
// Day 8+) falls through to a generic "Day N" entry in getDayDef below
// rather than fabricating content this prototype never actually scripted.
const WEEK1_FLAVOR: Record<number, { title: string; shortLabel: string; scriptedMarket?: MarketModifiers }> = {
  1: { title: 'First Harvest & First Breeding', shortLabel: 'Day 1' },
  2: { title: 'Yellow Market Surge (+30%)', shortLabel: 'Yellow Surge', scriptedMarket: { Yellow: 0.3 } },
  3: { title: 'Contest Prep', shortLabel: 'Prep Day' },
  5: { title: 'Mutation Day — Something Unusual Awaits', shortLabel: '???' },
  6: { title: 'Market Event — Purple +40% / Striped +25%', shortLabel: 'Market Event', scriptedMarket: { Purple: 0.4, Striped: 0.25 } },
};

/** Always returns a def — Day 8+ (past the old fixed Week-1 table) is a real, playable day now that Contest V1 repeats indefinitely, so this never falls back to `undefined` the way the old fixed 7-entry table did. */
export function getDayDef(day: number): DayDef {
  const contestType = contestTypeForDay(day);
  if (contestType) {
    return { day, title: contestTypeLabel(contestType), shortLabel: contestShortLabel(contestType), event: 'CONTEST', contestType };
  }
  const flavor = WEEK1_FLAVOR[day];
  if (flavor) return { day, title: flavor.title, shortLabel: flavor.shortLabel, event: 'NONE', scriptedMarket: flavor.scriptedMarket };
  return { day, title: `Day ${day}`, shortLabel: `Day ${day}`, event: 'NONE' };
}

/** The next Contest day's def, strictly after `currentDay` — Contest is the only scheduled "event" left in V1, so this is exactly the NEXT CONTEST pointer (see ui/HUD.ts). */
export function nextEvent(currentDay: number): DayDef {
  return getDayDef(nextContestDayAfter(currentDay));
}

// Calendar's own "current visible range" (see PROJECT.md section 9 — no
// month-grid redesign): a rolling 7-day window aligned to 7-day blocks
// starting Day 1, so every block ends on that week's Contest day (Day 7,
// 14, 21, ...) exactly like the original fixed Week-1 strip did for Day 7,
// but now it follows the player past Day 7 instead of staying pinned to
// days 1-7 forever.
export function calendarWindowForDay(day: number): DayDef[] {
  const blockStart = Math.floor((Math.max(1, day) - 1) / 7) * 7 + 1;
  return Array.from({ length: 7 }, (_, i) => getDayDef(blockStart + i));
}
