<script setup lang="ts">
import { NCard, NGi, NGrid, NStatistic, NTag } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { te } from '../i18n';
import type { AssetSummary } from '../api/client';
import { fmtDate, fmtNum, sideLabel, strategyName } from '../format';

defineProps<{ summary: AssetSummary }>();
const { t } = useI18n();

type TagType = 'success' | 'error' | 'warning' | 'default';

/** Labels for the summary states; unknown values are shown as they come. */
const stateLabel = (state: string): string =>
  te(`summary.state.${state}`) ? t(`summary.state.${state}`) : state;
const stateType = (state: string): TagType =>
  (({ up: 'success', bullish: 'success', down: 'error', bearish: 'error', high: 'warning' })[
    state
  ] as TagType | undefined) ?? 'default';
</script>

<template>
  <NGrid :cols="4" :x-gap="12" :y-gap="12" responsive="screen" item-responsive>
    <NGi span="2 m:1">
      <NCard size="small" :title="t('summary.price')">
        <NStatistic :value="fmtNum(summary.price)" />
        <div class="sub">{{ t('summary.lastBar', { time: fmtDate(summary.asOf) }) }}</div>
      </NCard>
    </NGi>
    <NGi span="2 m:1">
      <NCard size="small" title="Trend">
        <NTag :type="stateType(summary.trend.state)" :bordered="false">{{
          stateLabel(summary.trend.state)
        }}</NTag>
        <div class="sub">EMA: {{ summary.trend.emaAlignment ?? '—' }}</div>
        <div class="sub">
          {{
            t('summary.adx', {
              adx: fmtNum(summary.trend.adx, 1),
              pct: fmtNum(summary.trend.priceVsEma200Pct, 1),
            })
          }}
        </div>
      </NCard>
    </NGi>
    <NGi span="2 m:1">
      <NCard size="small" title="Momentum">
        <NTag :type="stateType(summary.momentum.state)" :bordered="false">{{
          stateLabel(summary.momentum.state)
        }}</NTag>
        <div class="sub">
          RSI {{ fmtNum(summary.momentum.rsi, 1) }} · MACD hist
          {{ fmtNum(summary.momentum.macdHistogram, 3) }}
        </div>
      </NCard>
    </NGi>
    <NGi span="2 m:1">
      <NCard size="small" :title="t('summary.volatility')">
        <NTag :type="stateType(summary.volatility.state)" :bordered="false">{{
          stateLabel(summary.volatility.state)
        }}</NTag>
        <div class="sub">
          {{
            t('summary.atr', {
              atr: fmtNum(summary.volatility.atrPct, 2),
              pct: fmtNum(summary.volatility.bandwidthPercentile, 0),
            })
          }}
        </div>
      </NCard>
    </NGi>
    <NGi span="4">
      <NCard size="small">
        <template #header>
          {{
            t('summary.consensus', {
              long: summary.consensus.long,
              flat: summary.consensus.flat,
            })
          }}
          <span class="sub">{{
            t('summary.consensusScore', { score: fmtNum(summary.consensus.score, 2) })
          }}</span>
        </template>
        <div class="strategies">
          <div v-for="s in summary.strategies" :key="s.configId" class="strategy">
            <NTag
              :type="s.position === 'long' ? 'success' : 'default'"
              size="small"
              :bordered="false"
            >
              {{ strategyName(s.code) }} · {{ stateLabel(s.position) }}
            </NTag>
            <div v-if="s.configName !== 'default'" class="sub">{{ s.configName }}</div>
            <div v-if="s.lastSignal" class="sub">
              {{
                t('summary.lastSignal', {
                  side: sideLabel(s.lastSignal.side),
                  price: fmtNum(s.lastSignal.price),
                  time: fmtDate(s.lastSignal.barTime),
                })
              }}
            </div>
          </div>
        </div>
      </NCard>
    </NGi>
  </NGrid>
</template>

<style scoped>
.sub {
  font-size: 12px;
  color: var(--muted);
  margin-top: 4px;
}
.strategies {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}
.strategy {
  min-width: 200px;
}
</style>
