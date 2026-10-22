import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { BacktestMetrics } from '../../backtesting/domain/metrics';
import type { PositionSide, TradeDirection } from '../../trading/domain/execution';
import type { TradeRecord } from '../domain/trade-record';

/**
 * Read-only SQL over other modules' tables (src/modules/README.md). Reporting
 * never writes. Column names are snake_case (SnakeNamingStrategy).
 */

export interface RunRow {
  id: string;
  assetId: string;
  symbol: string;
  strategyCode: string;
  configName: string | null;
  params: Record<string, unknown>;
  segment: string;
  metrics: BacktestMetrics;
  periodFrom: Date | null;
  periodTo: Date | null;
  finishedAt: Date;
  equityCurve?: [number, number][] | null;
  benchmarkCurve?: [number, number][] | null;
}

export interface RunFilter {
  segment?: string;
  strategy?: string;
  assetId?: string;
  includeSweeps?: boolean;
  withCurves?: boolean;
}

export interface TradeFilter {
  strategy?: string;
  assetId?: string;
  portfolioId?: string;
  runId?: string;
  /** Exit time range. */
  from?: Date;
  to?: Date;
  limit?: number;
}

export interface SignalRow {
  assetId: string;
  symbol: string;
  strategyCode: string;
  configName: string;
  barTime: Date;
  side: 'BUY' | 'SELL';
  price: number;
}

export interface SnapshotRow {
  at: Date;
  equity: string;
  cash: string;
  positionsValue: string;
}

export interface SubscriptionRow {
  id: string;
  assetId: string;
  symbol: string;
  strategyConfigId: string;
  strategyCode: string;
  configName: string;
  source: string;
  allocationPct: number | null;
  direction: TradeDirection;
  isActive: boolean;
  startBarTime: Date | null;
  lastBarTime: Date | null;
  createdAt: Date;
}

/** Builds `$n` placeholders as conditions are added. */
class Where {
  readonly params: unknown[] = [];
  private readonly parts: string[] = [];

  add(sql: string, value: unknown): this {
    this.params.push(value);
    this.parts.push(sql.replace('?', `$${this.params.length}`));
    return this;
  }

  raw(sql: string): this {
    this.parts.push(sql);
    return this;
  }

  toString(): string {
    return this.parts.length ? `WHERE ${this.parts.join(' AND ')}` : '';
  }
}

const num = (v: string | null): number | null => (v === null ? null : Number(v));

/**
 * Run settings that change the result: roll adjustment, the earnings filter
 * and the trade direction; older runs lack them. Reports keep one run per asset × strategy × params and
 * order by this first, so the plain run (no adjustment, no filter) wins when there is one; the
 * leaderboard lists each variant separately.
 */
export const VARIANT = (alias?: string) => {
  const e = `${alias ? `${alias}.` : ''}execution`;
  return `COALESCE((${e}->>'adjustRolls')::boolean, false), COALESCE(${e}->'earnings', 'null'::jsonb), COALESCE(${e}->>'direction', 'long')`;
};

@Injectable()
export class ReportQueries {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /** Latest successful run per asset × strategy × params (the leaderboard set). */
  async latestRuns(f: RunFilter = {}): Promise<RunRow[]> {
    const w = new Where().raw(`r.status = 'success'`).add('r.segment = ?', f.segment ?? 'full');
    if (!f.includeSweeps) w.raw(`r.source = 'run'`);
    if (f.strategy) w.add('r.strategy_code = ?', f.strategy);
    if (f.assetId) w.add('r.asset_id = ?', f.assetId);
    const curves = f.withCurves ? ', r.equity_curve, r.benchmark_curve' : '';
    const rows = await this.db.query<Record<string, unknown>[]>(
      `SELECT DISTINCT ON (r.asset_id, r.strategy_code, r.params)
         r.id, r.asset_id, a.symbol, r.strategy_code, r.config_name, r.params, r.segment,
         r.metrics, r.period_from, r.period_to, r.finished_at${curves}
       FROM backtest_runs r JOIN assets a ON a.id = r.asset_id
       ${w.toString()}
       ORDER BY r.asset_id, r.strategy_code, r.params, ${VARIANT('r')}, r.finished_at DESC`,
      w.params,
    );
    return rows.map((r) => ({
      id: r.id as string,
      assetId: r.asset_id as string,
      symbol: r.symbol as string,
      strategyCode: r.strategy_code as string,
      configName: r.config_name as string | null,
      params: r.params as Record<string, unknown>,
      segment: r.segment as string,
      metrics: r.metrics as BacktestMetrics,
      periodFrom: r.period_from as Date | null,
      periodTo: r.period_to as Date | null,
      finishedAt: r.finished_at as Date,
      equityCurve: r.equity_curve as [number, number][] | null | undefined,
      benchmarkCurve: r.benchmark_curve as [number, number][] | null | undefined,
    }));
  }

