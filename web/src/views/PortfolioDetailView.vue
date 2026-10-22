<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  NAlert,
  NButton,
  NCard,
  NDataTable,
  NPopconfirm,
  NSelect,
  NSpin,
  NSwitch,
  NTabPane,
  NTabs,
  NTag,
  NTooltip,
  useMessage,
  type DataTableColumns,
} from 'naive-ui';
import {
  api,
  call,
  errorMessage,
  type ClosedTrade,
  type EquityPoint,
  type Order,
  type PortfolioDetail,
  type Position,
} from '../api/client';
import BrokerPanel from '../components/BrokerPanel.vue';
import EquityChart from '../components/EquityChart.vue';
import ManualOrderForm from '../components/portfolio/ManualOrderForm.vue';
import RiskRulesForm from '../components/portfolio/RiskRulesForm.vue';
import SubscriptionsPanel from '../components/portfolio/SubscriptionsPanel.vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useDeletePortfolio } from '../composables/useDeletePortfolio';
import { useAssets } from '../composables/useAssets';
import { useAction } from '../composables/useAction';
import { usePolling } from '../composables/usePolling';
import EmptyState from '../components/EmptyState.vue';
import MetricCard from '../components/MetricCard.vue';
import Term from '../components/Term.vue';
import {
  configLabel,
  exitReasonLabel,
  orderSourceLabel,
  orderStatusLabel,
  ORDER_STATUS_TAGS,
  fmtAgo,
  fmtDate,
  fmtDec,
  fmtNum,
  fmtPct,
  pnlColor,
  rejectReasonLabel,
  sideLabel,
} from '../format';

const props = defineProps<{ id: string }>();
const message = useMessage();
const router = useRouter();
const { t } = useI18n();
const confirmDelete = useDeletePortfolio(() => router.push('/portfolios'));
const { assets, refresh: refreshAssets } = useAssets();

const portfolio = ref<PortfolioDetail>();
const orders = ref<Order[]>([]);
const trades = ref<ClosedTrade[]>([]);
const equity = ref<EquityPoint[]>([]);
const loading = ref(false);
const orderStatus = ref<Order['status'] | null>(null);

const path = computed(() => ({ id: props.id }));

// Only the newest request may write state, so a slow older response cannot overwrite a newer one.
let requestSeq = 0;
// Poll failures toast once until a request succeeds again, not on every tick.
let lastFailed = false;

async function load(): Promise<void> {
  const mine = ++requestSeq;
  try {
    const [p, o, closed, e] = await Promise.all([
      call(api.GET('/api/portfolios/{id}', { params: { path: path.value } })),
      call(
        api.GET('/api/portfolios/{id}/orders', {
          params: {
            path: path.value,
            query: orderStatus.value ? { status: orderStatus.value } : {},
          },
        }),
      ),
      call(api.GET('/api/portfolios/{id}/trades', { params: { path: path.value } })),
      call(api.GET('/api/portfolios/{id}/equity', { params: { path: path.value, query: {} } })),
    ]);
    if (unmounted || mine !== requestSeq) return;
    [portfolio.value, orders.value, trades.value, equity.value] = [p, o, closed, e];
    lastFailed = false;
  } catch (e) {
    if (unmounted || mine !== requestSeq) return;
    if (!lastFailed) message.error(errorMessage(e));
    lastFailed = true;
  }
}

// Paper trading advances on syncs in the background; refresh while the page is open.
let unmounted = false;
onMounted(async () => {
  loading.value = true;
  await Promise.all([load(), refreshAssets()]).catch((e: unknown) =>
    message.error(errorMessage(e)),
  );
  loading.value = false;
});
usePolling(load, 15_000);
onBeforeUnmount(() => {
  unmounted = true;
});
// Another portfolio: drop the previous one's data instead of showing it until the load ends.
watch(
  () => props.id,
  async () => {
    portfolio.value = undefined;
    [orders.value, trades.value, equity.value] = [[], [], []];
    loading.value = true;
    await load();
    loading.value = false;
  },
);
watch(orderStatus, load);

const { busy, act } = useAction(load);

const symbolOptions = computed(() =>
  assets.value.map((a) => ({ label: `${a.symbol} · ${a.name}`, value: a.symbol })),
);

