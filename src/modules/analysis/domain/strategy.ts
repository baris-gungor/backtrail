import * as Joi from 'joi';
import { InvalidInputError } from '../../../common/errors/domain.error';
import type { Bar } from '../../market-data/domain/bar';
import type { Series } from './indicators';

export type SignalSide = 'BUY' | 'SELL';

export interface StrategySignal {
  /** openTime of the closed bar that produced the signal */
  barTime: Date;
  side: SignalSide;
  /** 0..1, how strongly the confirmation conditions were met */
  strength: number;
  /** Close of the signal bar. Execution happens at the next bar's open. */
  price: number;
  stopLoss?: number;
  takeProfit?: number;
  reason: string;
  indicators: Record<string, number>;
}

export type StrategyParams = Record<string, unknown>;

/**
 * Non-generic strategy contract used by the registry and services.
 * Strategies are pure: same bars and params give the same signals, and the signal for
 * bar i depends only on bars[0..i] (no look-ahead).
 */
export interface StrategyDefinition {
  readonly code: string;
  /** Increment when the logic changes; stored signals of older versions are regenerated. */
  readonly version: number;
  readonly name: string;
  readonly description: string;
  /** Benchmarks (buy & hold) are for comparison and are inactive for signal generation by default. */
  readonly isBenchmark: boolean;
  readonly defaultParams: StrategyParams;
  /** Joi description of the params, exposed through the API. */
  describeParams(): Joi.Description;
  /** Validates and fills defaults. Throws InvalidInputError. */
  validateParams(raw: unknown): StrategyParams;
  warmupBars(params: StrategyParams): number;
  /** Bars must be closed (isComplete) and sorted ascending. */
  evaluate(bars: Bar[], params: StrategyParams): StrategySignal[];
  /** The strategy has short rules. */
  readonly canShort: boolean;
  /**
   * Bar-by-bar access to the rules, for callers that track the position themselves
   * (the backtest engine closes positions on stop-loss or take-profit, which `evaluate` does not know).
   */
  createRunner(bars: Bar[], params: StrategyParams): StrategyRunner;
}

export interface StrategyRunner extends LongOnlyRules, Partial<ShortRules> {
  /** First bar index the rules may be asked about. */
  readonly warmup: number;
}

export interface PriceSeries {
  bars: Bar[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

export interface EntryDecision {
  strength: number;
  stopLoss?: number;
  takeProfit?: number;
  reason: string;
  indicators: Record<string, number>;
}

export interface ExitDecision {
  reason: string;
  indicators: Record<string, number>;
}

/** Long-only state machine rules. `entry` is asked only when flat, `exit` only when long. */
export interface LongOnlyRules {
  entry(i: number): EntryDecision | null;
  exit(i: number, entryIndex: number): ExitDecision | null;
}

/**
 * Optional mirror rules for short positions. `shortEntry` is asked only when flat
 * (after `entry` returned null), `shortExit` only when short. A short entry's stop is above the
 * price and its take-profit below.
 */
export interface ShortRules {
  shortEntry(i: number): EntryDecision | null;
  shortExit(i: number, entryIndex: number): ExitDecision | null;
}

interface StrategySpec<P extends StrategyParams> {
  code: string;
  version: number;
  name: string;
  description: string;
  isBenchmark?: boolean;
  schema: Joi.ObjectSchema<P>;
  warmupBars(params: P): number;
  rules(series: PriceSeries, params: P): LongOnlyRules & Partial<ShortRules>;
}

/** Builds a StrategyDefinition from typed params and long-only rules. */
export function defineStrategy<P extends StrategyParams>(
  spec: StrategySpec<P>,
): StrategyDefinition {
  const validate = (raw: unknown): P => {
    const result: Joi.ValidationResult<P> = spec.schema.validate(raw ?? {}, {
      abortEarly: false,
      convert: true,
    });
    if (result.error) {
      throw new InvalidInputError(`Invalid params for ${spec.code}: ${result.error.message}`);
    }
    return result.value;
  };

  return {
    code: spec.code,
    version: spec.version,
    name: spec.name,
    description: spec.description,
    isBenchmark: spec.isBenchmark ?? false,
    defaultParams: validate({}),
    describeParams: () => spec.schema.describe(),
    validateParams: validate,
    warmupBars: (params) => spec.warmupBars(validate(params)),
    evaluate: (bars, params) => runLongOnly(bars, createRunner(bars, params)),
    createRunner,
    canShort: Boolean(spec.rules(toSeries([]), validate({})).shortEntry),
  };

  function createRunner(bars: Bar[], params: StrategyParams): StrategyRunner {
    const p = validate(params);
    const rules = spec.rules(toSeries(bars), p);
    const { shortEntry, shortExit } = rules;
    return {
      warmup: spec.warmupBars(p),
      entry: (i) => rules.entry(i),
      exit: (i, entryIndex) => rules.exit(i, entryIndex),
      ...(shortEntry && shortExit
        ? {
            shortEntry: (i: number) => shortEntry(i),
            shortExit: (i: number, entryIndex: number) => shortExit(i, entryIndex),
          }
        : {}),
    };
  }
}

export function toSeries(bars: Bar[]): PriceSeries {
  return {
    bars,
    open: bars.map((b) => b.open),
    high: bars.map((b) => b.high),
    low: bars.map((b) => b.low),
    close: bars.map((b) => b.close),
    volume: bars.map((b) => b.volume),
  };
}

function runLongOnly(bars: Bar[], rules: StrategyRunner): StrategySignal[] {
  const signals: StrategySignal[] = [];
  let entryIndex = -1;

  for (let i = rules.warmup; i < bars.length; i++) {
    const bar = bars[i];
    if (entryIndex < 0) {
      const entry = rules.entry(i);
      if (!entry) continue;
      signals.push({ barTime: bar.openTime, side: 'BUY', price: bar.close, ...entry });
      entryIndex = i;
    } else {
      const exit = rules.exit(i, entryIndex);
      if (!exit) continue;
      signals.push({ barTime: bar.openTime, side: 'SELL', price: bar.close, strength: 1, ...exit });
      entryIndex = -1;
    }
  }
  return signals;
}

// Helpers shared by strategy implementations

/** Returns the values at index i, or null if any of them is still warming up. */
export function at<K extends string>(
  i: number,
  series: Record<K, Series>,
): Record<K, number> | null {
  const out = {} as Record<K, number>;
  for (const key of Object.keys(series) as K[]) {
    const v = series[key][i];
    if (v === null || v === undefined || Number.isNaN(v)) return null;
    out[key] = v;
  }
  return out;
}

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export const round = (x: number, digits = 4): number => Number(x.toFixed(digits));

/** Rounds every value for compact, stable storage in signal metadata. */
export function snapshot(values: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(values)) out[k] = round(v, 6);
  return out;
}

export const intParam = (def: number, min = 1, max = 500) =>
  Joi.number().integer().min(min).max(max).default(def);
export const numParam = (def: number, min = 0, max = 1000) =>
  Joi.number().min(min).max(max).default(def);
