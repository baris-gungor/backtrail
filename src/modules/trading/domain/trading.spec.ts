import Decimal from 'decimal.js';
import { STRATEGIES } from '../../analysis/domain/strategies';
import type { StrategyDefinition } from '../../analysis/domain/strategy';
import fixture from '../../analysis/domain/strategies/__fixtures__/gc-f-4h.json';
import { runBacktest } from '../../backtesting/domain/engine';
import type { Bar } from '../../market-data/domain/bar';
import {
  Account,
  DEFAULT_SIZING,
  flatSlot,
  stepBar,
  type ClosedTrade,
  type ExecutionModel,
  type OpenPosition,
  type TradeDirection,
} from './execution';
import { canTransition, limitFillPrice, transition } from './order';
import { checkRisk, DEFAULT_RISK_RULES, type RiskState } from './risk';
import { signalRunner } from './signal-runner';
import { FLAT_SLOT, indexAtOrBefore, loadSlot, storeSlot, type StoredSlot } from './slot-state';

const bars: Bar[] = fixture.map(([t, open, high, low, close, volume]) => ({
  openTime: new Date(t * 1000),
  open,
  high,
  low,
  close,
  volume,
  isComplete: true,
}));

const d = (v: Decimal.Value) => new Decimal(v);

describe('risk rules', () => {
  const state: RiskState = {
    equity: d(10_000),
    cash: d(10_000),
    openPositions: 0,
    dayStartEquity: d(10_000),
  };
  const entry = { quantity: d(10), price: d(100), stopLoss: 95 };

  it('approves an entry inside every limit', () => {
    expect(checkRisk(DEFAULT_RISK_RULES, state, entry)).toEqual({
      action: 'approve',
      quantity: d(10),
    });
  });

  it('resizes to the maximum position size and to the cash buffer', () => {
    const big = { ...entry, quantity: d(100) };
    const resized = checkRisk(DEFAULT_RISK_RULES, state, big);
    expect(resized).toMatchObject({ action: 'resize' });
    expect(resized.action === 'resize' && resized.quantity.toNumber()).toBe(25);

    const buffered = checkRisk(
      { ...DEFAULT_RISK_RULES, maxPositionPct: 100, cashBufferPct: 40 },
      { ...state, cash: d(5_000) },
      big,
    );
    expect(buffered.action === 'resize' && buffered.quantity.toNumber()).toBe(10);
  });

  it('rejects without a stop, at the position limit, after the daily loss and without cash', () => {
    expect(checkRisk(DEFAULT_RISK_RULES, state, { ...entry, stopLoss: undefined })).toEqual({
      action: 'reject',
      reason: 'no_stop_loss',
    });
    expect(
      checkRisk({ ...DEFAULT_RISK_RULES, requireStopLoss: false }, state, {
        ...entry,
        stopLoss: undefined,
      }).action,
    ).toBe('approve');
    expect(checkRisk(DEFAULT_RISK_RULES, { ...state, openPositions: 5 }, entry)).toMatchObject({
      reason: 'max_positions',
    });
    expect(checkRisk(DEFAULT_RISK_RULES, { ...state, equity: d(9_600) }, entry)).toMatchObject({
      reason: 'daily_loss',
    });
    expect(checkRisk(DEFAULT_RISK_RULES, { ...state, cash: d(0) }, entry)).toMatchObject({
      reason: 'insufficient_cash',
    });
  });
});

describe('order lifecycle', () => {
  it('allows only transitions out of pending', () => {
    expect(transition('pending', 'filled')).toBe('filled');
    expect(canTransition('pending', 'cancelled')).toBe(true);
    expect(canTransition('filled', 'cancelled')).toBe(false);
    expect(() => transition('cancelled', 'filled')).toThrow();
  });

  it('fills limit orders at the limit, or at the open on a gap', () => {
    const bar = { open: 100, high: 104, low: 97 };
    expect(limitFillPrice('BUY', 98, bar)).toBe(98);
    expect(limitFillPrice('BUY', 96, bar)).toBeNull();
    expect(limitFillPrice('BUY', 101, bar)).toBe(100);
    expect(limitFillPrice('SELL', 103, bar)).toBe(103);
    expect(limitFillPrice('SELL', 105, bar)).toBeNull();
    expect(limitFillPrice('SELL', 99, bar)).toBe(100);
  });
});

describe('slot state', () => {
  it('stores bar indexes as times and finds them again after older bars are added', () => {
    const slot = {
      ...flatSlot('A'),
      entrySignalIndex: 10,
      entryBarIndex: 11,
      levels: { stopLoss: 1 },
      pending: {
        kind: 'exit' as const,
        signalIndex: 20,
        decision: { reason: 'x', indicators: {} },
      },
    };
    const stored = JSON.parse(JSON.stringify(storeSlot(slot, bars))) as StoredSlot;
    expect(loadSlot('A', stored, bars)).toEqual(slot);
    // With 5 bars fewer at the start, every index shifts by 5.
    expect(loadSlot('A', stored, bars.slice(5))).toMatchObject({
      entrySignalIndex: 5,
      entryBarIndex: 6,
      pending: { signalIndex: 15 },
    });
    expect(loadSlot('A', FLAT_SLOT, bars)).toEqual(flatSlot('A'));
  });

  it('maps a time between bars to the bar before it', () => {
    const between = new Date(bars[3].openTime.getTime() + 60_000);
    expect(indexAtOrBefore(bars, between)).toBe(3);
    expect(indexAtOrBefore(bars, new Date(0))).toBe(-1);
  });
});

