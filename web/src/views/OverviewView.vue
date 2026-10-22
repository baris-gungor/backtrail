<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRouter } from 'vue-router';
import {
  NAlert,
  NButton,
  NCard,
  NDataTable,
  NSpin,
  NTag,
  useMessage,
  type DataTableColumns,
} from 'naive-ui';
import {
  api,
  call,
  errorMessage,
  type BacktestRun,
  type PortfolioSummary,
  type Signal,
  type TradingState,
} from '../api/client';
import EmptyState from '../components/EmptyState.vue';
import MetricCard from '../components/MetricCard.vue';
import PageHead from '../components/PageHead.vue';
import Term from '../components/Term.vue';
import { useAssets } from '../composables/useAssets';
import { RATING_TAG, rate } from '../glossary';
import {
  fmtAgo,
  fmtDec,
  fmtNum,
  fmtPct,
  pnlColor,
  sideLabel,
  strategyMethod,
  strategyName,
} from '../format';

const message = useMessage();
const { t } = useI18n();
const router = useRouter();
const { assets, refresh: refreshAssets } = useAssets();
const portfolios = ref<PortfolioSummary[]>([]);
const signals = ref<Signal[]>([]);
const leaders = ref<BacktestRun[]>([]);
const trading = ref<TradingState>();
const loading = ref(true);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [p, s, l, state] = await Promise.all([
      call(api.GET('/api/portfolios')),
      call(api.GET('/api/analysis/signals', { params: { query: { limit: 8 } } })),
      call(
        api.GET('/api/backtests/leaderboard', {
          params: { query: { metric: 'sharpe', limit: 20 } },
        }),
      ),
      call(api.GET('/api/trading/state')),
      refreshAssets(),
    ]);
    portfolios.value = p;
    signals.value = s;
    leaders.value = l.filter((r) => r.strategyCode !== 'buy_and_hold' && r.metrics).slice(0, 5);
    trading.value = state;
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    loading.value = false;
  }
}
onMounted(load);

// Display-only sums; float rounding is fine at cent precision for a summary card.
const totals = computed(() => {
  let equity = 0;
  let initial = 0;
  let day = 0;
  let open = 0;
  for (const p of portfolios.value) {
    equity += Number(p.equity);
    initial += Number(p.initialCash);
    day += Number(p.dayPnl ?? 0);
    open += p.openPositions;
  }
  const prev = equity - day;
  return {
    equity: equity.toFixed(2),
    initial: initial.toFixed(2),
    day: day.toFixed(2),
    dayPct: prev > 0 && portfolios.value.length ? day / prev : null,
    open,
  };
});

const sync = computed(() => {
  const times = assets.value
    .filter((a) => a.isActive && a.lastSyncedAt)
    .map((a) => a.lastSyncedAt!)
    .sort();
  return { latest: times.at(-1) ?? null, oldest: times[0] ?? null, count: times.length };
});

const halted = computed(() => portfolios.value.filter((p) => p.haltedAt));
const maxSharpe = computed(() => Math.max(1, ...leaders.value.map((r) => r.metrics?.sharpe ?? 0)));

const portfolioColumns = computed<DataTableColumns<PortfolioSummary>>(() => [
  {
    title: t('reports.tabs.portfolio'),
    key: 'name',
    render: (p) => h(RouterLink, { to: `/portfolios/${p.id}` }, () => p.name),
  },
  {
    title: t('portfolios.mode'),
    key: 'mode',
    render: (p) =>
      h(
        NTag,
        { size: 'small', bordered: false, type: p.mode === 'alpaca_paper' ? 'info' : 'default' },
        () => (p.mode === 'alpaca_paper' ? 'Alpaca demo' : t('portfolios.simulation')),
      ),
  },
  { title: 'Equity', key: 'equity', align: 'right', render: (p) => `${fmtDec(p.equity)} $` },
  {
    title: t('reports.return'),
    key: 'totalReturn',
    align: 'right',
    render: (p) =>
      h(
        'span',
        { style: { color: pnlColor(p.totalReturn) } },
        `${fmtPct(p.totalReturn)} ${p.totalReturn >= 0 ? '▲' : '▼'}`,
      ),
  },
  {
    title: '',
    key: 'state',
    render: (p) =>
      p.haltedAt
        ? h(NTag, { size: 'small', type: 'error', bordered: false }, () => t('portfolios.halted'))
        : h(
            NTag,
            { size: 'small', type: p.isActive ? 'success' : 'default', bordered: false },
            () => (p.isActive ? t('portfolios.active') : t('assets.inactive')),
          ),
  },
]);

