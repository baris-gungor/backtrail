/**
 * Indicator output: same length as the input, `null` while the indicator is warming up.
 */
export type Series = (number | null)[];

export const nulls = (length: number): Series => new Array<number | null>(length).fill(null);

/** Index of the first non-null value, or -1. */
export function firstValid(values: Series): number {
  return values.findIndex((v) => v !== null);
}
