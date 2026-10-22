import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsSelect, Repository } from 'typeorm';
import { InvalidInputError, NotFoundError } from '../../../common/errors/domain.error';
import { AssetsService } from '../../assets/application/assets.service';
import type { BacktestMetrics } from '../domain/metrics';
import { monteCarlo, tradeReturns, type MonteCarloResult } from '../domain/monte-carlo';
import {
  BacktestRunEntity,
  BacktestStatus,
  type BacktestSegment,
} from '../infrastructure/backtest-run.entity';
import { BacktestTradeEntity } from '../infrastructure/backtest-trade.entity';

export type RunSummary = Omit<BacktestRunEntity, 'equityCurve' | 'benchmarkCurve'> & {
  symbol: string;
};
export type RunDetail = BacktestRunEntity & { symbol: string };

export interface BatchView {
  batchId: string;
  total: number;
  pending: number;
  running: number;
  success: number;
  failed: number;
  runs: RunSummary[];
}

/** Metrics the leaderboard can rank by. Max drawdown ranks ascending, the rest descending. */
export const LEADERBOARD_METRICS = [
  'sharpe',
  'sortino',
  'calmar',
  'totalReturn',
  'cagr',
  'alpha',
  'profitFactor',
  'winRate',
  'expectancy',
  'maxDrawdown',
] as const satisfies readonly (keyof BacktestMetrics)[];
export type LeaderboardMetric = (typeof LEADERBOARD_METRICS)[number];

export interface LeaderboardQuery {
  symbol?: string;
  strategy?: string;
  metric: LeaderboardMetric;
  segment: BacktestSegment;
  /** Include sweep runs. Default false: only directly requested runs. */
  includeSweeps?: boolean;
  limit: number;
}

const SUMMARY_COLUMNS = [
  'id',
  'batchId',
  'source',
  'strategyCode',
  'strategyVersion',
  'strategyConfigId',
  'configName',
  'params',
  'assetId',
  'timeframe',
  'periodFrom',
  'periodTo',
  'segment',
  'initialCapital',
  'execution',
  'status',
  'metrics',
  'walkForward',
  'error',
  'createdAt',
  'startedAt',
  'finishedAt',
] as const satisfies readonly (keyof BacktestRunEntity)[];

const SUMMARY_SELECT = Object.fromEntries(
  SUMMARY_COLUMNS.map((c) => [c, true]),
) as FindOptionsSelect<BacktestRunEntity>;

/**
 * See `VARIANT` in reporting: runs with and without roll adjustment, the earnings filter or shorts
 * are separate leaderboard entries.
 */
const VARIANT = [
  `COALESCE((r.execution->>'adjustRolls')::boolean, false)`,
  `COALESCE(r.execution->'earnings', 'null'::jsonb)`,
  `COALESCE(r.execution->>'direction', 'long')`,
];

@Injectable()
export class BacktestQueryService {
  constructor(
    @InjectRepository(BacktestRunEntity) private readonly runs: Repository<BacktestRunEntity>,
    @InjectRepository(BacktestTradeEntity)
    private readonly trades: Repository<BacktestTradeEntity>,
    private readonly assets: AssetsService,
  ) {}

  async getRun(id: string): Promise<RunDetail> {
    const run = await this.runs.findOneBy({ id });
    if (!run) throw new NotFoundError(`Backtest run ${id} not found`);
    const [withSymbol] = await this.withSymbols([run]);
    return withSymbol;
  }

  async getTrades(id: string): Promise<BacktestTradeEntity[]> {
    if (!(await this.runs.existsBy({ id })))
      throw new NotFoundError(`Backtest run ${id} not found`);
    return this.trades.find({ where: { runId: id }, order: { entryTime: 'ASC' } });
  }

  /**
   * Monte Carlo of a finished run's trades. Computed on request from the stored
   * trades; the same request gives the same result (fixed seed).
   */
  async monteCarlo(id: string, samples: number, seed: number): Promise<MonteCarloResult> {
    const run = await this.runs.findOne({
      select: { id: true, status: true, initialCapital: true },
      where: { id },
    });
    if (!run) throw new NotFoundError(`Backtest run ${id} not found`);
    if (run.status !== BacktestStatus.Success) {
      throw new InvalidInputError(`Backtest run ${id} is ${run.status}`);
    }
    const trades = await this.trades.find({
      select: { pnl: true, exitTime: true },
      where: { runId: id },
      order: { exitTime: 'ASC' },
    });
    const returns = tradeReturns(
      Number(run.initialCapital),
      trades.map((t) => Number(t.pnl)),
    );
    return monteCarlo(returns, { samples, seed });
  }

