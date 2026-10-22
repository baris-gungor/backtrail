import { describe, expect, it } from 'vitest';
import { initialLocale } from './i18n';
import en from './i18n/locales/en';
import tr from './i18n/locales/tr';

type Tree = { [key: string]: string | Tree };

/** "a.b.c" -> message for every leaf. */
function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

const placeholders = (message: string) =>
  [...message.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

const trMessages = flatten(tr as Tree);
const enMessages = flatten(en as Tree);

describe('initialLocale', () => {
  it('prefers the stored choice, then the browser language, then English', () => {
    expect(initialLocale('en', 'tr-TR')).toBe('en');
    expect(initialLocale('tr', 'en-US')).toBe('tr');
    expect(initialLocale(null, 'tr-TR')).toBe('tr');
    expect(initialLocale(null, 'tr')).toBe('tr');
    expect(initialLocale(null, 'de-DE')).toBe('en');
    expect(initialLocale('xx', undefined)).toBe('en');
  });
});

describe('messages', () => {
  it('have the same keys in both languages', () => {
    expect([...enMessages.keys()].sort()).toEqual([...trMessages.keys()].sort());
  });

  it('use the same placeholders in both languages', () => {
    for (const [key, message] of trMessages) {
      expect(placeholders(enMessages.get(key) ?? ''), key).toEqual(placeholders(message));
    }
  });

  it('exist for every literal key used in the source', () => {
    const sources = import.meta.glob(['./**/*.vue', './**/*.ts', '!./**/*.spec.ts'], {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    const used = new Set<string>();
    for (const text of Object.values(sources) as string[]) {
      for (const m of text.matchAll(/\bt\(\s*'([\w.]+)'/g)) used.add(m[1]);
      for (const m of text.matchAll(/keypath="([\w.]+)"/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(100);
    const missing = [...used].filter((key) => !trMessages.has(key));
    expect(missing).toEqual([]);
  });
});