const signalColumns = computed<DataTableColumns<Signal>>(() => [
  {
    title: t('trades.symbol'),
    key: 'symbol',
    render: (s) => h(RouterLink, { to: `/assets/${encodeURIComponent(s.symbol)}` }, () => s.symbol),
  },
  {
    title: t('signals.side'),
    key: 'side',
    render: (s) =>
      h(
        NTag,
        { size: 'small', bordered: false, type: s.side === 'BUY' ? 'success' : 'error' },
        () => sideLabel(s.side),
      ),
  },
  { title: t('trades.strategy'), key: 'strategy', render: (s) => strategyName(s.strategy) },
  { title: t('signals.price'), key: 'price', align: 'right', render: (s) => fmtNum(s.price) },
  { title: t('overview.when'), key: 'barTime', align: 'right', render: (s) => fmtAgo(s.barTime) },
]);

const leaderColumns = computed<DataTableColumns<BacktestRun>>(() => [
  { title: '#', key: 'rank', width: 40, render: (_r, i) => i + 1 },
  {
    title: t('trades.strategy'),
    key: 'strategy',
    render: (r) =>
      h('span', {}, [
        h(RouterLink, { to: `/backtests/${r.id}` }, () => strategyName(r.strategyCode)),
        h('span', { class: 'method' }, ` ${strategyMethod(r.strategyCode)}`),
        r.configName && r.configName !== 'default'
          ? h('span', { class: 'method' }, ` · ${r.configName}`)
          : null,
      ]),
  },
  { title: t('reports.tabs.asset'), key: 'symbol' },
  {
    title: () => h(Term, { k: 'sharpe' }, () => 'Sharpe'),
    key: 'sharpe',
    width: '34%',
    render: (r) => {
      const v = r.metrics?.sharpe ?? null;
      const rating = rate('sharpe', v);
      return h('div', { class: 'bar-cell' }, [
        h('div', {
          class: 'bar',
          style: { width: `${Math.max(2, ((v ?? 0) / maxSharpe.value) * 55)}%` },
        }),
        h('strong', fmtNum(v)),
        rating
          ? h(NTag, { size: 'small', bordered: false, type: RATING_TAG[rating] }, () =>
              t(`labels.rating.${rating}`),
            )
          : null,
        r.metrics?.lowSample
          ? h(
              NTag,
              { size: 'small', bordered: false, type: 'warning' },
              () => `⚠ ${t('overview.fewTrades', { n: r.metrics?.trades ?? 0 })}`,
            )
          : null,
      ]);
    },
  },
  {
    title: t('reports.return'),
    key: 'ret',
    align: 'right',
    render: (r) =>
      h(
        'span',
        { style: { color: pnlColor(r.metrics?.totalReturn) } },
        fmtPct(r.metrics?.totalReturn, 1),
      ),
  },
  {
    title: () => h(Term, { k: 'maxDrawdown' }, () => t('runs.maxDrawdown')),
    key: 'dd',
    align: 'right',
    render: (r) => fmtPct(r.metrics?.maxDrawdown, 1),
  },
  {
    title: t('reports.stats.trades'),
    key: 'trades',
    align: 'right',
    render: (r) => r.metrics?.trades ?? '—',
  },
]);

const STEPS = computed(() => [
  {
    title: t('overview.steps.assets'),
    text: t('overview.steps.assetsText'),
    to: '/assets',
    cta: t('nav.assets'),
  },
  {
    title: t('overview.steps.strategies'),
    text: t('overview.steps.strategiesText'),
    to: '/strategies',
    cta: t('nav.strategies'),
  },
  {
    title: t('overview.steps.backtest'),
    text: t('overview.steps.backtestText'),
    to: '/backtests',
    cta: t('nav.backtests'),
  },
  {
    title: t('overview.steps.portfolio'),
    text: t('overview.steps.portfolioText'),
    to: '/portfolios?create=1',
    cta: t('nav.portfolios'),
  },
]);
const stepDone = computed(() => [
  assets.value.length > 0,
  assets.value.length > 0,
  leaders.value.length > 0,
  portfolios.value.length > 0,
]);
const setupDone = computed(() => stepDone.value.every(Boolean));
</script>

