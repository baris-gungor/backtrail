import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BacktestQueryService } from '../application/backtest-query.service';
import { BacktestRunnerService } from '../application/backtest-runner.service';
import {
  BacktestRunDetailDto,
  BacktestRunDto,
  BacktestTradeDto,
  BatchDto,
  CreateBacktestDto,
  LeaderboardQueryDto,
  MonteCarloDto,
  MonteCarloQueryDto,
  SubmitResultDto,
  SweepDto,
  WalkForwardDto,
} from './backtests.dto';

@ApiTags('backtests')
@Controller('backtests')
export class BacktestsController {
  constructor(
    private readonly runner: BacktestRunnerService,
    private readonly query: BacktestQueryService,
  ) {}

  /** Queues every symbol × strategy combination. Poll `GET /backtests/batches/:batchId`. */
  @Post()
  create(@Body() dto: CreateBacktestDto): Promise<SubmitResultDto> {
    return this.runner.submit(dto);
  }

  /** Grid search on the train segment, then the best results on the test segment. */
  @Post('sweep')
  sweep(@Body() dto: SweepDto): Promise<SubmitResultDto> {
    return this.runner.sweep(dto);
  }

  /**
   * Walk-forward analysis: per window a sweep on the train segment, the best params on the test
   * segment, and one joined out-of-sample run (`segment: oos`). Poll the batch.
   */
  @Post('walk-forward')
  walkForward(@Body() dto: WalkForwardDto): Promise<SubmitResultDto> {
    return this.runner.walkForward(dto);
  }

  /** Latest successful run per asset × strategy × params, ranked by a metric. */
  @Get('leaderboard')
  leaderboard(@Query() q: LeaderboardQueryDto): Promise<BacktestRunDto[]> {
    return this.query.leaderboard(q);
  }

  @Get('batches/:batchId')
  batch(@Param('batchId', ParseUUIDPipe) batchId: string): Promise<BatchDto> {
    return this.query.getBatch(batchId);
  }

  /** Run with metrics, equity curve and benchmark curve. */
  @Get(':id')
  run(@Param('id', ParseUUIDPipe) id: string): Promise<BacktestRunDetailDto> {
    return this.query.getRun(id);
  }

  /**
   * Monte Carlo on the run's trades: bootstrap range of total return and drawdown, loss
   * probability, drawdown under shuffled trade order. 422 below 5 trades.
   */
  @Get(':id/monte-carlo')
  monteCarlo(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: MonteCarloQueryDto,
  ): Promise<MonteCarloDto> {
    return this.query.monteCarlo(id, q.samples, q.seed);
  }

  @Get(':id/trades')
  trades(@Param('id', ParseUUIDPipe) id: string): Promise<BacktestTradeDto[]> {
    return this.query.getTrades(id);
  }
}
