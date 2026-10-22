export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'market' | 'limit';
export type OrderStatus = 'pending' | 'filled' | 'cancelled' | 'rejected' | 'expired';
/** `signal` covers strategy decisions and stored signals alike (see the subscription's source). */
export type OrderSource = 'signal' | 'manual' | 'stop_loss' | 'take_profit';

const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['filled', 'cancelled', 'rejected', 'expired'],
  filled: [],
  cancelled: [],
  rejected: [],
  expired: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Returns `to`, or throws when the order lifecycle does not allow the change. */
export function transition(from: OrderStatus, to: OrderStatus): OrderStatus {
  if (!canTransition(from, to)) throw new Error(`Order cannot go from ${from} to ${to}`);
  return to;
}

/**
 * Fill price of a limit order on one bar, or null when the bar does not reach the limit.
 * Buys fill at low ≤ limit, sells at high ≥ limit; a gap through the limit fills at the open.
 */
export function limitFillPrice(
  side: OrderSide,
  limit: number,
  bar: { open: number; high: number; low: number },
): number | null {
  if (side === 'BUY') {
    if (bar.open <= limit) return bar.open;
    return bar.low <= limit ? limit : null;
  }
  if (bar.open >= limit) return bar.open;
  return bar.high >= limit ? limit : null;
}
