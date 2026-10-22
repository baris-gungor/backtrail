<script setup lang="ts">
import { computed, h } from 'vue';
import { NDataTable, NTag, NTooltip, type DataTableColumns } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import type { Signal } from '../api/client';
import { configLabel, fmtDate, fmtNum, sideLabel, strategyFullName } from '../format';
import Term from './Term.vue';

const props = defineProps<{ signals: Signal[]; loading?: boolean; showSymbol?: boolean }>();
const { t } = useI18n();

const columns = computed<DataTableColumns<Signal>>(() => [
  { title: 'Bar', key: 'barTime', width: 140, render: (s) => fmtDate(s.barTime) },
  ...(props.showSymbol ? [{ title: t('signals.symbol'), key: 'symbol', width: 90 }] : []),
  {
    title: t('signals.strategy'),
    key: 'strategy',
    width: 200,
    render: (s) =>
      h('span', { title: strategyFullName(s.strategy) }, configLabel(s.strategy, s.configName)),
  },
  {
    title: t('signals.side'),
    key: 'side',
    width: 70,
    render: (s) =>
      h(
        NTag,
        { size: 'small', bordered: false, type: s.side === 'BUY' ? 'success' : 'error' },
        () => sideLabel(s.side),
      ),
  },
  { title: t('signals.price'), key: 'price', width: 100, render: (s) => fmtNum(s.price) },
  {
    title: () => h(Term, { k: 'stopLoss' }, () => 'Stop'),
    key: 'stopLoss',
    width: 100,
    render: (s) => fmtNum(s.stopLoss),
  },
  {
    title: t('signals.strength'),
    key: 'strength',
    width: 70,
    render: (s) =>
      h(
        NTooltip,
        {},
        {
          trigger: () => fmtNum(s.strength, 2),
          default: () => t('signals.strengthHelp'),
        },
      ),
  },
  {
    title: t('signals.reason'),
    key: 'reason',
    ellipsis: { tooltip: true },
    render: (s) =>
      h(
        NTooltip,
        {},
        {
          trigger: () => s.reason,
          default: () =>
            Object.entries(s.indicators)
              .map(([k, v]) => `${k}: ${fmtNum(v, 2)}`)
              .join(' · '),
        },
      ),
  },
]);
</script>

<template>
  <NDataTable
    :columns="columns"
    :data="signals"
    :loading="loading"
    :row-key="(s: Signal) => s.id"
    :pagination="{ pageSize: 20 }"
    size="small"
  />
</template>
