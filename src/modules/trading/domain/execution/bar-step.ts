import Decimal from 'decimal.js';
import type {
  EntryDecision,
  ExitDecision,
  StrategyRunner,
} from '../../../analysis/domain/strategy';
import type { Bar } from '../../../market-data/domain/bar';
import { closingSide, type Account, type ClosedTrade, type PositionSide } from './account';
import { exitFee, feeFor, slippedPrice, type ExecutionModel } from './execution-model';
import type { DecisionFilter } from './event-filter';
import { checkExitLevels, type ExitLevels } from './fill';
import { positionSize, type PositionSizing } from './position-sizing';

export type ExitReason =
  'signal' | 'stop_loss' | 'take_profit' | 'end_of_data' | 'manual' | 'earnings';

export interface PendingEntry {
  kind: 'entry';
  /** Bar index whose close produced the decision. */
  signalIndex: number;
  decision: EntryDecision;
  /** Missing means long (stored decisions from before short support). */
  side?: PositionSide;
}

/** Which entries a slot may take. Default `long`, the original behaviour. */
export type TradeDirection = 'long' | 'short' | 'both';

export interface PendingExit {
  kind: 'exit';
  signalIndex: number;
  decision: ExitDecision;
  /** Set when a `DecisionFilter` forced the exit; the trade is recorded with this reason. */
  cause?: 'earnings';
}

export type PendingOrder = PendingEntry | PendingExit;

/** State of one strategy trading one instrument (account key). Plain data, so it can be stored. */
export interface Slot {
  key: string;
  /** Decided at the previous bar's close, fills at the next bar's open. */
  pending: PendingOrder | null;
  /** Signal bar index of the entry while this slot holds the position, -1 when flat. */
  entrySignalIndex: number;
  /** Bar index of the entry fill, -1 when flat. */
  entryBarIndex: number;
  levels: ExitLevels;
  /** Side of the held position; missing means long. */
  side?: PositionSide;
}

export const flatSlot = (key: string): Slot => ({
  key,
  pending: null,
  entrySignalIndex: -1,
  entryBarIndex: -1,
  levels: {},
});

export interface EntryRequest {
  quantity: Decimal;
  /** Account equity at this bar's open. */
  equity: Decimal;
  /** Fill price, slippage included. */
  price: Decimal;
  decision: EntryDecision;
}

export type EntryApproval = { quantity: Decimal } | { reject: string };

export interface StepContext {
  execution: ExecutionModel;
  sizing: PositionSizing;
  /** Account equity for sizing, with this slot's instrument marked at `price`. */
  equity(price: number): Decimal;
  /** Cash that may back a new position (`Account.freeCash`). Default: the account's cash. */
  cash?(price: number): Decimal;
  /** Risk rules for a new position (paper trading). Without it the sized quantity is used. */
  approveEntry?(request: EntryRequest): EntryApproval;
  /** Earnings filter and the like; see `decide`. */
  filter?: DecisionFilter;
  /** Entries the strategy may take. Default `long`. */
  direction?: TradeDirection;
}

export type StepEvent =
  | { type: 'entry'; order: PendingEntry; quantity: Decimal; price: Decimal; fee: Decimal }
  | { type: 'entry_rejected'; order: PendingEntry; reason: string }
  | {
      type: 'exit';
      /** The exit order for a signal exit, null for stop-loss, take-profit and end of data. */
      order: PendingExit | null;
      reason: ExitReason;
      trade: ClosedTrade;
      price: Decimal;
      fee: Decimal;
      barsHeld: number;
    }
  /** A decision at this bar's close; it becomes the slot's pending order. */
  | { type: 'order'; order: PendingOrder };

export const holdsPosition = (account: Account, slot: Slot): boolean =>
  slot.entrySignalIndex >= 0 && account.position(slot.key) !== null;

/**
 * Closes the slot's position at `rawPrice` on bar `t`. Market exits pay slippage, limit exits
 * (take-profit) do not.
 */
export function closeSlot(
  account: Account,
  slot: Slot,
  bars: Bar[],
  t: number,
  exit: { rawPrice: number; market: boolean; reason: ExitReason; order?: PendingExit },
  execution: ExecutionModel,
): StepEvent {
  const position = account.position(slot.key)!;
  const price = exit.market
    ? slippedPrice(exit.rawPrice, closingSide(position), execution)
    : new Decimal(exit.rawPrice);
  const fee = exitFee(position, price, bars[t].openTime, execution);
  const trade = account.close(slot.key, price, fee, bars[t].openTime);
  const event: StepEvent = {
    type: 'exit',
    order: exit.order ?? null,
    reason: exit.reason,
    trade,
    price,
    fee,
    barsHeld: t - slot.entryBarIndex,
  };
  slot.entrySignalIndex = -1;
  slot.entryBarIndex = -1;
  slot.levels = {};
  delete slot.side;
  return event;
}

