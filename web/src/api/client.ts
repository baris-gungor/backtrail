import createClient, { type Middleware } from 'openapi-fetch';
import type { components, paths } from './schema';

export type Schemas = components['schemas'];
export type Asset = Schemas['AssetEntity'];
export type AssetSuggestion = Schemas['AssetSuggestionDto'];
export type Bar = Schemas['BarDto'];
export type IngestionRun = Schemas['IngestionRunEntity'];
export type Signal = Schemas['SignalDto'];
export type Strategy = Schemas['StrategyDto'];
export type StrategyConfig = Schemas['StrategyConfigEntity'];
export type IndicatorPoint = Schemas['IndicatorPointDto'];
export type AssetSummary = Schemas['AssetSummaryDto'];
export type BacktestRun = Schemas['BacktestRunDto'];
export type BacktestRunDetail = Schemas['BacktestRunDetailDto'];
export type BacktestMetrics = Schemas['BacktestMetricsDto'];
export type BacktestTrade = Schemas['BacktestTradeDto'];
export type Batch = Schemas['BatchDto'];
export type PortfolioSummary = Schemas['PortfolioSummaryDto'];
export type PortfolioDetail = Schemas['PortfolioDetailDto'];
export type Position = Schemas['PositionDto'];
export type Subscription = Schemas['SubscriptionDto'];
export type Order = Schemas['OrderDto'];
export type ClosedTrade = Schemas['ClosedTradeDto'];
export type EquityPoint = Schemas['EquityPointDto'];
export type RiskRules = Schemas['RiskRulesDto'];
export type MatrixReport = Schemas['MatrixReportDto'];
export type StrategyReport = Schemas['StrategyReportDto'];
export type AssetReport = Schemas['AssetReportDto'];
export type PortfolioReport = Schemas['PortfolioReportDto'];
export type DivergenceRow = Schemas['DivergenceRowDto'];
export type SignalQualityReport = Schemas['SignalQualityReportDto'];
export type TradeRecord = Schemas['TradeRecordDto'];
export type TradeStats = Schemas['TradeStatsDto'];
export type BacktestExtras = Schemas['BacktestExtrasDto'];
export type PeriodReturn = Schemas['PeriodReturnDto'];
export type TradingState = Schemas['TradingStateDto'];
export type BrokerStatus = Schemas['BrokerStatusDto'];
export type BrokerSummary = Schemas['BrokerSummaryDto'];
export type ReconciliationRun = Schemas['ReconciliationRunDto'];
export type AuditEvent = Schemas['AuditEventDto'];

/** Error body produced by the backend's AllExceptionsFilter. */
interface ErrorBody {
  statusCode?: number;
  message?: string | string[];
}

/** Thrown for every non-2xx response, with the backend message. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const throwOnError: Middleware = {
  async onResponse({ response }) {
    if (response.ok) return undefined;
    const body = (await response
      .clone()
      .json()
      .catch(() => ({}))) as ErrorBody;
    const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    throw new ApiError(response.status, message ?? response.statusText);
  },
};

export const api = createClient<paths>({ baseUrl: '/' });
api.use(throwOnError);

/** Unwraps openapi-fetch results; errors were already thrown by the middleware. */
export async function call<T>(request: Promise<{ data?: T }>): Promise<T> {
  const { data } = await request;
  return data as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
