<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue';
import {
  NAlert,
  NCard,
  NDataTable,
  NGrid,
  NGridItem,
  NSelect,
  NSpin,
  NStatistic,
  useMessage,
  type DataTableColumns,
} from 'naive-ui';
import {
  api,
  call,
  errorMessage,
  type DivergenceRow,
  type PortfolioReport,
  type PortfolioSummary,
} from '../../api/client';
import { useI18n } from 'vue-i18n';
import { configLabel, fmtDate, fmtDec, fmtNum, fmtPct, pnlColor } from '../../format';
import EquityChart from '../EquityChart.vue';
import MonthlyReturns from '../MonthlyReturns.vue';

type Contribution = PortfolioReport['contributions'][number];
type Risk = PortfolioReport['openRisk']['positions'][number];

const message = useMessage();
const { t } = useI18n();
const portfolios = ref<PortfolioSummary[]>([]);
const id = ref<string | null>(null);
const report = ref<PortfolioReport>();
const divergence = ref<DivergenceRow[]>([]);
const loading = ref(false);

onMounted(async () => {
  try {
    portfolios.value = await call(api.GET('/api/portfolios'));
    id.value = portfolios.value[0]?.id ?? null;
  } catch (e) {
    message.error(errorMessage(e));
  }
});
const options = computed(() => portfolios.value.map((p) => ({ label: p.name, value: p.id })));

watch(id, async (portfolioId) => {
  if (!portfolioId) return;
  loading.value = true;
  try {
    [report.value, divergence.value] = await Promise.all([
      call(api.GET('/api/reports/portfolios/{id}', { params: { path: { id: portfolioId } } })),
      call(api.GET('/api/reports/divergence', { params: { query: { portfolioId } } })),
    ]);
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    loading.value = false;
  }
});

const curve = computed(() =>
  (report.value?.equity ?? []).map((p) => [new Date(p.time).getTime(), p.equity]),
);

const cards = computed(() => {
  const r = report.value;
  if (!r) return [];
  const m = r.metrics;
  return [
    {
      label: t('portfolioReport.totalReturn'),
      value: fmtPct(m.totalReturn),
      sub: `CAGR ${fmtPct(m.cagr)}`,
    },
    {
      label: 'Max drawdown',
      value: fmtPct(m.maxDrawdown),
      sub: `Ulcer ${fmtPct(r.extra.ulcerIndex)}`,
    },
    {
      label: t('portfolioReport.longestDrawdown'),
      value: t('portfolioReport.days', { n: fmtNum(r.extra.longestDrawdown.days, 1) }),
      sub: r.extra.longestDrawdown.recovered
        ? t('portfolioReport.recovered')
        : t('portfolioReport.ongoing'),
    },
    {
      label: t('portfolioReport.sharpeDaily'),
      value: fmtNum(m.sharpe),
      sub: `Sortino ${fmtNum(m.sortino)}`,
    },
    {
      label: t('reports.stats.trades'),
      value: String(m.trades),
      sub: `Win ${fmtPct(m.winRate, 0)} · PF ${fmtNum(m.profitFactor)}`,
    },
    {
      label: t('reports.stats.streaks'),
      value: `${r.extra.maxWinStreak} / ${r.extra.maxLossStreak}`,
      sub: t('portfolioReport.longestWinLoss'),
    },
    {
      label: t('portfolioReport.riskToStops'),
      value: fmtDec(r.openRisk.toStops),
      sub: t('portfolioReport.unprotected', { value: fmtDec(r.openRisk.unprotected) }),
    },
  ];
});

const contributionColumns = computed<DataTableColumns<Contribution>>(() => [
  { title: t('trades.source'), key: 'label' },
  { title: t('reports.stats.trades'), key: 'trades' },
  {
    title: t('portfolioReport.realized'),
    key: 'realizedPnl',
    render: (c) => h('span', { style: { color: pnlColor(c.realizedPnl) } }, fmtDec(c.realizedPnl)),
  },
  {
    title: t('portfolioReport.open'),
    key: 'unrealizedPnl',
    render: (c) =>
      h('span', { style: { color: pnlColor(c.unrealizedPnl) } }, fmtDec(c.unrealizedPnl)),
  },
]);

