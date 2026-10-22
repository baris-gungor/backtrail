import { SessionType } from '../../assets/domain/asset.types';

const newYorkParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function newYorkClock(date: Date): { weekday: string; minutes: number } {
  let weekday = '';
  let hour = 0;
  let minute = 0;
  for (const part of newYorkParts.formatToParts(date)) {
    if (part.type === 'weekday') weekday = part.value;
    if (part.type === 'hour') hour = Number(part.value);
    if (part.type === 'minute') minute = Number(part.value);
  }
  return { weekday, minutes: hour * 60 + minute };
}

/**
 * True when a scheduled sync should run for this session type in the minute of `now`:
 * `delayMinutes` after a 1h bar closes, so the provider has the finished bar.
 * - continuous: bars close on the full UTC hour, every hour.
 * - us_equity: bars close at :30 New York time from 10:30 to 15:30, and at the 16:00 close,
 *   on weekdays (holidays only cost an empty fetch).
 */
export function isSyncDue(session: SessionType, now: Date, delayMinutes: number): boolean {
  if (session === SessionType.Continuous) return now.getUTCMinutes() === delayMinutes;

  const { weekday, minutes } = newYorkClock(now);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const closeMinutes = minutes - delayMinutes;
  const regular =
    closeMinutes % 60 === 30 && closeMinutes >= 10 * 60 + 30 && closeMinutes <= 15 * 60 + 30;
  return regular || closeMinutes === 16 * 60;
}
