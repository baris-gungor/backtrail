<script setup lang="ts">
import { computed, h, ref } from 'vue';
import { I18nT, useI18n } from 'vue-i18n';
import { RouterLink, useRouter } from 'vue-router';
import {
  NAlert,
  NButton,
  NCheckbox,
  NDataTable,
  NInputNumber,
  NProgress,
  NSelect,
  useMessage,
  type DataTableColumns,
} from 'naive-ui';
import { api, call, errorMessage, type BacktestRun, type Strategy } from '../api/client';
import { useAssets } from '../composables/useAssets';
import { useBatch } from '../composables/useBatch';
import { fmtDate, fmtNum, fmtPct, pnlColor, strategyFullName } from '../format';
import { gridCombinations, gridRows, toParamGrid, type GridRow } from '../params';
import EmptyState from './EmptyState.vue';
import MetricCard from './MetricCard.vue';
import ParamGridForm from './ParamGridForm.vue';
import Term from './Term.vue';

/** Same limit as the API (MAX_WALK_FORWARD_RUNS): combinations × windows. */
const MAX_RUNS = 2000;

const props = defineProps<{
  strategies: Strategy[];
  /** Shared run settings of the backtest page (period, capital, costs, sizing). */
  settings: () => Record<string, unknown>;
}>();

const message = useMessage();
const { t } = useI18n();
const router = useRouter();
const { assets } = useAssets();

const symbol = ref<string | null>(null);
const strategy = ref<string | null>(null);
const windows = ref(5);
const trainRatio = ref(0.7);
const anchored = ref(false);
type Metric = 'sharpe' | 'sortino' | 'calmar' | 'totalReturn' | 'profitFactor';
const metric = ref<Metric>('sharpe');
const grid = ref<GridRow[]>([]);

const symbolOptions = computed(() =>
  assets.value.map((a) => ({ label: a.symbol, value: a.symbol })),
);
const strategyOptions = computed(() =>
  props.strategies
    .filter((s) => !s.isBenchmark)
    .map((s) => ({ label: strategyFullName(s.code), value: s.code })),
);
const metricOptions = computed(() =>
  (['sharpe', 'sortino', 'calmar', 'totalReturn', 'profitFactor'] as const).map((value) => ({
    label: t(`matrix.metrics.${value}`),
    value,
  })),
);

function onStrategy(code: string | null): void {
  strategy.value = code;
  const s = props.strategies.find((x) => x.code === code);
  grid.value = s ? gridRows(s.paramsSchema) : [];
}

const combinations = computed(() => gridCombinations(grid.value));
const totalRuns = computed(() => combinations.value * windows.value);

// Result.
const train = ref<BacktestRun[]>([]);
const test = ref<BacktestRun[]>([]);
const oos = ref<BacktestRun>();
const running = ref(false);
const batch = useBatch((b) => {
  const byWindow = (segment: string) =>
    b.runs
      .filter((r) => r.segment === segment)
      .sort((x, y) => (x.walkForward?.window ?? 0) - (y.walkForward?.window ?? 0));
  train.value = byWindow('train');
  test.value = byWindow('test');
  oos.value = b.runs.find((r) => r.segment === 'oos');
  if (b.failed)
    message.error(t('walkForward.failed', { error: b.runs.find((r) => r.error)?.error ?? '' }));
  else message.success(t('walkForward.done'));
});
const progress = computed(() => {
  const b = batch.batch.value;
  return b ? Math.round(((b.success + b.failed) / Math.max(b.total, 1)) * 100) : 0;
});

async function start(): Promise<void> {
  if (!symbol.value || !strategy.value) return;
  running.value = true;
  train.value = [];
  test.value = [];
  oos.value = undefined;
  try {
    const { batchId } = await call(
      api.POST('/api/backtests/walk-forward', {
        body: {
          ...props.settings(),
          symbol: symbol.value,
          strategy: { code: strategy.value },
          paramGrid: toParamGrid(grid.value),
          windows: windows.value,
          trainRatio: trainRatio.value,
          anchored: anchored.value,
          metric: metric.value,
        },
      }),
    );
    await batch.poll(batchId);
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    running.value = false;
  }
}

const summary = computed(() => oos.value?.walkForward?.summary);
const m = computed(() => oos.value?.metrics ?? undefined);
/** Only the scanned params differ between windows; the rest are the strategy defaults. */
const scanned = computed(() => grid.value.filter((g) => g.enabled).map((g) => g.name));

interface WindowRow {
  index: number;
  train: BacktestRun;
  test?: BacktestRun;
}
const rows = computed<WindowRow[]>(() =>
  train.value.map((t, i) => ({ index: i + 1, train: t, test: test.value[i] })),
);
const signed = (v: number | null | undefined, text: string) =>
  h('span', { style: { color: pnlColor(v) } }, text);
const period = (r: BacktestRun | undefined) =>
  r ? `${fmtDate(r.periodFrom)} – ${fmtDate(r.periodTo)}` : '—';

