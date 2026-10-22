<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import {
  NAlert,
  NCard,
  NDataTable,
  NDescriptions,
  NDescriptionsItem,
  NSpin,
  NTag,
  NTooltip,
  useMessage,
  type DataTableColumns,
} from 'naive-ui';
import { useI18n } from 'vue-i18n';
import {
  api,
  call,
  errorMessage,
  type BacktestExtras,
  type BacktestRunDetail,
  type BacktestTrade,
} from '../api/client';
import EquityChart from '../components/EquityChart.vue';
import MetricCard from '../components/MetricCard.vue';
import MonteCarloCard from '../components/MonteCarloCard.vue';
import MonthlyReturns from '../components/MonthlyReturns.vue';
import PageHead from '../components/PageHead.vue';
import Term from '../components/Term.vue';
import { useIsMobile } from '../composables/useIsMobile';
import {
  exitReasonLabel,
  directionLabel,
  fmtDate,
  fmtNum,
  fmtPct,
  pnlColor,
  segmentLabel,
  strategyFullName,
} from '../format';

const props = defineProps<{ id: string }>();
const message = useMessage();
const isMobile = useIsMobile();
const { t } = useI18n();

const run = ref<BacktestRunDetail>();
const trades = ref<BacktestTrade[]>([]);
const extras = ref<BacktestExtras>();
const loading = ref(false);

