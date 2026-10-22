<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineData,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Bar, IndicatorPoint, Signal } from '../api/client';
import { useI18n } from 'vue-i18n';
import { fmtDateTime, strategyLabel } from '../format';
import { useTheme } from '../composables/useTheme';

export type Overlay = 'ema' | 'bb' | 'supertrend' | 'rsi';

const props = defineProps<{
  bars: Bar[];
  points: IndicatorPoint[];
  signals: Signal[];
  overlays: Overlay[];
}>();

const container = ref<HTMLDivElement>();
let chart: IChartApi | undefined;
let candles: ISeriesApi<'Candlestick'>;
let volume: ISeriesApi<'Histogram'>;
let markers: ISeriesMarkersPluginApi<Time>;
const lines = new Map<string, ISeriesApi<'Line'>>();

const toTime = (iso: string) => Math.floor(new Date(iso).getTime() / 1000) as UTCTimestamp;

/** Indicator lines: key in IndicatorPoint, overlay group, color, pane (0 = price, 1 = RSI). */
const LINES: { key: keyof IndicatorPoint; group: Overlay; color: string; pane: number }[] = [
  { key: 'ema20', group: 'ema', color: '#f5c542', pane: 0 },
  { key: 'ema50', group: 'ema', color: '#42a5f5', pane: 0 },
  { key: 'ema200', group: 'ema', color: '#ab47bc', pane: 0 },
  { key: 'bbUpper', group: 'bb', color: '#78909c', pane: 0 },
  { key: 'bbMiddle', group: 'bb', color: '#546e7a', pane: 0 },
  { key: 'bbLower', group: 'bb', color: '#78909c', pane: 0 },
  { key: 'supertrend', group: 'supertrend', color: '#ff7043', pane: 0 },
  { key: 'rsi14', group: 'rsi', color: '#26c6da', pane: 1 },
];

const { chartColors } = useTheme();
const candleColors = () => ({
  upColor: chartColors.value.up,
  downColor: chartColors.value.down,
  wickUpColor: chartColors.value.up,
  wickDownColor: chartColors.value.down,
});

function render(): void {
  if (!chart) return;
  candles.setData(
    props.bars.map((b) => ({
      time: toTime(b.openTime),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      // The still-open bar is drawn faded: signals never use it.
      ...(b.isComplete
        ? {}
        : {
            color: chartColors.value.incomplete,
            wickColor: chartColors.value.incomplete,
            borderColor: chartColors.value.incomplete,
          }),
    })),
  );
  volume.setData(
    props.bars.map((b) => ({
      time: toTime(b.openTime),
      value: b.volume,
      color: b.close >= b.open ? chartColors.value.volumeUp : chartColors.value.volumeDown,
    })),
  );

  for (const line of LINES) {
    const visible = props.overlays.includes(line.group);
    let series = lines.get(line.key);
    if (!visible) {
      if (series) {
        chart.removeSeries(series);
        lines.delete(line.key);
      }
      continue;
    }
    series ??= chart.addSeries(
      LineSeries,
      {
        color: line.color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        // Supertrend flips sides, so it is drawn as dots rather than a connected line.
        ...(line.key === 'supertrend'
          ? { lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 1 }
          : {}),
      },
      line.pane,
    );
    lines.set(line.key, series);
    const data: LineData[] = props.points.flatMap((p) => {
      const value = p[line.key];
      return typeof value === 'number' ? [{ time: toTime(p.openTime), value }] : [];
    });
    series.setData(data);
  }

  const marks: SeriesMarker<Time>[] = props.signals
    .map((s) => ({
      time: toTime(s.barTime),
      position: s.side === 'BUY' ? ('belowBar' as const) : ('aboveBar' as const),
      shape: s.side === 'BUY' ? ('arrowUp' as const) : ('arrowDown' as const),
      color: s.side === 'BUY' ? chartColors.value.up : chartColors.value.down,
      text: strategyLabel(s.strategy),
    }))
    .sort((a, b) => a.time - b.time);
  markers.setMarkers(marks);
}

const themeOptions = () => ({
  layout: { background: { color: 'transparent' }, textColor: chartColors.value.text },
  grid: {
    vertLines: { color: chartColors.value.grid },
    horzLines: { color: chartColors.value.grid },
  },
});
watch(chartColors, () => {
  chart?.applyOptions(themeOptions());
  candles?.applyOptions(candleColors());
  render();
});

onMounted(() => {
  chart = createChart(container.value!, {
    autoSize: true,
    ...themeOptions(),
    timeScale: { timeVisible: true, secondsVisible: false },
    localization: {
      timeFormatter: (time: UTCTimestamp) => fmtDateTime(new Date(time * 1000)),
    },
  });
  candles = chart.addSeries(CandlestickSeries, {
    ...candleColors(),
    borderVisible: false,
  });
  volume = chart.addSeries(HistogramSeries, {
    priceScaleId: 'volume',
    priceFormat: { type: 'volume' },
  });
  chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
  markers = createSeriesMarkers(candles, []);
  render();
  chart.timeScale().fitContent();
});

watch(() => [props.bars, props.points, props.signals, props.overlays], render);
// The crosshair time follows the language switch.
const { locale } = useI18n();
watch(locale, () =>
  chart?.applyOptions({
    localization: { timeFormatter: (time: UTCTimestamp) => fmtDateTime(new Date(time * 1000)) },
  }),
);
// A new asset (not a refresh of the same one) resets the visible range.
watch(
  () => props.bars[0]?.openTime,
  () => chart?.timeScale().fitContent(),
);

onBeforeUnmount(() => chart?.remove());
</script>

<template>
  <div ref="container" class="chart" />
</template>

<style scoped>
.chart {
  width: 100%;
  height: 520px;
}
</style>
