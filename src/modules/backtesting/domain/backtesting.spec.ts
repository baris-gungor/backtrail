import type { EntryDecision, StrategyRunner } from '../../analysis/domain/strategy';
import { STRATEGIES, findStrategy } from '../../analysis/domain/strategies';
import fixture from '../../analysis/domain/strategies/__fixtures__/gc-f-4h.json';
import type { Bar } from '../../market-data/domain/bar';
import type { ExecutionModel } from '../../trading/domain/execution';
import { adjustRolls, dataQuality } from './data-quality';
import { downsample, runBacktest, type BacktestInput, type EquityPoint } from './engine';
import { computeMetrics, drawdownStats, returnMetrics } from './metrics';
import { expandGrid, rangeValues, splitIndex } from './sweep';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 0, 5, 14);
const FREE: ExecutionModel = { feeBps: 0, slippageBps: 0, minFee: 0 };

/** Bars from [open, high, low, close] tuples, 4h apart. */
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

const flat = (n: number, price = 100): [number, number, number, number][] =>
  Array.from({ length: n }, () => [price, price + 1, price - 1, price]);

/** Enters at the close of `entryAt` bars and exits at the close of `exitAt` bars. */
function scriptedRunner(
  entryAt: number[],
  exitAt: number[] = [],
  decision: Partial<EntryDecision> = {},
): StrategyRunner & { asked: number[] } {
  const asked: number[] = [];
  return {
    warmup: 0,
    asked,
    entry: (i) => {
      asked.push(i);
      return entryAt.includes(i)
        ? { strength: 1, reason: 'test', indicators: {}, ...decision }
        : null;
    },
    exit: (i) => {
      asked.push(i);
      return exitAt.includes(i) ? { reason: 'test', indicators: {} } : null;
    },
  };
}

const base = (bars: Bar[], runner: StrategyRunner): BacktestInput => ({
  bars,
  runner,
  initialCapital: 10_000,
  execution: FREE,
  sizing: { type: 'all_in' },
});

const realBars: Bar[] = fixture.map(([t, open, high, low, close, volume]) => ({
  openTime: new Date(t * 1000),
  open,
  high,
  low,
  close,
  volume,
  isComplete: true,
}));

