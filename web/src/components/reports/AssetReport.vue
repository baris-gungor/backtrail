<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import {
  NCard,
  NDataTable,
  NInputNumber,
  NSelect,
  NSpin,
  useMessage,
  type DataTableColumns,
} from 'naive-ui';
import { api, call, errorMessage, type AssetReport } from '../../api/client';
import { useAssets } from '../../composables/useAssets';
import { useI18n } from 'vue-i18n';
import { configLabel, fmtDec, fmtNum, fmtPct, heatColor, pnlColor } from '../../format';

type Row = AssetReport['strategies'][number];

const message = useMessage();
const { t } = useI18n();
const { assets, refresh } = useAssets();
const symbol = ref<string | null>(null);
const horizon = ref(6);
const report = ref<AssetReport>();
const loading = ref(false);

onMounted(async () => {
  if (assets.value.length === 0) await refresh().catch(() => undefined);
  symbol.value = assets.value[0]?.symbol ?? null;
});
const options = computed(() => assets.value.map((a) => ({ label: a.symbol, value: a.symbol })));

async function load(): Promise<void> {
  if (!symbol.value || !horizon.value) return;
  loading.value = true;
  try {
    report.value = await call(
      api.GET('/api/reports/assets/{symbol}', {
        params: { path: { symbol: symbol.value }, query: { horizon: horizon.value } },
      }),
    );
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    loading.value = false;
  }
}
watch([symbol, horizon], load);

const columns = computed<DataTableColumns<Row>>(() => [
  {
    title: t('reports.strategyConfig'),
    key: 'key',
    render: (r) => {
      const label = configLabel(r.strategyCode, r.configName);
      return r.runId ? h(RouterLink, { to: `/backtests/${r.runId}` }, () => label) : label;
    },
  },
  { title: t('reports.btReturn'), key: 'ret', render: (r) => fmtPct(r.metrics?.totalReturn) },
  { title: 'BT Sharpe', key: 'sharpe', render: (r) => fmtNum(r.metrics?.sharpe) },
  { title: 'BT max DD', key: 'dd', render: (r) => fmtPct(r.metrics?.maxDrawdown) },
  {
    title: t('reports.btTrades'),
    key: 'trades',
    render: (r) => (r.metrics ? String(r.metrics.trades) : '—'),
  },
  {
    title: 'Paper PnL',
    key: 'paper',
    render: (r) =>
      r.paper
        ? h(
            'span',
            { style: { color: pnlColor(r.paper.totalPnl) } },
            `${fmtDec(r.paper.totalPnl)} (${r.paper.trades})`,
          )
        : '—',
  },
  {
    title: t('reports.signalsBuySell'),
    key: 'signals',
    render: (r) => (r.signals ? `${r.signals.buys} / ${r.signals.sells}` : '—'),
  },
  {
    title: t('reports.buyHit'),
    key: 'buyHit',
    render: (r) =>
      r.signals
        ? t('reports.hitMean', {
            hit: fmtPct(r.signals.buy.hitRate, 0),
            mean: fmtPct(r.signals.buy.mean, 2),
          })
        : '—',
  },
  {
    title: t('reports.sellHit'),
    key: 'sellHit',
    render: (r) =>
      r.signals
        ? t('reports.hitMean', {
            hit: fmtPct(r.signals.sell.hitRate, 0),
            mean: fmtPct(r.signals.sell.mean, 2),
          })
        : '—',
  },
]);
</script>

<template>
  <div class="stack" style="--gap: 12px">
    <div class="hstack">
      <NSelect
        v-model:value="symbol"
        :options="options"
        filterable
        style="width: 200px"
        size="small"
      />
      <span class="hint">{{ t('reports.signalHorizon') }}</span>
      <NInputNumber v-model:value="horizon" :min="1" :max="100" size="small" style="width: 110px" />
      <span class="hint">{{ t('reports.bars4h') }}</span>
    </div>
    <NSpin :show="loading">
      <div v-if="report" class="stack" style="--gap: 12px">
        <NCard :title="t('nav.strategies')" size="small">
          <NDataTable :columns="columns" :data="report.strategies" size="small" />
          <p class="hint">{{ t('reports.assetHelp', { n: horizon }) }}</p>
        </NCard>
        <NCard :title="t('reports.correlation')" size="small">
          <div v-if="report.correlation.keys.length > 1" class="wrap">
            <table>
              <thead>
                <tr>
                  <th />
                  <th v-for="k in report.correlation.keys" :key="k">{{ k }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, i) in report.correlation.matrix" :key="i">
                  <th class="left">{{ report.correlation.keys[i] }}</th>
                  <td
                    v-for="(v, j) in row"
                    :key="j"
                    :style="{ background: i === j ? undefined : heatColor(v, 1) }"
                  >
                    {{ fmtNum(v) }}
                  </td>
                </tr>
              </tbody>
            </table>
            <p class="hint">{{ t('reports.correlationHelp') }}</p>
          </div>
          <span v-else class="hint">{{ t('reports.correlationNeedsTwo') }}</span>
        </NCard>
      </div>
    </NSpin>
  </div>
</template>

<style scoped>
.wrap {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  font-size: 12px;
}
th,
td {
  padding: 4px 8px;
  text-align: right;
  border: 1px solid var(--border);
  white-space: nowrap;
}
th {
  opacity: 0.75;
  font-weight: 500;
}
.left {
  text-align: left;
}
.hint {
  font-size: 12px;
  opacity: 0.6;
}
</style>
