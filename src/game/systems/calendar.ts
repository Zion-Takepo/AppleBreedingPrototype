import type { MarketModifiers } from '../types.ts';

export type DayEvent = 'NONE' | 'CONTEST_SWEETNESS' | 'FAIR';

export interface DayDef {
  day: number;
  title: string;
  shortLabel: string;
  event: DayEvent;
  scriptedMarket?: MarketModifiers;
}

export const WEEK1_CALENDAR: DayDef[] = [
  { day: 1, title: 'First Harvest & First Breeding', shortLabel: 'Day 1', event: 'NONE' },
  { day: 2, title: 'Yellow Market Surge (+30%)', shortLabel: 'Yellow Surge', event: 'NONE', scriptedMarket: { Yellow: 0.3 } },
  { day: 3, title: 'Contest Prep — Sweetness Contest Tomorrow', shortLabel: 'Prep Day', event: 'NONE' },
  { day: 4, title: 'SWEETNESS CONTEST', shortLabel: 'Contest', event: 'CONTEST_SWEETNESS' },
  { day: 5, title: 'Mutation Day — Something Unusual Awaits', shortLabel: '???', event: 'NONE' },
  { day: 6, title: 'Market Event — Purple +40% / Striped +25%', shortLabel: 'Market Event', event: 'NONE', scriptedMarket: { Purple: 0.4, Striped: 0.25 } },
  { day: 7, title: 'APPLE FAIR', shortLabel: 'Apple Fair', event: 'FAIR' },
];

export function getDayDef(day: number): DayDef | undefined {
  return WEEK1_CALENDAR.find((d) => d.day === day);
}

export function nextEvent(currentDay: number): DayDef | undefined {
  return WEEK1_CALENDAR.find((d) => d.day > currentDay && d.event !== 'NONE');
}