  async run(id: string): Promise<RunRow | null> {
    const rows = await this.db.query<Record<string, unknown>[]>(
      `SELECT r.id, r.asset_id, a.symbol, r.strategy_code, r.config_name, r.params, r.segment,
              r.metrics, r.period_from, r.period_to, r.finished_at, r.equity_curve, r.benchmark_curve
       FROM backtest_runs r JOIN assets a ON a.id = r.asset_id
       WHERE r.id = $1 AND r.status = 'success'`,
      [id],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id as string,
      assetId: r.asset_id as string,
      symbol: r.symbol as string,
      strategyCode: r.strategy_code as string,
      configName: r.config_name as string | null,
      params: r.params as Record<string, unknown>,
      segment: r.segment as string,
      metrics: r.metrics as BacktestMetrics,
      periodFrom: r.period_from as Date | null,
      periodTo: r.period_to as Date | null,
      finishedAt: r.finished_at as Date,
      equityCurve: r.equity_curve as [number, number][] | null,
      benchmarkCurve: r.benchmark_curve as [number, number][] | null,
    };
  }

  /**
   * Backtest trades. Without `runId` only trades of the latest runs (`latestRuns`, full segment,
   * no sweeps) count, so repeated runs do not duplicate trades.
   */
  async backtestTrades(f: TradeFilter = {}): Promise<TradeRecord[]> {
    const w = new Where();
    if (f.runId) w.add('t.run_id = ?', f.runId);
    if (f.strategy) w.add('r.strategy_code = ?', f.strategy);
    if (f.assetId) w.add('r.asset_id = ?', f.assetId);
    if (f.from) w.add('t.exit_time >= ?', f.from);
    if (f.to) w.add('t.exit_time <= ?', f.to);
    const latest = f.runId
      ? ''
      : `JOIN (SELECT DISTINCT ON (asset_id, strategy_code, params) id FROM backtest_runs
               WHERE status = 'success' AND segment = 'full' AND source = 'run'
               ORDER BY asset_id, strategy_code, params, ${VARIANT()}, finished_at DESC) l ON l.id = r.id`;
    const rows = await this.db.query<Record<string, string | Date | number | null>[]>(
      `SELECT t.id, t.run_id, r.strategy_code, r.config_name, a.symbol, r.asset_id,
              t.entry_time, t.entry_price, t.exit_time, t.exit_price, t.quantity::text AS quantity,
              t.fees::text AS fees, t.pnl::text AS pnl, t.return_pct, t.side, t.exit_reason, t.bars_held
       FROM backtest_trades t
       JOIN backtest_runs r ON r.id = t.run_id
       ${latest}
       JOIN assets a ON a.id = r.asset_id
       ${w.toString()}
       ORDER BY t.exit_time DESC
       ${f.limit ? `LIMIT ${Math.floor(f.limit)}` : ''}`,
      w.params,
    );
    return rows.map((r) => ({
      source: 'backtest',
      id: r.id as string,
      runId: r.run_id as string,
      portfolioId: null,
      subscriptionId: null,
      strategyCode: r.strategy_code as string,
      configName: r.config_name as string | null,
      symbol: r.symbol as string,
      assetId: r.asset_id as string,
      entryTime: r.entry_time as Date,
      entryPrice: Number(r.entry_price),
      exitTime: r.exit_time as Date,
      exitPrice: Number(r.exit_price),
      quantity: r.quantity as string,
      fees: r.fees as string,
      pnl: r.pnl as string,
      returnPct: Number(r.return_pct),
      side: r.side as PositionSide,
      exitReason: r.exit_reason as string,
      barsHeld: r.bars_held === null ? null : Number(r.bars_held),
    }));
  }

