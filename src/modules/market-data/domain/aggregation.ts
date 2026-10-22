import { SessionType } from '../../assets/domain/asset.types';
import { Bar, RawBar } from './bar';
import { fourHourBucket, hourlyBarEnd, isInSession } from './session';

/** Drops bars outside the trading session, sorts by time and sets completeness. */
export function normalizeHourlyBars(raw: RawBar[], session: SessionType, now: Date): Bar[] {
  return raw
    .filter((bar) => isInSession(bar.openTime, session))
    .sort((a, b) => a.openTime.getTime() - b.openTime.getTime())
    .map((bar) => ({
      ...bar,
      isComplete: hourlyBarEnd(bar.openTime, session).getTime() <= now.getTime(),
    }));
}

/**
 * Builds 4h bars from 1h bars. Input must be sorted ascending.
 * open = first open, high = max, low = min, close = last close, volume = sum.
 * A 4h bar is complete when its bucket has ended and all its 1h bars are complete.
 */
export function aggregateToFourHour(hourly: Bar[], session: SessionType, now: Date): Bar[] {
  const result: Bar[] = [];
  let current: Bar | null = null;
  let currentEnd = 0;

  for (const bar of hourly) {
    const bucket = fourHourBucket(bar.openTime, session);

    if (current && current.openTime.getTime() === bucket.start.getTime()) {
      current.high = Math.max(current.high, bar.high);
      current.low = Math.min(current.low, bar.low);
      current.close = bar.close;
      current.volume += bar.volume;
      current.isComplete = current.isComplete && bar.isComplete;
      continue;
    }

    if (current) result.push(finalize(current, currentEnd, now));
    current = { ...bar, openTime: bucket.start };
    currentEnd = bucket.end.getTime();
  }

  if (current) result.push(finalize(current, currentEnd, now));
  return result;
}

function finalize(bar: Bar, bucketEnd: number, now: Date): Bar {
  return { ...bar, isComplete: bar.isComplete && bucketEnd <= now.getTime() };
}
