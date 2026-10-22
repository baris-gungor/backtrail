import { Inject, Injectable } from '@nestjs/common';
import { InvalidInputError, UpstreamError } from '../../../common/errors/domain.error';
import {
  YAHOO_FINANCE,
  type YahooFinanceClient,
} from '../../../integrations/yahoo-finance/yahoo-finance.module';
import { AssetClass, SessionType, SymbolMetadata } from '../domain/asset.types';
import { SymbolResolver, SymbolSuggestion } from '../domain/symbol-resolver.port';

const QUOTE_TYPE_TO_CLASS: Record<string, AssetClass> = {
  EQUITY: AssetClass.Equity,
  ETF: AssetClass.Etf,
  FUTURE: AssetClass.Future,
  INDEX: AssetClass.Index,
  CURRENCY: AssetClass.Currency,
  CRYPTOCURRENCY: AssetClass.Crypto,
};

/** Fields we read from a Yahoo quote. The library's quote union leaks `any` on some fields. */
interface YahooQuoteView {
  symbol?: string;
  quoteType: string;
  longName?: string;
  shortName?: string;
  exchange?: string;
  fullExchangeName?: string;
  currency?: string;
  exchangeTimezoneName?: string;
}

/** Fields we read from a Yahoo search hit (the library's union types are awkward to narrow). */
interface YahooSearchHit {
  symbol?: string;
  quoteType?: string;
  shortname?: string;
  longname?: string;
  exchange?: string;
  exchDisp?: string;
  isYahooFinance?: boolean;
}

/** Yahoo exchange codes of US listings (NASDAQ, NYSE, AMEX, NYSE Arca, Cboe). */
const US_EXCHANGES = new Set([
  'NMS',
  'NGM',
  'NCM',
  'NAS',
  'NYQ',
  'NYS',
  'ASE',
  'PCX',
  'BTS',
  'BATS',
]);
/** US index venues (S&P, Dow, NASDAQ indexes, Cboe). */
const US_INDEX_EXCHANGES = new Set(['SNP', 'DJI', 'NIM', 'NAS', 'CBO', 'WCB']);

const SESSION_BOUND_CLASSES = new Set([AssetClass.Equity, AssetClass.Etf, AssetClass.Index]);

@Injectable()
export class YahooSymbolResolver implements SymbolResolver {
  constructor(@Inject(YAHOO_FINANCE) private readonly yf: YahooFinanceClient) {}

  async resolve(symbol: string): Promise<SymbolMetadata | null> {
    // The client returns undefined for unknown symbols despite its declared type.
    const quote: YahooQuoteView | undefined = await this.yf
      .quote(symbol)
      .catch((error: unknown) => {
        throw new UpstreamError(`Yahoo Finance quote lookup failed for ${symbol}`, error);
      });
    if (!quote) return null;

    const assetClass = QUOTE_TYPE_TO_CLASS[quote.quoteType];
    if (!assetClass) {
      throw new InvalidInputError(`Unsupported quote type '${quote.quoteType}' for ${symbol}`);
    }

    let sessionType = SessionType.Continuous;
    if (SESSION_BOUND_CLASSES.has(assetClass)) {
      if (quote.exchangeTimezoneName !== 'America/New_York') {
        throw new InvalidInputError(
          `Only US-listed ${assetClass} symbols are supported; ${symbol} trades in ${quote.exchangeTimezoneName}`,
        );
      }
      sessionType = SessionType.UsEquity;
    }

    return {
      symbol: quote.symbol ?? symbol,
      name: quote.longName ?? quote.shortName ?? quote.symbol ?? symbol,
      assetClass,
      exchange: quote.fullExchangeName ?? quote.exchange ?? null,
      currency: quote.currency ?? 'USD',
      sessionType,
      provider: 'yahoo',
    };
  }

  async search(query: string, limit: number): Promise<SymbolSuggestion[]> {
    const result = await this.yf
      .search(query, { quotesCount: limit * 2, newsCount: 0 }, { validateResult: false })
      .catch((error: unknown) => {
        throw new UpstreamError(`Yahoo Finance search failed for '${query}'`, error);
      });
    const hits = (result as { quotes?: YahooSearchHit[] }).quotes ?? [];
    const suggestions: SymbolSuggestion[] = [];
    for (const hit of hits) {
      const assetClass = hit.quoteType ? QUOTE_TYPE_TO_CLASS[hit.quoteType] : undefined;
      if (!hit.symbol || !hit.isYahooFinance || !assetClass) continue;
      const exchange = hit.exchange ?? '';
      const supported =
        assetClass === AssetClass.Future ||
        ((assetClass === AssetClass.Equity || assetClass === AssetClass.Etf) &&
          US_EXCHANGES.has(exchange)) ||
        (assetClass === AssetClass.Index && US_INDEX_EXCHANGES.has(exchange));
      if (!supported) continue;
      suggestions.push({
        symbol: hit.symbol,
        name: hit.longname ?? hit.shortname ?? hit.symbol,
        assetClass,
        exchange: hit.exchDisp ?? (exchange || null),
      });
      if (suggestions.length === limit) break;
    }
    return suggestions;
  }
}
