<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { NButton, NCard, NDatePicker, NSelect, useMessage } from 'naive-ui';
import { api, call, errorMessage, type Signal } from '../api/client';
import EmptyState from '../components/EmptyState.vue';
import PageHead from '../components/PageHead.vue';
import SignalsTable from '../components/SignalsTable.vue';
import { useAssets } from '../composables/useAssets';
import { useI18n } from 'vue-i18n';
import { sideLabel, STRATEGY_CODES, strategyFullName } from '../format';

const message = useMessage();
const { t } = useI18n();
const { assets } = useAssets();

const symbol = ref<string | null>(null);
const strategy = ref<string | null>(null);
const side = ref<'BUY' | 'SELL' | null>(null);
const range = ref<[number, number] | null>(null);
const signals = ref<Signal[]>([]);
const loading = ref(false);

const symbolOptions = computed(() =>
  assets.value.map((a) => ({ label: a.symbol, value: a.symbol })),
);
const strategyOptions = computed(() =>
  STRATEGY_CODES.filter((code) => code !== 'buy_and_hold').map((code) => ({
    label: strategyFullName(code),
    value: code,
  })),
);
const sideOptions = computed(() => [
  { label: sideLabel('BUY'), value: 'BUY' },
  { label: sideLabel('SELL'), value: 'SELL' },
]);

async function load(): Promise<void> {
  loading.value = true;
  try {
    signals.value = await call(
      api.GET('/api/analysis/signals', {
        params: {
          query: {
            symbol: symbol.value ?? undefined,
            strategy: strategy.value ?? undefined,
            side: side.value ?? undefined,
            from: range.value ? new Date(range.value[0]).toISOString() : undefined,
            to: range.value ? new Date(range.value[1]).toISOString() : undefined,
            limit: 1000,
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

onMounted(load);
</script>

<template>
  <div class="stack">
    <PageHead :title="t('nav.signals')" :text="t('signals.intro')" />
    <NCard size="small">
      <div class="hstack" style="margin-bottom: 12px">
        <NSelect
          v-model:value="symbol"
          :options="symbolOptions"
          clearable
          :placeholder="t('signals.symbol')"
          style="width: 140px"
        />
        <NSelect
          v-model:value="strategy"
          :options="strategyOptions"
          clearable
          :placeholder="t('signals.strategy')"
          style="width: 260px"
        />
        <NSelect
          v-model:value="side"
          :options="sideOptions"
          clearable
          :placeholder="t('signals.side')"
          style="width: 100px"
        />
        <NDatePicker v-model:value="range" type="daterange" clearable />
        <NButton type="primary" :loading="loading" @click="load">{{ t('common.filter') }}</NButton>
      </div>
      <EmptyState
        v-if="!loading && !signals.length"
        icon="📡"
        :title="t('signals.emptyTitle')"
        :text="t('signals.emptyText')"
      />
      <SignalsTable v-else :signals="signals" :loading="loading" show-symbol />
    </NCard>
  </div>
</template>
