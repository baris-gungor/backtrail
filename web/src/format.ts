import { intlLocale, t, te } from './i18n';

// Formatters are cached per locale; a call inside a render reads the current locale, so the text
// follows the language switch.
const cache = new Map<string, Intl.DateTimeFormat | Intl.RelativeTimeFormat>();
const dateTime = (): Intl.DateTimeFormat => {
  const key = `dt:${intlLocale()}`;
  if (!cache.has(key)) {
    cache.set(
      key,
      new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'short', timeStyle: 'short' }),
    );
  }
  return cache.get(key) as Intl.DateTimeFormat;
};
const relative = (): Intl.RelativeTimeFormat => {
  const key = `rt:${intlLocale()}`;
  if (!cache.has(key))
    cache.set(key, new Intl.RelativeTimeFormat(intlLocale(), { numeric: 'auto' }));
  return cache.get(key) as Intl.RelativeTimeFormat;
};

export const fmtDate = (iso: string | null | undefined): string =>
  iso ? dateTime().format(new Date(iso)) : '—';

/** Chart axis and crosshair time in the current locale. */
export const fmtDateTime = (date: Date): string => date.toLocaleString(intlLocale());

export const fmtNum = (value: number | null | undefined, digits = 2): string =>
  value === null || value === undefined
    ? '—'
    : value.toLocaleString(intlLocale(), {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });

/** Ratio as percent: 0.1234 -> "12,34%" (tr) / "12.34%" (en). */
export const fmtPct = (value: number | null | undefined, digits = 2): string =>
  value === null || value === undefined ? '—' : `${fmtNum(value * 100, digits)}%`;

/** Compact params text: "fast=20, slow=50". */
export const paramsText = (params: Record<string, unknown>): string =>
  Object.entries(params)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(', ');

/** Short labels for chart markers and tags (same in every language). */
export const STRATEGY_LABELS: Record<string, string> = {
  trend_ema_adx: 'TREND',
  meanrev_bb_rsi: 'MR',
  momentum_macd_rsi_vol: 'MOM',
  breakout_donchian_atr: 'BO',
  pullback_supertrend_rsi: 'PB',
  buy_and_hold: 'B&H',
};

export const strategyLabel = (code: string): string => STRATEGY_LABELS[code] ?? code;

/** Strategies the UI has names for, in menu order. */
export const STRATEGY_CODES = Object.keys(STRATEGY_LABELS);

/** Translated label of a code, or `fallback` for codes the UI does not know (added later). */
const label = (group: string, code: string, fallback: string = code): string => {
  const key = `labels.${group}.${code}`;
  return te(key) ? t(key) : fallback;
};

/** Readable name: "Kırılım" / "Breakout"; falls back to the code for strategies added later. */
export const strategyName = (code: string): string => label('strategy', code);

/** The indicators behind a strategy: "Donchian + ATR". */
export const strategyMethod = (code: string): string => label('strategyMethod', code, '');

/** "Kırılım (Donchian + ATR)". */
export const strategyFullName = (code: string): string => {
  const method = strategyMethod(code);
  return method ? `${strategyName(code)} (${method})` : strategyName(code);
};

/** The config name, with "default" translated. */
export const configName = (name: string): string =>
  name === 'default' ? t('labels.defaultConfig') : name;

/** "Kırılım · varsayılan"; the config name is left out when there is none. */
export const configLabel = (code: string, name?: string | null): string =>
  name ? `${strategyName(code)} · ${configName(name)}` : strategyName(code);

export const sideLabel = (side: string): string => label('side', side);

export const segmentLabel = (segment: string): string => label('segment', segment);

export const directionLabel = (d: string | null | undefined): string =>
  label('direction', d ?? 'long', String(d));
export const directionOptions = () =>
  (['long', 'short', 'both'] as const).map((value) => ({ label: directionLabel(value), value }));

export const exitReasonLabel = (reason: string | null | undefined): string =>
  reason ? label('exitReason', reason) : '—';

/** "5 dakika önce" / "5 minutes ago"; older than a week falls back to the date. */
export const fmtAgo = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 60) return t('labels.justNow');
  if (abs < 3600) return relative().format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relative().format(Math.round(seconds / 3600), 'hour');
  if (abs < 7 * 86_400) return relative().format(Math.round(seconds / 86_400), 'day');
  return fmtDate(iso);
};

/** Decimal string from the API (money, quantity) formatted like fmtNum. */
export const fmtDec = (value: string | null | undefined, digits = 2): string =>
  value === null || value === undefined ? '—' : fmtNum(Number(value), digits);

/** Green for gains, red for losses (theme tokens from style.css). */
export const pnlColor = (value: number | string | null | undefined): string | undefined =>
  value === null || value === undefined
    ? undefined
    : Number(value) >= 0
      ? 'var(--up)'
      : 'var(--down)';

/**
 * Background for a heat-map cell: green for good, red for bad, stronger towards the extremes.
 * `scale` is the absolute value that gets full color.
 */
export const heatColor = (value: number | null | undefined, scale: number): string | undefined => {
  if (value === null || value === undefined || !Number.isFinite(value) || scale <= 0)
    return undefined;
  const strength = Math.min(1, Math.abs(value) / scale) * 0.55 + 0.08;
  return value >= 0 ? `rgba(38,166,154,${strength})` : `rgba(239,83,80,${strength})`;
};

export const ORDER_STATUSES = ['pending', 'filled', 'cancelled', 'rejected', 'expired'] as const;
export const orderStatusLabel = (status: string): string => label('orderStatus', status);
export const ORDER_STATUS_TAGS = {
  pending: 'info',
  filled: 'success',
  cancelled: 'default',
  rejected: 'error',
  expired: 'default',
} as const;
export const orderSourceLabel = (source: string): string => label('orderSource', source);

export const HEALTH_TAGS = {
  ok: 'success',
  info: 'info',
  warning: 'warning',
  unknown: 'default',
} as const;
export const healthLabel = (level: string): string => label('health', level);

export const assetClassLabel = (assetClass: string): string => label('assetClass', assetClass);

/** Why an order was rejected; unknown reasons (broker messages) are shown as they are. */
export const rejectReasonLabel = (reason: string | null | undefined): string =>
  reason ? label('rejectReason', reason) : '';
