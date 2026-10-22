import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { UpstreamError } from '../../../common/errors/domain.error';
import { marketDataConfig } from '../../../config';
import {
  YAHOO_FINANCE,
  type YahooFinanceClient,
} from '../../../integrations/yahoo-finance/yahoo-finance.module';
import type { EarningsProvider, EarningsReport } from '../domain/earnings-provider.port';

const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const SUBMISSIONS_URL = (cik: string) => `https://data.sec.gov/submissions/CIK${cik}.json`;
const TIMEOUT_MS = 15_000;
/** A Yahoo date this close to a SEC filing is the same report. */
const SAME_REPORT_MS = 3 * 24 * 60 * 60 * 1000;

/** The parts of the SEC submissions JSON that are read. */
interface Submissions {
  filings?: {
    recent?: { form?: string[]; items?: string[]; acceptanceDateTime?: string[] };
  };
}

/** `quoteSummary` types leak `any`; read through a narrow interface. */
interface CalendarSummary {
  calendarEvents?: { earnings?: { earningsDate?: Date[] } };
}

/**
 * Past reports from SEC EDGAR: 8-K filings with item 2.02 (Results of Operations and Financial
 * Condition), timed by their acceptance (UTC). The upcoming report from Yahoo's calendar.
 */
@Injectable()
export class SecYahooEarningsProvider implements EarningsProvider {
  private ciks?: Promise<Map<string, string>>;

  constructor(
    @Inject(YAHOO_FINANCE) private readonly yf: YahooFinanceClient,
    @Inject(marketDataConfig.KEY) private readonly config: ConfigType<typeof marketDataConfig>,
  ) {}

  async fetchReports(symbol: string): Promise<EarningsReport[]> {
    const past = await this.secReports(symbol);
    const next = await this.yahooNext(symbol);
    const now = Date.now();
    const upcoming = next
      .filter((d) => d.getTime() > now)
      .filter((d) => !past.some((p) => Math.abs(p.getTime() - d.getTime()) < SAME_REPORT_MS));
    return [
      ...past.map((reportedAt) => ({ reportedAt, source: 'sec' as const })),
      ...upcoming.map((reportedAt) => ({ reportedAt, source: 'yahoo' as const })),
    ];
  }

  private async secReports(symbol: string): Promise<Date[]> {
    const cik = (await this.cikMap()).get(symbol.toUpperCase());
    if (!cik) return [];
    const data = await this.secJson<Submissions>(SUBMISSIONS_URL(cik));
    const recent = data.filings?.recent ?? {};
    const reports: Date[] = [];
    (recent.form ?? []).forEach((form, i) => {
      const items = recent.items?.[i] ?? '';
      const accepted = recent.acceptanceDateTime?.[i];
      if ((form === '8-K' || form === '8-K/A') && items.split(',').includes('2.02') && accepted) {
        reports.push(new Date(accepted));
      }
    });
    return reports.sort((a, b) => a.getTime() - b.getTime());
  }

  private async yahooNext(symbol: string): Promise<Date[]> {
    try {
      const summary = (await this.yf.quoteSummary(symbol, {
        modules: ['calendarEvents'],
      })) as CalendarSummary | undefined;
      return summary?.calendarEvents?.earnings?.earningsDate ?? [];
    } catch {
      // The next date is a convenience; past reports are what the filter needs.
      return [];
    }
  }

  /** Ticker → zero-padded CIK, loaded once per process. */
  private cikMap(): Promise<Map<string, string>> {
    this.ciks ??= this.secJson<Record<string, { cik_str: number; ticker: string }>>(TICKERS_URL)
      .then(
        (rows) =>
          new Map(
            Object.values(rows).map((r) => [
              r.ticker.toUpperCase(),
              String(r.cik_str).padStart(10, '0'),
            ]),
          ),
      )
      .catch((error: unknown) => {
        this.ciks = undefined; // try again next time
        throw error;
      });
    return this.ciks;
  }

  private async secJson<T>(url: string): Promise<T> {
    const res = await fetch(url, {
      // SEC asks automated clients to identify themselves.
      headers: { 'user-agent': this.config.secUserAgent, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch((error: unknown) => {
      throw new UpstreamError(`SEC request failed: ${url}`, error);
    });
    if (!res.ok) throw new UpstreamError(`SEC ${res.status}: ${url}`);
    return (await res.json()) as T;
  }
}
