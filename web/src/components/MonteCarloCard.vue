<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NButton, NCard, NSpin } from 'naive-ui';
import { api, call, errorMessage, type Schemas } from '../api/client';
import { useI18n } from 'vue-i18n';
import { fmtPct, pnlColor } from '../format';
import MetricCard from './MetricCard.vue';
import Term from './Term.vue';

/** Monte Carlo of a backtest run's trades. Loaded on demand. */
const props = defineProps<{ runId: string; trades: number }>();
const { t } = useI18n();

type MonteCarlo = Schemas['MonteCarloDto'];
const result = ref<MonteCarlo>();
const loading = ref(false);
const error = ref<string>();
const MIN_TRADES = 5;

async function load(): Promise<void> {
  loading.value = true;
  error.value = undefined;
  try {
    result.value = await call(
      api.GET('/api/backtests/{id}/monte-carlo', { params: { path: { id: props.runId } } }),
    );
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}
watch(
  () => props.runId,
  () => {
    result.value = undefined;
    if (props.trades >= MIN_TRADES) void load();
  },
  { immediate: true },
);

/** Positions on the 5%–95% bar, in percent of its width. */
const bar = computed(() => {
  const r = result.value;
  if (!r) return null;
  const lo = Math.min(r.totalReturn.p5, r.actual.totalReturn, 0);
  const hi = Math.max(r.totalReturn.p95, r.actual.totalReturn, 0);
  const span = hi - lo || 1;
  const at = (v: number) => `${((v - lo) / span) * 100}%`;
  return {
    left: at(r.totalReturn.p5),
    width: `${((r.totalReturn.p95 - r.totalReturn.p5) / span) * 100}%`,
    median: at(r.totalReturn.p50),
    actual: at(r.actual.totalReturn),
    zero: at(0),
  };
});
</script>

<template>
  <NCard size="small">
    <template #header>
      <Term k="monteCarlo">{{ t('monteCarlo.title') }}</Term>
    </template>
    <span v-if="trades < MIN_TRADES" class="hint">
      {{ t('monteCarlo.tooFew', { min: MIN_TRADES, n: trades }) }}
    </span>
    <span v-else-if="error" class="hint">
      {{ error }} <NButton size="tiny" @click="load">{{ t('common.retry') }}</NButton>
    </span>
    <NSpin v-else :show="loading">
      <div v-if="result && bar" class="stack" style="--gap: 12px">
        <span class="hint">
          {{ t('monteCarlo.explain', { trades: result.trades, samples: result.samples }) }}
        </span>
        <div>
          <div class="range">
            <div class="zero" :style="{ left: bar.zero }" title="%0" />
            <div class="band" :style="{ left: bar.left, width: bar.width }" />
            <div class="median" :style="{ left: bar.median }" />
            <div class="actual" :style="{ left: bar.actual }" />
          </div>
          <div class="hstack between labels">
            <span :style="{ color: pnlColor(result.totalReturn.p5) }">
              %5: {{ fmtPct(result.totalReturn.p5) }}
            </span>
            <span>{{ t('monteCarlo.median', { value: fmtPct(result.totalReturn.p50) }) }}</span>
            <span :style="{ color: pnlColor(result.totalReturn.p95) }">
              %95: {{ fmtPct(result.totalReturn.p95) }}
            </span>
          </div>
        </div>
        <div class="grid-cards" style="--min: 170px">
          <MetricCard
            :label="t('monteCarlo.lossProbability')"
            :value="fmtPct(result.lossProbability, 0)"
            :color="result.lossProbability > 0.3 ? 'var(--down)' : undefined"
            :sub="t('monteCarlo.lossProbabilitySub')"
          />
          <MetricCard
            :label="t('monteCarlo.badDrawdown')"
            term="maxDrawdown"
            :value="fmtPct(result.maxDrawdown.p95)"
            :sub="t('monteCarlo.badDrawdownSub', { actual: fmtPct(result.actual.maxDrawdown) })"
          />
          <MetricCard
            :label="t('monteCarlo.orderLuck')"
            :value="fmtPct(result.shuffledMaxDrawdown.p95)"
            :sub="t('monteCarlo.orderLuckSub')"
          />
        </div>
      </div>
    </NSpin>
  </NCard>
</template>

<style scoped>
.range {
  position: relative;
  height: 18px;
  margin: 4px 0;
  background: var(--border);
  border-radius: 9px;
}
.band {
  position: absolute;
  top: 0;
  bottom: 0;
  background: var(--primary-soft);
  border: 1px solid var(--primary);
  border-radius: 9px;
}
.median,
.zero {
  position: absolute;
  top: -3px;
  bottom: -3px;
  width: 2px;
  background: var(--primary);
}
.zero {
  background: var(--muted);
}
.actual {
  position: absolute;
  top: 3px;
  width: 12px;
  height: 12px;
  margin-left: -6px;
  border-radius: 50%;
  background: var(--text);
}
.labels {
  font-size: 12px;
  color: var(--muted);
}
</style>
