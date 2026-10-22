import { SessionType } from '../../assets/domain/asset.types';
import { aggregateToFourHour, normalizeHourlyBars } from './aggregation';
import { RawBar } from './bar';
import { fourHourBucket, hourlyBarEnd, isInSession } from './session';
import { isSyncDue } from './sync-schedule';

const bar = (iso: string, open: number, close = open, volume = 100): RawBar => ({
  openTime: new Date(iso),
  open,
  high: Math.max(open, close) + 1,
  low: Math.min(open, close) - 1,
  close,
  volume,
});

describe('session', () => {
  // 2026-10-05 is EDT (UTC-4): 09:30 NY = 13:30Z, 16:00 NY = 20:00Z
  it('keeps only regular US session bars', () => {
    expect(isInSession(new Date('2026-10-05T13:30:00Z'), SessionType.UsEquity)).toBe(true);
    expect(isInSession(new Date('2026-10-05T19:30:00Z'), SessionType.UsEquity)).toBe(true);
    expect(isInSession(new Date('2026-10-05T20:00:00Z'), SessionType.UsEquity)).toBe(false);
    expect(isInSession(new Date('2026-10-05T12:30:00Z'), SessionType.UsEquity)).toBe(false);
    expect(isInSession(new Date('2026-10-05T03:00:00Z'), SessionType.Continuous)).toBe(true);
  });

  it('cuts the last US hourly bar at the close', () => {
    expect(hourlyBarEnd(new Date('2026-10-05T19:30:00Z'), SessionType.UsEquity).toISOString()).toBe(
      '2026-10-05T20:00:00.000Z',
    );
    expect(hourlyBarEnd(new Date('2026-10-05T14:30:00Z'), SessionType.UsEquity).toISOString()).toBe(
      '2026-10-05T15:30:00.000Z',
    );
  });

  it('aligns US buckets to 09:30 and 13:30 New York time, in summer and winter', () => {
    const summer = fourHourBucket(new Date('2026-10-05T16:30:00Z'), SessionType.UsEquity);
    expect(summer.start.toISOString()).toBe('2026-10-05T13:30:00.000Z');
    expect(summer.end.toISOString()).toBe('2026-10-05T17:30:00.000Z');

    const afternoon = fourHourBucket(new Date('2026-10-05T17:30:00Z'), SessionType.UsEquity);
    expect(afternoon.start.toISOString()).toBe('2026-10-05T17:30:00.000Z');
    expect(afternoon.end.toISOString()).toBe('2026-10-05T20:00:00.000Z');

    // 2026-12-07 is EST (UTC-5): 09:30 NY = 14:30Z
    const winter = fourHourBucket(new Date('2026-12-07T16:30:00Z'), SessionType.UsEquity);
    expect(winter.start.toISOString()).toBe('2026-12-07T14:30:00.000Z');
  });

  it('aligns continuous buckets to UTC 4h boundaries', () => {
    const bucket = fourHourBucket(new Date('2026-10-05T06:00:00Z'), SessionType.Continuous);
    expect(bucket.start.toISOString()).toBe('2026-10-05T04:00:00.000Z');
    expect(bucket.end.toISOString()).toBe('2026-10-05T08:00:00.000Z');
  });
});

describe('aggregateToFourHour', () => {
  const now = new Date('2026-10-06T00:00:00Z');

  it('builds two US session bars per day with correct OHLCV', () => {
    const raw = [
      bar('2026-10-05T15:30:00Z', 12, 13), // out of order on purpose
      bar('2026-10-05T13:30:00Z', 10, 11),
      bar('2026-10-05T14:30:00Z', 11, 12),
      bar('2026-10-05T16:30:00Z', 13, 14),
      bar('2026-10-05T17:30:00Z', 20, 21),
      bar('2026-10-05T18:30:00Z', 21, 22),
      bar('2026-10-05T19:30:00Z', 22, 23),
      bar('2026-10-05T20:00:00Z', 99), // after close, dropped
    ];

    const hourly = normalizeHourlyBars(raw, SessionType.UsEquity, now);
    expect(hourly).toHaveLength(7);

    const fourHour = aggregateToFourHour(hourly, SessionType.UsEquity, now);
    expect(fourHour).toEqual([
      {
        openTime: new Date('2026-10-05T13:30:00Z'),
        open: 10,
        high: 15,
        low: 9,
        close: 14,
        volume: 400,
        isComplete: true,
      },
      {
        openTime: new Date('2026-10-05T17:30:00Z'),
        open: 20,
        high: 24,
        low: 19,
        close: 23,
        volume: 300,
        isComplete: true,
      },
    ]);
  });

  it('marks the running bucket as incomplete', () => {
    const midSession = new Date('2026-10-05T15:00:00Z');
    const hourly = normalizeHourlyBars(
      [bar('2026-10-05T13:30:00Z', 10), bar('2026-10-05T14:30:00Z', 11)],
      SessionType.UsEquity,
      midSession,
    );
    expect(hourly.map((b) => b.isComplete)).toEqual([true, false]);

    const [fourHour] = aggregateToFourHour(hourly, SessionType.UsEquity, midSession);
    expect(fourHour.isComplete).toBe(false);
  });

  it('groups continuous markets by UTC 4h windows', () => {
    const hourly = normalizeHourlyBars(
      [
        bar('2026-10-05T03:00:00Z', 1),
        bar('2026-10-05T04:00:00Z', 2),
        bar('2026-10-05T05:00:00Z', 3),
        bar('2026-10-05T07:00:00Z', 4),
        bar('2026-10-05T08:00:00Z', 5),
      ],
      SessionType.Continuous,
      now,
    );
    const fourHour = aggregateToFourHour(hourly, SessionType.Continuous, now);
    expect(fourHour.map((b) => [b.openTime.toISOString(), b.open, b.close, b.volume])).toEqual([
      ['2026-10-05T00:00:00.000Z', 1, 1, 100],
      ['2026-10-05T04:00:00.000Z', 2, 4, 300],
      ['2026-10-05T08:00:00.000Z', 5, 5, 100],
    ]);
  });
});

describe('sync schedule', () => {
  const due = (iso: string, session: SessionType) => isSyncDue(session, new Date(iso), 5);

  it('syncs continuous assets 5 minutes after every full UTC hour', () => {
    expect(due('2026-10-10T03:05:00Z', SessionType.Continuous)).toBe(true);
    expect(due('2026-10-10T03:35:00Z', SessionType.Continuous)).toBe(false);
  });

  // 2026-10-05 is a Monday in EDT (UTC-4).
  it('syncs US equities after each session bar close on weekdays', () => {
    expect(due('2026-10-05T13:35:00Z', SessionType.UsEquity)).toBe(false); // 09:35, no bar closed
    expect(due('2026-10-05T14:35:00Z', SessionType.UsEquity)).toBe(true); // 10:35
    expect(due('2026-10-05T19:35:00Z', SessionType.UsEquity)).toBe(true); // 15:35
    expect(due('2026-10-05T20:05:00Z', SessionType.UsEquity)).toBe(true); // 16:05, close
    expect(due('2026-10-05T20:35:00Z', SessionType.UsEquity)).toBe(false);
    expect(due('2026-10-05T15:05:00Z', SessionType.UsEquity)).toBe(false);
    expect(due('2026-10-10T14:35:00Z', SessionType.UsEquity)).toBe(false); // Saturday
  });
});