  async paperTrades(f: TradeFilter & { subscriptionId?: string } = {}): Promise<TradeRecord[]> {
    const w = new Where();
    if (f.portfolioId) w.add('t.portfolio_id = ?', f.portfolioId);
    if (f.subscriptionId) w.add('t.subscription_id = ?', f.subscriptionId);
    if (f.strategy) w.add('s.code = ?', f.strategy);
    if (f.assetId) w.add('t.asset_id = ?', f.assetId);
    if (f.from) w.add('t.exit_time >= ?', f.from);
    if (f.to) w.add('t.exit_time <= ?', f.to);
    const rows = await this.db.query<Record<string, string | Date | number | null>[]>(
      `SELECT t.id, t.portfolio_id, t.subscription_id, s.code AS strategy_code, c.name AS config_name, a.symbol,
              t.asset_id, t.entry_time, t.entry_price, t.exit_time, t.exit_price,
              t.quantity::text AS quantity, t.fees::text AS fees, t.pnl::text AS pnl,
              t.return_pct, t.side, t.exit_reason, t.bars_held
       FROM closed_trades t
       JOIN assets a ON a.id = t.asset_id
       LEFT JOIN strategy_configs c ON c.id = t.strategy_config_id
       LEFT JOIN strategies s ON s.id = c.strategy_id
       ${w.toString()}
       ORDER BY t.exit_time DESC
       ${f.limit ? `LIMIT ${Math.floor(f.limit)}` : ''}`,
      w.params,
    );
    return rows.map((r) => ({
      source: 'paper',
      id: r.id as string,
      runId: null,
      portfolioId: r.portfolio_id as string,
      subscriptionId: r.subscription_id as string | null,
      strategyCode: r.strategy_code as string | null,
      configName: r.config_name as string | null,
      symbol: r.symbol as string,
      assetId: r.asset_id as string,
      entryTime: r.entry_time as Date,
      entryPrice: Number(r.entry_price),
      exitTime: r.exit_time as Date,
      exitPrice: Number(r.exit_price),
      quantity: r.quantity as string,
      fees: r.fees as string,
      pnl: r.pnl as string,
      returnPct: Number(r.return_pct),
      side: r.side as PositionSide,
      exitReason: r.exit_reason as string,
      barsHeld: r.bars_held === null ? null : Number(r.bars_held),
    }));
  }

  async signals(f: { strategy?: string; assetId?: string } = {}): Promise<SignalRow[]> {
    const w = new Where();
    if (f.strategy) w.add('s.code = ?', f.strategy);
    if (f.assetId) w.add('g.asset_id = ?', f.assetId);
    const rows = await this.db.query<Record<string, string | Date>[]>(
      `SELECT g.asset_id, a.symbol, s.code AS strategy_code, c.name AS config_name,
              g.bar_time, g.side, g.price
       FROM signals g
       JOIN assets a ON a.id = g.asset_id
       JOIN strategy_configs c ON c.id = g.strategy_config_id
       JOIN strategies s ON s.id = c.strategy_id
       ${w.toString()}
       ORDER BY g.asset_id, g.bar_time`,
      w.params,
    );
    return rows.map((r) => ({
      assetId: r.asset_id as string,
      symbol: r.symbol as string,
      strategyCode: r.strategy_code as string,
      configName: r.config_name as string,
      barTime: r.bar_time as Date,
      side: r.side as 'BUY' | 'SELL',
      price: Number(r.price),
    }));
  }

  async snapshots(portfolioId: string): Promise<SnapshotRow[]> {
    const rows = await this.db.query<Record<string, string | Date>[]>(
      `SELECT at, equity::text AS equity, cash::text AS cash,
              positions_value::text AS positions_value
       FROM performance_snapshots WHERE portfolio_id = $1 ORDER BY at`,
      [portfolioId],
    );
    return rows.map((r) => ({
      at: r.at as Date,
      equity: r.equity as string,
      cash: r.cash as string,
      positionsValue: r.positions_value as string,
    }));
  }

  async subscriptions(portfolioId: string): Promise<SubscriptionRow[]> {
    const rows = await this.db.query<Record<string, unknown>[]>(
      `SELECT p.id, p.asset_id, a.symbol, p.strategy_config_id, s.code AS strategy_code,
              c.name AS config_name, p.source, p.allocation_pct, p.direction, p.is_active, p.start_bar_time,
              p.last_bar_time, p.created_at
       FROM portfolio_subscriptions p
       JOIN assets a ON a.id = p.asset_id
       JOIN strategy_configs c ON c.id = p.strategy_config_id
       JOIN strategies s ON s.id = c.strategy_id
       WHERE p.portfolio_id = $1
       ORDER BY p.created_at`,
      [portfolioId],
    );
    return rows.map((r) => ({
      id: r.id as string,
      assetId: r.asset_id as string,
      symbol: r.symbol as string,
      strategyConfigId: r.strategy_config_id as string,
      strategyCode: r.strategy_code as string,
      configName: r.config_name as string,
      source: r.source as string,
      allocationPct: num(r.allocation_pct as string | null),
      direction: r.direction as TradeDirection,
      isActive: r.is_active as boolean,
      startBarTime: r.start_bar_time as Date | null,
      lastBarTime: r.last_bar_time as Date | null,
      createdAt: r.created_at as Date,
    }));
  }

  /** Active assets, by symbol. */
  async activeAssets(): Promise<{ assetId: string; symbol: string }[]> {
    const rows = await this.db.query<{ id: string; symbol: string }[]>(
      `SELECT id, symbol FROM assets WHERE is_active ORDER BY symbol`,
    );
    return rows.map((r) => ({ assetId: r.id, symbol: r.symbol }));
  }
}
