<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
  NAlert,
  NButton,
  NCard,
  NCheckbox,
  NCheckboxGroup,
  NDataTable,
  NEmpty,
  NSelect,
  NSpace,
  NSpin,
  NSwitch,
  NTabPane,
  NTabs,
  NTag,
  useDialog,
  useMessage,
  type DataTableColumns,
} from 'naive-ui';
import {
  ApiError,
  api,
  call,
  errorMessage,
  type AssetSummary,
  type Bar,
  type IndicatorPoint,
  type IngestionRun,
  type Signal,
} from '../api/client';
import PriceChart, { type Overlay } from '../components/PriceChart.vue';
import EarningsTag from '../components/EarningsTag.vue';
import ProxyLinks from '../components/ProxyLinks.vue';
import SignalsTable from '../components/SignalsTable.vue';
import SummaryPanel from '../components/SummaryPanel.vue';
import { useAssets } from '../composables/useAssets';
import { fmtDate, strategyFullName } from '../format';

const props = defineProps<{ symbol?: string }>();
const router = useRouter();
const message = useMessage();
const dialog = useDialog();
const { t } = useI18n();
const { assets, refresh: refreshAssets } = useAssets();

const asset = computed(() => assets.value.find((a) => a.symbol === props.symbol));

const bars = ref<Bar[]>([]);
const points = ref<IndicatorPoint[]>([]);
const signals = ref<Signal[]>([]);
const summary = ref<AssetSummary>();
const runs = ref<IngestionRun[]>([]);
const loading = ref(false);
const syncing = ref(false);

const overlays = ref<Overlay[]>(['ema']);
const strategyFilter = ref<string[]>([]);

const strategyOptions = computed(() =>
  [...new Set(signals.value.map((s) => s.strategy))].map((code) => ({
    label: strategyFullName(code),
    value: code,
  })),
);
const visibleSignals = computed(() =>
  strategyFilter.value.length
    ? signals.value.filter((s) => strategyFilter.value.includes(s.strategy))
    : signals.value,
);

async function load(): Promise<void> {
  const symbol = props.symbol;
  if (!symbol) return;
  loading.value = true;
  try {
    const path = { symbol };
    const [b, i, s, sum] = await Promise.all([
      call(
        api.GET('/api/market-data/bars', {
          params: { query: { symbol, timeframe: '4h', limit: 5000 } },
        }),
      ),
      call(
        api.GET('/api/analysis/assets/{symbol}/indicators', {
          params: { path, query: { limit: 5000 } },
        }),
      ),
      call(api.GET('/api/analysis/signals', { params: { query: { symbol, limit: 1000 } } })),
      // 404 means no closed bars yet, which is expected right after an asset is added.
      call(api.GET('/api/analysis/assets/{symbol}/summary', { params: { path } })).catch(
        (e: unknown) => {
          if (e instanceof ApiError && e.status === 404) return undefined;
          throw e;
        },
      ),
    ]);
    // Sort ascending: the chart needs time order regardless of the API's ordering.
    bars.value = [...b.bars].sort((x, y) => x.openTime.localeCompare(y.openTime));
    points.value = i.points;
    signals.value = s;
    summary.value = sum;
    if (asset.value) {
      runs.value = await call(
        api.GET('/api/market-data/ingestion-runs', {
          params: { query: { assetId: asset.value.id, limit: 20 } },
        }),
      );
    }
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    loading.value = false;
  }
}

// After an asset is added, its backfill runs in the background; poll until a run finishes.
let pollTimer: ReturnType<typeof setTimeout> | undefined;
// A poll that is in flight when the page is left must not schedule another one.
let unmounted = false;
function schedulePoll(): void {
  clearTimeout(pollTimer);
  if (unmounted) return;
  const pending = runs.value.length === 0 || runs.value[0].status === 'running';
  if (props.symbol && pending) {
    pollTimer = setTimeout(() => {
      // A failed refresh (backend restarting) must not end the polling or leave a rejection.
      Promise.all([refreshAssets(), load()])
        .catch(() => undefined)
        .finally(schedulePoll);
    }, 3000);
  }
}
onBeforeUnmount(() => {
  unmounted = true;
  clearTimeout(pollTimer);
});

watch(
  () => [props.symbol, asset.value?.id],
  async () => {
    strategyFilter.value = [];
    await load();
    schedulePoll();
  },
  { immediate: true },
);

