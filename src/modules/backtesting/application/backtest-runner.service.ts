import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { In, Repository } from 'typeorm';
import { InvalidInputError } from '../../../common/errors/domain.error';
import { StrategyCatalogService } from '../../analysis/application/strategy-catalog.service';
import type { StrategyDefinition, StrategyParams } from '../../analysis/domain/strategy';
import { AssetsService } from '../../assets/application/assets.service';
import type { AssetEntity } from '../../assets/infrastructure/asset.entity';
import { EarningsService } from '../../market-data/application/earnings.service';
import { MarketDataQueryService } from '../../market-data/application/market-data-query.service';
import type { Bar } from '../../market-data/domain/bar';
import {
  DEFAULT_EXECUTION,
  earningsFilter,
  toSizing,
  type DecisionFilter,
  type EarningsRule,
  type ExecutionModel,
  type SizingRequest,
  type TradeDirection,
} from '../../trading/domain/execution';
import { adjustRolls, dataQuality, type DataQualityReport } from '../domain/data-quality';
import { downsample, runBacktest, type BacktestResult, type EquityPoint } from '../domain/engine';
import { computeMetrics, type BacktestMetrics } from '../domain/metrics';
import { expandGrid, splitIndex, type ParamRange } from '../domain/sweep';
import {
  bestIndex,
  MAX_WALK_FORWARD_RUNS,
  stitchResults,
  summarize,
  walkForwardWindows,
  type WalkForwardMetric,
  type WalkForwardWindow,
  type WindowOutcome,
} from '../domain/walk-forward';
import {
  BacktestRunEntity,
  BacktestStatus,
  type BacktestExecution,
  type BacktestSegment,
  type BacktestSource,
  type WalkForwardInfo,
} from '../infrastructure/backtest-run.entity';
import { BacktestTradeEntity } from '../infrastructure/backtest-trade.entity';

export const DEFAULT_CAPITAL = 10_000;
/** Runs processed at the same time. Runs are CPU-bound, so more would not be faster. */
const CONCURRENCY = 2;
/** Sweep results tested on the test segment, best train Sharpe first. */
export const DEFAULT_SWEEP_TOP = 5;

export interface StrategySelection {
  code: string;
  /** Stored config name. Its params are used unless `params` is given. */
  config?: string;
  params?: Record<string, unknown>;
}

export interface RunSettings {
  from?: Date;
  to?: Date;
  initialCapital?: number;
  execution?: Partial<ExecutionModel>;
  sizing?: SizingRequest;
  riskFreeRate?: number;
  /** Ratio back-adjust futures roll jumps before running. Default false. */
  adjustRolls?: boolean;
  /** Earnings filter for equities. Default off. */
  earnings?: EarningsRule;
  /** Entries the strategy may take. Default long. */
  direction?: TradeDirection;
}

export interface BacktestRequest extends RunSettings {
  symbols: string[];
  /** Default: every active stored config. */
  strategies?: StrategySelection[];
}

export interface SweepRequest extends RunSettings {
  symbol: string;
  strategy: StrategySelection;
  paramGrid: Record<string, ParamRange>;
  trainRatio?: number;
  top?: number;
}

export interface WalkForwardRequest extends RunSettings {
  symbol: string;
  strategy: StrategySelection;
  paramGrid: Record<string, ParamRange>;
  /** Test segments. Default 5. */
  windows?: number;
  /** Train share of each train + test window. Default 0.7. */
  trainRatio?: number;
  /** Expanding train segments from the first bar. Default false (rolling). */
  anchored?: boolean;
  /** Selects each window's params on its train segment. Default sharpe. */
  metric?: WalkForwardMetric;
}

export interface SubmitResult {
  batchId: string;
  runs: number;
}

interface ResolvedStrategy {
  definition: StrategyDefinition;
  params: StrategyParams;
  configId: string | null;
  configName: string | null;
}

/** Bars of one run and the index range it trades in. */
interface RunWindow {
  bars: Bar[];
  tradeFrom: number;
}

/**
 * Validates backtest requests, stores runs as pending and processes them in an in-process queue.
 * Requests return the batch id at once; clients poll the batch.
 */