const cards = computed(() => {
  const p = portfolio.value;
  if (!p) return [];
  return [
    {
      label: 'Equity',
      term: 'equity',
      value: fmtDec(p.equity),
      sub: t('portfolio.startedWith', { value: fmtDec(p.initialCash, 0) }),
    },
    { label: t('broker.cash'), value: fmtDec(p.cash), sub: t('portfolio.uninvested') },
    {
      label: t('portfolio.positionsValue'),
      value: fmtDec(p.positionsValue),
      sub: t('portfolio.openCount', { n: p.positions.length }),
    },
    {
      label: t('portfolioReport.totalReturn'),
      term: 'totalReturn',
      value: fmtPct(p.totalReturn),
      color: pnlColor(p.totalReturn),
      sub: t('portfolio.sinceStart'),
    },
    {
      label: t('overview.todayPnl'),
      value: fmtDec(p.dayPnl),
      color: pnlColor(p.dayPnl),
      sub: t('portfolio.vsLastClose'),
    },
    {
      label: t('portfolio.realizedPnl'),
      term: 'realizedPnl',
      value: fmtDec(p.realizedPnl),
      color: pnlColor(p.realizedPnl),
      sub: t('portfolio.fromClosed'),
    },
  ];
});

const curve = computed(() => equity.value.map((e) => [new Date(e.at).getTime(), Number(e.equity)]));

const signed = (value: string | number | null, text: string) =>
  h('span', { style: { color: pnlColor(value) } }, text);

// Positions
const positionColumns = computed<DataTableColumns<Position>>(() => [
  { title: t('trades.symbol'), key: 'symbol', width: 80 },
  { title: t('trades.quantity'), key: 'quantity', render: (p) => fmtDec(p.quantity, 4) },
  { title: t('portfolio.avgPrice'), key: 'avgPrice', render: (p) => fmtDec(p.avgPrice) },
  {
    title: t('portfolioReport.lastPrice'),
    key: 'lastPrice',
    render: (p) =>
      h('div', {}, [
        fmtNum(p.lastPrice),
        h(
          'div',
          {
            class: 'hint',
            style: { fontSize: '11px' },
            title: p.priceSource === 'quote' ? t('portfolio.quoteLive') : t('portfolio.quoteBar'),
          },
          p.priceAsOf
            ? `${fmtAgo(p.priceAsOf)}${p.priceSource === 'bar' ? ` · ${t('portfolio.hourly')}` : ''}`
            : t('portfolio.noData'),
        ),
      ]),
  },
  { title: t('portfolio.value'), key: 'marketValue', render: (p) => fmtDec(p.marketValue) },
  {
    title: t('portfolio.unrealizedPnl'),
    key: 'unrealizedPnl',
    render: (p) => signed(p.unrealizedPnl, fmtDec(p.unrealizedPnl)),
  },
  {
    title: () => h(Term, { k: 'stopLoss' }, () => 'Stop'),
    key: 'stopLoss',
    render: (p) => fmtNum(p.stopLoss),
  },
  {
    title: () => h(Term, { k: 'takeProfit' }, () => t('portfolio.target')),
    key: 'takeProfit',
    render: (p) => fmtNum(p.takeProfit),
  },
  { title: t('portfolio.opened'), key: 'openedAt', render: (p) => fmtDate(p.openedAt) },
  {
    title: t('trades.source'),
    key: 'subscriptionId',
    render: (p) => {
      const sub = portfolio.value?.subscriptions.find((s) => s.id === p.subscriptionId);
      return sub ? configLabel(sub.strategyCode, sub.configName) : orderSourceLabel('manual');
    },
  },
  {
    title: '',
    key: 'close',
    width: 90,
    render: (p) =>
      h(
        NPopconfirm,
        {
          onPositiveClick: () =>
            act(
              () =>
                call(
                  api.POST('/api/portfolios/{id}/positions/{assetId}/close', {
                    params: { path: { id: props.id, assetId: p.assetId } },
                  }),
                ),
              t('portfolio.closed', { symbol: p.symbol }),
            ),
        },
        {
          trigger: () =>
            h(NButton, { size: 'tiny', type: 'error', ghost: true }, () => t('portfolio.close')),
          default: () => t('portfolio.closeConfirm', { symbol: p.symbol }),
        },
      ),
  },
]);

// Orders
const statusOptions = computed(() =>
  ['pending', 'filled', 'cancelled', 'rejected'].map((s) => ({
    label: orderStatusLabel(s),
    value: s,
  })),
);

