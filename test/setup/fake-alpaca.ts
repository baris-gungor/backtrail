import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import {
  AlpacaApiError,
  type AlpacaClient,
} from '../../src/integrations/alpaca/alpaca-client.port';
import type {
  AlpacaAccount,
  AlpacaAsset,
  AlpacaClock,
  AlpacaOrder,
  AlpacaOrderRequest,
  AlpacaPosition,
  TradeUpdate,
} from '../../src/integrations/alpaca/alpaca.types';

/**
 * In-memory Alpaca paper account. Market orders fill on the next tick at `prices` (unless
 * `autoFill` is off); bracket / OTO legs become active after the parent fills and are triggered with
 * `triggerLeg`. Every change is sent as a trade update, like the real stream.
 */
export class FakeAlpacaClient implements AlpacaClient {
  enabled = true;
  autoFill = true;
  cash = new Decimal(100_000);
  readonly positions = new Map<string, Decimal>();
  readonly avg = new Map<string, Decimal>();
  readonly orders = new Map<string, AlpacaOrder>();
  readonly prices = new Map<string, number>();
  readonly untradable = new Set<string>();
  /** Symbols that cannot be sold short (not easy to borrow). */
  readonly unshortable = new Set<string>();
  readonly submitted: AlpacaOrderRequest[] = [];
  /**
   * Network failure on the next submit: `after` the broker accepted the order (the response is
   * lost), or `before` it reached the broker.
   */
  failNextSubmit: 'after' | 'before' | null = null;
  /** Network failure on order lookups and cancels. */
  failLookups = false;
  failCancels = false;
  private readonly listeners = new Set<(u: TradeUpdate) => void>();

  reset(): void {
    this.enabled = true;
    this.autoFill = true;
    this.cash = new Decimal(100_000);
    this.positions.clear();
    this.avg.clear();
    this.orders.clear();
    this.prices.clear();
    this.untradable.clear();
    this.unshortable.clear();
    this.submitted.length = 0;
    this.failNextSubmit = null;
    this.failLookups = false;
    this.failCancels = false;
  }

  private networkError(): AlpacaApiError {
    return new AlpacaApiError(0, 'fetch failed: ECONNRESET');
  }

  getAccount(): Promise<AlpacaAccount> {
    let equity = this.cash;
    for (const [symbol, qty] of this.positions) equity = equity.plus(qty.mul(this.price(symbol)));
    return Promise.resolve({
      id: 'fake-account',
      account_number: 'PA-FAKE',
      status: 'ACTIVE',
      currency: 'USD',
      cash: this.cash.toString(),
      equity: equity.toString(),
      buying_power: this.cash.mul(2).toString(),
    });
  }

  getPositions(): Promise<AlpacaPosition[]> {
    return Promise.resolve(
      [...this.positions].map(([symbol, qty]) => ({
        symbol,
        qty: qty.toString(),
        avg_entry_price: (this.avg.get(symbol) ?? new Decimal(0)).toString(),
        market_value: qty.mul(this.price(symbol)).toString(),
        side: qty.isNeg() ? ('short' as const) : ('long' as const),
      })),
    );
  }

  getOpenOrders(): Promise<AlpacaOrder[]> {
    return Promise.resolve(
      [...this.orders.values()].filter((o) => ['new', 'held', 'accepted'].includes(o.status)),
    );
  }

  getOrderByClientId(clientOrderId: string): Promise<AlpacaOrder | null> {
    if (this.failLookups) return Promise.reject(this.networkError());
    return Promise.resolve(
      [...this.orders.values()].find((o) => o.client_order_id === clientOrderId) ?? null,
    );
  }

  submitOrder(request: AlpacaOrderRequest): Promise<AlpacaOrder> {
    if ([...this.orders.values()].some((o) => o.client_order_id === request.client_order_id)) {
      return Promise.reject(new AlpacaApiError(422, 'client_order_id must be unique'));
    }
    const failure = this.failNextSubmit;
    this.failNextSubmit = null;
    if (failure === 'before') return Promise.reject(this.networkError());
    this.submitted.push(request);
    const qty =
      request.qty ?? new Decimal(request.notional!).div(this.price(request.symbol)).toString();
    const order = this.order({
      client_order_id: request.client_order_id,
      symbol: request.symbol,
      side: request.side,
      type: request.type,
      order_class: request.order_class ?? 'simple',
      qty,
      notional: request.notional ?? null,
      limit_price: request.limit_price ?? null,
      status: 'new',
    });
    const legs: AlpacaOrder[] = [];
    // Legs close the entry: sells for a buy, buys for a short sale.
    const legSide = request.side === 'buy' ? 'sell' : 'buy';
    if (request.take_profit) {
      legs.push(
        this.order({
          client_order_id: `${request.client_order_id}-tp`,
          symbol: request.symbol,
          side: legSide,
          type: 'limit',
          qty,
          limit_price: request.take_profit.limit_price,
          status: 'held',
        }),
      );
    }
    if (request.stop_loss) {
      legs.push(
        this.order({
          client_order_id: `${request.client_order_id}-sl`,
          symbol: request.symbol,
          side: legSide,
          type: 'stop',
          qty,
          stop_price: request.stop_loss.stop_price,
          status: 'held',
        }),
      );
    }
    order.legs = legs.length ? legs : null;
    if (this.autoFill && request.type === 'market') setImmediate(() => this.fill(order.id));
    if (failure === 'after') return Promise.reject(this.networkError());
    return Promise.resolve(structuredClone(order));
  }