<template>
  <div class="stack">
    <PageHead :title="t('nav.overview')" :text="t('overview.intro')">
      <NButton @click="router.push('/assets')">{{ t('overview.addAsset') }}</NButton>
      <NButton type="primary" @click="router.push('/portfolios?create=1')">{{
        t('overview.createPortfolio')
      }}</NButton>
    </PageHead>

    <NAlert v-if="trading?.halted" type="error" :title="t('overview.haltedTitle')">
      {{ t('overview.haltedText', { reason: trading.reason }) }}
    </NAlert>
    <NAlert v-else-if="halted.length" type="warning" :title="t('overview.haltedPortfolios')">
      {{ halted.map((p) => `${p.name}: ${p.haltReason}`).join(' · ') }}
    </NAlert>

    <NSpin :show="loading">
      <div class="stack">
        <NCard v-if="!loading && !setupDone" size="small" :title="t('overview.gettingStarted')">
          <p class="hint" style="margin-top: 0">{{ t('overview.stepsIntro') }}</p>
          <div class="grid-cards" style="--min: 220px">
            <div v-for="(s, i) in STEPS" :key="s.title" class="step" :class="{ done: stepDone[i] }">
              <div class="hstack" style="--gap: 8px">
                <span class="num">{{ stepDone[i] ? '✓' : i + 1 }}</span>
                <strong>{{ s.title }}</strong>
              </div>
              <div class="hint">{{ s.text }}</div>
              <RouterLink v-if="!stepDone[i]" :to="s.to" class="small">{{ s.cta }} →</RouterLink>
            </div>
          </div>
        </NCard>

        <div class="grid-cards" style="--min: 230px">
          <MetricCard
            :label="t('overview.totalEquity')"
            term="equity"
            :value="`${fmtDec(totals.equity)} $`"
            :sub="
              t('overview.totalEquitySub', {
                n: portfolios.length,
                initial: fmtDec(totals.initial, 0),
              })
            "
          />
          <MetricCard
            :label="t('overview.todayPnl')"
            :value="`${Number(totals.day) >= 0 ? '+' : ''}${fmtDec(totals.day)} $`"
            :color="pnlColor(totals.day)"
            :sub="
              totals.dayPct === null
                ? t('overview.noPortfolio')
                : t('overview.allPortfolios', { pct: fmtPct(totals.dayPct) })
            "
          />
          <MetricCard
            :label="t('portfolios.openPositions')"
            :value="String(totals.open)"
            :sub="totals.open ? t('overview.openDetails') : t('overview.noOpen')"
          />
          <MetricCard
            :label="t('overview.freshness')"
            :value="fmtAgo(sync.latest)"
            :sub="
              sync.count
                ? t('overview.freshnessSub', { n: sync.count, oldest: fmtAgo(sync.oldest) })
                : t('overview.noAssets')
            "
          />
        </div>

        <div class="grid-cards" style="--min: 420px; --min-m: 100%">
          <NCard size="small" :title="t('nav.portfolios')">
            <template #header-extra
              ><RouterLink to="/portfolios" class="small">{{
                t('overview.all')
              }}</RouterLink></template
            >
            <NDataTable
              v-if="portfolios.length"
              :columns="portfolioColumns"
              :data="portfolios"
              size="small"
              :bordered="false"
            />
            <EmptyState
              v-else
              icon="📁"
              :title="t('portfolios.emptyTitle')"
              :text="t('portfolios.emptyText')"
              :action="t('portfolios.emptyAction')"
              @action="router.push('/portfolios?create=1')"
            />
          </NCard>
          <NCard size="small" :title="t('overview.recentSignals')">
            <template #header-extra
              ><RouterLink to="/signals" class="small">{{
                t('overview.all')
              }}</RouterLink></template
            >
            <NDataTable
              v-if="signals.length"
              :columns="signalColumns"
              :data="signals"
              size="small"
              :bordered="false"
            />
            <EmptyState
              v-else
              icon="📡"
              :title="t('overview.noSignalsTitle')"
              :text="t('overview.noSignalsText')"
              :action="t('overview.steps.assets')"
              @action="router.push('/assets')"
            />
          </NCard>
        </div>

        <NCard size="small">
          <template #header>
            {{ t('overview.best') }} <span class="hint">· {{ t('overview.bestHint') }}</span>
          </template>
          <template #header-extra
            ><RouterLink to="/backtests" class="small">{{
              t('overview.leaderboard')
            }}</RouterLink></template
          >
          <NDataTable
            v-if="leaders.length"
            :columns="leaderColumns"
            :data="leaders"
            size="small"
            :bordered="false"
          />
          <EmptyState
            v-else
            icon="🧪"
            :title="t('overview.noBacktestsTitle')"
            :text="t('overview.noBacktestsText')"
            :action="t('overview.steps.backtest')"
            @action="router.push('/backtests')"
          />
        </NCard>
      </div>
    </NSpin>
  </div>
</template>

<style scoped>
.step {
  border: 1px dashed var(--border);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.step.done {
  opacity: 0.6;
}
.num {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--primary-soft);
  color: var(--primary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
}
.small {
  font-size: 13px;
}
:deep(.method) {
  font-size: 11px;
  color: var(--muted);
}
:deep(.bar-cell) {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
:deep(.bar) {
  height: 8px;
  border-radius: 4px;
  background: var(--primary);
  opacity: 0.75;
}
</style>
