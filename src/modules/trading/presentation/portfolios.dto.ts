import type { HealthCheckCode, HealthLevel } from '../domain/health';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsNumber,
  IsNumberString,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import type { ExitReason, PositionSide, PositionSizing, TradeDirection } from '../domain/execution';
import type { OrderSide, OrderSource, OrderStatus, OrderType } from '../domain/order';
import type { SubscriptionSource } from '../infrastructure/portfolio-subscription.entity';
import type { PortfolioMode } from '../infrastructure/portfolio.entity';

const ORDER_STATUSES: OrderStatus[] = ['pending', 'filled', 'cancelled', 'rejected', 'expired'];

// Requests

export class RiskRulesInputDto {
  /** Max share of equity in one position, percent. Default 25 */
  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(100)
  maxPositionPct?: number;

  /** Default 5 */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxOpenPositions?: number;

  /** No new entries for the day after this loss, percent. Default 3 */
  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(100)
  maxDailyLossPct?: number;

  /** Reject entries without a stop-loss. Default true */
  @IsOptional()
  @IsBoolean()
  requireStopLoss?: boolean;

  /** Share of equity kept in cash, percent. Default 0 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  cashBufferPct?: number;

  /** Close positions before earnings reports (equities). Default false */
  @IsOptional()
  @IsBoolean()
  earningsExit?: boolean;

  /** No new entries this many calendar days before a report. Default 0 */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  earningsBlockDays?: number;

  /** Subscriptions may sell short (direction short/both). Default false */
  @IsOptional()
  @IsBoolean()
  allowShort?: boolean;
}

export class PortfolioSizingDto {
  @IsIn(['all_in', 'fixed_fraction', 'risk_per_trade'])
  type: PositionSizing['type'];

  /** fixed_fraction: share of equity, (0, 1]. Default 1. */
  @IsOptional()
  @IsNumber()
  @Min(0.001)
  @Max(1)
  fraction?: number;

  /** risk_per_trade: % of equity risked to the stop. Default 1. */
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(100)
  riskPct?: number;
}

export class PortfolioExecutionInputDto {
  /** Default 5 (0.05%) */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  feeBps?: number;

  /** Default 5 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  slippageBps?: number;

  /** Default 0 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  minFee?: number;

  /** Annual borrow cost of short positions, percent of entry notional. Default 0 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  borrowPct?: number;

  /** Default fixed_fraction 1 (then capped by maxPositionPct) */
  @IsOptional()
  @ValidateNested()
  @Type(() => PortfolioSizingDto)
  sizing?: PortfolioSizingDto;
}

export class CreatePortfolioDto {
  @IsString()
  @Length(1, 64)
  name: string;

  /** paper (default): simulated fills. alpaca_paper: the Alpaca demo account (needs API keys). */
  @IsOptional()
  @IsIn(['paper', 'alpaca_paper'])
  mode?: PortfolioMode;

  /** Required for paper; alpaca_paper takes the demo account's cash. */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  initialCash?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => RiskRulesInputDto)
  riskRules?: RiskRulesInputDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PortfolioExecutionInputDto)
  execution?: PortfolioExecutionInputDto;
}

export class UpdatePortfolioDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => RiskRulesInputDto)
  riskRules?: RiskRulesInputDto;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateSubscriptionDto {
  @IsUUID()
  strategyConfigId: string;

  @IsString()
  symbol: string;

  /** strategy (default): rules driven like a backtest. signals: stored signals become orders. */
  @IsOptional()
  @IsIn(['strategy', 'signals'])
  source?: SubscriptionSource;

  /** Fixed share of equity per entry, percent; overrides the portfolio sizing */
  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(100)
  allocationPct?: number;

  /** long (default), short or both. Shorts need riskRules.allowShort and source=strategy. */
  @IsOptional()
  @IsIn(['long', 'short', 'both'])
  @ApiPropertyOptional({ enum: ['long', 'short', 'both'] })
  direction?: TradeDirection;
}

export class CreateOrderDto {
  @IsString()
  symbol: string;

  @IsIn(['BUY', 'SELL'])
  side: OrderSide;

  @IsIn(['market', 'limit'])
  type: OrderType;

  /** BUY quantity, decimal string. A SELL always closes the whole position. */
  @IsOptional()
  @IsNumberString()
  quantity?: string;

  /** BUY amount in account currency, decimal string (instead of quantity) */
  @IsOptional()
  @IsNumberString()
  notional?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  limitPrice?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  stopLoss?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  takeProfit?: number;
}

export class OrdersQueryDto {
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  @ApiPropertyOptional({ enum: ORDER_STATUSES })
  status?: OrderStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  @ApiPropertyOptional({ default: 200 })
  limit: number = 200;
}

export class LimitQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  @ApiPropertyOptional({ default: 200 })
  limit: number = 200;
}

export class EquityQueryDto {
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}

// Responses

export class RiskRulesDto {
  maxPositionPct: number;
  maxOpenPositions: number;
  maxDailyLossPct: number;
  requireStopLoss: boolean;
  cashBufferPct: number;
  /** Close positions before earnings reports (missing on older portfolios: off) */
  earningsExit?: boolean;
  /** No new entries this many days before a report */
  earningsBlockDays?: number;
  /** Shorts allowed (missing on older portfolios: off) */
  allowShort?: boolean;
}

export class PortfolioSizingViewDto {
  type: PositionSizing['type'];
  fraction?: number;
  riskPct?: number;
}

export class PortfolioExecutionDto {
  feeBps: number;
  slippageBps: number;
  minFee: number;
  sizing: PortfolioSizingViewDto;
}