  cancelOrder(orderId: string): Promise<void> {
    if (this.failCancels) return Promise.reject(this.networkError());
    const order = this.orders.get(orderId);
    if (!order) return Promise.reject(new AlpacaApiError(404, 'order not found'));
    if (!['new', 'held', 'accepted'].includes(order.status)) {
      return Promise.reject(new AlpacaApiError(422, `order is ${order.status}`));
    }
    order.status = 'canceled';
    this.emit('canceled', order);
    return Promise.resolve();
  }

  getClock(): Promise<AlpacaClock> {
    const now = new Date().toISOString();
    return Promise.resolve({ timestamp: now, is_open: true, next_open: now, next_close: now });
  }

  getAsset(symbol: string): Promise<AlpacaAsset | null> {
    return Promise.resolve({
      symbol,
      tradable: !this.untradable.has(symbol),
      fractionable: true,
      status: 'active',
      shortable: !this.unshortable.has(symbol),
      easy_to_borrow: !this.unshortable.has(symbol),
    });
  }

  onTradeUpdate(listener: (update: TradeUpdate) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Fills an order (default: at the symbol's current price) and activates its legs. */
  fill(orderId: string, price?: number): void {
    const order = this.orders.get(orderId)!;
    const fillPrice = new Decimal(price ?? this.price(order.symbol));
    const qty = new Decimal(order.qty!);
    const held = this.positions.get(order.symbol) ?? new Decimal(0);
    // Signed position: a sell without shares opens a short, a buy covers it.
    const delta = order.side === 'buy' ? qty : qty.neg();
    const left = held.plus(delta);
    if (held.isZero() || held.isNeg() === delta.isNeg()) {
      const avg = this.avg.get(order.symbol) ?? new Decimal(0);
      this.avg.set(order.symbol, held.mul(avg).plus(delta.mul(fillPrice)).div(left));
    }
    if (left.isZero()) {
      this.positions.delete(order.symbol);
      this.avg.delete(order.symbol);
    } else {
      this.positions.set(order.symbol, left);
    }
    this.cash = this.cash.minus(delta.mul(fillPrice));
    Object.assign(order, {
      status: 'filled',
      filled_qty: qty.toString(),
      filled_avg_price: fillPrice.toString(),
      filled_at: new Date().toISOString(),
    });
    for (const leg of order.legs ?? []) this.orders.get(leg.id)!.status = 'new';
    this.emit('fill', order);
  }

  /** The broker cancels an order after filling only part of it (e.g. end of day). */
  cancelAfterPartial(orderId: string, quantity: number, price?: number): void {
    const order = this.orders.get(orderId)!;
    const fillPrice = new Decimal(price ?? this.price(order.symbol));
    const qty = new Decimal(quantity);
    const held = this.positions.get(order.symbol) ?? new Decimal(0);
    this.positions.set(order.symbol, held.plus(qty));
    this.avg.set(order.symbol, fillPrice);
    this.cash = this.cash.minus(qty.mul(fillPrice));
    Object.assign(order, {
      status: 'canceled',
      filled_qty: qty.toString(),
      filled_avg_price: fillPrice.toString(),
      filled_at: new Date().toISOString(),
    });
    this.emit('canceled', order);
  }

  /** Fills the active stop-loss or take-profit leg of a symbol and cancels its sibling (OCO). */
  triggerLeg(symbol: string, kind: 'stop_loss' | 'take_profit'): void {
    const type = kind === 'stop_loss' ? 'stop' : 'limit';
    const leg = [...this.orders.values()].find(
      (o) => o.symbol === symbol && o.type === type && o.status === 'new',
    );
    if (!leg) throw new Error(`No active ${kind} leg for ${symbol}`);
    this.fill(leg.id, Number(leg.stop_price ?? leg.limit_price));
    const parent = [...this.orders.values()].find((o) => o.legs?.some((l) => l.id === leg.id));
    for (const sibling of parent?.legs ?? []) {
      const s = this.orders.get(sibling.id)!;
      if (s.id !== leg.id && ['new', 'held'].includes(s.status)) {
        s.status = 'canceled';
        this.emit('canceled', s);
      }
    }
  }

  private price(symbol: string): number {
    return this.prices.get(symbol) ?? 100;
  }

  private order(fields: Partial<AlpacaOrder>): AlpacaOrder {
    const order: AlpacaOrder = {
      id: randomUUID(),
      client_order_id: '',
      symbol: '',
      side: 'buy',
      type: 'market',
      order_class: 'simple',
      qty: null,
      notional: null,
      filled_qty: '0',
      filled_avg_price: null,
      limit_price: null,
      stop_price: null,
      status: 'new',
      filled_at: null,
      legs: null,
      ...fields,
    };
    this.orders.set(order.id, order);
    return order;
  }

  private emit(event: string, order: AlpacaOrder): void {
    const update: TradeUpdate = {
      event,
      order: structuredClone(order),
      timestamp: new Date().toISOString(),
    };
    setImmediate(() => {
      for (const listener of this.listeners) listener(update);
    });
  }
}
