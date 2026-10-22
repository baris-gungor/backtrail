import { beforeEach, describe, expect, it } from 'vitest';
import {
  configLabel,
  exitReasonLabel,
  fmtDec,
  fmtNum,
  fmtPct,
  heatColor,
  paramsText,
  pnlColor,
  strategyFullName,
  strategyName,
} from './format';
import { setLocale } from './i18n';

// Turkish unless a test switches; the English cases are at the end.
beforeEach(() => setLocale('tr'));

describe('number formatting', () => {
  it('formats with Turkish separators', () => {
    expect(fmtNum(1234.5)).toBe('1.234,50');
    expect(fmtPct(0.1234)).toBe('12,34%');
  });

  it('shows a dash for missing values', () => {
    expect(fmtNum(null)).toBe('—');
    expect(fmtPct(undefined)).toBe('—');
    expect(fmtDec(null)).toBe('—');
  });

  it('formats decimal strings from the API', () => {
    expect(fmtDec('1234.5')).toBe('1.234,50');
    expect(fmtDec('0.123456', 4)).toBe('0,1235');
  });
});

describe('pnlColor', () => {
  it('uses theme tokens, never fixed colors', () => {
    expect(pnlColor(5)).toBe('var(--up)');
    expect(pnlColor('-3.2')).toBe('var(--down)');
    expect(pnlColor(0)).toBe('var(--up)');
    expect(pnlColor(null)).toBeUndefined();
  });
});

describe('labels', () => {
  it('names known strategies and falls back to the code', () => {
    expect(strategyName('trend_ema_adx')).toBe('Trend');
    expect(strategyName('new_one')).toBe('new_one');
    expect(strategyFullName('breakout_donchian_atr')).toBe('Kırılım (Donchian + ATR)');
  });

  it('shows the default config as "varsayılan" and omits an empty one', () => {
    expect(configLabel('trend_ema_adx', 'default')).toBe('Trend · varsayılan');
    expect(configLabel('trend_ema_adx', 'fast')).toBe('Trend · fast');
    expect(configLabel('trend_ema_adx', null)).toBe('Trend');
  });

  it('labels exit reasons', () => {
    expect(exitReasonLabel('stop_loss')).toBe('stop');
    expect(exitReasonLabel('other')).toBe('other');
    expect(exitReasonLabel(null)).toBe('—');
  });

  it('joins params', () => {
    expect(paramsText({ fast: 20, slow: 50 })).toBe('fast=20, slow=50');
  });
});

describe('heatColor', () => {
  it('is empty without a usable value or scale', () => {
    expect(heatColor(null, 1)).toBeUndefined();
    expect(heatColor(Number.NaN, 1)).toBeUndefined();
    expect(heatColor(1, 0)).toBeUndefined();
  });

  it('gets stronger with the value and caps at the scale', () => {
    const alpha = (c: string | undefined) => Number(/,([\d.]+)\)$/.exec(c ?? '')?.[1]);
    expect(alpha(heatColor(0.5, 1))).toBeLessThan(alpha(heatColor(1, 1)));
    expect(heatColor(5, 1)).toBe(heatColor(1, 1));
    expect(heatColor(-1, 1)).toContain('239,83,80');
  });
});

describe('English', () => {
  beforeEach(() => setLocale('en'));

  it('formats with English separators', () => {
    expect(fmtNum(1234.5)).toBe('1,234.50');
    expect(fmtPct(0.1234)).toBe('12.34%');
    expect(fmtDec('0.123456', 4)).toBe('0.1235');
  });

  it('uses English labels', () => {
    expect(strategyFullName('breakout_donchian_atr')).toBe('Breakout (Donchian + ATR)');
    expect(configLabel('trend_ema_adx', 'default')).toBe('Trend · default');
    expect(exitReasonLabel('take_profit')).toBe('target');
    expect(strategyName('new_one')).toBe('new_one');
  });
});
