import Decimal from 'decimal.js';

export type PositionSide = 'long' | 'short';

export interface OpenPosition {
  /** Signed: negative for a short position. */
  quantity: Decimal;
  /** Fill price, slippage included. */
  entryPrice: Decimal;
  entryFee: Decimal;
  entryTime: Date;
}

export interface ClosedTrade {
  side: PositionSide;
  entryTime: Date;
  entryPrice: Decimal;
  exitTime: Date;
  exitPrice: Decimal;
  /** Absolute quantity; `side` tells the direction. */
  quantity: Decimal;
  /** Entry and exit fees. */
  fees: Decimal;
  /** Net of fees. */
  pnl: Decimal;
  /** pnl / (entry notional + entry fee). */
  returnPct: Decimal;
}

/** Order side that closes a position: a sell for a long, a buy-to-cover for a short. */
export const closingSide = (position: Pick<OpenPosition, 'quantity'>): 'BUY' | 'SELL' =>
  position.quantity.lt(0) ? 'BUY' : 'SELL';

/**
 * Cash and positions keyed by instrument, in decimal arithmetic. One position per key; a backtest
 * uses a single key, a paper portfolio one key per asset. A short position has a negative
 * quantity: opening it adds the sale proceeds to cash, equity counts it as a liability at the mark.
 */
export class Account {
  private cashBalance: Decimal;
  private readonly open = new Map<string, OpenPosition>();
  private feesPaid = new Decimal(0);

  constructor(initialCash: Decimal.Value, positions: Iterable<[string, OpenPosition]> = []) {
    this.cashBalance = new Decimal(initialCash);
    for (const [key, position] of positions) this.open.set(key, position);
  }

  get cash(): Decimal {
    return this.cashBalance;
  }

  get totalFees(): Decimal {
    return this.feesPaid;
  }

  get positions(): ReadonlyMap<string, OpenPosition> {
    return this.open;
  }

  position(key: string): OpenPosition | null {
    return this.open.get(key) ?? null;
  }

  /** Opens a long position. */
  buy(key: string, quantity: Decimal, price: Decimal, fee: Decimal, time: Date): void {
    this.openPosition(key, 'long', quantity, price, fee, time);
  }

  /** Opens a long or short position of `quantity` (positive) units. */
  openPosition(
    key: string,
    side: PositionSide,
    quantity: Decimal,
    price: Decimal,
    fee: Decimal,
    time: Date,
  ): void {
    if (this.open.has(key)) throw new Error(`Account already holds a position in ${key}`);
    if (quantity.lte(0)) throw new Error('Quantity must be positive');
    const signed = side === 'short' ? quantity.neg() : quantity;
    this.cashBalance = this.cashBalance.minus(signed.mul(price)).minus(fee);
    this.feesPaid = this.feesPaid.plus(fee);
    this.open.set(key, { quantity: signed, entryPrice: price, entryFee: fee, entryTime: time });
  }

  /** Closes the whole position (sells a long, buys back a short) at `price`. */
  close(key: string, price: Decimal, fee: Decimal, time: Date): ClosedTrade {
    const pos = this.open.get(key);
    if (!pos) throw new Error(`Account holds no position in ${key}`);
    this.cashBalance = this.cashBalance.plus(pos.quantity.mul(price)).minus(fee);
    this.feesPaid = this.feesPaid.plus(fee);
    this.open.delete(key);

    const size = pos.quantity.abs();
    const cost = size.mul(pos.entryPrice).plus(pos.entryFee);
    // Signed quantity: a short gains when the price falls.
    const pnl = pos.quantity.mul(price.minus(pos.entryPrice)).minus(pos.entryFee).minus(fee);
    return {
      side: pos.quantity.lt(0) ? 'short' : 'long',
      entryTime: pos.entryTime,
      entryPrice: pos.entryPrice,
      exitTime: time,
      exitPrice: price,
      quantity: size,
      fees: pos.entryFee.plus(fee),
      pnl,
      returnPct: pnl.div(cost),
    };
  }

  /**
   * Cash that backs a new position: cash minus what buying back every short at `priceOf(key)`
   * would cost. Equals `cash` without shorts; short proceeds never fund another position.
   */
  freeCash(priceOf: (key: string) => Decimal.Value): Decimal {
    let free = this.cashBalance;
    for (const [key, pos] of this.open) {
      if (pos.quantity.lt(0)) free = free.plus(pos.quantity.mul(priceOf(key)));
    }
    return free;
  }

  /** Cash plus every position marked at `priceOf(key)`. */
  equity(priceOf: (key: string) => Decimal.Value): Decimal {
    let total = this.cashBalance;
    for (const [key, pos] of this.open) total = total.plus(pos.quantity.mul(priceOf(key)));
    return total;
  }
}
