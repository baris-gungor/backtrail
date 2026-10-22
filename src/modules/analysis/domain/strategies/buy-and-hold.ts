import * as Joi from 'joi';
import { defineStrategy } from '../strategy';

/** Benchmark: buy on the first bar and never sell. */
export const buyAndHold = defineStrategy<Record<string, never>>({
  code: 'buy_and_hold',
  version: 1,
  name: 'Benchmark: buy and hold',
  description: 'BUY: buys on the first bar and never sells. Used as a benchmark.',
  isBenchmark: true,
  schema: Joi.object({}),
  warmupBars: () => 0,
  rules: ({ close }) => ({
    entry: (i) =>
      i === 0 ? { strength: 1, reason: 'benchmark entry', indicators: { close: close[0] } } : null,
    exit: () => null,
  }),
});
