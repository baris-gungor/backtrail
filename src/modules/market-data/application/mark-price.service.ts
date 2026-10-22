import { Inject, Injectable, Logger } from '@nestjs/common';
import { AssetsService } from '../../assets/application/assets.service';
import { QUOTE_PROVIDER, type Quote, type QuoteProvider } from '../domain/quote-provider.port';
import { MarketDataQueryService } from './market-data-query.service';

/** A quote is reused for this long, so frequent screen refreshes do not hammer the provider. */
const QUOTE_TTL_MS = 20_000;

export interface MarkPrice {
  price: number;
  /** When the price was observed: the quote time, or the open of the latest 1h bar. */
  asOf: Date;
  source: 'quote' | 'bar';
}

/**
 * Prices for marking positions to market: a near-live quote when the provider has a fresher one
 * than the stored bars, otherwise the latest stored 1h close. Never throws on provider failure.
 * Strategy and risk decisions do not use this; they read closed bars.
 */
@Injectable()
export class MarkPriceService {
  private readonly logger = new Logger(MarkPriceService.name);
  private readonly cache = new Map<string, { quote: Quote; fetchedAt: number }>();
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly assets: AssetsService,
    private readonly marketData: MarketDataQueryService,
    @Inject(QUOTE_PROVIDER) private readonly quotes: QuoteProvider,
  ) {}

  /** Forgets cached quotes (tests change the fake provider's prices between calls). */
  clearCache(): void {
    this.cache.clear();
  }

  async markPrices(assetIds: Iterable<string>): Promise<Map<string, MarkPrice>> {
    const symbols = new Map<string, string>();
    for (const id of new Set(assetIds)) symbols.set(id, (await this.assets.findById(id)).symbol);
    await this.refresh([...symbols.values()]);

    const marks = new Map<string, MarkPrice>();
    for (const [assetId, symbol] of symbols) {
      const bar = await this.marketData.latestBar(assetId, '1h');
      const quote = this.cache.get(symbol)?.quote;
      if (quote && (!bar || quote.asOf.getTime() >= bar.openTime.getTime())) {
        marks.set(assetId, { price: quote.price, asOf: quote.asOf, source: 'quote' });
      } else if (bar) {
        marks.set(assetId, { price: bar.close, asOf: bar.openTime, source: 'bar' });
      }
    }
    return marks;
  }

  /** Fetches the symbols whose cached quote is missing or expired, in one provider call. */
  private async refresh(symbols: string[]): Promise<void> {
    const now = Date.now();
    const stale = symbols.filter((s) => {
      const hit = this.cache.get(s);
      return !hit || now - hit.fetchedAt >= QUOTE_TTL_MS;
    });
    if (stale.length === 0) return;

    const key = [...stale].sort().join(',');
    let pending = this.inFlight.get(key);
    if (!pending) {
      pending = this.quotes
        .getQuotes(stale)
        .then((found) => {
          const fetchedAt = Date.now();
          for (const [symbol, quote] of found) this.cache.set(symbol, { quote, fetchedAt });
        })
        .catch((error: unknown) => {
          // Marks fall back to stored bars; failed symbols stay out of the cache so the next call retries.
          this.logger.warn({ msg: 'Quote refresh failed', symbols: stale, err: error });
        })
        .finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, pending);
    }
    await pending;
  }
}
