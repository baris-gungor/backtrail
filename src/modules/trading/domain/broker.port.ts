import type { OrderSide, OrderType } from './order';

export interface ManualOrderRequest {
  assetId: string;
  side: OrderSide;
  type: OrderType;
  /** Decimal string. A BUY needs `quantity` or `notional`; a SELL always closes the whole position. */
  quantity?: string;
  /** BUY amount in account currency, decimal string. */
  notional?: string;
  limitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
}

/**
 * Order execution for portfolios. `PaperBroker` simulates fills on stored bars; a live broker
 * adapter (Phase 6) implements the same port. Application code only talks to this port.
 */
export interface BrokerPort {
  /** Processes the asset's new closed 4h bars for every portfolio trading it (or only `portfolioId`). */
  processAsset(assetId: string, portfolioId?: string): Promise<void>;
  /** Places a manual order and returns its id. A market order fills immediately. */
  placeOrder(portfolioId: string, request: ManualOrderRequest): Promise<string>;
  cancelOrder(portfolioId: string, orderId: string): Promise<void>;
  /**
   * Kill switch: cancels pending automatic orders (entries and strategy exits, not protective
   * stop-loss / take-profit) and drops the strategies' pending decisions.
   */
  cancelAutomatic(portfolioId: string): Promise<void>;
  /** Stops a subscription; its open position stays and keeps its protective levels. */
  deactivateSubscription(portfolioId: string, subscriptionId: string): Promise<void>;
  /** Resolves when no processing is running. */
  whenIdle(): Promise<void>;
}

export const BROKER = Symbol('BROKER');