/** Money fields are decimal strings; prices are numbers. */
export class PortfolioSummaryDto {
  id: string;
  name: string;
  /** paper or alpaca_paper */
  mode: string;
  baseCurrency: string;
  isActive: boolean;
  /** Set while this portfolio alone is halted */
  haltedAt: Date | null;
  haltReason: string | null;
  initialCash: string;
  cash: string;
  positionsValue: string;
  equity: string;
  /** equity / initialCash - 1 */
  totalReturn: number;
  /** Equity change since the start of the UTC day */
  dayPnl: string | null;
  realizedPnl: string;
  openPositions: number;
  riskRules: RiskRulesDto;
  execution: PortfolioExecutionDto;
  createdAt: Date;
}

export class PositionDto {
  assetId: string;
  symbol: string;
  quantity: string;
  avgPrice: string;
  /** Near-live quote, or the latest 1h close when no fresher quote exists */
  lastPrice: number;
  /** When `lastPrice` was observed; null without market data */
  @ApiProperty({ type: Date, nullable: true })
  priceAsOf: Date | null;
  @ApiProperty({ enum: ['quote', 'bar'], nullable: true })
  priceSource: 'quote' | 'bar' | null;
  marketValue: string;
  /** Before the exit fee */
  unrealizedPnl: string;
  stopLoss: number | null;
  takeProfit: number | null;
  openedAt: Date;
  /** Null for manual positions */
  subscriptionId: string | null;
}

export class HealthCheckDto {
  @ApiProperty({ enum: ['drawdown', 'loss_streak', 'win_rate', 'silence', 'no_backtest'] })
  code: HealthCheckCode;
  @ApiProperty({ enum: ['ok', 'info', 'warning', 'unknown'] })
  level: HealthLevel;
  /** Turkish explanation */
  message: string;
}

export class SubscriptionHealthDto {
  /** Worst check: warning > info > ok; unknown without a backtest to compare with */
  @ApiProperty({ enum: ['ok', 'info', 'warning', 'unknown'] })
  level: HealthLevel;
  checks: HealthCheckDto[];
  /** ISO time of the check */
  checkedAt: string;
  /** Backtest run the subscription was compared with */
  runId: string | null;
}

export class SubscriptionHealthViewDto {
  subscriptionId: string;
  health: SubscriptionHealthDto;
}

export class SubscriptionDto {
  id: string;
  symbol: string;
  strategyConfigId: string;
  strategyCode: string;
  configName: string;
  source: SubscriptionSource;
  allocationPct: number | null;
  @ApiProperty({ enum: ['long', 'short', 'both'] })
  direction: TradeDirection;
  isActive: boolean;
  /** Last processed 4h bar */
  lastBarTime: Date | null;
  createdAt: Date;
  /** Last strategy health check; null until checked (hourly) */
  health: SubscriptionHealthDto | null;
}

export class PortfolioDetailDto extends PortfolioSummaryDto {
  positions: PositionDto[];
  subscriptions: SubscriptionDto[];
}

export class OrderDto {
  id: string;
  portfolioId: string;
  assetId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  /** Decimal string; null for an automatic entry until it fills */
  quantity: string | null;
  notional: string | null;
  limitPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  status: OrderStatus;
  source: OrderSource;
  /** 4h bar whose close produced an automatic order */
  barTime: Date | null;
  signalId: string | null;
  subscriptionId: string | null;
  rejectReason: string | null;
  clientOrderId: string;
  createdAt: Date;
  updatedAt: Date;
  filledAt: Date | null;
}

export class FillDto {
  id: string;
  orderId: string;
  assetId: string;
  symbol: string;
  side: OrderSide;
  quantity: string;
  price: number;
  fee: string;
  executedAt: Date;
}

export class ClosedTradeDto {
  id: string;
  assetId: string;
  symbol: string;
  subscriptionId: string | null;
  strategyConfigId: string | null;
  entryTime: Date;
  entryPrice: number;
  exitTime: Date;
  exitPrice: number;
  quantity: string;
  fees: string;
  /** Net of fees */
  pnl: string;
  returnPct: number;
  @ApiProperty({ enum: ['long', 'short'] })
  side: PositionSide;
  @ApiProperty({
    enum: ['signal', 'stop_loss', 'take_profit', 'end_of_data', 'manual', 'earnings'],
  })
  exitReason: ExitReason;
  barsHeld: number | null;
}

export class EquityPointDto {
  at: Date;
  equity: string;
  cash: string;
  /** Depth below the running peak, 0..1 */
  drawdown: number;
}

export class ReconciliationDiffDto {
  /** position or cash */
  kind: string;
  symbol?: string;
  broker: string;
  db: string;
}

export class ReconciliationRunDto {
  id: string;
  portfolioId: string;
  /** ok, diff or error */
  status: string;
  diffs: ReconciliationDiffDto[];
  brokerCash: string | null;
  brokerEquity: string | null;
  error: string | null;
  createdAt: Date;
}

export class BrokerAccountDto {
  id: string;
  status: string;
  cash: string;
  equity: string;
  buyingPower: string;
}

export class BrokerStatusDto {
  /** API keys are configured */
  enabled: boolean;
  /** Always paper: live trading is disabled */
  environment: string;
  account: BrokerAccountDto | null;
  error: string | null;
}

export class BrokerSummaryDto extends BrokerStatusDto {
  mode: string;
  /** Latest first */
  reconciliations: ReconciliationRunDto[];
}

export class HaltDto {
  @IsString()
  @Length(1, 200)
  reason: string;

  /** Also close every open position with a market order. Default false */
  @IsOptional()
  @IsBoolean()
  closePositions?: boolean;
}

export class HaltedPortfolioDto {
  id: string;
  name: string;
  reason: string | null;
  haltedAt: Date;
}

export class TradingStateDto {
  halted: boolean;
  reason: string | null;
  changedAt: Date | null;
  haltedPortfolios: HaltedPortfolioDto[];
}