describe('backtest engine', () => {
  it('fills at the next open and closes at the next open after the exit signal, net of costs', () => {
    const rows = flat(6);
    rows[1] = [100, 101, 99, 100];
    rows[2] = [102, 106, 101, 105]; // entry fills at 102
    rows[3] = [105, 111, 104, 110];
    rows[4] = [110, 113, 108, 112]; // exit fills at 110
    const bars = makeBars(rows);
    const execution = { feeBps: 10, slippageBps: 0, minFee: 0 };
    const result = runBacktest({ ...base(bars, scriptedRunner([1], [3])), execution });

    expect(result.trades).toHaveLength(1);
    const [trade] = result.trades;
    expect(trade.entryPrice.toNumber()).toBe(102);
    expect(trade.exitPrice.toNumber()).toBe(110);
    expect(trade.exitReason).toBe('signal');
    expect(trade.barsHeld).toBe(2);
    // quantity = 10 000 / (102 × 1.001); PnL = q × 8 − fees.
    const q = 10_000 / (102 * 1.001);
    expect(trade.quantity.toNumber()).toBeCloseTo(q, 8);
    expect(trade.pnl.toNumber()).toBeCloseTo(q * 8 - q * 102 * 0.001 - q * 110 * 0.001, 6);
    expect(result.equity.at(-1)!.equity).toBeCloseTo(10_000 + trade.pnl.toNumber(), 6);
  });

  it('applies slippage to market fills', () => {
    const bars = makeBars(flat(5));
    const execution = { feeBps: 0, slippageBps: 10, minFee: 0 };
    const [trade] = runBacktest({ ...base(bars, scriptedRunner([0], [2])), execution }).trades;
    expect(trade.entryPrice.toNumber()).toBeCloseTo(100.1, 10);
    expect(trade.exitPrice.toNumber()).toBeCloseTo(99.9, 10);
  });

  it('fills a gap through the stop at the open', () => {
    const rows = flat(5);
    rows[2] = [90, 91, 88, 89];
    const result = runBacktest(base(makeBars(rows), scriptedRunner([0], [], { stopLoss: 95 })));
    expect(result.trades[0]).toMatchObject({ exitReason: 'stop_loss', barsHeld: 1 });
    expect(result.trades[0].exitPrice.toNumber()).toBe(90);
  });

  it('assumes the stop when stop and take-profit are both inside one bar', () => {
    const rows = flat(5);
    rows[2] = [100, 112, 94, 100];
    const runner = scriptedRunner([0], [], { stopLoss: 95, takeProfit: 110 });
    const [trade] = runBacktest(base(makeBars(rows), runner)).trades;
    expect(trade.exitReason).toBe('stop_loss');
    expect(trade.exitPrice.toNumber()).toBe(95);
  });

  it('lets the strategy enter again after a stop-out', () => {
    const rows = flat(8);
    rows[2] = [100, 101, 94, 96];
    const runner = scriptedRunner([0, 3], [], { stopLoss: 95 });
    const result = runBacktest(base(makeBars(rows), runner));
    expect(result.trades.map((t) => t.exitReason)).toEqual(['stop_loss', 'end_of_data']);
    expect(result.trades[1].entryTime).toEqual(makeBars(rows)[4].openTime);
  });

  it('closes an open position at the last close and does not ask about the last bar', () => {
    const runner = scriptedRunner([1]);
    const result = runBacktest(base(makeBars(flat(4)), runner));
    expect(result.trades[0].exitReason).toBe('end_of_data');
    expect(runner.asked).not.toContain(3);
    expect(result.barsInMarket).toBe(2);
  });

  it('starts trading at tradeFrom but lets the strategy use earlier bars', () => {
    const runner = scriptedRunner([1, 5]);
    const result = runBacktest({ ...base(makeBars(flat(8)), runner), tradeFrom: 4 });
    expect(result.bars).toBe(4);
    expect(runner.asked[0]).toBe(4);
    expect(result.trades).toHaveLength(1);
    expect(result.equity[0].time).toEqual(makeBars(flat(8))[4].openTime);
  });

  it('matches buy & hold price return with the benchmark curve', () => {
    const rows = flat(10).map((_, i): [number, number, number, number] => [
      100 + i,
      102 + i,
      99 + i,
      101 + i,
    ]);
    const result = runBacktest(base(makeBars(rows), scriptedRunner([])));
    expect(result.benchmark.at(-1)!.equity).toBeCloseTo((10_000 * 110) / 100, 8);
    expect(result.equity.every((p) => p.equity === 10_000)).toBe(true);
  });

  it('has no look-ahead: a runner built from bars[0..t] gives the same trades', () => {
    const strategy = findStrategy('trend_ema_adx')!;
    const params = strategy.defaultParams;
    const bars = realBars.slice(0, 700);
    const full = runBacktest(base(bars, strategy.createRunner(bars, params)));

    const truncated: StrategyRunner = {
      warmup: strategy.createRunner(bars, params).warmup,
      entry: (i) => strategy.createRunner(bars.slice(0, i + 1), params).entry(i),
      exit: (i, e) => strategy.createRunner(bars.slice(0, i + 1), params).exit(i, e),
    };
    const stepwise = runBacktest(base(bars, truncated));
    expect(full.trades.length).toBeGreaterThan(0);
    expect(stepwise.trades.map((t) => [t.entryTime, t.exitTime])).toEqual(
      full.trades.map((t) => [t.entryTime, t.exitTime]),
    );
  });

  it.each(STRATEGIES.map((s) => [s.code, s] as const))(
    '%s runs on real data with finite metrics',
    (_code, strategy) => {
      const result = runBacktest({
        ...base(realBars, strategy.createRunner(realBars, strategy.defaultParams)),
        execution: { feeBps: 5, slippageBps: 5, minFee: 0 },
      });
      const metrics = computeMetrics(result);
      expect(result.trades.length).toBeGreaterThan(0);
      expect(Number.isFinite(metrics.totalReturn)).toBe(true);
      expect(metrics.maxDrawdown).toBeGreaterThanOrEqual(0);
      expect(metrics.maxDrawdown).toBeLessThan(1);
      expect(result.equity.every((p) => p.equity > 0)).toBe(true);
    },
  );

  it('downsamples keeping the first and last points', () => {
    const points = Array.from({ length: 2500 }, (_, i) => i);
    const out = downsample(points, 1000);
    expect(out).toHaveLength(1000);
    expect(out[0]).toBe(0);
    expect(out.at(-1)).toBe(2499);
  });
});

