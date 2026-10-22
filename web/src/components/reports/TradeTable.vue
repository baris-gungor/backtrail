<script setup lang="ts">
import { computed, h } from 'vue';
import { NDataTable, NTag, type DataTableColumns } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import type { TradeRecord } from '../../api/client';
import {
  configLabel,
  exitReasonLabel,
  fmtDate,
  fmtDec,
  fmtNum,
  fmtPct,
  pnlColor,
} from '../../format';

defineProps<{ trades: TradeRecord[]; pageSize?: number; loading?: boolean }>();
const { t } = useI18n();

const columns = computed<DataTableColumns<TradeRecord>>(() => [
  {
    title: t('trades.source'),
    key: 'source',
    width: 85,
    render: (r) =>
      h(
        NTag,
        { size: 'small', bordered: false, type: r.source === 'paper' ? 'warning' : 'default' },
        () => (r.source === 'paper' ? t('trades.sourcePaper') : 'backtest'),
      ),
  },
  {
    title: t('trades.strategy'),
    key: 'strategyCode',
    render: (r) =>
      r.strategyCode ? configLabel(r.strategyCode, r.configName) : t('labels.orderSource.manual'),
  },
  { title: t('trades.symbol'), key: 'symbol', width: 80 },
  { title: t('trades.entry'), key: 'entryTime', render: (r) => fmtDate(r.entryTime) },
  { title: t('trades.entryPrice'), key: 'entryPrice', render: (r) => fmtNum(r.entryPrice) },
  { title: t('trades.exit'), key: 'exitTime', render: (r) => fmtDate(r.exitTime) },
  { title: t('trades.exitPrice'), key: 'exitPrice', render: (r) => fmtNum(r.exitPrice) },
  { title: t('trades.quantity'), key: 'quantity', render: (r) => fmtDec(r.quantity, 4) },
  {
    title: t('trades.pnl'),
    key: 'pnl',
    render: (r) =>
      h(
        'span',
        { style: { color: pnlColor(r.pnl) } },
        `${fmtDec(r.pnl)} (${fmtPct(r.returnPct, 1)})`,
      ),
  },
  {
    title: t('trades.exitReason'),
    key: 'exitReason',
    render: (r) => exitReasonLabel(r.exitReason),
  },
]);
</script>

<template>
  <NDataTable
    :columns="columns"
    :data="trades"
    :loading="loading"
    size="small"
    :pagination="pageSize ? { pageSize } : false"
  />
</template>
