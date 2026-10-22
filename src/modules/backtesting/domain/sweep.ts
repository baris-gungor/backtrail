import { InvalidInputError } from '../../../common/errors/domain.error';
import type { StrategyParams } from '../../analysis/domain/strategy';

/** Inclusive numeric range, or an explicit list of values. */
export type ParamRange = { min: number; max: number; step: number } | (number | string | boolean)[];

export const MAX_SWEEP_COMBINATIONS = 500;

export function rangeValues(range: ParamRange): (number | string | boolean)[] {
  if (Array.isArray(range)) return range;
  const { min, max, step } = range;
  if (!(step > 0) || max < min) {
    throw new InvalidInputError(`Invalid range: min ${min}, max ${max}, step ${step}`);
  }
  const values: number[] = [];
  // Index-based steps avoid float drift (0.1 + 0.2 ...).
  for (let k = 0; ; k++) {
    const v = Number((min + k * step).toFixed(10));
    if (v > max + 1e-9) break;
    values.push(v);
    if (values.length > MAX_SWEEP_COMBINATIONS) break;
  }
  return values;
}

/** Cartesian product of the grid on top of `base` params. */
export function expandGrid(
  base: StrategyParams,
  grid: Record<string, ParamRange>,
  limit = MAX_SWEEP_COMBINATIONS,
): StrategyParams[] {
  let combos: StrategyParams[] = [{ ...base }];
  for (const [key, range] of Object.entries(grid)) {
    const values = rangeValues(range);
    if (values.length === 0) throw new InvalidInputError(`Empty value list for ${key}`);
    if (combos.length * values.length > limit) {
      throw new InvalidInputError(
        `Parameter grid has more than ${limit} combinations; narrow the ranges`,
      );
    }
    combos = combos.flatMap((combo) => values.map((v) => ({ ...combo, [key]: v })));
  }
  return combos;
}

/** Index of the first test bar: the first `trainRatio` share of bars is the train segment. */
export function splitIndex(barCount: number, trainRatio: number): number {
  if (!(trainRatio > 0 && trainRatio < 1)) {
    throw new InvalidInputError('trainRatio must be between 0 and 1');
  }
  return Math.floor(barCount * trainRatio);
}
