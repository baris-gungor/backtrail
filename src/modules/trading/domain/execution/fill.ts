export interface ExitLevels {
  stopLoss?: number;
  takeProfit?: number;
}

export interface BarRange {
  open: number;
  high: number;
  low: number;
}

export interface LevelHit {
  reason: 'stop_loss' | 'take_profit';
  /** Trigger price before slippage. */
  price: number;
  /** Stops fill as market orders (slippage applies); take-profits are limit orders. */
  market: boolean;
}

/**
 * Checks a position's stop-loss and take-profit against one bar. For a long the stop is below
 * and the take-profit above; for a short the other way round.
 * - A gap through a level fills at the open, not at the level.
 * - If both levels fall inside the bar, the stop is assumed to hit first (conservative).
 */
export function checkExitLevels(
  bar: BarRange,
  levels: ExitLevels,
  side: 'long' | 'short' = 'long',
): LevelHit | null {
  if (side === 'short') return checkShortLevels(bar, levels);
  const { stopLoss, takeProfit } = levels;
  if (stopLoss !== undefined && bar.open <= stopLoss) {
    return { reason: 'stop_loss', price: bar.open, market: true };
  }
  if (takeProfit !== undefined && bar.open >= takeProfit) {
    return { reason: 'take_profit', price: bar.open, market: false };
  }
  if (stopLoss !== undefined && bar.low <= stopLoss) {
    return { reason: 'stop_loss', price: stopLoss, market: true };
  }
  if (takeProfit !== undefined && bar.high >= takeProfit) {
    return { reason: 'take_profit', price: takeProfit, market: false };
  }
  return null;
}

function checkShortLevels(bar: BarRange, levels: ExitLevels): LevelHit | null {
  const { stopLoss, takeProfit } = levels;
  if (stopLoss !== undefined && bar.open >= stopLoss) {
    return { reason: 'stop_loss', price: bar.open, market: true };
  }
  if (takeProfit !== undefined && bar.open <= takeProfit) {
    return { reason: 'take_profit', price: bar.open, market: false };
  }
  if (stopLoss !== undefined && bar.high >= stopLoss) {
    return { reason: 'stop_loss', price: stopLoss, market: true };
  }
  if (takeProfit !== undefined && bar.low <= takeProfit) {
    return { reason: 'take_profit', price: takeProfit, market: false };
  }
  return null;
}
