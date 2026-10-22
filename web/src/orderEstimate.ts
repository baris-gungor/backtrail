import { t } from './i18n';

/** Pre-trade estimate for the manual order form: what the typed amount buys and which rules it hits. */
export interface EstimateInput {
  amountMode: 'notional' | 'quantity';
  amount: number | null;
  price: number | null;
  /** The broker accepts whole shares only (Alpaca with stop-loss / take-profit). */
  wholeShares: boolean;
  equity: number;
  cash: number;
  maxPositionPct: number;
  cashBufferPct: number;
}

export interface Estimate {
  quantity: number;
  cost: number;
  pctOfEquity: number;
  /** Problems that make the order fail or shrink. */
  issues: string[];
}

export function estimateBuy(input: EstimateInput): Estimate {
  const { amount, price } = input;
  const empty: Estimate = { quantity: 0, cost: 0, pctOfEquity: 0, issues: [] };
  if (!amount || amount <= 0 || !price || price <= 0) return empty;

  let quantity = input.amountMode === 'quantity' ? amount : amount / price;
  if (input.wholeShares) quantity = Math.floor(quantity);
  const cost = quantity * price;
  const pctOfEquity = input.equity > 0 ? (cost / input.equity) * 100 : 0;
  const issues: string[] = [];

  if (quantity <= 0) {
    issues.push(t('order.issues.tooSmall', { price: price.toFixed(2) }));
    return { quantity: 0, cost: 0, pctOfEquity: 0, issues };
  }
  const spendable = input.cash - (input.equity * input.cashBufferPct) / 100;
  if (cost > spendable) {
    issues.push(t('order.issues.noCash', { amount: Math.max(spendable, 0).toFixed(2) }));
  }
  const maxCost = (input.equity * input.maxPositionPct) / 100;
  if (cost > maxCost) {
    issues.push(
      t('order.issues.overLimit', { pct: input.maxPositionPct, amount: maxCost.toFixed(2) }),
    );
  }
  return { quantity, cost, pctOfEquity, issues };
}
