/** Subset of Joi's `describe()` output that strategy param schemas use. */
interface JoiKey {
  type: string;
  flags?: { default?: unknown };
  rules?: { name: string; args?: { limit?: number } }[];
}

export interface ParamField {
  name: string;
  type: string;
  min?: number;
  max?: number;
  integer: boolean;
  default: unknown;
}

/** Form fields from a strategy's `paramsSchema`. */
export function paramFields(schema: Record<string, unknown>): ParamField[] {
  return Object.entries((schema.keys ?? {}) as Record<string, JoiKey>).map(([name, key]) => {
    const rule = (n: string) => key.rules?.find((r) => r.name === n)?.args?.limit;
    return {
      name,
      type: key.type,
      min: rule('min'),
      max: rule('max'),
      integer: !!key.rules?.some((r) => r.name === 'integer'),
      default: key.flags?.default,
    };
  });
}

/** One numeric param of a parameter grid form (sweep, walk-forward). */
export interface GridRow {
  name: string;
  enabled: boolean;
  min: number;
  max: number;
  step: number;
  integer: boolean;
}

/** Numeric params with a default, as disabled grid rows around the default (±2 steps). */
export function gridRows(schema: Record<string, unknown>): GridRow[] {
  return paramFields(schema)
    .filter((f) => f.type === 'number' && typeof f.default === 'number')
    .map((f) => {
      const def = f.default as number;
      const step = f.integer ? Math.max(1, Math.round(def / 4)) : Number((def / 4).toFixed(2));
      return {
        name: f.name,
        enabled: false,
        min: Math.max(f.min ?? -Infinity, def - 2 * step),
        max: Math.min(f.max ?? Infinity, def + 2 * step),
        step,
        integer: f.integer,
      };
    });
}

export const gridCombinations = (rows: GridRow[]): number =>
  rows
    .filter((g) => g.enabled)
    .reduce((n, g) => n * (g.step > 0 ? Math.floor((g.max - g.min) / g.step + 1e-9) + 1 : 1), 1);

/** The API's `paramGrid` from the enabled rows. */
export const toParamGrid = (rows: GridRow[]) =>
  Object.fromEntries(
    rows.filter((g) => g.enabled).map((g) => [g.name, { min: g.min, max: g.max, step: g.step }]),
  );