async function sync(): Promise<void> {
  if (!asset.value) return;
  syncing.value = true;
  try {
    const run = await call(
      api.POST('/api/market-data/sync/{assetId}', {
        params: { path: { assetId: asset.value.id } },
      }),
    );
    message.success(
      t('asset.synced', {
        status: run.status,
        h1: run.hourlyBarsUpserted,
        h4: run.fourHourBarsUpserted,
      }),
    );
    await refreshAssets();
    // Signals are generated after the sync event, so wait a moment before reloading.
    setTimeout(() => void load(), 1500);
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    syncing.value = false;
  }
}

async function setActive(isActive: boolean): Promise<void> {
  if (!asset.value) return;
  try {
    await call(
      api.PATCH('/api/assets/{id}', {
        params: { path: { id: asset.value.id } },
        body: { isActive },
      }),
    );
    await refreshAssets();
  } catch (e) {
    message.error(errorMessage(e));
  }
}

function remove(): void {
  const target = asset.value;
  if (!target) return;
  dialog.warning({
    title: t('asset.deleteTitle', { symbol: target.symbol }),
    content: t('asset.deleteText'),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      try {
        await call(api.DELETE('/api/assets/{id}', { params: { path: { id: target.id } } }));
        await refreshAssets();
        await router.push('/assets');
      } catch (e) {
        message.error(errorMessage(e));
      }
    },
  });
}

const runColumns = computed<DataTableColumns<IngestionRun>>(() => [
  { title: t('asset.started'), key: 'startedAt', render: (r) => fmtDate(r.startedAt) },
  { title: t('runs.status'), key: 'status' },
  {
    title: t('asset.range'),
    key: 'range',
    render: (r) => `${fmtDate(r.rangeFrom)} – ${fmtDate(r.rangeTo)}`,
  },
  { title: '1h', key: 'hourlyBarsUpserted' },
  { title: '4h', key: 'fourHourBarsUpserted' },
  { title: t('asset.error'), key: 'error', ellipsis: { tooltip: true } },
]);
</script>

<template>
  <NEmpty v-if="!symbol" :description="t('asset.pick')" style="margin-top: 80px" />
  <div v-else class="stack">
    <div class="hstack between">
      <div class="hstack">
        <h2 style="margin: 0">{{ symbol }}</h2>
        <span v-if="asset" class="hint"
          >{{ asset.name }} · {{ asset.exchange }} · {{ asset.currency }}</span
        >
        <NTag v-if="asset" size="small" :bordered="false">
          {{ asset.sessionType === 'us_equity' ? t('asset.usSession') : t('asset.continuous') }}
        </NTag>
      </div>
      <NSpace v-if="asset" align="center">
        <span :title="t('asset.trackedHelp')">{{ t('asset.tracked') }}</span>
        <NSwitch :value="asset.isActive" @update:value="setActive" />
        <NButton :loading="syncing" :title="t('asset.syncHelp')" @click="sync">{{
          t('asset.sync')
        }}</NButton>
        <NButton type="error" ghost @click="remove">{{ t('common.delete') }}</NButton>
      </NSpace>
    </div>

    <ProxyLinks v-if="asset" :asset="asset" />
    <EarningsTag v-if="asset" :asset="asset" />

    <NAlert v-if="!loading && bars.length === 0" type="info">
      {{ t('asset.noBars') }}
    </NAlert>

    <SummaryPanel v-if="summary" :summary="summary" />

    <NCard size="small">
      <template #header>
        <NSpace align="center">
          <span>{{ t('asset.chart') }}</span>
          <NCheckboxGroup v-model:value="overlays">
            <NCheckbox value="ema" label="EMA 20/50/200" />
            <NCheckbox value="bb" label="Bollinger" />
            <NCheckbox value="supertrend" label="Supertrend" />
            <NCheckbox value="rsi" label="RSI" />
          </NCheckboxGroup>
        </NSpace>
      </template>
      <template #header-extra>
        <NSelect
          v-model:value="strategyFilter"
          multiple
          clearable
          :options="strategyOptions"
          :placeholder="t('asset.allStrategies')"
          style="width: 320px"
        />
      </template>
      <NSpin :show="loading">
        <PriceChart :bars="bars" :points="points" :signals="visibleSignals" :overlays="overlays" />
      </NSpin>
    </NCard>

    <NTabs type="line">
      <NTabPane name="signals" :tab="`${t('nav.signals')} (${visibleSignals.length})`">
        <SignalsTable :signals="visibleSignals" :loading="loading" />
      </NTabPane>
      <NTabPane name="runs" :tab="t('asset.runs')">
        <NDataTable :columns="runColumns" :data="runs" size="small" />
      </NTabPane>
    </NTabs>
  </div>
</template>