describe('metrics', () => {
  const day = 24 * HOUR;
  const curve = (values: number[], stepMs = day): EquityPoint[] =>
    values.map((equity, i) => ({ time: new Date(T0 + i * stepMs), equity }));

  it('computes total return, CAGR and max drawdown with duration', () => {
    const points = curve([100, 120, 90, 110, 130, 125]);
    expect(returnMetrics(points).totalReturn).toBeCloseTo(0.25, 12);
    expect(drawdownStats(points)).toEqual({ depth: 0.25, bars: 3, days: 3 });

    const yearly = curve([100, 121], 365.25 * day);
    expect(returnMetrics(yearly).cagr).toBeCloseTo(0.21, 12);
    expect(returnMetrics(curve([100, 121], 2 * 365.25 * day)).cagr).toBeCloseTo(0.1, 12);
  });

  it('computes Sharpe, trade statistics and the low-sample flag', () => {
    // Returns +10%, -10%, +10%, -10% over 4 bars spanning one year.
    const values = [100, 110, 99, 108.9, 98.01];
    const equity = curve(values, (365.25 * day) / 4);
    const pnl = (x: number) => ({ toNumber: () => x });
    const trade = (p: number, bars: number) =>
      ({
        pnl: pnl(p),
        barsHeld: bars,
        entryTime: new Date(T0),
        exitTime: new Date(T0 + bars * 4 * HOUR),
      }) as never;
    const metrics = computeMetrics({
      equity,
      benchmark: curve([100, 100, 100, 100, 110], (365.25 * day) / 4),
      trades: [trade(30, 2), trade(-10, 1), trade(-20, 3)],
      bars: 4,
      barsInMarket: 3,
      totalFees: pnl(1.5) as never,
    });

    expect(metrics.barsPerYear).toBeCloseTo(4, 10);
    // mean 0, so Sharpe 0; std of [.1,-.1,.1,-.1] (sample) = 0.11547; × √4.
    expect(metrics.sharpe).toBeCloseTo(0, 12);
    expect(metrics.volatility).toBeCloseTo(0.1154700538 * 2, 8);
    expect(metrics.winRate).toBeCloseTo(1 / 3, 12);
    expect(metrics.profitFactor).toBeCloseTo(1, 12);
    expect(metrics.avgWin).toBe(30);
    expect(metrics.avgLoss).toBe(15);
    expect(metrics.payoff).toBe(2);
    expect(metrics.expectancy).toBeCloseTo(0, 12);
    expect(metrics.exposure).toBe(0.75);
    expect(metrics.avgHoldingBars).toBe(2);
    expect(metrics.avgHoldingHours).toBe(8);
    expect(metrics.lowSample).toBe(true);
    expect(metrics.benchmark.totalReturn).toBeCloseTo(0.1, 12);
    expect(metrics.alpha).toBeCloseTo(metrics.cagr! - 0.1, 12);
  });
});

describe('sweep', () => {
  it('expands ranges without float drift and lists as given', () => {
    expect(rangeValues({ min: 10, max: 30, step: 5 })).toEqual([10, 15, 20, 25, 30]);
    expect(rangeValues({ min: 0.1, max: 0.3, step: 0.1 })).toEqual([0.1, 0.2, 0.3]);
    const combos = expandGrid({ a: 1, b: 2, c: 3 }, { a: [1, 2], b: { min: 5, max: 6, step: 1 } });
    expect(combos).toEqual([
      { a: 1, b: 5, c: 3 },
      { a: 1, b: 6, c: 3 },
      { a: 2, b: 5, c: 3 },
      { a: 2, b: 6, c: 3 },
    ]);
  });

  it('rejects grids over the limit and bad ratios', () => {
    expect(() =>
      expandGrid({}, { a: { min: 1, max: 30, step: 1 }, b: { min: 1, max: 30, step: 1 } }),
    ).toThrow(/more than 500/);
    expect(() => rangeValues({ min: 1, max: 2, step: 0 })).toThrow();
    expect(splitIndex(100, 0.7)).toBe(70);
    expect(() => splitIndex(100, 1)).toThrow();
  });
});

describe('data quality', () => {
  const day = 24 * HOUR;

  it('counts price jumps and missing-data gaps', () => {
    // A level shift at bar 25, as in a futures roll.
    const rows = [...flat(25), ...flat(5, 130)];
    const bars = makeBars(rows);
    for (let i = 10; i < bars.length; i++) {
      bars[i] = { ...bars[i], openTime: new Date(bars[i].openTime.getTime() + 6 * day) };
    }
    const report = dataQuality(bars);
    expect(report.jumps).toBe(1);
    expect(report.jumpTimes).toEqual([bars[25].openTime.toISOString()]);
    expect(report.gaps).toBe(1);
    expect(report.maxGapDays).toBeCloseTo(6 + 1 / 6, 2);
  });

  it('back-adjusts roll jumps by ratio and leaves weekend gaps alone', () => {
    // Roll at bar 25 (4h after the previous bar): 100 -> 130. A gap of the same size at bar 35
    // comes after a 2-day break, so it is a real gap.
    const rows = [...flat(25), ...flat(10, 130), ...flat(5, 170)];
    const bars = makeBars(rows);
    for (let i = 35; i < bars.length; i++) {
      bars[i] = { ...bars[i], openTime: new Date(bars[i].openTime.getTime() + 2 * day) };
    }
    const { bars: adjusted, rolls } = adjustRolls(bars);
    expect(rolls).toEqual([25]);
    expect(dataQuality(adjusted).jumps).toBe(1);
    // Before the roll, prices are scaled by 130 / 100; from the roll on they are unchanged.
    expect(adjusted[0].close).toBeCloseTo(130);
    expect(adjusted[24].high).toBeCloseTo(101 * 1.3);
    expect(adjusted[25]).toEqual(bars[25]);
    expect(adjusted.at(-1)).toEqual(bars.at(-1));
    // The input is not modified.
    expect(bars[0].close).toBe(100);
  });
});
