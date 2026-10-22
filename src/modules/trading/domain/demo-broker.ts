import Decimal from 'decimal.js';

/**
 * Pure rules for trading through a demo broker (Alpaca paper). Kept free of the Alpaca types so
 * they can be tested without the integration.
 */

export interface ProtectiveLevels {
  stopLoss?: number;
  takeProfit?: number;
}

/** bracket: both levels, oto: one level, simple: none. */
export function orderClass(levels: ProtectiveLevels): 'bracket' | 'oto' | 'simple' {
  const n = Number(levels.stopLoss !== undefined) + Number(levels.takeProfit !== undefined);
  return n === 2 ? 'bracket' : n === 1 ? 'oto' : 'simple';
}

/** Bracket and OTO orders need whole shares, so automatic entries round down. */
export const wholeShares = (quantity: Decimal.Value): Decimal =>
  Decimal.max(0, new Decimal(quantity).floor());

/**
 * Price as the broker accepts it: 2 decimals at or above $1, 4 below. A stop rounds down and a
 * take-profit up, so rounding never tightens a level.
 */
export function brokerPrice(
  price: number,
  direction: 'down' | 'up' | 'nearest' = 'nearest',
): string {
  const places = price >= 1 ? 2 : 4;
  const rounding =
    direction === 'down'
      ? Decimal.ROUND_DOWN
      : direction === 'up'
        ? Decimal.ROUND_UP
        : Decimal.ROUND_HALF_UP;
  return new Decimal(price).toDecimalPlaces(places, rounding).toFixed(places);
}

/** Client order id of an automatic order: one per subscription, decision bar and kind. */
export const automaticClientOrderId = (subscriptionId: string, barTime: Date, kind: string) =>
  `${subscriptionId}:${barTime.toISOString()}:${kind}`;

export interface Holding {
  symbol: string;
  quantity: string;
}

export interface ReconciliationDiff {
  kind: 'position' | 'cash';
  symbol?: string;
  broker: string;
  db: string;
}

/** Cash may differ by rounding of fill prices and regulatory fees on sells. */
export const CASH_TOLERANCE = new Decimal(1);

/** Positions (by symbol and quantity) and cash that differ between the broker and the database. */
export function reconcile(
  broker: { holdings: Holding[]; cash: string },
  db: { holdings: Holding[]; cash: string },
  cashTolerance: Decimal = CASH_TOLERANCE,
): ReconciliationDiff[] {
  const diffs: ReconciliationDiff[] = [];
  const brokerQty = new Map(broker.holdings.map((h) => [h.symbol, new Decimal(h.quantity)]));
  const dbQty = new Map(db.holdings.map((h) => [h.symbol, new Decimal(h.quantity)]));
  for (const symbol of [...new Set([...brokerQty.keys(), ...dbQty.keys()])].sort()) {
    const b = brokerQty.get(symbol) ?? new Decimal(0);
    const d = dbQty.get(symbol) ?? new Decimal(0);
    // Quantities are compared to 6 decimals, the precision brokers report fractional shares with.
    if (!b.toDecimalPlaces(6).eq(d.toDecimalPlaces(6))) {
      diffs.push({ kind: 'position', symbol, broker: b.toString(), db: d.toString() });
    }
  }
  if (new Decimal(broker.cash).minus(db.cash).abs().gt(cashTolerance)) {
    diffs.push({ kind: 'cash', broker: broker.cash, db: db.cash });
  }
  return diffs;
}
