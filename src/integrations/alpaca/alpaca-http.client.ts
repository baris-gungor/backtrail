import { Logger } from '@nestjs/common';
import type { AlpacaConfig } from '../../config/alpaca.config';
import { AlpacaApiError, type AlpacaClient } from './alpaca-client.port';
import type {
  AlpacaAccount,
  AlpacaAsset,
  AlpacaClock,
  AlpacaOrder,
  AlpacaOrderRequest,
  AlpacaPosition,
  TradeUpdate,
} from './alpaca.types';

const MAX_BACKOFF_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * REST v2 over `fetch` and the `trade_updates` stream over Node's built-in WebSocket.
 * The stream connects on the first listener and reconnects with backoff; missed updates are
 * recovered by the broker's periodic order sync.
 */
export class AlpacaHttpClient implements AlpacaClient {
  private readonly logger = new Logger(AlpacaHttpClient.name);
  private readonly listeners = new Set<(update: TradeUpdate) => void>();
  private socket: WebSocket | null = null;
  private backoff = 1_000;
  private closed = false;

  constructor(private readonly config: AlpacaConfig) {}

  get enabled(): boolean {
    return this.config.enabled;
  }

  getAccount(): Promise<AlpacaAccount> {
    return this.request('GET', '/v2/account');
  }

  getPositions(): Promise<AlpacaPosition[]> {
    return this.request('GET', '/v2/positions');
  }

  getOpenOrders(): Promise<AlpacaOrder[]> {
    return this.request('GET', '/v2/orders?status=open&nested=true&limit=500');
  }

  async getOrderByClientId(clientOrderId: string): Promise<AlpacaOrder | null> {
    try {
      return await this.request<AlpacaOrder>(
        'GET',
        `/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`,
        undefined,
        [404],
      );
    } catch (error) {
      if (error instanceof AlpacaApiError && error.status === 404) return null;
      throw error;
    }
  }

  submitOrder(request: AlpacaOrderRequest): Promise<AlpacaOrder> {
    return this.request('POST', '/v2/orders', request);
  }

  async cancelOrder(orderId: string): Promise<void> {
    // 404/422: already filled or cancelled, which the broker treats as settled.
    await this.request(
      'DELETE',
      `/v2/orders/${encodeURIComponent(orderId)}`,
      undefined,
      [404, 422],
    );
  }

  getClock(): Promise<AlpacaClock> {
    return this.request('GET', '/v2/clock');
  }

  async getAsset(symbol: string): Promise<AlpacaAsset | null> {
    try {
      return await this.request<AlpacaAsset>(
        'GET',
        `/v2/assets/${encodeURIComponent(symbol)}`,
        undefined,
        [404],
      );
    } catch (error) {
      if (error instanceof AlpacaApiError && error.status === 404) return null;
      throw error;
    }
  }

  onTradeUpdate(listener: (update: TradeUpdate) => void): () => void {
    this.listeners.add(listener);
    if (this.enabled && !this.socket) this.connect();
    return () => this.listeners.delete(listener);
  }

  /** Stops the stream (application shutdown). */
  close(): void {
    this.closed = true;
    this.socket?.close();
  }

  /** Failed calls are logged as errors, except the statuses in `expected` (the caller handles them). */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    expected: number[] = [],
  ): Promise<T> {
    if (!this.enabled) throw new AlpacaApiError(503, 'Alpaca API keys are not configured');
    try {
      return await this.send<T>(method, path, body);
    } catch (error) {
      const { status, message } = error as AlpacaApiError;
      if (!expected.includes(status)) {
        this.logger.error({
          msg: `Alpaca ${method} ${path.split('?')[0]} failed (${status || 'no response'}): ${message}`,
          status,
        });
      }
      throw error;
    }
  }

  private async send<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    let text: string;
    try {
      res = await fetch(`${this.config.baseUrl}${path}`, {
        method,
        headers: {
          'APCA-API-KEY-ID': this.config.keyId,
          'APCA-API-SECRET-KEY': this.config.secretKey,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      text = await res.text();
    } catch (error) {
      // DNS, connection reset, timeout: no response, so the outcome of a write is unknown.
      const reason =
        error instanceof Error && error.name === 'TimeoutError'
          ? `no response within ${REQUEST_TIMEOUT_MS / 1000}s`
          : error instanceof Error
            ? error.cause instanceof Error
              ? error.cause.message
              : error.message
            : String(error);
      throw new AlpacaApiError(0, `${method} ${path.split('?')[0]} failed: ${reason}`, error);
    }
    if (!res.ok) {
      let message = text || res.statusText;
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? message;
      } catch {
        // Not JSON: keep the raw text.
      }
      throw new AlpacaApiError(res.status, message);
    }
    try {
      return (text ? JSON.parse(text) : undefined) as T;
    } catch (error) {
      throw new AlpacaApiError(
        res.status,
        `invalid JSON in the response to ${method} ${path}`,
        error,
      );
    }
  }

  private connect(): void {
    if (this.closed) return;
    const ws = new WebSocket(this.config.streamUrl);
    ws.binaryType = 'arraybuffer';
    this.socket = ws;

    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          action: 'auth',
          key: this.config.keyId,
          secret: this.config.secretKey,
        }),
      );
    });
    ws.addEventListener('message', (event: MessageEvent) => {
      const text =
        typeof event.data === 'string'
          ? event.data
          : new TextDecoder().decode(event.data as ArrayBuffer);
      this.onMessage(ws, text);
    });
    ws.addEventListener('close', () => {
      this.socket = null;
      if (this.closed) return;
      this.logger.warn({ msg: 'Alpaca stream closed, reconnecting', inMs: this.backoff });
      setTimeout(() => this.connect(), this.backoff).unref();
      this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    });
    ws.addEventListener('error', () => {
      // `close` follows and schedules the reconnect.
    });
  }

  private onMessage(ws: WebSocket, text: string): void {
    let message: { stream?: string; data?: Record<string, unknown> };
    try {
      message = JSON.parse(text) as typeof message;
    } catch {
      return;
    }
    if (message.stream === 'authorization') {
      if (message.data?.status === 'authorized') {
        this.backoff = 1_000;
        ws.send(JSON.stringify({ action: 'listen', data: { streams: ['trade_updates'] } }));
        this.logger.log({ msg: 'Alpaca stream connected' });
      } else {
        this.logger.error({ msg: 'Alpaca stream authorization failed', data: message.data });
      }
      return;
    }
    if (message.stream === 'trade_updates' && message.data) {
      const update = message.data as unknown as TradeUpdate;
      for (const listener of this.listeners) listener(update);
    }
  }
}