const riskColumns = computed<DataTableColumns<Risk>>(() => [
  { title: t('trades.symbol'), key: 'symbol' },
  { title: t('trades.quantity'), key: 'quantity', render: (p) => fmtDec(p.quantity, 4) },
  { title: t('portfolioReport.lastPrice'), key: 'lastPrice', render: (p) => fmtNum(p.lastPrice) },
  { title: 'Stop', key: 'stopLoss', render: (p) => fmtNum(p.stopLoss) },
  {
    title: t('portfolioReport.toStop'),
    key: 'riskToStop',
    render: (p) => (p.riskToStop === null ? t('portfolioReport.noStop') : fmtDec(p.riskToStop)),
  },
]);

const divergenceColumns = computed<DataTableColumns<DivergenceRow>>(() => [
  {
    title: t('portfolioReport.subscription'),
    key: 'subscriptionId',
    render: (d) =>
      `${d.symbol} · ${configLabel(d.strategyCode, d.configName)} (${d.source === 'signals' ? t('portfolioReport.storedSignals') : t('portfolioReport.strategyRules')})`,
  },
  {
    title: t('portfolioReport.window'),
    key: 'from',
    render: (d) => `${fmtDate(d.from)} – ${fmtDate(d.to)}`,
  },
  {
    title: 'Paper',
    key: 'paper',
    render: (d) =>
      t('portfolioReport.tradesPnl', { n: d.paper.trades, pnl: fmtDec(d.paper.totalPnl) }),
  },
  {
    title: 'Backtest',
    key: 'backtest',
    render: (d) =>
      t('portfolioReport.tradesPnl', { n: d.backtest.trades, pnl: fmtDec(d.backtest.totalPnl) }),
  },
  {
    title: t('portfolioReport.pnlDiff'),
    key: 'pnlDiff',
    render: (d) =>
      h(
        'span',
        { style: { color: Number(d.pnlDiff) === 0 ? undefined : pnlColor(d.pnlDiff) } },
        fmtDec(d.pnlDiff),
      ),
  },
  {
    title: t('portfolioReport.matched'),
    key: 'matched',
    render: (d) => `${d.matched} / ${d.onlyPaper.length} / ${d.onlyBacktest.length}`,
  },
]);
</script>

<template>
  <div class="stack" style="--gap: 12px">
    <div class="hstack">
      <NSelect
        v-model:value="id"
        :options="options"
        :placeholder="t('reports.tabs.portfolio')"
        style="width: 260px"
        size="small"
      />
    </div>
    <NAlert v-if="portfolios.length === 0" type="info">{{ t('portfolioReport.none') }}</NAlert>
    <NSpin :show="loading">
      <div v-if="report" class="stack" style="--gap: 12px">
        <NGrid :cols="7" :x-gap="12" :y-gap="12" responsive="screen" item-responsive>
          <NGridItem v-for="c in cards" :key="c.label" span="7 m:3 l:1">
            <NCard size="small">
              <NStatistic :label="c.label" :value="c.value" />
              <div class="sub">{{ c.sub }}</div>
            </NCard>
          </NGridItem>
        </NGrid>

        <NCard :title="t('portfolioReport.equityDrawdown')" size="small">
          <EquityChart :equity="curve" :benchmark="null" />
          <p class="hint">{{ t('portfolioReport.metricsHelp') }}</p>
        </NCard>

        <NCard :title="t('portfolioReport.monthly')" size="small">
          <MonthlyReturns :monthly="report.extra.monthly" :yearly="report.extra.yearly" />
        </NCard>

        <div class="hstack" style="align-items: stretch">
          <NCard
            :title="t('portfolioReport.contribution')"
            size="small"
            style="flex: 1; min-width: 320px"
          >
            <NDataTable :columns="contributionColumns" :data="report.contributions" size="small" />
          </NCard>
          <NCard
            :title="t('portfolioReport.openRisk')"
            size="small"
            style="flex: 1; min-width: 320px"
          >
            <NDataTable :columns="riskColumns" :data="report.openRisk.positions" size="small" />
          </NCard>
        </div>

        <NCard title="Backtest vs paper" size="small">
          <NDataTable :columns="divergenceColumns" :data="divergence" size="small" />
          <p class="hint">{{ t('portfolioReport.divergenceHelp') }}</p>
        </NCard>
      </div>
    </NSpin>
  </div>
</template>

<style scoped>
.sub {
  font-size: 12px;
  opacity: 0.6;
  margin-top: 4px;
}
.hint {
  font-size: 12px;
  opacity: 0.6;
}
</style>