const orderColumns = computed<DataTableColumns<Order>>(() => [
  { title: t('portfolio.createdAt'), key: 'createdAt', render: (o) => fmtDate(o.createdAt) },
  { title: t('trades.symbol'), key: 'symbol', width: 80 },
  {
    title: t('signals.side'),
    key: 'side',
    width: 70,
    render: (o) =>
      h(
        NTag,
        { size: 'small', bordered: false, type: o.side === 'BUY' ? 'success' : 'error' },
        () => sideLabel(o.side),
      ),
  },
  {
    title: t('portfolios.mode'),
    key: 'type',
    render: (o) => (o.limitPrice ? `${o.type} @ ${fmtNum(o.limitPrice)}` : o.type),
  },
  {
    title: t('trades.source'),
    key: 'source',
    render: (o) => orderSourceLabel(o.source),
  },
  {
    title: t('trades.quantity'),
    key: 'quantity',
    render: (o) =>
      o.quantity ? fmtDec(o.quantity, 4) : o.notional ? `${fmtDec(o.notional)} $` : '—',
  },
  {
    title: t('runs.status'),
    key: 'status',
    render: (o) =>
      h('span', {}, [
        h(NTag, { size: 'small', bordered: false, type: ORDER_STATUS_TAGS[o.status] }, () =>
          orderStatusLabel(o.status),
        ),
        o.rejectReason ? ` ${rejectReasonLabel(o.rejectReason)}` : '',
      ]),
  },
  { title: t('portfolio.filledAt'), key: 'filledAt', render: (o) => fmtDate(o.filledAt) },
  {
    title: '',
    key: 'cancel',
    width: 80,
    render: (o) =>
      o.status === 'pending'
        ? h(
            NButton,
            {
              size: 'tiny',
              onClick: () =>
                act(
                  () =>
                    call(
                      api.DELETE('/api/portfolios/{id}/orders/{orderId}', {
                        params: { path: { id: props.id, orderId: o.id } },
                      }),
                    ),
                  t('portfolio.orderCancelled'),
                ),
            },
            () => t('portfolio.cancelOrder'),
          )
        : null,
  },
]);

// Trades
/** Trade side; a short is highlighted. */
const sideTag = (side: string) =>
  side === 'short'
    ? h(NTag, { size: 'small', type: 'warning', bordered: false }, () => 'short')
    : 'long';

