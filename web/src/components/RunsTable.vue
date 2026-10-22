<script setup lang="ts">
import { computed, h } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { NDataTable, NTag, NTooltip, type DataTableColumns } from 'naive-ui';
import type { BacktestRun } from '../api/client';
import { RATING_TAG, rate } from '../glossary';
import { configLabel, fmtNum, fmtPct, paramsText, pnlColor, segmentLabel } from '../format';
import Term from './Term.vue';

defineProps<{ runs: BacktestRun[]; loading?: boolean }>();
const router = useRouter();
const { t } = useI18n();

const STATUS_TYPES = {
  pending: 'default',
  running: 'info',
  success: 'success',
  failed: 'error',
} as const;

const signed = (v: number | null | undefined, text: string) =>
  h('span', { style: { color: pnlColor(v) } }, text);

const term = (k: string, label: string) => () => h(Term, { k }, () => label);

/** Value with a small colored dot for the good / fair / weak rating. */
const rated = (metric: string, v: number | null | undefined, text: string) => {
  const r = rate(metric, v);
  return h(
    'span',
    {
      class: r ? `rated ${RATING_TAG[r]}` : undefined,
      title: r ? t(`labels.rating.${r}`) : undefined,
    },
    text,
  );
};

/** Settings that make runs with the same params differ: shown so leaderboard rows are told apart. */
const variantTags = (r: BacktestRun) =>
  [
    r.execution.adjustRolls && 'roll',
    r.execution.earnings && t('runs.earningsTag'),
    r.execution.direction === 'short' && 'short',
    r.execution.direction === 'both' && 'L+S',
  ]
    .filter(Boolean)
    .map((label) =>
      h(NTag, { size: 'tiny', bordered: false, style: 'margin-left: 4px' }, () => label),
    );

const columns = computed<DataTableColumns<BacktestRun>>(() => [
  { title: t('trades.symbol'), key: 'symbol', width: 80 },
  {
    title: t('trades.strategy'),
    key: 'strategyCode',
    width: 200,
    render: (r) =>
      h(
        NTooltip,
        {},
        {
          trigger: () =>
            h('span', {}, [
              configLabel(r.strategyCode, r.configName ?? t('runs.custom')),
              ...variantTags(r),
            ]),
          default: () => `${r.strategyCode} · ${paramsText(r.params)}`,
        },
      ),
  },
  {
    title: term('segment', t('runs.segment')),
    key: 'segment',
    width: 95,
    render: (r) => segmentLabel(r.segment),
  },
  {
    title: t('reports.stats.trades'),
    key: 'trades',
    width: 80,
    render: (r) =>
      r.metrics?.lowSample
        ? h(
            NTooltip,
            {},
            {
              trigger: () =>
                h(
                  NTag,
                  { size: 'small', type: 'warning', bordered: false },
                  () => `⚠ ${r.metrics!.trades}`,
                ),
              default: () => t('runs.lowSample'),
            },
          )
        : String(r.metrics?.trades ?? '—'),
  },
  {
    title: t('reports.return'),
    key: 'totalReturn',
    render: (r) => signed(r.metrics?.totalReturn, fmtPct(r.metrics?.totalReturn, 1)),
  },
  { title: term('cagr', 'CAGR'), key: 'cagr', render: (r) => fmtPct(r.metrics?.cagr, 1) },
  {
    title: term('sharpe', 'Sharpe'),
    key: 'sharpe',
    render: (r) => rated('sharpe', r.metrics?.sharpe, fmtNum(r.metrics?.sharpe)),
  },
  {
    title: term('sortino', 'Sortino'),
    key: 'sortino',
    render: (r) => rated('sortino', r.metrics?.sortino, fmtNum(r.metrics?.sortino)),
  },
  {
    title: term('maxDrawdown', t('runs.maxDrawdown')),
    key: 'maxDrawdown',
    render: (r) => rated('maxDrawdown', r.metrics?.maxDrawdown, fmtPct(r.metrics?.maxDrawdown, 1)),
  },
  {
    title: term('winRate', t('runs.winRate')),
    key: 'winRate',
    render: (r) => fmtPct(r.metrics?.winRate, 0),
  },
  {
    title: term('profitFactor', 'PF'),
    key: 'profitFactor',
    render: (r) => rated('profitFactor', r.metrics?.profitFactor, fmtNum(r.metrics?.profitFactor)),
  },
  {
    title: term('benchmark', t('labels.strategy.buy_and_hold')),
    key: 'benchmark',
    render: (r) => fmtPct(r.metrics?.benchmark.totalReturn, 1),
  },
  {
    title: term('alpha', 'Alpha'),
    key: 'alpha',
    render: (r) => signed(r.metrics?.alpha, fmtPct(r.metrics?.alpha, 1)),
  },
  {
    title: t('runs.status'),
    key: 'status',
    width: 90,
    render: (r) =>
      h(NTag, { size: 'small', bordered: false, type: STATUS_TYPES[r.status] }, () =>
        t(`runs.statuses.${r.status}`),
      ),
  },
]);

const rowProps = (r: BacktestRun) => ({
  style: 'cursor: pointer',
  onClick: () => router.push(`/backtests/${r.id}`),
});
</script>

<template>
  <NDataTable
    :columns="columns"
    :data="runs"
    :loading="loading"
    :row-props="rowProps"
    :row-key="(r: BacktestRun) => r.id"
    size="small"
    :pagination="{ pageSize: 25 }"
  />
</template>

<style scoped>
:deep(.rated)::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-right: 5px;
  vertical-align: middle;
}
:deep(.rated.success)::before {
  background: var(--up);
}
:deep(.rated.warning)::before {
  background: var(--warn);
}
:deep(.rated.error)::before {
  background: var(--down);
}
</style>
