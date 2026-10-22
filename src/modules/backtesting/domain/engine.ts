import type Decimal from 'decimal.js';
import type { StrategyRunner } from '../../analysis/domain/strategy';
import type { Bar } from '../../market-data/domain/bar';
import {
  Account,
  closeSlot,
  flatSlot,
  holdsPosition,
  stepBar,
  type ClosedTrade,
  type ExecutionModel,
  type ExitReason,
  type PositionSizing,
  type StepContext,
  type StepEvent,
  type DecisionFilter,
  type TradeDirection,
} from '../../trading/domain/execution';

export type { ExitReason };

export interface BacktestTrade extends ClosedTrade {
  exitReason: ExitReason;
  barsHeld: number;
}

export interface EquityPoint {
  time: Date;
  equity: number;
}

export interface BacktestInput {
  /** Closed bars, ascending. Bars before `tradeFrom` are only used for indicator warmup. */
  bars: Bar[];
  runner: StrategyRunner;
  initialCapital: number;
  execution: ExecutionModel;
  sizing: PositionSizing;
  /** First bar index where the account starts trading. Default 0. */
  tradeFrom?: number;
  /** Earnings filter and the like (`decide`). */
  filter?: DecisionFilter;
  /** Entries the strategy may take. Default long. */
  direction?: TradeDirection;
}

export interface BacktestResult {
  trades: BacktestTrade[];
  /** Initial capital at the first trading bar's open, then equity at every bar close. */
  equity: EquityPoint[];
  /** Buy & hold of the same window without costs, on the same time points. */
  benchmark: EquityPoint[];
  /** Bars in the trading window. */
  bars: number;
  /** Bars that closed with an open position. */
  barsInMarket: number;
  totalFees: Decimal;
}

/** Account key of the single instrument a backtest trades. */
const KEY = 'instrument';

/**
 * Event-driven simulation, long-only unless `direction` allows shorts. For each bar t (see `stepBar`):
 * 1. A pending order from bar t−1 fills at t's open (slippage and fee applied).
 * 2. An open position's stop-loss and take-profit are checked against t's range.
 * 3. Equity is marked at t's close.
 * 4. The strategy is asked at t's close. A decision becomes the pending order for t+1.
 * The strategy sees only bars[0..t] when asked about bar t (its indicators have no look-ahead).
 * A stop or take-profit exit makes the strategy flat, so it may enter again on its next entry signal.
 */
export function runBacktest(input: BacktestInput): BacktestResult {
  const { bars, runner, execution, sizing } = input;
  const start = input.tradeFrom ?? 0;
  const account = new Account(input.initialCapital);
  const slot = flatSlot(KEY);
  const ctx: StepContext = {
    execution,
    sizing,
    equity: (price) => account.equity(() => price),
    filter: input.filter,
    direction: input.direction,
  };
  const trades: BacktestTrade[] = [];
  const equity: EquityPoint[] = [];
  const benchmark: EquityPoint[] = [];
  let barsInMarket = 0;

  const record = (events: StepEvent[]): void => {
    for (const event of events) {
      if (event.type === 'exit') {
        trades.push({ ...event.trade, exitReason: event.reason, barsHeld: event.barsHeld });
      }
    }
  };

  if (start < bars.length) {
    const first = bars[start];
    equity.push({ time: first.openTime, equity: input.initialCapital });
    benchmark.push({ time: first.openTime, equity: input.initialCapital });
  }

  for (let t = start; t < bars.length; t++) {
    const bar = bars[t];
    // The last bar has no next open to fill at, so the strategy is not asked there.
    record(stepBar(account, slot, bars, t, runner, ctx, { decide: t < bars.length - 1 }));

    if (account.position(KEY)) barsInMarket++;
    equity.push({ time: bar.openTime, equity: account.equity(() => bar.close).toNumber() });
    benchmark.push({
      time: bar.openTime,
      equity: (input.initialCapital * bar.close) / bars[start].open,
    });
  }

  const last = bars.length - 1;
  if (holdsPosition(account, slot) && last >= start) {
    record([
      closeSlot(
        account,
        slot,
        bars,
        last,
        { rawPrice: bars[last].close, market: true, reason: 'end_of_data' },
        execution,
      ),
    ]);
    equity[equity.length - 1] = { time: bars[last].openTime, equity: account.cash.toNumber() };
  }

  return {
    trades,
    equity,
    benchmark,
    bars: Math.max(0, bars.length - start),
    barsInMarket,
    totalFees: account.totalFees,
  };
}

/** Keeps at most `max` points, always including the first and the last. */
export function downsample<T>(points: T[], max = 1000): T[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]);
}
