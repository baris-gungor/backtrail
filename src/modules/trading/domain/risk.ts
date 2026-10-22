import Decimal from 'decimal.js';
import type { EarningsRule } from './execution';

/** Per-portfolio risk rules. Percentages are 0..100. */
export interface RiskRules {
  /** A single position may not exceed this share of equity; larger orders are resized. */
  maxPositionPct: number;
  /** New entries are rejected while this many positions are open. */
  maxOpenPositions: number;
  /** No new entries for the rest of the UTC day once equity fell this far below the day's start. */
  maxDailyLossPct: number;
  /** Entries without a stop-loss are rejected. */
  requireStopLoss: boolean;
  /** Share of equity that must stay in cash after an entry. */
  cashBufferPct: number;
  /** Close positions before earnings reports. Missing on older portfolios: off. */
  earningsExit?: boolean;
  /** No new entries this many days before a report; 0 or missing: only the last two bars. */
  earningsBlockDays?: number;
  /** Subscriptions may sell short. Missing on older portfolios: off. */
  allowShort?: boolean;
}

export const DEFAULT_RISK_RULES: RiskRules = {
  maxPositionPct: 25,
  maxOpenPositions: 5,
  maxDailyLossPct: 3,
  requireStopLoss: true,
  cashBufferPct: 0,
  earningsExit: false,
  earningsBlockDays: 0,
  allowShort: false,
};

/** The earnings filter the portfolio's rules ask for, or null when it is off. */
export function earningsRuleOf(rules: RiskRules): EarningsRule | null {
  const blockEntryDays = rules.earningsBlockDays ?? 0;
  const exitBefore = rules.earningsExit ?? false;
  return exitBefore || blockEntryDays > 0 ? { exitBefore, blockEntryDays } : null;
}

export type RiskRejection = 'no_stop_loss' | 'max_positions' | 'daily_loss' | 'insufficient_cash';

export interface RiskState {
  equity: Decimal;
  cash: Decimal;
  openPositions: number;
  /** Equity at the start of the current UTC day, null when unknown. */
  dayStartEquity: Decimal | null;
}

export interface EntryCheck {
  quantity: Decimal;
  /** Fill price, slippage included. */
  price: Decimal;
  stopLoss?: number;
}

export type RiskVerdict =
  | { action: 'approve'; quantity: Decimal }
  | { action: 'resize'; quantity: Decimal }
  | { action: 'reject'; reason: RiskRejection };

/**
 * Checks a new entry (long or short; `cash` is the free cash, see `Account.freeCash`) against
 * the portfolio's risk rules. Exits are never blocked.
 */
export function checkRisk(rules: RiskRules, state: RiskState, entry: EntryCheck): RiskVerdict {
  if (rules.requireStopLoss && entry.stopLoss === undefined) {
    return { action: 'reject', reason: 'no_stop_loss' };
  }
  if (state.openPositions >= rules.maxOpenPositions) {
    return { action: 'reject', reason: 'max_positions' };
  }
  if (state.dayStartEquity?.gt(0)) {
    const floor = state.dayStartEquity.mul(1 - rules.maxDailyLossPct / 100);
    if (state.equity.lt(floor)) return { action: 'reject', reason: 'daily_loss' };
  }

  const maxNotional = state.equity.mul(rules.maxPositionPct).div(100);
  const spendable = state.cash.minus(state.equity.mul(rules.cashBufferPct).div(100));
  const quantity = Decimal.min(
    entry.quantity,
    maxNotional.div(entry.price),
    Decimal.max(spendable, 0).div(entry.price),
  );
  if (quantity.lte(0)) return { action: 'reject', reason: 'insufficient_cash' };
  return quantity.eq(entry.quantity)
    ? { action: 'approve', quantity }
    : { action: 'resize', quantity };
}
