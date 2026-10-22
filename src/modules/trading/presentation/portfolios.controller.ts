import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AssetsService } from '../../assets/application/assets.service';
import { OrderService } from '../application/order.service';
import { StrategyHealthService } from '../application/strategy-health.service';
import { PortfolioService } from '../application/portfolio.service';
import { TradingControlService } from '../application/trading-control.service';
import { TradingQueryService } from '../application/trading-query.service';
import { AlpacaBroker } from '../infrastructure/alpaca-broker';
import {
  BrokerSummaryDto,
  ClosedTradeDto,
  CreateOrderDto,
  CreatePortfolioDto,
  CreateSubscriptionDto,
  EquityPointDto,
  EquityQueryDto,
  FillDto,
  LimitQueryDto,
  OrderDto,
  OrdersQueryDto,
  PortfolioDetailDto,
  SubscriptionHealthViewDto,
  PortfolioSummaryDto,
  PositionDto,
  ReconciliationRunDto,
  SubscriptionDto,
  UpdatePortfolioDto,
} from './portfolios.dto';

@ApiTags('portfolios')
@Controller('portfolios')
export class PortfoliosController {
  constructor(
    private readonly portfolios: PortfolioService,
    private readonly query: TradingQueryService,
    private readonly assets: AssetsService,
    private readonly orderService: OrderService,
    private readonly control: TradingControlService,
    private readonly alpaca: AlpacaBroker,
    private readonly health: StrategyHealthService,
  ) {}

  @Post()
  async create(@Body() dto: CreatePortfolioDto): Promise<PortfolioDetailDto> {
    const portfolio = await this.portfolios.create(dto);
    return this.query.detail(portfolio.id);
  }

  @Get()
  list(): Promise<PortfolioSummaryDto[]> {
    return this.query.list();
  }

  /** Cash, equity, open positions (marked at the latest 1h close), subscriptions, day PnL. */
  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<PortfolioDetailDto> {
    return this.query.detail(id);
  }

  /** Risk rules and active flag. An inactive portfolio places no orders. */
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePortfolioDto,
  ): Promise<PortfolioDetailDto> {
    await this.portfolios.update(id, dto);
    return this.query.detail(id);
  }

  /** Deletes the portfolio with its whole history. */
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.portfolios.remove(id);
  }

  /** Trades a strategy config on an asset, starting after the latest closed 4h bar. */
  @Post(':id/subscriptions')
  async subscribe(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSubscriptionDto,
  ): Promise<SubscriptionDto> {
    const sub = await this.portfolios.subscribe(id, dto);
    const detail = await this.query.detail(id);
    return detail.subscriptions.find((s) => s.id === sub.id)!;
  }

  /** Stops automatic orders. An open position stays and keeps its stop-loss / take-profit. */
  @Delete(':id/subscriptions/:subId')
  @HttpCode(204)
  unsubscribe(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('subId', ParseUUIDPipe) subId: string,
  ): Promise<void> {
    return this.orderService.unsubscribe(id, subId);
  }

  /**
   * Checks the strategy health of the portfolio's active subscriptions now (normally hourly):
   * live trades against the latest full-period backtest. Stores the result and notifies changes.
   */
  @Post(':id/health')
  async checkHealth(@Param('id', ParseUUIDPipe) id: string): Promise<SubscriptionHealthViewDto[]> {
    await this.portfolios.get(id);
    return this.health.check(id);
  }

  /** Processes stored closed bars now instead of waiting for the next sync. */
  @Post(':id/process')
  async process(@Param('id', ParseUUIDPipe) id: string): Promise<PortfolioDetailDto> {
    await this.portfolios.process(id);
    return this.query.detail(id);
  }

  /** Manual order. Market orders fill at the latest 1h close plus slippage; limit orders on later 4h bars. */
  @Post(':id/orders')
  async placeOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateOrderDto,
  ): Promise<OrderDto> {
    const asset = await this.assets.findBySymbol(dto.symbol);
    const orderId = await this.orderService.place(id, { ...dto, assetId: asset.id });
    return this.query.getOrder(id, orderId);
  }

  @Get(':id/orders')
  orders(@Param('id', ParseUUIDPipe) id: string, @Query() q: OrdersQueryDto): Promise<OrderDto[]> {
    return this.query.listOrders(id, q.status, q.limit);
  }

  @Delete(':id/orders/:orderId')
  @HttpCode(204)
  cancelOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<void> {
    return this.orderService.cancel(id, orderId);
  }

  @Get(':id/fills')
  fills(@Param('id', ParseUUIDPipe) id: string, @Query() q: LimitQueryDto): Promise<FillDto[]> {
    return this.query.listFills(id, q.limit);
  }

  @Get(':id/positions')
  async positions(@Param('id', ParseUUIDPipe) id: string): Promise<PositionDto[]> {
    return (await this.query.detail(id)).positions;
  }

  @Get(':id/trades')
  trades(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: LimitQueryDto,
  ): Promise<ClosedTradeDto[]> {
    return this.query.listTrades(id, q.limit);
  }

  /** Performance snapshots, one per processing run or manual order. */
  @Get(':id/equity')
  equity(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: EquityQueryDto,
  ): Promise<EquityPointDto[]> {
    return this.query.equity(id, q.from, q.to);
  }

  /** Closes the position with a market order at the latest 1h close. */
  @Post(':id/positions/:assetId/close')
  async closePosition(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
  ): Promise<OrderDto> {
    const orderId = await this.orderService.place(id, { assetId, side: 'SELL', type: 'market' });
    return this.query.getOrder(id, orderId);
  }

  /** Lifts this portfolio's own halt (e.g. after a reconciliation difference was resolved). */
  @Post(':id/resume')
  async resume(@Param('id', ParseUUIDPipe) id: string): Promise<PortfolioDetailDto> {
    await this.control.resumePortfolio(id);
    return this.query.detail(id);
  }

  /** Demo-broker account and the latest reconciliation runs (`alpaca_paper` portfolios). */
  @Get(':id/broker')
  broker(@Param('id', ParseUUIDPipe) id: string): Promise<BrokerSummaryDto> {
    return this.query.brokerSummary(id);
  }

  /** Compares broker positions and cash with the database now. A difference halts the portfolio. */
  @Post(':id/reconcile')
  reconcile(@Param('id', ParseUUIDPipe) id: string): Promise<ReconciliationRunDto> {
    return this.alpaca.reconcileNow(id);
  }
}
