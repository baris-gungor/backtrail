import { SessionType } from '../../assets/domain/asset.types';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const FOUR_HOURS_MS = 4 * HOUR_MS;

/** US regular session in America/New_York wall-clock minutes. */
const US_OPEN = 9 * 60 + 30; // 09:30
const US_MIDDAY = 13 * 60 + 30; // 13:30
const US_CLOSE = 16 * 60; // 16:00

export interface Period {
  start: Date;
  end: Date;
}

const newYorkClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
});

/** Minutes since local midnight in New York. Handles DST through Intl. */
function newYorkMinutes(date: Date): number {
  let hour = 0;
  let minute = 0;
  for (const part of newYorkClock.formatToParts(date)) {
    if (part.type === 'hour') hour = Number(part.value);
    if (part.type === 'minute') minute = Number(part.value);
  }
  return hour * 60 + minute;
}

const newYorkWeekday = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
});

const isNewYorkWeekday = (date: Date) => !['Sat', 'Sun'].includes(newYorkWeekday.format(date));

/** The same New York day at `minutes` past midnight (DST changes at 02:00 do not matter here). */
const atNewYorkMinutes = (date: Date, minutes: number) =>
  new Date(date.getTime() + (minutes - newYorkMinutes(date)) * MINUTE_MS);

/**
 * The first US session open (09:30 New York, Monday–Friday) at or after `time`. Exchange holidays
 * are not known: the open of a holiday is returned as if it traded.
 */
export function nextUsSessionOpen(time: Date): Date {
  if (isNewYorkWeekday(time) && newYorkMinutes(time) <= US_OPEN) {
    return atNewYorkMinutes(time, US_OPEN);
  }
  // Noon of the following New York days until a weekday.
  let probe = atNewYorkMinutes(new Date(time.getTime() + 24 * HOUR_MS), 12 * 60);
  while (!isNewYorkWeekday(probe)) probe = new Date(probe.getTime() + 24 * HOUR_MS);
  return atNewYorkMinutes(probe, US_OPEN);
}

/** Open of the next US 4h bar after the bar opening at `time` (09:30 → 13:30 → next 09:30). */
export function nextUsBarOpen(time: Date): Date {
  const minutes = newYorkMinutes(time);
  if (isNewYorkWeekday(time) && minutes < US_OPEN) return atNewYorkMinutes(time, US_OPEN);
  if (isNewYorkWeekday(time) && minutes < US_MIDDAY) return atNewYorkMinutes(time, US_MIDDAY);
  return nextUsSessionOpen(new Date(time.getTime() + 24 * HOUR_MS - minutes * MINUTE_MS));
}

/**
 * When a report filed at `time` first moves the price: that weekday's open for a report before
 * the 16:00 close (also when filed during the session, after a pre-market release), otherwise
 * the next session's open.
 */
export function usReportGap(time: Date): Date {
  return isNewYorkWeekday(time) && newYorkMinutes(time) < US_CLOSE
    ? atNewYorkMinutes(time, US_OPEN)
    : nextUsSessionOpen(new Date(time.getTime() + 24 * HOUR_MS - newYorkMinutes(time) * MINUTE_MS));
}

/** True when the bar opens inside the regular session. */
export function isInSession(openTime: Date, session: SessionType): boolean {
  if (session === SessionType.Continuous) return true;
  const minutes = newYorkMinutes(openTime);
  return minutes >= US_OPEN && minutes < US_CLOSE;
}

/** End time of a 1h bar. US session bars are cut at the 16:00 close (15:30 bar lasts 30 min). */
export function hourlyBarEnd(openTime: Date, session: SessionType): Date {
  const end = openTime.getTime() + HOUR_MS;
  if (session === SessionType.Continuous) return new Date(end);
  const minutesToClose = US_CLOSE - newYorkMinutes(openTime);
  return new Date(Math.min(end, openTime.getTime() + minutesToClose * MINUTE_MS));
}

/**
 * 4h bucket that contains the bar.
 * - us_equity: 09:30-13:30 and 13:30-16:00 New York time (second bucket is 2.5h).
 * - continuous: UTC 00/04/08/12/16/20.
 */
export function fourHourBucket(openTime: Date, session: SessionType): Period {
  const t = openTime.getTime();
  if (session === SessionType.Continuous) {
    const start = Math.floor(t / FOUR_HOURS_MS) * FOUR_HOURS_MS;
    return { start: new Date(start), end: new Date(start + FOUR_HOURS_MS) };
  }

  const minutes = newYorkMinutes(openTime);
  const [bucketStart, bucketEnd] =
    minutes < US_MIDDAY ? [US_OPEN, US_MIDDAY] : [US_MIDDAY, US_CLOSE];
  const start = t - (minutes - bucketStart) * MINUTE_MS;
  return { start: new Date(start), end: new Date(start + (bucketEnd - bucketStart) * MINUTE_MS) };
}
