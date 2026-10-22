import { Inject, Injectable } from '@nestjs/common';
import { UpstreamError } from '../../../common/errors/domain.error';
import {
  YAHOO_FINANCE,
  type YahooFinanceClient,
} from '../../../integrations/yahoo-finance/yahoo-finance.module';
import type { Quote, QuoteProvider } from '../domain/quote-provider.port';

/** Fields we read from a Yahoo quote. The library's quote union leaks `any` on some fields. */
interface YahooPriceView {
  symbol?: string;
  regularMarketPrice?: number;
  regularMarketTime?: Date | number;
}

@Injectable()
export class YahooQuoteProvider implements QuoteProvider {
  constructor(@Inject(YAHOO_FINANCE) private readonly yf: YahooFinanceClient) {}

  async getQuotes(symbols: string[]): Promise<Map<string, Quote>> {
    const quotes = new Map<string, Quote>();
    if (symbols.length === 0) return quotes;
    const rows = (await this.yf
      .quote(symbols, {}, { validateResult: false })
      .catch((error: unknown) => {
        throw new UpstreamError('Yahoo Finance quote request failed', error);
      })) as YahooPriceView[] | undefined;
    for (const row of rows ?? []) {
      if (!row.symbol || typeof row.regularMarketPrice !== 'number') continue;
      const time = row.regularMarketTime;
      const asOf = time instanceof Date ? time : new Date((time ?? 0) * 1000);
      if (Number.isNaN(asOf.getTime()) || asOf.getTime() === 0) continue;
      quotes.set(row.symbol.toUpperCase(), { price: row.regularMarketPrice, asOf });
    }
    return quotes;
  }
}
