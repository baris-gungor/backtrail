import { currentLocale } from './i18n';
import en from './i18n/glossary/en';
import tr from './i18n/glossary/tr';

/**
 * Plain-language explanations for the terms shown in the UI (`<Term k="sharpe">`), and the
 * thresholds behind the good / fair / weak badges (`rate`). Thresholds are rules of thumb for
 * 4h swing strategies, not hard limits; the tooltip shows them so the user can judge.
 * The texts live in `i18n/glossary/{tr,en}.ts`.
 */
export interface GlossaryEntry {
  title: string;
  text: string;
  /** Human-readable thresholds shown under the text, in good / fair / weak order. */
  scale?: [string, string, string];
}

export const GLOSSARIES = { tr, en };

/** The entry of a term in the current language, or undefined for unknown keys. */
export const glossaryEntry = (key: string): GlossaryEntry | undefined =>
  (GLOSSARIES[currentLocale()] as Record<string, GlossaryEntry>)[key];

export type Rating = 'good' | 'fair' | 'weak';

/** [good-at-or-above, weak-below] for "higher is better" metrics; reversed for drawdown. */
const THRESHOLDS: Record<string, { good: number; weak: number; lowerIsBetter?: boolean }> = {
  sharpe: { good: 1, weak: 0 },
  sortino: { good: 1.5, weak: 0 },
  calmar: { good: 1, weak: 0.3 },
  profitFactor: { good: 1.5, weak: 1 },
  alpha: { good: 0, weak: -0.05 },
  maxDrawdown: { good: 0.1, weak: 0.25, lowerIsBetter: true },
  wfe: { good: 0.5, weak: 0 },
  profitableWindows: { good: 0.6, weak: 0.4 },
};

/** Badge for a metric value, or null when the metric has no thresholds or no value. */
export function rate(metric: string, value: number | null | undefined): Rating | null {
  const t = THRESHOLDS[metric];
  if (!t || value === null || value === undefined || !Number.isFinite(value)) return null;
  if (t.lowerIsBetter) {
    const v = Math.abs(value);
    return v < t.good ? 'good' : v <= t.weak ? 'fair' : 'weak';
  }
  return value > t.good ? 'good' : value >= t.weak ? 'fair' : 'weak';
}

export const RATING_TAG = { good: 'success', fair: 'warning', weak: 'error' } as const;
