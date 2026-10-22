<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  NButton,
  NDatePicker,
  NInputNumber,
  NRadioButton,
  NRadioGroup,
  NSelect,
  useMessage,
} from 'naive-ui';
import { api, call, errorMessage, type Strategy, type TradeRecord } from '../../api/client';
import { useI18n } from 'vue-i18n';
import { useAssets } from '../../composables/useAssets';
import { strategyFullName } from '../../format';
import TradeTable from './TradeTable.vue';

const message = useMessage();
const { t } = useI18n();
const { assets, refresh } = useAssets();
const strategies = ref<Strategy[]>([]);
const source = ref<'all' | 'backtest' | 'paper'>('all');
const strategy = ref<string | null>(null);
const symbol = ref<string | null>(null);
const range = ref<[number, number] | null>(null);
const limit = ref(500);
const trades = ref<TradeRecord[]>([]);
const loading = ref(false);

const symbolOptions = computed(() =>
  assets.value.map((a) => ({ label: a.symbol, value: a.symbol })),
);
const strategyOptions = computed(() =>
  strategies.value.map((s) => ({ label: strategyFullName(s.code), value: s.code })),
);

/** The same filters for the JSON request and the CSV link. */
const query = computed(() => {
  const q: Record<string, string> = { limit: String(limit.value) };
  if (source.value !== 'all') q.source = source.value;
  if (strategy.value) q.strategy = strategy.value;
  if (symbol.value) q.symbol = symbol.value;
  if (range.value) {
    q.from = new Date(range.value[0]).toISOString();
    q.to = new Date(range.value[1]).toISOString();
  }
  return q;
});
const csvUrl = computed(
  () => `/api/reports/trades?${new URLSearchParams({ ...query.value, format: 'csv' }).toString()}`,
);

async function load(): Promise<void> {
  loading.value = true;
  try {
    trades.value = await call(
      api.GET('/api/reports/trades', { params: { query: query.value as never } }),
    );
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  if (assets.value.length === 0) await refresh().catch(() => undefined);
  strategies.value = await call(api.GET('/api/analysis/strategies')).catch(() => []);
  await load();
});
watch(query, load);
</script>

<template>
  <div class="stack" style="--gap: 12px">
    <div class="hstack">
      <NRadioGroup v-model:value="source" size="small">
        <NRadioButton value="all">{{ t('reports.all') }}</NRadioButton>
        <NRadioButton value="backtest">Backtest</NRadioButton>
        <NRadioButton value="paper">Paper</NRadioButton>
      </NRadioGroup>
      <NSelect
        v-model:value="strategy"
        :options="strategyOptions"
        clearable
        :placeholder="t('trades.strategy')"
        style="width: 240px"
        size="small"
      />
      <NSelect
        v-model:value="symbol"
        :options="symbolOptions"
        clearable
        :placeholder="t('trades.symbol')"
        style="width: 160px"
        size="small"
      />
      <NDatePicker v-model:value="range" type="daterange" clearable size="small" />
      <NInputNumber
        v-model:value="limit"
        :min="1"
        :max="10000"
        :step="100"
        size="small"
        style="width: 120px"
      />
      <a :href="csvUrl" download="trades.csv">
        <NButton size="small" type="primary">{{ t('reports.downloadCsv') }}</NButton>
      </a>
    </div>
    <TradeTable :trades="trades" :loading="loading" :page-size="25" />
    <p class="hint">{{ t('reports.journalHelp') }}</p>
  </div>
</template>

<style scoped>
.hint {
  font-size: 12px;
  opacity: 0.6;
}
</style>