  /**
   * What a live subscription is compared with: the latest successful full-period
   * run of the same asset and stored config, as per-trade returns and the days it covered.
   */
  async healthExpectation(
    assetId: string,
    strategyConfigId: string,
    direction: string = 'long',
  ): Promise<{ runId: string; returns: number[]; periodDays: number } | null> {
    const run = await this.runs
      .createQueryBuilder('r')
      .select('r.id', 'id')
      .addSelect(`(r.equity_curve->0->>0)::bigint`, 'first')
      .addSelect(`(r.equity_curve->-1->>0)::bigint`, 'last')
      .where('r.asset_id = :assetId', { assetId })
      .andWhere('r.strategy_config_id = :strategyConfigId', { strategyConfigId })
      .andWhere(`r.status = 'success' AND r.segment = 'full' AND r.source = 'run'`)
      // A short subscription is compared with a backtest that also traded shorts.
      .andWhere(`COALESCE(r.execution->>'direction', 'long') = :direction`, { direction })
      .andWhere('r.equity_curve IS NOT NULL')
      .orderBy('r.finished_at', 'DESC')
      .limit(1)
      .getRawOne<{ id: string; first: string; last: string }>();
    if (!run) return null;
    const trades = await this.trades.find({
      select: { returnPct: true, exitTime: true },
      where: { runId: run.id },
      order: { exitTime: 'ASC' },
    });
    return {
      runId: run.id,
      returns: trades.map((t) => t.returnPct),
      periodDays: (Number(run.last) - Number(run.first)) / 86_400_000,
    };
  }

  async getBatch(batchId: string): Promise<BatchView> {
    const rows = await this.runs.find({
      select: SUMMARY_SELECT,
      where: { batchId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    if (rows.length === 0) throw new NotFoundError(`Backtest batch ${batchId} not found`);
    const count = (status: BacktestStatus) => rows.filter((r) => r.status === status).length;
    return {
      batchId,
      total: rows.length,
      pending: count(BacktestStatus.Pending),
      running: count(BacktestStatus.Running),
      success: count(BacktestStatus.Success),
      failed: count(BacktestStatus.Failed),
      runs: await this.withSymbols(rows),
    };
  }

  /** Latest successful run per asset × strategy × params, ranked by `metric`. */
  async leaderboard(q: LeaderboardQuery): Promise<RunSummary[]> {
    const qb = this.runs
      .createQueryBuilder('r')
      .select(SUMMARY_COLUMNS.map((c) => `r.${c}`))
      .distinctOn(['r.asset_id', 'r.strategy_code', 'r.params', ...VARIANT])
      .where('r.status = :status', { status: BacktestStatus.Success })
      .andWhere('r.segment = :segment', { segment: q.segment })
      .orderBy('r.asset_id')
      .addOrderBy('r.strategy_code')
      .addOrderBy('r.params');
    for (const v of VARIANT) qb.addOrderBy(v);
    qb.addOrderBy('r.finished_at', 'DESC');
    // Joined walk-forward results exist only as walk-forward runs.
    if (!q.includeSweeps && q.segment !== 'oos') qb.andWhere(`r.source = 'run'`);
    if (q.strategy) qb.andWhere('r.strategy_code = :strategy', { strategy: q.strategy });
    if (q.symbol) {
      const asset = await this.assets.findBySymbol(q.symbol);
      qb.andWhere('r.asset_id = :assetId', { assetId: asset.id });
    }

    const rows = await qb.getMany();
    const value = (r: BacktestRunEntity): number | null => r.metrics?.[q.metric] ?? null;
    const ascending = q.metric === 'maxDrawdown';
    rows.sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va === null || vb === null) return (va === null ? 1 : 0) - (vb === null ? 1 : 0);
      return ascending ? va - vb : vb - va;
    });
    return this.withSymbols(rows.slice(0, q.limit));
  }

  private async withSymbols<T extends Pick<BacktestRunEntity, 'assetId'>>(
    rows: T[],
  ): Promise<(T & { symbol: string })[]> {
    const symbols = new Map((await this.assets.findAll({})).map((a) => [a.id, a.symbol]));
    return rows.map((r) => ({ ...r, symbol: symbols.get(r.assetId) ?? '?' }));
  }
}
