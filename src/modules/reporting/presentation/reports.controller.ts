import { Controller, Get, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ReportService } from '../application/report.service';
import { toCsv, type CsvColumn } from '../domain/csv';
import type { TradeRecord } from '../domain/trade-record';
import {
  AssetReportDto,
  AssetReportQueryDto,
  BacktestExtrasDto,
  DivergenceQueryDto,
  DivergenceRowDto,
  MatrixQueryDto,
  MatrixReportDto,
  PortfolioReportDto,
  SignalQualityQueryDto,
  SignalQualityReportDto,
  SourceRangeQueryDto,
  StrategyReportDto,
  TradeRecordDto,
  TradesQueryDto,
} from './reports.dto';

const TRADE_COLUMNS: CsvColumn<TradeRecord>[] = [
  { header: 'source', value: (t) => t.source },
  { header: 'strategy', value: (t) => t.strategyCode },
  { header: 'config', value: (t) => t.configName },
  { header: 'symbol', value: (t) => t.symbol },
  { header: 'entry_time', value: (t) => t.entryTime },
  { header: 'entry_price', value: (t) => t.entryPrice },
  { header: 'exit_time', value: (t) => t.exitTime },
  { header: 'exit_price', value: (t) => t.exitPrice },
  { header: 'quantity', value: (t) => t.quantity },
  { header: 'fees', value: (t) => t.fees },
  { header: 'pnl', value: (t) => t.pnl },
  { header: 'return_pct', value: (t) => t.returnPct },
  { header: 'exit_reason', value: (t) => t.exitReason },
  { header: 'bars_held', value: (t) => t.barsHeld },
  { header: 'run_id', value: (t) => t.runId },
  { header: 'portfolio_id', value: (t) => t.portfolioId },
];

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportService) {}

  /** Strategy × asset matrix of one metric. Includes a buy & hold row for backtests. */
  @Get('matrix')
  matrix(@Query() q: MatrixQueryDto): Promise<MatrixReportDto> {
    return this.reports.matrix(q.source, q.metric, q.segment);
  }

  /** One strategy over all assets: totals, per-asset breakdown, best and worst trades. */
  @Get('strategies/:code')
  strategy(
    @Param('code') code: string,
    @Query() q: SourceRangeQueryDto,
  ): Promise<StrategyReportDto> {
    return this.reports.strategy(code, q.source, { from: q.from, to: q.to });
  }

  /** Every strategy on one asset: latest backtest, paper trades, signal hit rates, correlation. */
  @Get('assets/:symbol')
  asset(@Param('symbol') symbol: string, @Query() q: AssetReportQueryDto): Promise<AssetReportDto> {
    return this.reports.asset(symbol, q.horizon);
  }

  /** Equity and drawdown, metrics, monthly returns, open risk, contribution per subscription. */
  @Get('portfolios/:id')
  portfolio(@Param('id', ParseUUIDPipe) id: string): Promise<PortfolioReportDto> {
    return this.reports.portfolio(id);
  }

  /** Trade journal of backtests and paper portfolios, newest exit first. `format=csv` downloads. */
  @Get('trades')
  @ApiProduces('application/json', 'text/csv')
  @ApiOkResponse({ type: [TradeRecordDto] })
  async trades(
    @Query() q: TradesQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TradeRecordDto[] | string> {
    const trades = await this.reports.trades(q);
    if (q.format !== 'csv') return trades;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="trades.csv"');
    return toCsv(TRADE_COLUMNS, trades);
  }

  /** Paper trades of each subscription against a backtest of the same bars. */
  @Get('divergence')
  divergence(@Query() q: DivergenceQueryDto): Promise<DivergenceRowDto[]> {
    return this.reports.divergence(q.portfolioId);
  }

  /** Forward returns after stored signals, independent of trading. */
  @Get('signals')
  signals(@Query() q: SignalQualityQueryDto): Promise<SignalQualityReportDto> {
    return this.reports.signalQuality({ strategy: q.strategy, symbol: q.symbol }, q.horizons);
  }

  /** Monthly and yearly returns, ulcer index, longest drawdown, streaks, rolling Sharpe of a run. */
  @Get('backtests/:id')
  backtest(@Param('id', ParseUUIDPipe) id: string): Promise<BacktestExtrasDto> {
    return this.reports.backtestExtras(id);
  }
}
