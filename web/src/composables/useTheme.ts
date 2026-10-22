import { computed, ref, watchEffect } from 'vue';

export type ThemeName = 'light' | 'dark';

const STORAGE_KEY = 'backtrail-theme';

function initial(): ThemeName {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // Storage can be blocked; fall back to the system preference.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Shared across the app: the header toggle, NConfigProvider and the charts read the same value.
const theme = ref<ThemeName>(initial());

watchEffect(() => {
  document.documentElement.dataset.theme = theme.value;
  try {
    localStorage.setItem(STORAGE_KEY, theme.value);
  } catch {
    // Not persisted; the choice still holds for this tab.
  }
});

/** Colors lightweight-charts needs as plain values (it cannot read CSS variables). */
export interface ChartColors {
  text: string;
  grid: string;
  benchmark: string;
  /** Same hues as the --up / --down tokens in style.css. */
  up: string;
  down: string;
  volumeUp: string;
  volumeDown: string;
  drawdown: string;
  /** The still-open bar. */
  incomplete: string;
}

const CHART_COLORS: Record<ThemeName, ChartColors> = {
  dark: {
    text: '#ccc',
    grid: '#2a2a2a',
    benchmark: '#9e9e9e',
    up: '#63e2b7',
    down: '#e88080',
    volumeUp: 'rgba(99,226,183,0.3)',
    volumeDown: 'rgba(232,128,128,0.3)',
    drawdown: 'rgba(232,128,128,0.5)',
    incomplete: '#666',
  },
  light: {
    text: '#333639',
    grid: '#ececf0',
    benchmark: '#8a8f98',
    up: '#18a058',
    down: '#d03050',
    volumeUp: 'rgba(24,160,88,0.3)',
    volumeDown: 'rgba(208,48,80,0.3)',
    drawdown: 'rgba(208,48,80,0.45)',
    incomplete: '#b5b8bf',
  },
};

export function useTheme() {
  return {
    theme,
    isDark: computed(() => theme.value === 'dark'),
    chartColors: computed(() => CHART_COLORS[theme.value]),
    toggle: () => {
      theme.value = theme.value === 'dark' ? 'light' : 'dark';
    },
  };
}
