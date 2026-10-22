import Decimal from 'decimal.js';
import { type ExecutionModel } from './execution-model';

export type PositionSizing =
  /** All available cash. */
  | { type: 'all_in' }
  /** A fraction (0..1] of current equity, capped by cash. */
  | { type: 'fixed_fraction'; fraction: number }
  /** Risk `riskPct` % of equity between entry and stop. Without a stop it falls back to all cash. */
  | { type: 'risk_per_trade'; riskPct: number };

export const DEFAULT_SIZING: PositionSizing = { type: 'fixed_fraction', fraction: 1 };

/** Sizing as sent by clients; missing fractions get defaults. */
export interface SizingRequest {
  type: PositionSizing['type'];
  fraction?: number;
  riskPct?: number;
}

export function toSizing(input: SizingRequest | undefined): PositionSizing {
  switch (input?.type) {
    case 'all_in':
      return { type: 'all_in' };
    case 'fixed_fraction':
      return { type: 'fixed_fraction', fraction: input.fraction ?? 1 };
    case 'risk_per_trade':
      return { type: 'risk_per_trade', riskPct: input.riskPct ?? 1 };
    default:
      return DEFAULT_SIZING;
  }
}

export interface SizingInput {
  sizing: PositionSizing;
  equity: Decimal;
  cash: Decimal;
  /** Expected fill price, slippage included. */
  price: Decimal;
  stopLoss?: number;
  model: ExecutionModel;
  /** A short's stop is above the price. Default long. */
  side?: 'long' | 'short';
}

/**
 * Quantity to buy (or to sell short: the same cash budget backs the short, no leverage).
 * Fractional quantities are allowed. The fee is paid from the same budget,
 * so `quantity × price + fee` never exceeds cash.
 */
export function positionSize(input: SizingInput): Decimal {
  const { sizing, equity, cash, price, stopLoss, model, side = 'long' } = input;
  if (price.lte(0) || cash.lte(0)) return new Decimal(0);

  let budget = cash;
  if (sizing.type === 'fixed_fraction') {
    budget = Decimal.min(cash, equity.mul(sizing.fraction));
  }

  const feeRate = new Decimal(model.feeBps).div(10_000);
  // Largest quantity whose notional plus fee fits the budget.
  let quantity = Decimal.min(
    budget.div(price.mul(feeRate.plus(1))),
    budget.minus(model.minFee).div(price),
  );

  if (sizing.type === 'risk_per_trade' && stopLoss !== undefined) {
    const perUnit = side === 'short' ? new Decimal(stopLoss).minus(price) : price.minus(stopLoss);
    if (perUnit.gt(0)) {
      quantity = Decimal.min(quantity, equity.mul(sizing.riskPct).div(100).div(perUnit));
    }
  }
  return Decimal.max(quantity, 0);
}
