import { TUNING } from '../tuning.ts';

/**
 * Maps `dayTimeRemaining` (counts down from TUNING.DAY_DURATION_SEC) onto a
 * digital 09:00-18:00 game clock — reuses the existing day pacing directly
 * rather than inventing a second duration to balance; changing
 * DAY_DURATION_SEC (or DAY_START_HOUR/DAY_END_HOUR) alone still keeps the
 * clock in sync with the rest of the day.
 */
export function gameClockLabel(dayTimeRemaining: number): string {
  const elapsedFraction = 1 - Math.max(0, Math.min(1, dayTimeRemaining / TUNING.DAY_DURATION_SEC));
  const spanMinutes = (TUNING.DAY_END_HOUR - TUNING.DAY_START_HOUR) * 60;
  const totalMinutes = Math.floor(TUNING.DAY_START_HOUR * 60 + elapsedFraction * spanMinutes);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
