import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { BacktestRunnerService } from '../../src/modules/backtesting/application/backtest-runner.service';
import { SignalGenerationService } from '../../src/modules/analysis/application/signal-generation.service';
import { MarketDataSyncService } from '../../src/modules/market-data/application/market-data-sync.service';
import { BROKER, type BrokerPort } from '../../src/modules/trading/domain/broker.port';
import { AlpacaBroker } from '../../src/modules/trading/infrastructure/alpaca-broker';
import { ALPACA_CLIENT } from '../../src/integrations/alpaca/alpaca-client.port';
import { FakeAlpacaClient } from './fake-alpaca';
import { NotificationService } from '../../src/modules/notifications/application/notification.service';
import { NOTIFIER, type Notifier } from '../../src/modules/notifications/domain/notifier.port';
import {
  EARNINGS_PROVIDER,
  type EarningsProvider,
  type EarningsReport,
} from '../../src/modules/market-data/domain/earnings-provider.port';
import { RawBar } from '../../src/modules/market-data/domain/bar';
import {
  MARKET_DATA_PROVIDER,
  MarketDataProvider,
} from '../../src/modules/market-data/domain/market-data-provider.port';
import { MarkPriceService } from '../../src/modules/market-data/application/mark-price.service';
import {
  QUOTE_PROVIDER,
  type Quote,
  type QuoteProvider,
} from '../../src/modules/market-data/domain/quote-provider.port';
import { SymbolMetadata } from '../../src/modules/assets/domain/asset.types';
import {
  SYMBOL_RESOLVER,
  SymbolResolver,
  SymbolSuggestion,
} from '../../src/modules/assets/domain/symbol-resolver.port';

export class FakeSymbolResolver implements SymbolResolver {
  readonly known = new Map<string, SymbolMetadata>();

  resolve(symbol: string): Promise<SymbolMetadata | null> {
    return Promise.resolve(this.known.get(symbol) ?? null);
  }

  /** Known symbols whose symbol or name contains the query. */
  search(query: string, limit: number): Promise<SymbolSuggestion[]> {
    const q = query.toLowerCase();
    return Promise.resolve(
      [...this.known.values()]
        .filter((m) => m.symbol.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
        .slice(0, limit)
        .map(({ symbol, name, assetClass, exchange }) => ({ symbol, name, assetClass, exchange })),
    );
  }
}

export class FakeMarketDataProvider implements MarketDataProvider {
  readonly name = 'fake';
  readonly bars = new Map<string, RawBar[]>();
  readonly calls: { symbol: string; from: Date; to: Date }[] = [];

  fetchHourlyBars(symbol: string, from: Date, to: Date): Promise<RawBar[]> {
    this.calls.push({ symbol, from, to });
    const bars = (this.bars.get(symbol) ?? []).filter(
      (b) => b.openTime >= from && b.openTime <= to,
    );
    return Promise.resolve(bars);
  }
}

/** Earnings reports per symbol instead of SEC and Yahoo. */
export class FakeEarningsProvider implements EarningsProvider {
  readonly reports = new Map<string, Date[]>();

  fetchReports(symbol: string): Promise<EarningsReport[]> {
    return Promise.resolve(
      (this.reports.get(symbol) ?? []).map((reportedAt) => ({
        reportedAt,
        source: 'sec' as const,
      })),
    );
  }
}

/** Near-live prices set by the test; without a quote a position is marked at its latest 1h close. */
export class FakeQuoteProvider implements QuoteProvider {
  private readonly quotes = new Map<string, Quote>();
  /** Makes every request fail, as when the provider is down. */
  fail = false;
  onChange: () => void = () => undefined;

  set(symbol: string, price: number, asOf = new Date()): void {
    this.quotes.set(symbol, { price, asOf });
    this.onChange();
  }

  clear(): void {
    this.quotes.clear();
    this.fail = false;
    this.onChange();
  }

  getQuotes(symbols: string[]): Promise<Map<string, Quote>> {
    if (this.fail) return Promise.reject(new Error('quote provider down'));
    return Promise.resolve(
      new Map(
        symbols.flatMap((s) => (this.quotes.has(s) ? [[s, this.quotes.get(s)!] as const] : [])),
      ),
    );
  }
}

/** Records notifications instead of calling Telegram. */
export class FakeNotifier implements Notifier {
  readonly enabled = true;
  readonly sent: string[] = [];

  send(text: string): Promise<void> {
    this.sent.push(text);
    return Promise.resolve();
  }
}

export interface TestContext {
  app: INestApplication<App>;
  resolver: FakeSymbolResolver;
  provider: FakeMarketDataProvider;
  alpaca: FakeAlpacaClient;
  notifier: FakeNotifier;
  earnings: FakeEarningsProvider;
  quotes: FakeQuoteProvider;
  dataSource: DataSource;
  /** Waits until background work (backfill, signals, backtests, paper trading) has finished. */
  idle(): Promise<void>;
  /** Removes all rows so each test starts from an empty database. */
  reset(): Promise<void>;
}

/** Boots the full app against the e2e database with external providers replaced by fakes. */
export async function createTestApp(): Promise<TestContext> {
  const resolver = new FakeSymbolResolver();
  const provider = new FakeMarketDataProvider();
  const alpaca = new FakeAlpacaClient();
  const notifier = new FakeNotifier();
  const earnings = new FakeEarningsProvider();
  const quotes = new FakeQuoteProvider();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SYMBOL_RESOLVER)
    .useValue(resolver)
    .overrideProvider(MARKET_DATA_PROVIDER)
    .useValue(provider)
    .overrideProvider(ALPACA_CLIENT)
    .useValue(alpaca)
    .overrideProvider(NOTIFIER)
    .useValue(notifier)
    .overrideProvider(EARNINGS_PROVIDER)
    .useValue(earnings)
    .overrideProvider(QUOTE_PROVIDER)
    .useValue(quotes)
    .compile();

  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();

  const dataSource = app.get(DataSource);
  quotes.onChange = () => app.get(MarkPriceService).clearCache();
  const sync = app.get(MarketDataSyncService);
  const signals = app.get(SignalGenerationService);
  const backtests = app.get(BacktestRunnerService);
  const broker = app.get<BrokerPort>(BROKER);
  const alpacaBroker = app.get(AlpacaBroker);
  const notifications = app.get(NotificationService);

  const idle = async (): Promise<void> => {
    // Sync emits an event that starts signal generation asynchronously, so wait in rounds.
    for (let round = 0; round < 3; round++) {
      await sync.whenIdle();
      await new Promise((resolve) => setImmediate(resolve));
      await signals.whenIdle();
      await backtests.whenIdle();
      await new Promise((resolve) => setImmediate(resolve));
      await broker.whenIdle();
      await new Promise((resolve) => setImmediate(resolve));
      await alpacaBroker.whenIdle();
      await notifications.whenIdle();
    }
  };

  const reset = async (): Promise<void> => {
    await idle();
    await dataSource.query('TRUNCATE assets, portfolios, audit_events, trading_state CASCADE');
    await dataSource.query(`DELETE FROM strategy_configs WHERE name <> 'default'`);
    resolver.known.clear();
    provider.bars.clear();
    provider.calls.length = 0;
    alpaca.reset();
    notifier.sent.length = 0;
    earnings.reports.clear();
    quotes.clear();
  };

  return { app, resolver, provider, alpaca, notifier, earnings, quotes, dataSource, idle, reset };
}
