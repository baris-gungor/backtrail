<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import {
  NCard,
  NDataTable,
  NDatePicker,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSpin,
  useMessage,
  type DataTableColumns,
} from 'naive-ui';
import { api, call, errorMessage, type Strategy, type StrategyReport } from '../../api/client';
import { useI18n } from 'vue-i18n';
import { fmtDec, fmtNum, fmtPct, pnlColor, strategyFullName } from '../../format';
import TradeStatsGrid from './TradeStatsGrid.vue';
import TradeTable from './TradeTable.vue';

type Breakdown = StrategyReport['assets'][number];

const message = useMessage();
const { t } = useI18n();
const strategies = ref<Strategy[]>([]);
const code = ref<string | null>(null);
const source = ref<'backtest' | 'paper'>('backtest');
const range = ref<[number, number] | null>(null);
const report = ref<StrategyReport>();
const loading = ref(false);

onMounted(async () => {
  try {
    strategies.value = await call(api.GET('/api/analysis/strategies'));
    code.value = strategies.value.find((s) => !s.isBenchmark)?.code ?? null;
  } catch (e) {
    message.error(errorMessage(e));
  }
});

const options = computed(() =>
  strategies.value.map((s) => ({ label: strategyFullName(s.code), value: s.code })),
);

async function load(): Promise<void> {
  if (!code.value) return;
  loading.value = true;
  try {
    const [from, to] = range.value ?? [];
    report.value = await call(
      api.GET('/api/reports/strategies/{code}', {
        params: {
          path: { code: code.value },
          query: {
            source: source.value,
            ...(from ? { from: new Date(from).toISOString() } : {}),
            ...(to ? { to: new Date(to).toISOString() } : {}),
          },
        },
      }),
    );
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    loading.value = false;
  }
}
watch([code, source, range], load);

const columns = computed<DataTableColumns<Breakdown>>(() => [
  {
    title: t('trades.symbol'),
    key: 'symbol',
    render: (a) =>
      a.runId ? h(RouterLink, { to: `/backtests/${a.runId}` }, () => a.symbol) : a.symbol,
  },
  { title: t('reports.stats.trades'), key: 'trades', render: (a) => String(a.stats.trades) },
  {
    title: 'PnL',
    key: 'pnl',
    render: (a) =>
      h('span', { style: { color: pnlColor(a.stats.totalPnl) } }, fmtDec(a.stats.totalPnl)),
  },
  { title: 'Win rate', key: 'winRate', render: (a) => fmtPct(a.stats.winRate, 0) },
  { title: 'PF', key: 'pf', render: (a) => fmtNum(a.stats.profitFactor) },
  { title: t('reports.return'), key: 'ret', render: (a) => fmtPct(a.metrics?.totalReturn) },
  { title: 'B&H', key: 'bh', render: (a) => fmtPct(a.metrics?.benchmark.totalReturn) },
  { title: 'Sharpe', key: 'sharpe', render: (a) => fmtNum(a.metrics?.sharpe) },
  { title: 'Max DD', key: 'dd', render: (a) => fmtPct(a.metrics?.maxDrawdown) },
]);
</script>

<template>
  <div class="stack" style="--gap: 12px">
    <div class="hstack">
      <NSelect v-model:value="code" :options="options" style="width: 320px" size="small" />
      <NRadioGroup v-model:value="source" size="small">
        <NRadioButton value="backtest">Backtest</NRadioButton>
        <NRadioButton value="paper">Paper</NRadioButton>
      </NRadioGroup>
      <NDatePicker v-model:value="range" type="daterange" clearable size="small" />
    </div>
    <NSpin :show="loading">
      <div v-if="report" class="stack" style="--gap: 12px">
        <TradeStatsGrid :stats="report.summary" />
        <NCard :title="t('reports.byAsset')" size="small">
          <NDataTable :columns="columns" :data="report.assets" size="small" />
          <p class="hint">{{ t('reports.strategyHelp') }}</p>
        </NCard>
        <div class="hstack" style="align-items: stretch">
          <NCard :title="t('reports.best5')" size="small" style="flex: 1; min-width: 320px">
            <TradeTable :trades="report.best" />
          </NCard>
          <NCard :title="t('reports.worst5')" size="small" style="flex: 1; min-width: 320px">
            <TradeTable :trades="report.worst" />
          </NCard>
        </div>
      </div>
    </NSpin>
  </div>
</template>

<style scoped>
.hint {
  font-size: 12px;
  opacity: 0.6;
}
</style>
