import { describe, expect, it } from 'vitest';
import { GLOSSARIES, rate } from './glossary';

describe('rate', () => {
  it('rates higher-is-better metrics (thresholds are exclusive above, inclusive below)', () => {
    expect(rate('sharpe', 1.5)).toBe('good');
    expect(rate('sharpe', 1)).toBe('fair');
    expect(rate('sharpe', 0)).toBe('fair');
    expect(rate('sharpe', -0.1)).toBe('weak');
  });

  it('rates drawdown by its absolute value, lower is better', () => {
    expect(rate('maxDrawdown', -0.05)).toBe('good');
    expect(rate('maxDrawdown', -0.2)).toBe('fair');
    expect(rate('maxDrawdown', -0.4)).toBe('weak');
  });

  it('returns null for unknown metrics and missing values', () => {
    expect(rate('nope', 1)).toBeNull();
    expect(rate('sharpe', null)).toBeNull();
    expect(rate('sharpe', Number.NaN)).toBeNull();
  });
});

describe('glossary', () => {
  it('has a title and text for every term in every language', () => {
    for (const [locale, glossary] of Object.entries(GLOSSARIES)) {
      for (const [key, entry] of Object.entries(glossary)) {
        expect(entry.title, `${locale}.${key}`).toBeTruthy();
        expect(entry.text, `${locale}.${key}`).toBeTruthy();
      }
    }
  });

  it('has the same terms and scales in both languages', () => {
    expect(Object.keys(GLOSSARIES.en).sort()).toEqual(Object.keys(GLOSSARIES.tr).sort());
    for (const [key, entry] of Object.entries(GLOSSARIES.tr)) {
      const en = GLOSSARIES.en[key as keyof typeof GLOSSARIES.en];
      expect(Boolean(en.scale), key).toBe('scale' in entry);
    }
  });
});
