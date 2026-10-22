import { computed } from 'vue';
import { dateEnUS, dateTrTR, enUS, trTR } from 'naive-ui';
import { currentLocale, setLocale } from '../i18n';

/** The UI language for the header switch and NConfigProvider (Naive UI's own texts). */
export function useLocale() {
  return {
    locale: computed(currentLocale),
    naiveLocale: computed(() => (currentLocale() === 'tr' ? trTR : enUS)),
    naiveDateLocale: computed(() => (currentLocale() === 'tr' ? dateTrTR : dateEnUS)),
    setLocale,
  };
}
