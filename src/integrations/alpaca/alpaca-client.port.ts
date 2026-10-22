import { UpstreamError } from '../../common/errors/domain.error';
import type {
  AlpacaAccount,
  AlpacaAsset,
  AlpacaClock,
  AlpacaOrder,
  AlpacaOrderRequest,
  AlpacaPosition,
  TradeUpdate,
} from './alpaca.types';

/**
 * Thrown for non-2xx Alpaca responses, with the API's message, and for requests that got no
 * response (`status` 0: network error or timeout). An upstream error, so a request that hits it
 * answers 502 with the message instead of a 500.
 */
export class AlpacaApiError extends UpstreamError {
  constructor(
    readonly status: number,
    message: string,
    cause?: unknown,
  ) {
    super(`Alpaca: ${message}`, cause);
  }

  /** No response, or a server-side failure: the request may or may not have been applied. */
  get uncertain(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

/**
 * Alpaca Trading API client (paper environment only). The HTTP implementation is bound in
 * `AlpacaModule`; e2e tests replace it with a fake, so they never call Alpaca.
 */
export interface AlpacaClient {
  /** False without API keys; every call then throws. */
  readonly enabled: boolean;
  getAccount(): Promise<AlpacaAccount>;
  getPositions(): Promise<AlpacaPosition[]>;
  /** Open orders with their bracket / OTO legs. */
  getOpenOrders(): Promise<AlpacaOrder[]>;
  getOrderByClientId(clientOrderId: string): Promise<AlpacaOrder | null>;
  submitOrder(request: AlpacaOrderRequest): Promise<AlpacaOrder>;
  cancelOrder(orderId: string): Promise<void>;
  getClock(): Promise<AlpacaClock>;
  /** Null when Alpaca does not know the symbol. */
  getAsset(symbol: string): Promise<AlpacaAsset | null>;
  /** Subscribes to `trade_updates`; returns the unsubscribe function. */
  onTradeUpdate(listener: (update: TradeUpdate) => void): () => void;
}

export const ALPACA_CLIENT = Symbol('ALPACA_CLIENT');
