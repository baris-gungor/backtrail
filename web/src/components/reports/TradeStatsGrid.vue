<script setup lang="ts">
import { computed } from 'vue';
import { NCard, NGrid, NGridItem, NStatistic } from 'naive-ui';
import type { TradeStats } from '../../api/client';
import { fmtDec, fmtNum, fmtPct, pnlColor } from '../../format';
import { t } from '../../i18n';

const props = defineProps<{ stats: TradeStats }>();

const cards = computed(() => {
  const s = props.stats;
  return [
    {
      label: t('reports.stats.trades'),
      value: String(s.trades),
      sub: t('reports.stats.winsLosses', { wins: s.wins, losses: s.losses }),
    },
    { label: t('reports.stats.totalPnl'), value: fmtDec(s.totalPnl), color: pnlColor(s.totalPnl) },
    { label: t('reports.stats.winRate'), value: fmtPct(s.winRate, 0) },
    { label: 'Profit factor', value: fmtNum(s.profitFactor) },
    {
      label: t('reports.stats.expectancy'),
      value: fmtNum(s.expectancy),
      sub: t('reports.stats.avgReturn', { value: fmtPct(s.avgReturn, 2) }),
    },
    {
      label: t('reports.stats.streaks'),
      value: `${s.maxWinStreak} / ${s.maxLossStreak}`,
      sub: t('reports.stats.streaksSub', { hours: fmtNum(s.avgHoldingHours, 0) }),
    },
  ];
});
</script>

<template>
  <NGrid :cols="6" :x-gap="12" :y-gap="12" responsive="screen" item-responsive>
    <NGridItem v-for="c in cards" :key="c.label" span="6 m:3 l:1">
      <NCard size="small">
        <NStatistic :label="c.label">
          <span :style="{ color: c.color }">{{ c.value }}</span>
        </NStatistic>
        <div class="sub">{{ c.sub }}</div>
      </NCard>
    </NGridItem>
  </NGrid>
</template>

<style scoped>
.sub {
  font-size: 12px;
  opacity: 0.6;
  margin-top: 4px;
  min-height: 16px;
}
</style>
