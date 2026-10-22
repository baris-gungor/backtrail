<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NTag, NTooltip } from 'naive-ui';
import { api, call, type Asset, type Schemas } from '../api/client';
import { useI18n } from 'vue-i18n';
import { fmtDate } from '../format';
import Term from './Term.vue';

/** Next and recent earnings reports of an equity. Hidden for other assets. */
const props = defineProps<{ asset: Asset }>();
const earnings = ref<Schemas['EarningsDto']>();
const { t } = useI18n();

watch(
  () => props.asset.symbol,
  async (symbol) => {
    earnings.value = undefined;
    if (props.asset.assetClass !== 'equity') return;
    try {
      earnings.value = await call(
        api.GET('/api/market-data/earnings', { params: { query: { symbol } } }),
      );
    } catch {
      // Optional information; the page works without it.
    }
  },
  { immediate: true },
);

const daysToNext = computed(() => {
  const next = earnings.value?.next;
  return next ? Math.ceil((new Date(next).getTime() - Date.now()) / 86_400_000) : null;
});
const recent = computed(() => [...(earnings.value?.reports ?? [])].reverse().slice(0, 8));
</script>

<template>
  <div v-if="earnings?.applies && earnings.reports.length" class="hstack" style="--gap: 6px 8px">
    <Term k="earnings">{{ t('earnings.label') }}</Term>
    <NTooltip>
      <template #trigger>
        <NTag
          size="small"
          :bordered="false"
          :type="daysToNext !== null && daysToNext <= 7 ? 'warning' : 'default'"
        >
          <template v-if="earnings.next">
            {{ t('earnings.next', { date: fmtDate(earnings.next), days: daysToNext }) }}
          </template>
          <template v-else>{{ t('earnings.nextUnknown') }}</template>
        </NTag>
      </template>
      <div>{{ t('earnings.recent') }}</div>
      <div v-for="r in recent" :key="r">{{ fmtDate(r) }}</div>
    </NTooltip>
  </div>
</template>
