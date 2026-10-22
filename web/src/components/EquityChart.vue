<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  createChart,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useI18n } from 'vue-i18n';
import { useTheme } from '../composables/useTheme';
import { fmtDateTime } from '../format';

/** Curves are [[epochMs, equity], ...] as stored by the backend. */
const props = defineProps<{
  equity: number[][];
  benchmark: number[][] | null;
}>();

const container = ref<HTMLDivElement>();
let chart: IChartApi | undefined;
let strategy: ISeriesApi<'Line'>;
let buyHold: ISeriesApi<'Line'>;
let drawdown: ISeriesApi<'Histogram'>;

const toTime = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;

/**
 * Chart points need strictly ascending times. The engine's starting point (initial capital) and the
 * first bar's mark share the first bar's open time, so keep only the last point per timestamp.
 */
function toPoints(curve: number[][]): { time: UTCTimestamp; value: number }[] {
  const points: { time: UTCTimestamp; value: number }[] = [];
  for (const [t, value] of curve) {
    const time = toTime(t);
    if (points.length && points[points.length - 1].time >= time) points.pop();
    points.push({ time, value });
  }
  return points;
}

function render(): void {
  if (!chart) return;
  const equity = toPoints(props.equity);
  strategy.setData(equity);
  buyHold.setData(toPoints(props.benchmark ?? []));

  // Drawdown from the running peak, in percent (negative).
  let peak = 0;
  drawdown.setData(
    equity.map(({ time, value }) => {
      peak = Math.max(peak, value);
      return { time, value: peak ? (value / peak - 1) * 100 : 0 };
    }),
  );
  chart.timeScale().fitContent();
}

const { chartColors } = useTheme();
const { t, locale } = useI18n();
const themeOptions = () => ({
  layout: { background: { color: 'transparent' }, textColor: chartColors.value.text },
  grid: {
    vertLines: { color: chartColors.value.grid },
    horzLines: { color: chartColors.value.grid },
  },
});
watch(chartColors, (c) => {
  chart?.applyOptions(themeOptions());
  buyHold?.applyOptions({ color: c.benchmark });
  strategy?.applyOptions({ color: c.up });
  drawdown?.applyOptions({ color: c.drawdown });
});

onMounted(() => {
  chart = createChart(container.value!, {
    autoSize: true,
    ...themeOptions(),
    // Curves have up to 1000 points; the default minimum spacing (0.5 px) cannot fit them on a
    // narrow screen, and fitContent then shows only the end of the curve.
    timeScale: { timeVisible: true, secondsVisible: false, minBarSpacing: 0.05 },
    localization: {
      timeFormatter: (time: UTCTimestamp) => fmtDateTime(new Date(time * 1000)),
    },
  });
  strategy = chart.addSeries(LineSeries, {
    color: chartColors.value.up,
    lineWidth: 2,
    title: t('charts.strategy'),
  });
  buyHold = chart.addSeries(LineSeries, {
    color: chartColors.value.benchmark,
    lineWidth: 1,
    lineStyle: 2,
    title: t('labels.strategy.buy_and_hold'),
  });
  drawdown = chart.addSeries(
    HistogramSeries,
    { color: chartColors.value.drawdown, priceFormat: { type: 'percent' }, title: 'Drawdown' },
    1,
  );
  chart.panes()[1]?.setHeight(120);
  render();
});

watch(() => [props.equity, props.benchmark], render);
// Series titles and the time formatter follow the language switch.
watch(locale, () => {
  strategy?.applyOptions({ title: t('charts.strategy') });
  buyHold?.applyOptions({ title: t('labels.strategy.buy_and_hold') });
  chart?.applyOptions({
    localization: { timeFormatter: (time: UTCTimestamp) => fmtDateTime(new Date(time * 1000)) },
  });
});

onBeforeUnmount(() => {
  chart?.remove();
  chart = undefined;
});
</script>

<template>
  <div ref="container" class="chart" />
</template>

<style scoped>
.chart {
  width: 100%;
  height: 460px;
}
</style>