/**
 * One bar of the execution rules, shared by the backtest engine and paper trading:
 * 1. The pending order from the previous close fills at this bar's open (slippage and fee applied).
 * 2. A held position's stop-loss and take-profit are checked against this bar's range.
 * 3. With `decide`, the strategy is asked at this bar's close; a decision becomes the pending order.
 * The caller marks equity between 2 and 3 if it needs to; step 3 does not change the account.
 */
export function stepBar(
  account: Account,
  slot: Slot,
  bars: Bar[],
  t: number,
  runner: StrategyRunner,
  ctx: StepContext,
  options: { decide: boolean } = { decide: true },
): StepEvent[] {
  const bar = bars[t];
  const events: StepEvent[] = [];
  const pending = slot.pending;
  slot.pending = null;

  // 1. Fill the order decided at the previous close.
  if (pending?.kind === 'entry') {
    events.push(fillEntry(account, slot, bars, t, pending, ctx));
  } else if (pending?.kind === 'exit' && holdsPosition(account, slot)) {
    events.push(
      closeSlot(
        account,
        slot,
        bars,
        t,
        { rawPrice: bar.open, market: true, reason: pending.cause ?? 'signal', order: pending },
        ctx.execution,
      ),
    );
  }

  // 2. Protective levels.
  if (holdsPosition(account, slot)) {
    const hit = checkExitLevels(bar, slot.levels, slot.side ?? 'long');
    if (hit) {
      events.push(
        closeSlot(
          account,
          slot,
          bars,
          t,
          { rawPrice: hit.price, market: hit.market, reason: hit.reason },
          ctx.execution,
        ),
      );
    }
  }

  // 3. Ask the strategy.
  if (options.decide) {
    slot.pending = decide(slot, runner, t, ctx.filter, ctx.direction);
    if (slot.pending) events.push({ type: 'order', order: slot.pending });
  }
  return events;
}

/**
 * The strategy's decision at bar `t`'s close: an entry when the slot is flat, an exit when it holds
 * the position, or null. Pure; shared by simulated fills (`stepBar`) and demo-broker trading.
 * A `filter` can block the entry or force the exit (earnings).
 */
export function decide(
  slot: Slot,
  runner: StrategyRunner,
  t: number,
  filter?: DecisionFilter,
  direction: TradeDirection = 'long',
): PendingOrder | null {
  if (slot.entrySignalIndex < 0) {
    if (t < runner.warmup || filter?.blockEntry(t)) return null;
    // Long first; a strategy whose long and short rules both fire on one bar goes long.
    if (direction !== 'short') {
      const decision = runner.entry(t);
      if (decision) return { kind: 'entry', signalIndex: t, decision };
    }
    if (direction !== 'long' && runner.shortEntry) {
      const decision = runner.shortEntry(t);
      if (decision) return { kind: 'entry', signalIndex: t, decision, side: 'short' };
    }
    return null;
  }
  const forced = filter?.forceExit(t);
  if (forced) return { kind: 'exit', signalIndex: t, decision: forced, cause: 'earnings' };
  if (t < runner.warmup) return null;
  const decision =
    slot.side === 'short'
      ? (runner.shortExit?.(t, slot.entrySignalIndex) ?? null)
      : runner.exit(t, slot.entrySignalIndex);
  return decision ? { kind: 'exit', signalIndex: t, decision } : null;
}

function fillEntry(
  account: Account,
  slot: Slot,
  bars: Bar[],
  t: number,
  order: PendingEntry,
  ctx: StepContext,
): StepEvent {
  const bar = bars[t];
  if (account.position(slot.key))
    return { type: 'entry_rejected', order, reason: 'position_exists' };

  const side = order.side ?? 'long';
  const price = slippedPrice(bar.open, side === 'short' ? 'SELL' : 'BUY', ctx.execution);
  const equity = ctx.equity(bar.open);
  const sized = positionSize({
    sizing: ctx.sizing,
    equity,
    cash: ctx.cash?.(bar.open) ?? account.cash,
    price,
    stopLoss: order.decision.stopLoss,
    model: ctx.execution,
    side,
  });
  if (sized.lte(0)) return { type: 'entry_rejected', order, reason: 'insufficient_cash' };

  const approval = ctx.approveEntry?.({
    quantity: sized,
    equity,
    price,
    decision: order.decision,
  }) ?? {
    quantity: sized,
  };
  if ('reject' in approval) return { type: 'entry_rejected', order, reason: approval.reject };
  if (approval.quantity.lte(0)) {
    return { type: 'entry_rejected', order, reason: 'insufficient_cash' };
  }

  const quantity = approval.quantity;
  const fee = feeFor(quantity.mul(price), ctx.execution);
  account.openPosition(slot.key, side, quantity, price, fee, bar.openTime);
  slot.entrySignalIndex = order.signalIndex;
  slot.entryBarIndex = t;
  slot.levels = { stopLoss: order.decision.stopLoss, takeProfit: order.decision.takeProfit };
  if (side === 'short') slot.side = 'short';
  return { type: 'entry', order, quantity, price, fee };
}