@Injectable()
export class BacktestRunnerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(BacktestRunnerService.name);
  private readonly queue: { batchId: string; job: () => Promise<void> }[] = [];
  private readonly active = new Set<Promise<void>>();
  private stopping = false;

  constructor(
    @InjectRepository(BacktestRunEntity) private readonly runs: Repository<BacktestRunEntity>,
    @InjectRepository(BacktestTradeEntity)
    private readonly trades: Repository<BacktestTradeEntity>,
    private readonly assets: AssetsService,
    private readonly marketData: MarketDataQueryService,
    private readonly catalog: StrategyCatalogService,
    private readonly earnings: EarningsService,
  ) {}

  /** Runs left unfinished by a previous process are never resumed. */
  async onApplicationBootstrap(): Promise<void> {
    await this.runs.update(
      { status: In([BacktestStatus.Pending, BacktestStatus.Running]) },
      { status: BacktestStatus.Failed, error: 'Interrupted by restart', finishedAt: new Date() },
    );
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    this.queue.length = 0;
    await this.whenIdle();
  }

  async whenIdle(): Promise<void> {
    while (this.active.size > 0 || this.queue.length > 0) {
      await Promise.allSettled([...this.active]);
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  /** Every symbol × strategy combination over the full period. */
  async submit(request: BacktestRequest): Promise<SubmitResult> {
    const assets = await Promise.all(request.symbols.map((s) => this.assets.findBySymbol(s)));
    const strategies = request.strategies?.length
      ? await Promise.all(request.strategies.map((s) => this.resolveStrategy(s)))
      : await this.activeStrategies();
    if (strategies.length === 0) throw new InvalidInputError('No strategies to run');
    for (const s of strategies) assertDirection(s.definition, request.direction);

    const batchId = randomUUID();
    const rows: BacktestRunEntity[] = [];
    for (const asset of assets) {
      for (const strategy of strategies) {
        rows.push(this.newRun(batchId, 'run', 'full', asset, strategy, request));
      }
    }
    const saved = await this.runs.save(rows);
    for (const run of saved) {
      this.enqueue(batchId, async () => {
        await this.process(run, (bars) => this.window(bars, period(run)));
      });
    }
    this.logger.debug({ msg: `Backtest batch queued`, batchId, runs: saved.length });
    return { batchId, runs: saved.length };
  }

  /**
   * Runs every grid combination on the train segment, then the best `top` (by train Sharpe)
   * on the test segment. The test segment's indicators warm up on the bars before it.
   */
  async sweep(request: SweepRequest): Promise<SubmitResult> {
    const asset = await this.assets.findBySymbol(request.symbol);
    const base = await this.resolveStrategy(request.strategy);
    assertDirection(base.definition, request.direction);
    const trainRatio = request.trainRatio ?? 0.7;
    splitIndex(100, trainRatio); // throws on an invalid ratio before anything is stored
    const combos = expandGrid(base.params, request.paramGrid).map((raw) =>
      base.definition.validateParams(raw),
    );
    // Grid params are not a stored config.
    const variant = (params: StrategyParams): ResolvedStrategy => ({
      ...base,
      params,
      configId: null,
      configName: null,
    });

    const batchId = randomUUID();
    const train = await this.runs.save(
      combos.map((params) =>
        this.newRun(batchId, 'sweep', 'train', asset, variant(params), request),
      ),
    );
    this.enqueue(batchId, async () => {
      const started = Date.now();
      const bars = await this.loadBars(asset.id);
      const split = (run: BacktestRunEntity): number => {
        const { tradeFrom, bars: windowBars } = this.window(bars, period(run));
        return tradeFrom + splitIndex(windowBars.length - tradeFrom, trainRatio);
      };

      for (const run of train) {
        if (this.stopping) return;
        await this.process(
          run,
          () => {
            const w = this.window(bars, period(run));
            return { bars: w.bars.slice(0, split(run)), tradeFrom: w.tradeFrom };
          },
          bars,
        );
        // Let HTTP requests through between CPU-bound runs.
        await new Promise((resolve) => setImmediate(resolve));
      }

      const best = train
        .filter((r) => r.status === BacktestStatus.Success)
        .sort((a, b) => byDesc(a.metrics?.sharpe, b.metrics?.sharpe))
        .slice(0, request.top ?? DEFAULT_SWEEP_TOP);
      const test = await this.runs.save(
        best.map((r) => this.newRun(batchId, 'sweep', 'test', asset, variant(r.params), request)),
      );
      for (const run of test) {
        if (this.stopping) return;
        await this.process(
          run,
          () => ({ ...this.window(bars, period(run)), tradeFrom: split(run) }),
          bars,
        );
      }
      this.logger.log({
        msg: `Sweep finished`,
        batchId,
        symbol: asset.symbol,
        strategy: base.definition.code,
        combinations: train.length,
        ms: Date.now() - started,
      });
    });
    return { batchId, runs: train.length };
  }

  /**
   * Walk-forward analysis. For each window, every grid combination runs on the
   * train segment in memory; the best one by `metric` runs on the test segment. Test segments run
   * one after another, each starting with the previous one's final equity, and are joined into one
   * out-of-sample run. Stored: per window the selected train run (metrics only) and the test run,
   * and the joined `oos` run with its curve and trades.
   */
  async walkForward(request: WalkForwardRequest): Promise<SubmitResult> {
    const asset = await this.assets.findBySymbol(request.symbol);
    const base = await this.resolveStrategy(request.strategy);
    assertDirection(base.definition, request.direction);
    const combos = expandGrid(base.params, request.paramGrid).map((raw) =>
      base.definition.validateParams(raw),
    );
    const options = {
      windows: request.windows ?? 5,
      trainRatio: request.trainRatio ?? 0.7,
      anchored: request.anchored ?? false,
    };
    const metric = request.metric ?? 'sharpe';
    if (combos.length * options.windows > MAX_WALK_FORWARD_RUNS) {
      throw new InvalidInputError(
        `${combos.length} combinations × ${options.windows} windows is more than ${MAX_WALK_FORWARD_RUNS} backtests; narrow the grid or use fewer windows`,
      );
    }
    // Bars are loaded up front, so an impossible window split is rejected before anything is stored.
    const { bars, tradeFrom } = this.window(await this.loadBars(asset.id), request);
    const windows = walkForwardWindows(tradeFrom, bars.length, options);
    const last = windows[windows.length - 1];

    const batchId = randomUUID();
    const strategy: ResolvedStrategy = { ...base, configId: null, configName: null };
    const iso = (i: number) => bars[i].openTime.toISOString();
    const row = (
      segment: BacktestSegment,
      w: WalkForwardWindow | null,
      from: number,
      to: number,
    ) => {
      const run = this.newRun(batchId, 'walk_forward', segment, asset, strategy, request);
      run.periodFrom = bars[from].openTime;
      run.periodTo = bars[to - 1].openTime;
      run.walkForward = {
        window: w?.index ?? null,
        ...options,
        metric,
        combinations: combos.length,
        trainFrom: iso((w ?? windows[0]).trainFrom),
        testFrom: iso((w ?? windows[0]).testFrom),
        testTo: iso((w ?? last).testTo - 1),
      } satisfies WalkForwardInfo;
      return run;
    };
    const pairs = windows.map((w) => ({
      window: w,
      train: row('train', w, w.trainFrom, w.testFrom),
      test: row('test', w, w.testFrom, w.testTo),
    }));
    const oos = row('oos', null, windows[0].testFrom, last.testTo);
    await this.runs.save([...pairs.flatMap((p) => [p.train, p.test]), oos]);

    this.enqueue(batchId, async () => {
      const started = new Date();
      let capital = Number(oos.initialCapital);
      const results: BacktestResult[] = [];
      const outcomes: WindowOutcome[] = [];
      for (const { window: w, train, test } of pairs) {
        if (this.stopping) return;
        const trainBars = bars.slice(0, w.testFrom);
        const trainPriced = priceBars(trainBars, train.execution.adjustRolls);
        const trainFilter = await this.filterFor(train, trainBars);
        const metrics: (BacktestMetrics | null)[] = [];
        for (const params of combos) {
          metrics.push(
            this.evaluate(
              base.definition,
              params,
              trainPriced.bars,
              w.trainFrom,
              train,
              trainFilter,
            ),
          );
          // Let HTTP requests through between CPU-bound runs.
          await new Promise((resolve) => setImmediate(resolve));
        }
        const best = bestIndex(metrics, metric);
        if (best < 0) throw new Error(`Window ${w.index}: every parameter combination failed`);
        const chosen = metrics[best]!;

        // The selected train run keeps its metrics only (no curve, no trades).
        train.params = combos[best];
        train.status = BacktestStatus.Success;
        train.metrics = {
          ...chosen,
          dataQuality: withRolls(
            dataQuality(trainBars.slice(w.trainFrom)),
            trainPriced.rollsFrom(w.trainFrom),
          ),
        };
        train.startedAt = started;
        train.finishedAt = new Date();
        await this.runs.save(train);

        test.params = combos[best];
        test.initialCapital = capital.toFixed(2);
        const result = await this.process(
          test,
          (loaded) => ({ bars: loaded.slice(0, w.testTo), tradeFrom: w.testFrom }),
          bars,
        );
        if (!result) throw new Error(`Window ${w.index}: test run failed (${test.error})`);
        results.push(result);
        capital = result.equity[result.equity.length - 1].equity;
        outcomes.push({
          trainCagr: chosen.cagr,
          testReturn: test.metrics!.totalReturn,
          params: combos[best],
        });
      }

      // The joined run shows the latest window's params: the ones a live run would use now.
      oos.params = pairs[pairs.length - 1].test.params;
      oos.startedAt = started;
      const rolls = pairs.reduce(
        (n, p) => n + (p.test.metrics?.dataQuality.rollAdjustments ?? 0),
        0,
      );
      await this.store(
        oos,
        stitchResults(results),
        bars.slice(windows[0].testFrom, last.testTo),
        oos.execution.adjustRolls ? rolls : undefined,
      );
      oos.walkForward = {
        ...oos.walkForward!,
        summary: summarize(outcomes, oos.metrics?.cagr ?? null),
      };
      oos.finishedAt = new Date();
      await this.runs.save(oos);
      this.logger.log({
        msg: `Walk-forward finished`,
        batchId,
        symbol: asset.symbol,
        strategy: base.definition.code,
        windows: windows.length,
        combinations: combos.length,
        ms: Date.now() - started.getTime(),
      });
    });
    return { batchId, runs: pairs.length * 2 + 1 };
  }

  /** In-memory backtest for parameter selection; null when the run throws. */
  private evaluate(
    definition: StrategyDefinition,
    params: StrategyParams,
    bars: Bar[],
    tradeFrom: number,
    run: BacktestRunEntity,
    filter: DecisionFilter | undefined,
  ): BacktestMetrics | null {
    try {
      const { execution } = run;
      const result = runBacktest({
        bars,
        runner: definition.createRunner(bars, params),
        initialCapital: Number(run.initialCapital),
        execution,
        sizing: execution.sizing,
        tradeFrom,
        filter,
        direction: execution.direction,
      });
      return computeMetrics(result, { riskFreeRate: execution.riskFreeRate });
    } catch (error) {
      this.logger.debug({ msg: 'Walk-forward train combination failed', params, err: error });
      return null;
    }
  }

  private enqueue(batchId: string, job: () => Promise<void>): void {
    this.queue.push({ batchId, job });
    this.drain();
  }

  private drain(): void {
    while (this.active.size < CONCURRENCY && this.queue.length > 0) {
      const { batchId, job } = this.queue.shift()!;
      const task: Promise<void> = job()
        .catch(async (error: unknown) => {
          this.logger.error({ msg: 'Backtest job failed', batchId, err: error });
          await this.failUnfinished(batchId, error);
        })
        .finally(() => {
          this.active.delete(task);
          this.drain();
        });
      this.active.add(task);
    }
  }

  /**
   * A job that failed outside a single run (bars could not be loaded, the DB was unavailable)
   * would leave its runs pending forever; mark them failed so the batch completes.
   */
  private async failUnfinished(batchId: string, error: unknown): Promise<void> {
    try {
      await this.runs.update(
        { batchId, status: In([BacktestStatus.Pending, BacktestStatus.Running]) },
        {
          status: BacktestStatus.Failed,
          error: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
          finishedAt: new Date(),
        },
      );
    } catch (updateError) {
      this.logger.error({ msg: 'Could not mark backtest runs failed', batchId, err: updateError });
    }
  }

  /**
   * Runs one backtest and stores its result. Failures are recorded on the run, not thrown.
   * Returns the result, or null when the run failed.
   */
  private async process(
    run: BacktestRunEntity,
    selectWindow: (bars: Bar[]) => RunWindow,
    preloaded?: Bar[],
  ): Promise<BacktestResult | null> {
    run.status = BacktestStatus.Running;
    run.startedAt = new Date();
    await this.runs.save(run);
    let result: BacktestResult | null;
    try {
      const definition = this.catalog.definition(run.strategyCode);
      const { bars, tradeFrom } = selectWindow(preloaded ?? (await this.loadBars(run.assetId)));
      const { execution } = run;
      const priced = priceBars(bars, execution.adjustRolls);
      result = runBacktest({
        bars: priced.bars,
        runner: definition.createRunner(priced.bars, run.params),
        initialCapital: Number(run.initialCapital),
        execution,
        sizing: execution.sizing,
        tradeFrom,
        filter: await this.filterFor(run, bars),
        direction: execution.direction,
      });
      await this.store(run, result, bars.slice(tradeFrom), priced.rollsFrom(tradeFrom));
    } catch (error) {
      result = null;
      run.status = BacktestStatus.Failed;
      run.error = error instanceof Error ? error.message : String(error);
      this.logger.error({ msg: 'Backtest run failed', runId: run.id, err: error });
    }
    run.finishedAt = new Date();
    await this.runs.save(run);
    return result;
  }

  /** Sets metrics, curves and status on the run and saves its trades; the run row is not saved. */
  private async store(
    run: BacktestRunEntity,
    result: BacktestResult,
    tradedBars: Bar[],
    rollAdjustments?: number,
  ): Promise<void> {
    const { execution } = run;
    run.metrics = {
      ...computeMetrics(result, { riskFreeRate: execution.riskFreeRate }),
      dataQuality: withRolls(dataQuality(tradedBars), rollAdjustments),
    };
    // 500 train runs × 1000 points would bloat the table; only their metrics are kept.
    const keepCurve = !(run.source === 'sweep' && run.segment === 'train');
    run.equityCurve = keepCurve ? toCurve(result.equity) : null;
    run.benchmarkCurve = keepCurve ? toCurve(result.benchmark) : null;
    run.status = BacktestStatus.Success;

    await this.trades.save(
      result.trades.map((t) =>
        this.trades.create({
          runId: run.id,
          entryTime: t.entryTime,
          entryPrice: t.entryPrice.toNumber(),
          exitTime: t.exitTime,
          exitPrice: t.exitPrice.toNumber(),
          quantity: t.quantity.toFixed(6),
          fees: t.fees.toFixed(6),
          pnl: t.pnl.toFixed(2),
          returnPct: Number(t.returnPct.toFixed(6)),
          side: t.side,
          exitReason: t.exitReason,
          barsHeld: t.barsHeld,
        }),
      ),
      { chunk: 500 },
    );
  }

  /** The run's earnings filter on these bars, when it asks for one. */
  private async filterFor(
    run: BacktestRunEntity,
    bars: Bar[],
  ): Promise<DecisionFilter | undefined> {
    const rule = run.execution.earnings;
    if (!rule) return undefined;
    const { sessionType } = await this.assets.findById(run.assetId);
    return earningsFilter(bars, await this.earnings.reports(run.assetId), rule, sessionType);
  }

  private loadBars(assetId: string): Promise<Bar[]> {
    return this.marketData.getHistory(assetId, '4h', { completeOnly: true });
  }

  /**
   * Bars up to `periodTo`, trading from the first bar at or after `periodFrom`.
   * Earlier bars stay in the series so indicators are warmed up when trading starts.
   */
  private window(bars: Bar[], period: Pick<RunSettings, 'from' | 'to'>): RunWindow {
    const to = period.to?.getTime() ?? Infinity;
    const from = period.from?.getTime() ?? -Infinity;
    const inRange = bars.filter((b) => b.openTime.getTime() <= to);
    const start = inRange.findIndex((b) => b.openTime.getTime() >= from);
    return { bars: inRange, tradeFrom: start < 0 ? inRange.length : start };
  }

  private newRun(
    batchId: string,
    source: BacktestSource,
    segment: BacktestSegment,
    asset: AssetEntity,
    strategy: ResolvedStrategy,
    settings: RunSettings,
  ): BacktestRunEntity {
    const input = settings.execution ?? {};
    const execution: BacktestExecution = {
      // Field by field: a DTO may carry optional keys set to undefined.
      feeBps: input.feeBps ?? DEFAULT_EXECUTION.feeBps,
      slippageBps: input.slippageBps ?? DEFAULT_EXECUTION.slippageBps,
      minFee: input.minFee ?? DEFAULT_EXECUTION.minFee,
      // Only stored when set, so plain runs keep their old shape.
      ...(input.borrowPct ? { borrowPct: input.borrowPct } : {}),
      sizing: toSizing(settings.sizing),
      riskFreeRate: settings.riskFreeRate ?? 0,
      adjustRolls: settings.adjustRolls ?? false,
      ...(settings.earnings ? { earnings: settings.earnings } : {}),
      ...(settings.direction && settings.direction !== 'long'
        ? { direction: settings.direction }
        : {}),
    };
    return this.runs.create({
      batchId,
      source,
      segment,
      assetId: asset.id,
      strategyCode: strategy.definition.code,
      strategyVersion: strategy.definition.version,
      strategyConfigId: strategy.configId,
      configName: strategy.configName,
      params: strategy.params,
      timeframe: '4h',
      periodFrom: settings.from ?? null,
      periodTo: settings.to ?? null,
      initialCapital: String(settings.initialCapital ?? DEFAULT_CAPITAL),
      execution,
      status: BacktestStatus.Pending,
    });
  }

  private async resolveStrategy(selection: StrategySelection): Promise<ResolvedStrategy> {
    if (selection.config) {
      const { config, strategy } = await this.catalog.findConfig(selection.code, selection.config);
      // Overridden params are no longer the stored config.
      const custom = selection.params !== undefined;
      return {
        definition: strategy,
        params: strategy.validateParams({ ...config.params, ...selection.params }),
        configId: custom ? null : config.id,
        configName: custom ? null : config.name,
      };
    }
    const definition = this.catalog.definition(selection.code);
    return {
      definition,
      params: definition.validateParams(selection.params ?? {}),
      configId: null,
      configName: null,
    };
  }

  private async activeStrategies(): Promise<ResolvedStrategy[]> {
    const configs = await this.catalog.activeConfigs();
    return configs.map(({ config, strategy }) => ({
      definition: strategy,
      params: strategy.validateParams(config.params),
      configId: config.id,
      configName: config.name,
    }));
  }
}

/**
 * Bars the engine trades on: roll-adjusted when the run asks for it. Only the
 * selected window is adjusted, so its latest bar keeps real prices. `rollsFrom` counts the rolls
 * removed in the traded part (undefined when not adjusted).
 */
function priceBars(bars: Bar[], adjust: boolean | undefined) {
  if (!adjust) return { bars, rollsFrom: (): number | undefined => undefined };
  const { bars: adjusted, rolls } = adjustRolls(bars);
  return {
    bars: adjusted,
    rollsFrom: (from: number): number | undefined => rolls.filter((i) => i >= from).length,
  };
}

const withRolls = (report: DataQualityReport, rollAdjustments: number | undefined) =>
  rollAdjustments === undefined ? report : { ...report, rollAdjustments };

/** A stored run's requested period in request form. */
const period = (run: BacktestRunEntity): Pick<RunSettings, 'from' | 'to'> => ({
  from: run.periodFrom ?? undefined,
  to: run.periodTo ?? undefined,
});

/** Descending order with missing values last. */
function byDesc(a: number | null | undefined, b: number | null | undefined): number {
  return (b ?? -Infinity) - (a ?? -Infinity) || (a == null ? 1 : 0) - (b == null ? 1 : 0);
}

function toCurve(points: EquityPoint[]): [number, number][] {
  return downsample(points).map((p) => [p.time.getTime(), Number(p.equity.toFixed(2))]);
}

/** Shorts need a strategy with short rules; otherwise the request is rejected, not run long-only. */
function assertDirection(definition: StrategyDefinition, direction: TradeDirection | undefined) {
  if (direction && direction !== 'long' && !definition.canShort) {
    throw new InvalidInputError(`${definition.code} has no short rules; use direction "long"`);
  }
}