const tradeColumns = computed<DataTableColumns<ClosedTrade>>(() => [
  { title: t('trades.symbol'), key: 'symbol', width: 80 },
  { title: t('signals.side'), key: 'side', width: 70, render: (r) => sideTag(r.side) },
  { title: t('trades.entry'), key: 'entryTime', render: (r) => fmtDate(r.entryTime) },
  { title: t('trades.entryPrice'), key: 'entryPrice', render: (r) => fmtNum(r.entryPrice) },
  { title: t('trades.exit'), key: 'exitTime', render: (r) => fmtDate(r.exitTime) },
  { title: t('trades.exitPrice'), key: 'exitPrice', render: (r) => fmtNum(r.exitPrice) },
  { title: t('trades.quantity'), key: 'quantity', render: (r) => fmtDec(r.quantity, 4) },
  { title: t('backtest.fee'), key: 'fees', render: (r) => fmtDec(r.fees) },
  {
    title: t('trades.pnl'),
    key: 'pnl',
    render: (r) => signed(r.pnl, `${fmtDec(r.pnl)} (${fmtPct(r.returnPct, 1)})`),
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
]);

const setActive = (isActive: boolean) =>
  act(() =>
    call(api.PATCH('/api/portfolios/{id}', { params: { path: path.value }, body: { isActive } })),
  );
const resume = () =>
  act(
    () => call(api.POST('/api/portfolios/{id}/resume', { params: { path: path.value } })),
    t('portfolio.resumed'),
  );
const processNow = () =>
  act(
    () => call(api.POST('/api/portfolios/{id}/process', { params: { path: path.value } })),
    t('portfolio.processed'),
  );
</script>

<template>
  <NSpin :show="loading">
    <div v-if="portfolio" class="stack">
      <div class="hstack between" style="align-items: flex-end">
        <div class="page-head">
          <div class="hstack">
            <h2>{{ portfolio.name }}</h2>
            <NTooltip>
              <template #trigger>
                <NTag
                  size="small"
                  :bordered="false"
                  :type="portfolio.mode === 'alpaca_paper' ? 'info' : 'default'"
                >
                  {{
                    portfolio.mode === 'alpaca_paper' ? 'Alpaca demo' : t('portfolios.simulation')
                  }}
                </NTag>
              </template>
              {{
                portfolio.mode === 'alpaca_paper'
                  ? t('portfolio.alpacaHelp')
                  : t('portfolio.paperHelp')
              }}
            </NTooltip>
            <NTag size="small" :bordered="false">{{ portfolio.baseCurrency }}</NTag>
          </div>
          <p>
            {{
              t('portfolio.intro', {
                fee: portfolio.execution.feeBps,
                slippage: portfolio.execution.slippageBps,
              })
            }}
          </p>
        </div>
        <div class="hstack">
          <NTooltip>
            <template #trigger>
              <span class="hstack" style="--gap: 6px">
                {{ t('portfolio.autoTrading') }}
                <NSwitch :value="portfolio.isActive" :disabled="busy" @update:value="setActive" />
              </span>
            </template>
            {{ t('portfolio.autoTradingHelp') }}
          </NTooltip>
          <NTooltip>
            <template #trigger>
              <NButton :loading="busy" @click="processNow">{{ t('portfolio.processNow') }}</NButton>
            </template>
            {{ t('portfolio.processNowHelp') }}
          </NTooltip>
          <NButton @click="load">{{ t('common.refresh') }}</NButton>
          <NButton type="error" ghost @click="confirmDelete(portfolio)">{{
            t('common.delete')
          }}</NButton>
        </div>
      </div>

      <NAlert v-if="portfolio.haltedAt" type="error" :title="t('portfolio.haltedTitle')">
        <div class="hstack between">
          <span>
            {{
              t('portfolio.haltedText', {
                time: fmtDate(portfolio.haltedAt),
                reason: portfolio.haltReason,
              })
            }}
          </span>
          <NButton size="small" :loading="busy" @click="resume">{{
            t('portfolio.resume')
          }}</NButton>
        </div>
      </NAlert>

      <div class="grid-cards" style="--min: 190px">
        <MetricCard
          v-for="c in cards"
          :key="c.label"
          :label="c.label"
          :term="c.term"
          :value="c.value"
          :sub="c.sub"
          :color="c.color"
        />
      </div>

      <NCard :title="t('portfolio.equityCurve')" size="small">
        <EquityChart :equity="curve" :benchmark="null" />
      </NCard>

      <NCard size="small">
        <NTabs type="line" animated>
          <NTabPane
            name="positions"
            :tab="t('portfolio.tabs.positions', { n: portfolio.positions.length })"
          >
            <NDataTable
              v-if="portfolio.positions.length"
              :columns="positionColumns"
              :data="portfolio.positions"
              size="small"
            />
            <EmptyState
              v-else
              icon="📭"
              :title="t('portfolio.noPositionsTitle')"
              :text="
                portfolio.subscriptions.length
                  ? t('portfolio.noPositionsWithSubs')
                  : t('portfolio.noPositionsText')
              "
            />
          </NTabPane>

          <NTabPane name="orders" :tab="t('portfolio.tabs.orders')">
            <div class="stack" style="--gap: 8px">
              <NSelect
                v-model:value="orderStatus"
                :options="statusOptions"
                clearable
                :placeholder="t('portfolio.allStatuses')"
                style="width: 200px"
              />
              <NDataTable
                :columns="orderColumns"
                :data="orders"
                size="small"
                :pagination="{ pageSize: 20 }"
              />
            </div>
          </NTabPane>

          <NTabPane name="trades" :tab="t('backtest.tradesTitle', { n: trades.length })">
            <NDataTable
              :columns="tradeColumns"
              :data="trades"
              size="small"
              :pagination="{ pageSize: 20 }"
            />
          </NTabPane>

          <NTabPane name="subscriptions" :tab="t('portfolio.tabs.subscriptions')">
            <SubscriptionsPanel :portfolio="portfolio" @changed="load" />
          </NTabPane>

          <NTabPane name="order" :tab="t('portfolio.tabs.manualOrder')">
            <ManualOrderForm
              :portfolio="portfolio"
              :symbol-options="symbolOptions"
              @changed="load"
            />
          </NTabPane>

          <NTabPane v-if="portfolio.mode === 'alpaca_paper'" name="broker" tab="Broker (demo)">
            <BrokerPanel :portfolio-id="portfolio.id" @changed="load" />
          </NTabPane>

          <NTabPane name="risk" :tab="t('portfolio.tabs.risk')">
            <RiskRulesForm
              :portfolio-id="portfolio.id"
              :risk-rules="portfolio.riskRules"
              @changed="load"
            />
          </NTabPane>
        </NTabs>
      </NCard>
    </div>
  </NSpin>
</template>

<style scoped>
.hint {
  font-size: 12px;
  opacity: 0.6;
}
</style>
