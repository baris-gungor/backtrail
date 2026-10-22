import type { StrategyRunner } from '../../../analysis/domain/strategy';
import { findStrategy } from '../../../analysis/domain/strategies';
import fixture from '../../../analysis/domain/strategies/__fixtures__/gc-f-4h.json';
import { runBacktest } from '../../../backtesting/domain/engine';
import type { Bar } from '../../../market-data/domain/bar';
import Decimal from 'decimal.js';
import { Account } from './account';
import { borrowFee } from './execution-model';
import { checkExitLevels } from './fill';
import type { TradeDirection } from './bar-step';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 0, 5, 14);
const FREE = { feeBps: 0, slippageBps: 0, minFee: 0 };

function makeBars(rows: [number, number, number, number][]): Bar[] {
  return rows.map(([open, high, low, close], i) => ({
    openTime: new Date(T0 + i * 4 * HOUR),
    open,
    high,
    low,
    close,
    volume: 1000,
    isComplete: true,
  }));
}

/** Goes short at `entryAt` with an optional stop, covers at `exitAt`; never long. */
function shortRunner(entryAt: number, exitAt: number, stopLoss?: number): StrategyRunner {
  return {
    warmup: 0,
    entry: () => null,
    exit: () => null,
    shortEntry: (i) =>
      i === entryAt ? { strength: 1, reason: 'test', indicators: {}, stopLoss } : null,
    shortExit: (i) => (i === exitAt ? { reason: 'test', indicators: {} } : null),
  };
}

const run = (bars: Bar[], runner: StrategyRunner, direction?: TradeDirection) =>
  runBacktest({
    bars,
    runner,
    initialCapital: 10_000,
    execution: FREE,
    sizing: { type: 'all_in' },
    direction,
  });

describe('short level checks', () => {
  it('has the stop above and the take-profit below', () => {
    const levels = { stopLoss: 110, takeProfit: 90 };
    expect(checkExitLevels({ open: 100, high: 111, low: 95 }, levels, 'short')).toEqual({
      reason: 'stop_loss',
      price: 110,
      market: true,
    });
    expect(checkExitLevels({ open: 100, high: 105, low: 89 }, levels, 'short')).toEqual({
      reason: 'take_profit',
      price: 90,
      market: false,
    });
    // A gap through the stop fills at the open; both inside the bar: stop first.
    expect(checkExitLevels({ open: 112, high: 113, low: 108 }, levels, 'short')?.price).toBe(112);
    expect(checkExitLevels({ open: 100, high: 111, low: 89 }, levels, 'short')?.reason).toBe(
      'stop_loss',
    );
  });
});

