import { ValueTransformer } from 'typeorm';

/**
 * Postgres returns `numeric` as string. Use this only for market prices and volumes,
 * where JS number precision is enough. Money (cash, PnL) must stay decimal.
 */
export const numericToNumber: ValueTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};
