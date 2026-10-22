<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { NRadioButton, NRadioGroup, NSelect, NSpin, NTooltip, useMessage } from 'naive-ui';
import { api, call, errorMessage, type MatrixReport } from '../../api/client';
import { useAssets } from '../../composables/useAssets';
import { useI18n } from 'vue-i18n';
import { fmtNum, fmtPct, heatColor, strategyMethod, strategyName } from '../../format';

const message = useMessage();
const { t } = useI18n();
const router = useRouter();

const source = ref<'backtest' | 'paper'>('backtest');
const metric = ref('sharpe');
const segment = ref<'full' | 'train' | 'test'>('full');
const report = ref<MatrixReport>();
const loading = ref(false);
const { assets } = useAssets();

/**
 * Column order: an ETF proxy right after its futures (GC=F, GLD), so the two read side by side.
 * Holds indices into `report.assets` and each row's `cells`.
 */
const columns = computed(() => {
  const list = report.value?.assets ?? [];
  const proxyFor = new Map(assets.value.map((a) => [a.id, a.proxyForId]));
  const order = list
    .map((_, i) => i)
    .filter((i) => !list.some((f) => f.assetId === proxyFor.get(list[i].assetId)));
  for (const [i, a] of list.entries()) {
    const futures = list.findIndex((f) => f.assetId === proxyFor.get(a.assetId));
    if (futures >= 0) order.splice(order.indexOf(futures) + 1, 0, i);
  }
  return order.map((i) => ({
    index: i,
    symbol: list[i].symbol,
    proxyOf: list.find((f) => f.assetId === proxyFor.get(list[i].assetId))?.symbol,
  }));
});

const METRICS = {
  backtest: [
    'sharpe',
    'sortino',
    'calmar',
    'totalReturn',
    'cagr',
    'alpha',
    'maxDrawdown',
    'profitFactor',
    'winRate',
    'expectancy',
    'trades',
  ],
  paper: ['totalPnl', 'winRate', 'profitFactor', 'expectancy', 'avgReturn', 'trades'],
} as const;
const PERCENT = new Set(['totalReturn', 'cagr', 'alpha', 'maxDrawdown', 'winRate', 'avgReturn']);
/** Lower is better. */
const INVERTED = new Set(['maxDrawdown']);
const NEUTRAL = new Set(['trades']);

const metricOptions = computed(() =>
  METRICS[source.value].map((value) => ({ value, label: t(`matrix.metrics.${value}`) })),
);
watch(source, (s) => {
  if (!METRICS[s].some((v) => v === metric.value)) metric.value = METRICS[s][0];
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    report.value = await call(
      api.GET('/api/reports/matrix', {
        params: {
          query: { source: source.value, metric: metric.value as never, segment: segment.value },
        },
      }),
    );
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch([source, metric, segment], load);

const format = (v: number | null) =>
  v === null
    ? '—'
    : PERCENT.has(metric.value)
      ? fmtPct(v, 1)
      : fmtNum(v, metric.value === 'trades' ? 0 : 2);

/** Color scale: the largest absolute value in the table. */
const scale = computed(() => {
  const values = (report.value?.rows ?? [])
    .flatMap((r) => r.cells.map((c) => c?.value))
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return values.length ? Math.max(...values.map(Math.abs)) : 1;
});
const color = (v: number | null | undefined) =>
  NEUTRAL.has(metric.value)
    ? undefined
    : heatColor(INVERTED.has(metric.value) && v ? -v : v, scale.value);

function open(runId: string | null | undefined): void {
  if (runId && source.value === 'backtest') void router.push(`/backtests/${runId}`);
}
</script>

<template>
  <div class="stack" style="--gap: 12px">
    <div class="hstack">
      <NRadioGroup v-model:value="source" size="small">
        <NRadioButton value="backtest">Backtest</NRadioButton>
        <NRadioButton value="paper">Paper</NRadioButton>
      </NRadioGroup>
      <NSelect v-model:value="metric" :options="metricOptions" style="width: 180px" size="small" />
      <NRadioGroup v-show="source === 'backtest'" v-model:value="segment" size="small">
        <NRadioButton value="full">{{ t('matrix.full') }}</NRadioButton>
        <NRadioButton value="train">{{ t('matrix.train') }}</NRadioButton>
        <NRadioButton value="test">{{ t('matrix.test') }}</NRadioButton>
      </NRadioGroup>
    </div>
    <NSpin :show="loading">
      <div v-if="report" class="wrap">
        <table>
          <thead>
            <tr>
              <th class="left">{{ t('trades.strategy') }}</th>
              <th v-for="c in columns" :key="c.index">
                {{ c.symbol }}
                <small v-if="c.proxyOf" class="proxy" :title="t('proxy.etfOfFutures')">
                  ≈ {{ c.proxyOf }}
                </small>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in report.rows" :key="row.key" :class="{ bench: row.isBenchmark }">
              <td class="left">
                <template v-if="row.isBenchmark">{{ t('matrix.benchmarkRow') }}</template>
                <template v-else>
                  <strong>{{ strategyName(row.strategyCode) }}</strong>
                  <span class="method">
                    {{ strategyMethod(row.strategyCode) }}
                    <template v-if="row.configName !== 'default'"> · {{ row.configName }}</template>
                  </span>
                </template>
              </td>
              <td
                v-for="{ index: i, cell } in columns.map((c) => ({
                  index: c.index,
                  cell: row.cells[c.index],
                }))"
                :key="i"
                :style="{ background: color(cell?.value) }"
                :class="{ link: !!cell?.runId && source === 'backtest' && !row.isBenchmark }"
                @click="!row.isBenchmark && open(cell?.runId)"
              >
                <NTooltip v-if="cell" :disabled="row.isBenchmark">
                  <template #trigger>
                    <span>
                      {{ format(cell.value) }}
                      <small v-if="!row.isBenchmark" :class="{ warn: cell.lowSample }">
                        ({{ cell.trades }})
                      </small>
                    </span>
                  </template>
                  {{ t('matrix.cellTrades', { n: cell.trades })
                  }}{{ cell.lowSample ? ` · ${t('matrix.lowSample')}` : '' }}
                </NTooltip>
                <span v-else class="empty">—</span>
              </td>
            </tr>
          </tbody>
        </table>
        <p class="hint">{{ t('matrix.help') }}</p>
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
  font-size: 13px;
  min-width: 100%;
}
th,
td {
  padding: 6px 10px;
  text-align: right;
  border: 1px solid var(--border);
  white-space: nowrap;
}
.left {
  text-align: left;
}
th {
  opacity: 0.75;
  font-weight: 500;
}
.bench td {
  font-style: italic;
  opacity: 0.85;
}
.link {
  cursor: pointer;
}
.link:hover {
  outline: 1px solid var(--cell-outline);
}
small {
  opacity: 0.6;
}
small.warn {
  color: var(--warn);
  opacity: 1;
}
.empty {
  opacity: 0.3;
}
.hint {
  font-size: 12px;
  opacity: 0.6;
}
.method {
  font-size: 11px;
  color: var(--muted);
  margin-left: 4px;
}
.proxy {
  display: block;
  font-weight: normal;
  opacity: 0.6;
}
</style>