describe('short backtests', () => {
  const falling = makeBars([
    [100, 101, 99, 100],
    [100, 101, 99, 100],
    [100, 100, 94, 95], // short fills at 100 (decided at bar 1)
    [95, 95, 89, 90],
    [90, 91, 89, 90], // cover fills at 90 (decided at bar 3)
    [90, 91, 89, 90],
  ]);

  it('gains when the price falls', () => {
    const { trades, equity } = run(falling, shortRunner(1, 3), 'short');
    expect(trades).toHaveLength(1);
    const [t] = trades;
    expect(t.side).toBe('short');
    expect(t.entryPrice.toNumber()).toBe(100);
    expect(t.exitPrice.toNumber()).toBe(90);
    expect(t.pnl.toNumber()).toBeCloseTo(1000, 6);
    expect(equity.at(-1)!.equity).toBeCloseTo(11_000, 6);
  });

  it('stops out above the entry', () => {
    const rising = makeBars([
      [100, 101, 99, 100],
      [100, 101, 99, 100],
      [100, 104, 99, 103],
      [103, 108, 102, 107], // stop 106 hit
      [107, 108, 106, 107],
    ]);
    const [t] = run(rising, shortRunner(1, -1, 106), 'short').trades;
    expect(t.exitReason).toBe('stop_loss');
    expect(t.exitPrice.toNumber()).toBe(106);
    expect(t.pnl.toNumber()).toBeCloseTo(-600, 6);
  });

  it('ignores short rules unless the direction allows them', () => {
    expect(run(falling, shortRunner(1, 3)).trades).toHaveLength(0);
    expect(run(falling, shortRunner(1, 3), 'long').trades).toHaveLength(0);
    expect(run(falling, shortRunner(1, 3), 'both').trades).toHaveLength(1);
  });

  it('trades both sides of the trend strategy on real data', () => {
    const bars: Bar[] = fixture.map(([t, open, high, low, close, volume]) => ({
      openTime: new Date(t * 1000),
      open,
      high,
      low,
      close,
      volume,
      isComplete: true,
    }));
    const trend = findStrategy('trend_ema_adx')!;
    expect(trend.canShort).toBe(true);
    expect(findStrategy('meanrev_bb_rsi')!.canShort).toBe(false);
    const runWith = (direction: TradeDirection) =>
      runBacktest({
        bars,
        runner: trend.createRunner(bars, trend.defaultParams),
        initialCapital: 10_000,
        execution: FREE,
        sizing: { type: 'fixed_fraction', fraction: 1 },
        direction,
      }).trades;
    const long = runWith('long');
    const both = runWith('both');
    expect(long.every((t) => t.side === 'long')).toBe(true);
    expect(both.some((t) => t.side === 'short')).toBe(true);
    // Every trade's PnL has the sign its side and prices imply (no fees here).
    for (const t of both) {
      const move = t.exitPrice.minus(t.entryPrice).mul(t.side === 'short' ? -1 : 1);
      expect(Math.sign(t.pnl.toNumber())).toBe(Math.sign(move.toNumber()));
    }
  });
});

describe('short accounting', () => {
  it('keeps short proceeds out of the cash that backs new positions', () => {
    const account = new Account(10_000);
    account.openPosition(
      'A',
      'short',
      new Decimal(10),
      new Decimal(100),
      new Decimal(0),
      new Date(),
    );
    expect(account.cash.toNumber()).toBe(11_000);
    expect(account.equity(() => 100).toNumber()).toBe(10_000);
    // Buying back at 120 would cost 1200.
    expect(account.freeCash(() => 120).toNumber()).toBe(9_800);
    account.buy('B', new Decimal(1), new Decimal(50), new Decimal(0), new Date());
    expect(account.freeCash(() => 100).toNumber()).toBe(9_950);
  });

  it('charges borrow cost pro rata on shorts only', () => {
    const entryTime = new Date(Date.UTC(2026, 0, 1));
    const to = new Date(entryTime.getTime() + 73 * 86_400_000); // 0.2 year
    const short = { quantity: new Decimal(-10), entryPrice: new Decimal(100), entryTime };
    const model = { ...FREE, borrowPct: 5 };
    expect(borrowFee(short, to, model).toNumber()).toBeCloseTo(10, 9);
    expect(borrowFee({ ...short, quantity: new Decimal(10) }, to, model).toNumber()).toBe(0);
    expect(borrowFee(short, to, FREE).toNumber()).toBe(0);
  });

  it('books the borrow cost as an exit fee in backtests', () => {
    const bars = makeBars([
      [100, 101, 99, 100],
      [100, 101, 99, 100],
      [100, 100, 94, 95],
      [95, 95, 89, 90],
      [90, 91, 89, 90],
      [90, 91, 89, 90],
    ]);
    const [t] = runBacktest({
      bars,
      runner: shortRunner(1, 3),
      initialCapital: 10_000,
      execution: { ...FREE, borrowPct: 10 },
      sizing: { type: 'all_in' },
      direction: 'short',
    }).trades;
    // 100 shares × 100 × 10% × 8 h / 365 d
    const cost = (100 * 100 * 0.1 * 8) / (365 * 24);
    expect(t.fees.toNumber()).toBeCloseTo(cost, 9);
    expect(t.pnl.toNumber()).toBeCloseTo(1000 - cost, 9);
  });
});
