<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue';
import {
  NDataTable,
  NInput,
  NSelect,
  NSpin,
  NTag,
  useMessage,
  type DataTableColumns,
} from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { api, call, errorMessage, type SignalQualityReport } from '../../api/client';
import { useAssets } from '../../composables/useAssets';
import { configLabel, fmtPct, heatColor, sideLabel } from '../../format';

type Row = SignalQualityReport['rows'][number];

const message = useMessage();
const { t } = useI18n();
const { assets, refresh } = useAssets();
const symbol = ref<string | null>(null);
const horizons = ref('1,3,6,12');
const report = ref<SignalQualityReport>();
const loading = ref(false);

const options = computed(() => assets.value.map((a) => ({ label: a.symbol, value: a.symbol })));

async function load(): Promise<void> {
  if (!/^\d+(,\d+)*$/.test(horizons.value)) return;
  loading.value = true;
  try {
    report.value = await call(
      api.GET('/api/reports/signals', {
        params: {
          query: { horizons: horizons.value, ...(symbol.value ? { symbol: symbol.value } : {}) },
        },
      }),
    );
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  if (assets.value.length === 0) await refresh().catch(() => undefined);
  await load();
});
watch([symbol, horizons], load);

const columns = computed<DataTableColumns<Row>>(() => [
  {
    title: t('reports.strategyConfig'),
    key: 'strategyCode',
    render: (r) => configLabel(r.strategyCode, r.configName),
  },
  {
    title: t('signals.side'),
    key: 'side',
    width: 70,
    render: (r) =>
      h(
        NTag,
        { size: 'small', bordered: false, type: r.side === 'BUY' ? 'success' : 'error' },
        () => sideLabel(r.side),
      ),
  },
  {
    title: t('reports.signalCount'),
    key: 'count',
    width: 70,
    render: (r) => String(r.byHorizon[0]?.count ?? 0),
  },
  ...(report.value?.horizons ?? []).map((horizon, i) => ({
    title: t('reports.horizonColumn', { n: horizon }),
    key: `h${horizon}`,
    render: (r: Row) => {
      const d = r.byHorizon[i];
      return h(
        'span',
        {
          style: {
            background: heatColor(d.hitRate === null ? null : d.hitRate - 0.5, 0.25),
            padding: '2px 4px',
          },
        },
        `${fmtPct(d.hitRate, 0)} · ${fmtPct(d.mean, 2)} · ${fmtPct(d.median, 2)}`,
      );
    },
  })),
]);
</script>

<template>
  <div class="stack" style="--gap: 12px">
    <div class="hstack">
      <NSelect
        v-model:value="symbol"
        :options="options"
        clearable
        :placeholder="t('reports.allAssets')"
        style="width: 200px"
        size="small"
      />
      <span class="hint">{{ t('reports.horizons') }}</span>
      <NInput v-model:value="horizons" size="small" style="width: 140px" />
    </div>
    <NSpin :show="loading">
      <NDataTable v-if="report" :columns="columns" :data="report.rows" size="small" />
    </NSpin>
    <p class="hint">{{ t('reports.signalQualityHelp') }}</p>
  </div>
</template>

<style scoped>
.hint {
  font-size: 12px;
  opacity: 0.6;
}
</style>