const columns = computed<DataTableColumns<WindowRow>>(() => [
  { title: '#', key: 'index', width: 40 },
  { title: t('matrix.train'), key: 'train', render: (r) => period(r.train) },
  { title: t('matrix.test'), key: 'test', render: (r) => period(r.test) },
  {
    title: t('walkForward.chosenParams'),
    key: 'params',
    render: (r) =>
      scanned.value.length
        ? scanned.value.map((k) => `${k}=${String(r.train.params[k])}`).join(', ')
        : t('labels.defaultConfig'),
  },
  {
    title: () => h(Term, { k: 'cagr' }, () => t('walkForward.trainCagr')),
    key: 'trainCagr',
    render: (r) => signed(r.train.metrics?.cagr, fmtPct(r.train.metrics?.cagr)),
  },
  {
    title: t('walkForward.testReturn'),
    key: 'testReturn',
    render: (r) => signed(r.test?.metrics?.totalReturn, fmtPct(r.test?.metrics?.totalReturn)),
  },
  {
    title: () => h(Term, { k: 'sharpe' }, () => 'Test Sharpe'),
    key: 'testSharpe',
    render: (r) => fmtNum(r.test?.metrics?.sharpe),
  },
  {
    title: t('reports.stats.trades'),
    key: 'trades',
    render: (r) => String(r.test?.metrics?.trades ?? '—'),
  },
]);
</script>

<template>
  <div class="stack" style="--gap: 12px">
    <I18nT keypath="walkForward.intro" tag="span" class="hint">
      <template #wf><Term k="walkForward">Walk-forward</Term></template>
      <template #oos><Term k="oos">out-of-sample</Term></template>
    </I18nT>
    <div class="hstack">
      <NSelect
        v-model:value="symbol"
        :options="symbolOptions"
        :placeholder="t('trades.symbol')"
        style="width: 140px"
      />
      <NSelect
        :value="strategy"
        :options="strategyOptions"
        :placeholder="t('trades.strategy')"
        style="width: 300px"
        @update:value="onStrategy"
      />
    </div>
    <div class="hstack">
      <span>{{ t('walkForward.windows') }}</span>
      <NInputNumber v-model:value="windows" :min="2" :max="20" style="width: 90px" />
      <Term k="segment">{{ t('walkForward.trainRatio') }}</Term>
      <NInputNumber
        v-model:value="trainRatio"
        :min="0.3"
        :max="0.95"
        :step="0.05"
        style="width: 90px"
      />
      <span>{{ t('walkForward.metric') }}</span>
      <NSelect v-model:value="metric" :options="metricOptions" style="width: 150px" />
      <NCheckbox v-model:checked="anchored"
        ><Term k="anchored">{{ t('walkForward.anchored') }}</Term></NCheckbox
      >
    </div>

    <ParamGridForm :rows="grid" />

    <div class="hstack">
      <NButton
        type="primary"
        :loading="running"
        :disabled="!symbol || !strategy || totalRuns > MAX_RUNS"
        @click="start"
      >
        {{ t('walkForward.start') }}
      </NButton>
      <span :class="{ error: totalRuns > MAX_RUNS }">
        {{ t('walkForward.runCount', { combinations, windows, total: totalRuns, max: MAX_RUNS }) }}
      </span>
    </div>
    <span v-if="combinations === 1" class="hint">{{ t('walkForward.noScan') }}</span>
    <NProgress v-if="running && batch.batch.value" type="line" :percentage="progress" />

    <template v-if="oos && m">
      <NAlert type="info" :show-icon="false">
        {{ t('walkForward.stitched', { n: test.length }) }}
        <RouterLink :to="`/backtests/${oos.id}`">{{ t('walkForward.openOos') }}</RouterLink>
      </NAlert>
      <div class="grid-cards" style="--min: 170px">
        <MetricCard
          :label="t('walkForward.oosReturn')"
          term="oos"
          :value="fmtPct(m.totalReturn)"
          :color="pnlColor(m.totalReturn)"
          :sub="`${t('labels.strategy.buy_and_hold')}: ${fmtPct(m.benchmark.totalReturn)}`"
        />
        <MetricCard
          label="OOS Sharpe"
          term="sharpe"
          :value="fmtNum(m.sharpe)"
          :rating-value="m.sharpe"
          :sub="`CAGR ${fmtPct(m.cagr)}`"
        />
        <MetricCard
          :label="t('runs.maxDrawdown')"
          term="maxDrawdown"
          :value="fmtPct(m.maxDrawdown)"
          :rating-value="m.maxDrawdown"
          :sub="t('matrix.cellTrades', { n: m.trades })"
        />
        <MetricCard
          :label="t('walkForward.efficiency')"
          term="wfe"
          :value="fmtNum(summary?.efficiency)"
          :rating-value="summary?.efficiency"
          :sub="t('walkForward.meanTrainCagr', { value: fmtPct(summary?.meanTrainCagr) })"
        />
        <MetricCard
          :label="t('walkForward.profitableWindows')"
          term="profitableWindows"
          :value="fmtPct(summary?.profitableWindows, 0)"
          :rating-value="summary?.profitableWindows"
          :sub="t('walkForward.ofWindows', { n: test.length })"
        />
        <MetricCard
          :label="t('walkForward.stability')"
          :value="t('walkForward.distinctSets', { n: summary?.distinctParams ?? '—' })"
          :sub="
            summary?.distinctParams === 1
              ? t('walkForward.sameEverywhere')
              : t('walkForward.inWindows', { n: test.length })
          "
        />
      </div>
      <NDataTable
        :columns="columns"
        :data="rows"
        size="small"
        :row-props="
          (r: WindowRow) => ({
            style: 'cursor: pointer',
            onClick: () => r.test && router.push(`/backtests/${r.test.id}`),
          })
        "
      />
      <span class="hint">{{ t('walkForward.rowHelp') }}</span>
    </template>
    <EmptyState
      v-else-if="!running && !oos"
      :title="t('walkForward.emptyTitle')"
      :text="t('walkForward.emptyText')"
    />
  </div>
</template>

<style scoped>
.error {
  color: var(--down);
}
</style>
