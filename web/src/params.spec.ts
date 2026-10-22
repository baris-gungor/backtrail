import { describe, expect, it } from 'vitest';
import { gridCombinations, gridRows, paramFields, toParamGrid } from './params';

const schema = {
  keys: {
    fast: {
      type: 'number',
      flags: { default: 20 },
      rules: [{ name: 'integer' }, { name: 'min', args: { limit: 5 } }],
    },
    mult: { type: 'number', flags: { default: 2 }, rules: [{ name: 'max', args: { limit: 3 } }] },
    mode: { type: 'string', flags: { default: 'a' } },
  },
};

describe('paramFields', () => {
  it('reads type, bounds, integer flag and default from the Joi description', () => {
    const [fast, mult] = paramFields(schema);
    expect(fast).toMatchObject({ name: 'fast', min: 5, integer: true, default: 20 });
    expect(mult).toMatchObject({ name: 'mult', max: 3, integer: false });
  });

  it('returns nothing for a schema without keys', () => {
    expect(paramFields({})).toEqual([]);
  });
});

describe('gridRows', () => {
  it('builds disabled rows only for numeric params, clamped to the bounds', () => {
    const rows = gridRows(schema);
    expect(rows.map((r) => r.name)).toEqual(['fast', 'mult']);
    expect(rows.every((r) => !r.enabled)).toBe(true);
    expect(rows[0]).toMatchObject({ min: 10, max: 30, step: 5 });
    expect(rows[1].max).toBe(3);
  });
});

describe('grid', () => {
  it('counts combinations of enabled rows and exports them', () => {
    const rows = gridRows(schema);
    expect(gridCombinations(rows)).toBe(1);
    rows[0].enabled = true;
    expect(gridCombinations(rows)).toBe(5);
    rows[1].enabled = true;
    expect(gridCombinations(rows)).toBe(5 * gridCombinations([rows[1]]));
    expect(Object.keys(toParamGrid(rows))).toEqual(['fast', 'mult']);
    expect(toParamGrid(rows).fast).toEqual({ min: 10, max: 30, step: 5 });
  });
});
