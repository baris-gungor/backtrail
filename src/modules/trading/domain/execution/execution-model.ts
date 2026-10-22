import Decimal from 'decimal.js';

export type OrderSide = 'BUY' | 'SELL';

/** Trading costs shared by the backtest engine and the paper broker. */
export interface ExecutionModel {
  /** Fee per fill in basis points of the notional (commission + regulatory fees). */
  feeBps: number;
  /** Price impact in basis points: buys fill higher, sells lower. */
  slippageBps: number;
  /** Minimum fee per fill, in account currency. */
  minFee: number;
  /** Annual borrow cost of a short in percent of its entry notional. Default 0. */
  borrowPct?: number;
}

export const DEFAULT_EXECUTION: ExecutionModel = { feeBps: 5, slippageBps: 5, minFee: 0 };

const BPS = new Decimal(10_000);

/** Market fill price after slippage. */
export function slippedPrice(
  price: Decimal.Value,
  side: OrderSide,
  model: ExecutionModel,
): Decimal {
  const slip = new Decimal(model.slippageBps).div(BPS);
  return new Decimal(price).mul(side === 'BUY' ? slip.plus(1) : new Decimal(1).minus(slip));
}

export function feeFor(notional: Decimal.Value, model: ExecutionModel): Decimal {
  const fee = new Decimal(notional).mul(model.feeBps).div(BPS);
  return Decimal.max(fee, model.minFee);
}

const YEAR_MS = 365 * 24 * 3_600_000;

/** Borrow cost of a short held from `from` to `to`: entry notional × `borrowPct` pro rata. Zero for longs. */
export function borrowFee(
  position: { quantity: Decimal; entryPrice: Decimal; entryTime: Date },
  to: Date,
  model: ExecutionModel,
): Decimal {
  if (!model.borrowPct || position.quantity.gte(0)) return new Decimal(0);
  const held = Math.max(0, to.getTime() - position.entryTime.getTime());
  return position.quantity
    .abs()
    .mul(position.entryPrice)
    .mul(model.borrowPct)
    .div(100)
    .mul(held)
    .div(YEAR_MS);
}

/** Fee of the fill that closes `position` at `price`: the exit fee plus a short's borrow cost. */
export function exitFee(
  position: { quantity: Decimal; entryPrice: Decimal; entryTime: Date },
  price: Decimal,
  time: Date,
  model: ExecutionModel,
): Decimal {
  return feeFor(position.quantity.abs().mul(price), model).plus(borrowFee(position, time, model));
}
