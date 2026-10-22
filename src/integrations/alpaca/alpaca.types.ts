/**
 * The subset of the Alpaca Trading API v2 the app uses. Numbers arrive as strings.
 * https://docs.alpaca.markets/reference
 */

export interface AlpacaAccount {
  id: string;
  account_number: string;
  status: string;
  currency: string;
  cash: string;
  equity: string;
  buying_power: string;
}

export interface AlpacaPosition {
  symbol: string;
  qty: string;
  avg_entry_price: string;
  market_value: string;
  side: 'long' | 'short';
}

/**
 * new, accepted, pending_new, partially_filled, filled, done_for_day, canceled, expired, replaced,
 * pending_cancel, rejected, held, ...
 */
export type AlpacaOrderStatus = string;

export interface AlpacaOrder {
  id: string;
  client_order_id: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stop_limit';
  order_class: '' | 'simple' | 'bracket' | 'oto' | 'oco';
  qty: string | null;
  notional: string | null;
  filled_qty: string;
  filled_avg_price: string | null;
  limit_price: string | null;
  stop_price: string | null;
  status: AlpacaOrderStatus;
  filled_at: string | null;
  /** Take-profit and stop-loss children of a bracket / OTO order. */
  legs: AlpacaOrder[] | null;
}

export interface AlpacaOrderRequest {
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  time_in_force: 'day' | 'gtc';
  qty?: string;
  notional?: string;
  limit_price?: string;
  client_order_id: string;
  order_class?: 'simple' | 'bracket' | 'oto';
  take_profit?: { limit_price: string };
  stop_loss?: { stop_price: string };
}

export interface AlpacaClock {
  timestamp: string;
  is_open: boolean;
  next_open: string;
  next_close: string;
}

export interface AlpacaAsset {
  symbol: string;
  tradable: boolean;
  fractionable: boolean;
  status: string;
  /** Short selling allowed; paper shorts also need `easy_to_borrow`. */
  shortable?: boolean;
  easy_to_borrow?: boolean;
}

/** `trade_updates` stream events: new, fill, partial_fill, canceled, expired, rejected, ... */
export type TradeEvent = string;

export interface TradeUpdate {
  event: TradeEvent;
  order: AlpacaOrder;
  /** Fill price and quantity of this execution (fill / partial_fill). */
  price?: string;
  qty?: string;
  timestamp?: string;
}