describe('signal runner', () => {
  it('turns stored BUY and SELL signals into entry and exit decisions', () => {
    const runner = signalRunner(bars, [
      {
        barTime: bars[4].openTime,
        side: 'BUY',
        strength: 0.5,
        stopLoss: 90,
        takeProfit: null,
        reason: 'b',
        indicators: {},
      },
      {
        barTime: bars[9].openTime,
        side: 'SELL',
        strength: 1,
        stopLoss: null,
        takeProfit: null,
        reason: 's',
        indicators: {},
      },
    ]);
    expect(runner.entry(4)).toMatchObject({ stopLoss: 90, takeProfit: undefined, reason: 'b' });
    expect(runner.entry(9)).toBeNull();
    expect(runner.exit(9, 4)).toMatchObject({ reason: 's' });
    expect(runner.exit(5, 4)).toBeNull();
  });
});

/**
 * Paper trading processes bars in batches (one per sync) and keeps its state in the database
 * between them. Replaying that with a serialization round trip after every batch must give
 * exactly the trades of a single backtest run over the same bars.
 */
describe('paper / backtest parity', () => {
  const execution: ExecutionModel = { feeBps: 5, slippageBps: 5, minFee: 1 };
  const tradeFrom = 300;

  function paperTrades(
    code: string,
    batchSize: number,
    direction: TradeDirection = 'long',
    model: ExecutionModel = execution,
  ): ClosedTrade[] {
    const strategy = STRATEGIES.find((s) => s.code === code)!;
    let cash = '10000';
    let positions: [string, OpenPosition][] = [];
    let stored = FLAT_SLOT;
    const trades: ClosedTrade[] = [];

    for (let end = tradeFrom + batchSize; ; end += batchSize) {
      const known = bars.slice(0, Math.min(end, bars.length));
      // Rebuilt from stored values each batch, as the paper service does.
      const account = new Account(cash, positions);
      const slot = loadSlot('GC=F', stored, known);
      const runner = strategy.createRunner(known, strategy.defaultParams);
      const ctx = {
        execution: model,
        sizing: DEFAULT_SIZING,
        equity: (price: number) => account.equity(() => price),
        direction,
      };
      for (let t = Math.max(tradeFrom, end - batchSize); t < known.length; t++) {
        for (const event of stepBar(account, slot, known, t, runner, ctx)) {
          if (event.type === 'exit') trades.push(event.trade);
        }
      }
      cash = account.cash.toString();
      positions = [...account.positions].map(([key, p]) => [
        key,
        {
          ...p,
          quantity: d(p.quantity.toString()),
          entryPrice: d(p.entryPrice.toString()),
          entryFee: d(p.entryFee.toString()),
        },
      ]);
      stored = JSON.parse(JSON.stringify(storeSlot(slot, known))) as StoredSlot;
      if (known.length === bars.length) return trades;
    }
  }

  const cases: [StrategyDefinition, TradeDirection, ExecutionModel][] = [
    ...STRATEGIES.map((s): [StrategyDefinition, TradeDirection, ExecutionModel] => [
      s,
      'long',
      execution,
    ]),
    // Shorts with a borrow cost.
    ...STRATEGIES.filter((s) => s.canShort).map(
      (s): [StrategyDefinition, TradeDirection, ExecutionModel] => [
        s,
        'both',
        { ...execution, borrowPct: 3 },
      ],
    ),
  ];
  for (const [strategy, direction, model] of cases) {
    it(`matches the backtest for ${strategy.code} (${direction})`, () => {
      const backtest = runBacktest({
        bars,
        runner: strategy.createRunner(bars, strategy.defaultParams),
        initialCapital: 10_000,
        execution: model,
        sizing: DEFAULT_SIZING,
        tradeFrom,
        direction,
      });
      // The backtest closes an open position at the end of the data; paper keeps it open.
      const expected = backtest.trades
        .filter((t) => t.exitReason !== 'end_of_data')
        .map((t): ClosedTrade => ({
          side: t.side,
          entryTime: t.entryTime,
          entryPrice: t.entryPrice,
          exitTime: t.exitTime,
          exitPrice: t.exitPrice,
          quantity: t.quantity,
          fees: t.fees,
          pnl: t.pnl,
          returnPct: t.returnPct,
        }));
      if (!strategy.isBenchmark) expect(expected.length).toBeGreaterThan(0);
      if (direction !== 'long') expect(expected.some((t) => t.side === 'short')).toBe(true);
      expect(paperTrades(strategy.code, 7, direction, model)).toEqual(expected);
      expect(paperTrades(strategy.code, 50, direction, model)).toEqual(expected);
    });
  }
});
