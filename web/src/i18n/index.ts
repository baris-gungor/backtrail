import { watchEffect } from 'vue';
import { createI18n } from 'vue-i18n';
import en from './locales/en';
import tr from './locales/tr';

export type Locale = 'tr' | 'en';
export const LOCALES: readonly Locale[] = ['tr', 'en'];

const STORAGE_KEY = 'backtrail-locale';

/** Stored choice first, then the browser language: Turkish browsers get tr, everyone else en. */
export function initialLocale(stored: string | null, browser: string | undefined): Locale {
  if (stored === 'tr' || stored === 'en') return stored;
  return browser?.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage can be blocked (or missing in tests); fall back to the browser language.
    return null;
  }
}

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale(readStored(), globalThis.navigator?.language),
  fallbackLocale: 'en',
  messages: { tr, en },
});

/** Current locale; reading it inside a render or computed makes that reactive. */
export const currentLocale = (): Locale => i18n.global.locale.value as Locale;

/** BCP 47 tag for Intl formatters. */
export const intlLocale = (): string => (currentLocale() === 'tr' ? 'tr-TR' : 'en-US');

/** `t` / `te` outside components (format helpers, table column factories). */
export const t = i18n.global.t;
export const te = (key: string): boolean => i18n.global.te(key);

if (typeof document !== 'undefined') {
  watchEffect(() => {
    document.documentElement.lang = currentLocale();
    try {
      localStorage.setItem(STORAGE_KEY, currentLocale());
    } catch {
      // Not persisted; the choice still holds for this tab.
    }
  });
}

export function setLocale(locale: Locale): void {
  i18n.global.locale.value = locale;
}