watch(
  () => props.id,
  async (id) => {
    loading.value = true;
    try {
      const path = { id };
      [run.value, trades.value] = await Promise.all([
        call(api.GET('/api/backtests/{id}', { params: { path } })),
        call(api.GET('/api/backtests/{id}/trades', { params: { path } })),
      ]);
      // Monthly returns and drawdown extras need the stored equity curve.
      extras.value =
        run.value.status === 'success' && run.value.equityCurve
          ? await call(api.GET('/api/reports/backtests/{id}', { params: { path } }))
          : undefined;
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);

const m = computed(() => run.value?.metrics ?? undefined);

const configText = computed(() => {
  const name = run.value?.configName;
  return name === 'default' ? t('labels.defaultConfig') : (name ?? t('backtest.customParams'));
});

const dataQualityText = computed(() => {
  const q = m.value?.dataQuality;
  if (!q) return '';
  const parts = [];
  if (q.jumps) parts.push(t('backtest.jumps', { n: q.jumps }));
  if (q.gaps) parts.push(t('backtest.gaps', { n: q.gaps }));
  const text = t('backtest.dataQualityFound', { items: parts.join(t('backtest.and')) });
  return q.rollAdjustments ? `${text} ${t('backtest.rollsFixed', { n: q.rollAdjustments })}` : text;
});

const sizingText = computed(() => {
  const s = run.value?.execution.sizing;
  if (!s) return '';
  if (s.type === 'fixed_fraction') return `equity × ${s.fraction}`;
  if (s.type === 'risk_per_trade') return t('backtest.riskPerTrade', { pct: s.riskPct });
  return t('backtest.allCash');
});

interface Card {
  label: string;
  term?: string;
  value: string;
  sub: string;
  rating?: number | null;
  color?: string;
}

const cards = computed<Card[]>(() => {
  const x = m.value;
  if (!x) return [];
  const vsBh = (a: number | null, b: number | null) =>
    a === null || b === null
      ? ''
      : a >= b
        ? ` ▲ ${t('backtest.ahead')}`
        : ` ▼ ${t('backtest.behind')}`;
  const bh = t('labels.strategy.buy_and_hold');
  return [
    {
      label: t('portfolioReport.totalReturn'),
      term: 'totalReturn',
      value: fmtPct(x.totalReturn),
      color: pnlColor(x.totalReturn),
      sub: `${bh}: ${fmtPct(x.benchmark.totalReturn)}${vsBh(x.totalReturn, x.benchmark.totalReturn)}`,
    },
    {
      label: t('backtest.cagr'),
      term: 'cagr',
      value: fmtPct(x.cagr),
      sub: `${bh}: ${fmtPct(x.benchmark.cagr)}`,
    },
    {
      label: 'Alpha',
      term: 'alpha',
      value: fmtPct(x.alpha),
      rating: x.alpha,
      sub: t('backtest.alphaSub'),
    },
    {
      label: t('runs.maxDrawdown'),
      term: 'maxDrawdown',
      value: fmtPct(x.maxDrawdown),
      rating: x.maxDrawdown,
      sub: t('backtest.drawdownSub', {
        days: fmtNum(x.maxDrawdownDays, 0),
        bh: fmtPct(x.benchmark.maxDrawdown),
      }),
    },
    {
      label: 'Sharpe',
      term: 'sharpe',
      value: fmtNum(x.sharpe),
      rating: x.sharpe,
      sub: `Sortino ${fmtNum(x.sortino)}`,
    },
    {
      label: 'Calmar',
      term: 'calmar',
      value: fmtNum(x.calmar),
      rating: x.calmar,
      sub: `${t('summary.volatility')} ${fmtPct(x.volatility, 1)}`,
    },
    {
      label: t('reports.stats.trades'),
      term: 'trades',
      value: String(x.trades),
      sub: t('backtest.winRateSub', { value: fmtPct(x.winRate, 0) }),
    },
    {
      label: 'Profit factor',
      term: 'profitFactor',
      value: fmtNum(x.profitFactor),
      rating: x.profitFactor,
      sub: `Payoff ${fmtNum(x.payoff)}`,
    },
    {
      label: t('backtest.expectancy'),
      term: 'expectancy',
      value: fmtNum(x.expectancy),
      color: pnlColor(x.expectancy),
      sub: t('backtest.expectancySub', { win: fmtNum(x.avgWin), loss: fmtNum(x.avgLoss) }),
    },
    {
      label: t('backtest.exposure'),
      term: 'exposure',
      value: fmtPct(x.exposure, 0),
      sub: t('backtest.exposureSub', { hours: fmtNum(x.avgHoldingHours, 0) }),
    },
    {
      label: t('backtest.fees'),
      term: 'fees',
      value: fmtNum(x.totalFees),
      sub: t('backtest.barsPerYear', { n: fmtNum(x.barsPerYear, 0) }),
    },
  ];
});

/** Trade side; a short is highlighted. */
const sideTag = (side: string) =>
  side === 'short'
    ? h(NTag, { size: 'small', type: 'warning', bordered: false }, () => 'short')
    : 'long';

const tradeColumns = computed<DataTableColumns<BacktestTrade>>(() => [
  { title: t('signals.side'), key: 'side', width: 70, render: (r) => sideTag(r.side) },
  { title: t('trades.entry'), key: 'entryTime', render: (r) => fmtDate(r.entryTime) },
  { title: t('trades.entryPrice'), key: 'entryPrice', render: (r) => fmtNum(r.entryPrice) },
  { title: t('trades.exit'), key: 'exitTime', render: (r) => fmtDate(r.exitTime) },
  { title: t('trades.exitPrice'), key: 'exitPrice', render: (r) => fmtNum(r.exitPrice) },
  { title: t('trades.quantity'), key: 'quantity', render: (r) => fmtNum(Number(r.quantity), 4) },
  { title: t('backtest.fee'), key: 'fees', render: (r) => fmtNum(Number(r.fees)) },
  {
    title: t('trades.pnl'),
    key: 'pnl',
    render: (r) =>
      h(
        'span',
        { style: { color: pnlColor(r.pnl) } },
        `${fmtNum(Number(r.pnl))} (${fmtPct(r.returnPct, 1)})`,
      ),
  },
  {
    title: t('trades.exitReason'),
    key: 'exitReason',
    render: (r) =>
      h(
        NTag,
        {
          size: 'small',
          bordered: false,
          type:
            r.exitReason === 'stop_loss'
              ? 'error'
              : r.exitReason === 'take_profit'
                ? 'success'
                : 'default',
        },
        () => exitReasonLabel(r.exitReason),
      ),
  },
  { title: t('backtest.barsHeld'), key: 'barsHeld', width: 90 },
]);
</script>

<template>
  <NSpin :show="loading">
    <div v-if="run" class="stack">
      <PageHead
        :title="`${run.symbol} · ${strategyFullName(run.strategyCode)}`"
        :text="t('backtest.intro')"
      >
        <NTag size="small" :bordered="false">{{ configText }}</NTag>
        <NTooltip>
          <template #trigger>
            <NTag size="small" :bordered="false">{{ segmentLabel(run.segment) }}</NTag>
          </template>
          {{ t('backtest.segmentHelp') }}
        </NTooltip>
        <NTag size="small" :bordered="false">v{{ run.strategyVersion }}</NTag>
      </PageHead>

      <NAlert v-if="run.status === 'failed'" type="error">{{ run.error }}</NAlert>
      <NAlert v-if="m?.lowSample" type="warning">
        {{ t('backtest.lowSample', { n: m.trades }) }}
      </NAlert>
      <NAlert v-if="m && (m.dataQuality.jumps > 0 || m.dataQuality.gaps > 0)" type="warning">
        <strong>{{ t('backtest.dataQuality') }}</strong> {{ dataQualityText }}
        {{ t('backtest.mayBeAffected') }}
        <details>
          <summary class="link">{{ t('backtest.details') }}</summary>
          {{ t('backtest.dataQualityHelp') }}
          <template v-if="m.dataQuality.jumpTimes.length">
            {{
              t('backtest.firstJumps', {
                times: m.dataQuality.jumpTimes.slice(0, 5).map(fmtDate).join(', '),
              })
            }}
          </template>
        </details>
      </NAlert>

      <div v-if="m" class="grid-cards" style="--min: 200px">
        <MetricCard
          v-for="c in cards"
          :key="c.label"
          :label="c.label"
          :term="c.term"
          :value="c.value"
          :sub="c.sub"
          :color="c.color"
          :rating-value="c.rating"
        />
      </div>

      <MonteCarloCard v-if="m && run.status === 'success'" :run-id="run.id" :trades="m.trades" />

      <NCard size="small" :title="t('backtest.settings')">
        <NDescriptions :column="isMobile ? 1 : 3" size="small" label-placement="left">
          <NDescriptionsItem :label="t('runs.segment')">
            {{ run.periodFrom ? fmtDate(run.periodFrom) : t('backtest.firstBar') }} –
            {{ run.periodTo ? fmtDate(run.periodTo) : t('backtest.lastBar') }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="t('backtest.capital')">
            {{ fmtNum(Number(run.initialCapital), 0) }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="t('backtest.sizing')">{{ sizingText }}</NDescriptionsItem>
          <NDescriptionsItem>
            <template #label
              ><Term k="bps">{{ t('backtest.feeSlippage') }}</Term></template
            >
            {{ run.execution.feeBps }} / {{ run.execution.slippageBps }} bps
          </NDescriptionsItem>
          <NDescriptionsItem v-if="run.execution.earnings">
            <template #label
              ><Term k="earnings">{{ t('backtest.earningsFilter') }}</Term></template
            >
            {{
              t('backtest.earningsValue', {
                exit: run.execution.earnings.exitBefore
                  ? t('backtest.closeBefore')
                  : t('backtest.noClose'),
                days: run.execution.earnings.blockEntryDays,
              })
            }}
          </NDescriptionsItem>
          <NDescriptionsItem v-if="run.execution.direction">
            <template #label
              ><Term k="short">{{ t('signals.side') }}</Term></template
            >
            {{ directionLabel(run.execution.direction) }}
            <template v-if="run.execution.borrowPct">
              · {{ t('backtest.borrow', { pct: run.execution.borrowPct }) }}
            </template>
          </NDescriptionsItem>
          <NDescriptionsItem v-if="run.execution.adjustRolls">
            <template #label
              ><Term k="rollAdjust">{{ t('backtest.rollAdjust') }}</Term></template
            >
            {{ t('backtest.rollAdjustOn') }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="t('backtest.ranAt')">{{
            fmtDate(run.finishedAt)
          }}</NDescriptionsItem>
          <NDescriptionsItem :label="t('backtest.code')">
            <code>{{ run.strategyCode }}</code>
          </NDescriptionsItem>
        </NDescriptions>
        <div class="params">
          <span class="sub">{{ t('backtest.params') }}</span>
          <NTag v-for="(v, k) in run.params" :key="k" size="small" :bordered="false">
            {{ k }} = {{ v }}
          </NTag>
        </div>
      </NCard>

      <NCard v-if="run.equityCurve" :title="t('backtest.equityCurve')" size="small">
        <EquityChart :equity="run.equityCurve" :benchmark="run.benchmarkCurve" />
      </NCard>
      <NAlert v-else type="info">{{ t('backtest.noCurve') }}</NAlert>

      <NCard v-if="extras" :title="t('portfolioReport.monthly')" size="small">
        <div class="stack" style="--gap: 8px">
          <MonthlyReturns :monthly="extras.extra.monthly" :yearly="extras.extra.yearly" />
          <span class="sub">
            <Term k="ulcer">Ulcer index</Term> {{ fmtPct(extras.extra.ulcerIndex) }} ·
            {{
              t('backtest.extras', {
                days: fmtNum(extras.extra.longestDrawdown.days, 1),
                state: extras.extra.longestDrawdown.recovered
                  ? t('portfolioReport.recovered')
                  : t('portfolioReport.ongoing'),
                wins: extras.extra.maxWinStreak,
                losses: extras.extra.maxLossStreak,
              })
            }}
          </span>
        </div>
      </NCard>

      <NCard :title="t('backtest.tradesTitle', { n: trades.length })" size="small">
        <NDataTable
          :columns="tradeColumns"
          :data="trades"
          size="small"
          :pagination="{ pageSize: 20 }"
        />
      </NCard>
    </div>
  </NSpin>
</template>

<style scoped>
.sub {
  font-size: 12px;
  color: var(--muted);
}
.params {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-top: 10px;
}
.link {
  cursor: pointer;
  color: var(--primary);
  margin-top: 4px;
}
</style>
