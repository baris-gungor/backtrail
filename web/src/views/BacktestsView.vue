<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  NAlert,
  NButton,
  NCard,
  NCheckbox,
  NDatePicker,
  NForm,
  NFormItem,
  NInputNumber,
  NProgress,
  NSelect,
  NSpace,
  NTabPane,
  NTabs,
  useMessage,
} from 'naive-ui';
import { useI18n } from 'vue-i18n';
import {
  api,
  call,
  errorMessage,
  type BacktestRun,
  type Batch,
  type Strategy,
} from '../api/client';
import ParamGridForm from '../components/ParamGridForm.vue';
import RunsTable from '../components/RunsTable.vue';
import WalkForwardPanel from '../components/WalkForwardPanel.vue';
import { useAssets } from '../composables/useAssets';
import { useBatch } from '../composables/useBatch';
import PageHead from '../components/PageHead.vue';
import Term from '../components/Term.vue';
import { configLabel, directionOptions, strategyFullName } from '../format';
import { gridCombinations, gridRows, toParamGrid, type GridRow } from '../params';
import type { paths } from '../api/schema';

type LeaderboardQuery = NonNullable<
  paths['/api/backtests/leaderboard']['get']['parameters']['query']
>;
type Metric = NonNullable<LeaderboardQuery['metric']>;
type SizingType = 'all_in' | 'fixed_fraction' | 'risk_per_trade';

const message = useMessage();
const { t } = useI18n();
const { assets } = useAssets();
const strategies = ref<Strategy[]>([]);

const symbolOptions = computed(() =>
  assets.value.map((a) => ({ label: a.symbol, value: a.symbol })),
);
/** "code/config" for every stored config. */
const configOptions = computed(() =>
  strategies.value.flatMap((s) =>
    s.configs.map((c) => ({
      label: `${configLabel(s.code, c.name)}${c.isActive ? '' : ` (${t('assets.inactive')})`}`,
      value: `${s.code}/${c.name}`,
    })),
  ),
);
const strategyOptions = computed(() =>
  strategies.value
    .filter((s) => !s.isBenchmark)
    .map((s) => ({ label: strategyFullName(s.code), value: s.code })),
);

const shortCapable = computed(() =>
  strategies.value
    .filter((s) => s.canShort)
    .map((s) => strategyFullName(s.code))
    .join(', '),
);

// Shared run settings.
const range = ref<[number, number] | null>(null);
const capital = ref(10_000);
const feeBps = ref(5);
const slippageBps = ref(5);
const sizingType = ref<SizingType>('fixed_fraction');
const sizingValue = ref(1);
const adjustRolls = ref(false);
const earningsExit = ref(false);
const earningsBlockDays = ref(0);
const direction = ref<'long' | 'short' | 'both'>('long');
const borrowPct = ref(0);
const sizingOptions = computed(() => [
  { label: t('backtests.sizing.fixed_fraction'), value: 'fixed_fraction' },
  { label: t('backtests.sizing.all_in'), value: 'all_in' },
  { label: t('backtests.sizing.risk_per_trade'), value: 'risk_per_trade' },
]);

function settings() {
  return {
    from: range.value ? new Date(range.value[0]).toISOString() : undefined,
    to: range.value ? new Date(range.value[1]).toISOString() : undefined,
    initialCapital: capital.value,
    execution: {
      feeBps: feeBps.value,
      slippageBps: slippageBps.value,
      ...(direction.value !== 'long' && borrowPct.value ? { borrowPct: borrowPct.value } : {}),
    },
    sizing:
      sizingType.value === 'fixed_fraction'
        ? { type: sizingType.value, fraction: sizingValue.value }
        : sizingType.value === 'risk_per_trade'
          ? { type: sizingType.value, riskPct: sizingValue.value }
          : { type: sizingType.value },
    adjustRolls: adjustRolls.value || undefined,
    earnings:
      earningsExit.value || earningsBlockDays.value > 0
        ? { exitBefore: earningsExit.value, blockEntryDays: earningsBlockDays.value }
        : undefined,
    direction: direction.value === 'long' ? undefined : direction.value,
  };
}

// Leaderboard.
const board = ref<BacktestRun[]>([]);
const boardLoading = ref(false);
const boardSymbol = ref<string | null>(null);
const boardMetric = ref<Metric>('sharpe');
const boardSegment = ref<'full' | 'oos'>('full');
const segmentOptions = computed(() => [
  { label: t('backtests.fullRuns'), value: 'full' },
  { label: 'Walk-forward (OOS)', value: 'oos' },
]);
const BOARD_METRICS: Metric[] = [
  'sharpe',
  'sortino',
  'calmar',
  'totalReturn',
  'cagr',
  'alpha',
  'profitFactor',
  'winRate',
  'expectancy',
];
const metricOptions = computed(() => [
  ...BOARD_METRICS.map((value) => ({ label: t(`matrix.metrics.${value}`), value })),
  { label: t('backtests.maxDrawdownLowBetter'), value: 'maxDrawdown' as Metric },
]);

async function loadBoard(): Promise<void> {
  boardLoading.value = true;
  try {
    board.value = await call(
      api.GET('/api/backtests/leaderboard', {
        params: {
          query: {
            symbol: boardSymbol.value ?? undefined,
            metric: boardMetric.value,
            segment: boardSegment.value,
            limit: 500,
          },
        },
      }),
    );
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    boardLoading.value = false;
  }
}

onMounted(async () => {
  try {
    strategies.value = await call(api.GET('/api/analysis/strategies'));
  } catch (e) {
    message.error(errorMessage(e));
  }
  await loadBoard();
});

// Matrix run.
const runSymbols = ref<string[]>([]);
const runConfigs = ref<string[]>([]);
const submitting = ref(false);
const matrix = useBatch((b) => {
  message.success(
    b.failed
      ? t('backtests.doneWithErrors', { n: b.success, failed: b.failed })
      : t('backtests.done', { n: b.success }),
  );
  void loadBoard();
});

async function runMatrix(): Promise<void> {
  submitting.value = true;
  try {
    const { batchId } = await call(
      api.POST('/api/backtests', {
        body: {
          ...settings(),
          symbols: runSymbols.value,
          strategies: runConfigs.value.length
            ? runConfigs.value.map((v) => {
                const [code, config] = v.split('/');
                return { code, config };
              })
            : undefined,
        },
      }),
    );
    await matrix.poll(batchId);
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    submitting.value = false;
  }
}

const progress = (b: Batch | undefined) =>
  b ? Math.round(((b.success + b.failed) / Math.max(b.total, 1)) * 100) : 0;

// Sweep.
const sweepSymbol = ref<string | null>(null);
const sweepStrategy = ref<string | null>(null);
const trainRatio = ref(0.7);
const top = ref(5);
const grid = ref<GridRow[]>([]);

function onSweepStrategy(code: string | null): void {
  sweepStrategy.value = code;
  const strategy = strategies.value.find((s) => s.code === code);
  grid.value = strategy ? gridRows(strategy.paramsSchema) : [];
}

const combinations = computed(() => gridCombinations(grid.value));

interface SweepRow {
  params: Record<string, unknown>;
  train: BacktestRun;
  test?: BacktestRun;
}
const sweepRows = ref<SweepRow[]>([]);
const sweeping = ref(false);
const sweep = useBatch((b) => {
  const key = (r: BacktestRun) => JSON.stringify(r.params);
  const tests = new Map(b.runs.filter((r) => r.segment === 'test').map((r) => [key(r), r]));
  sweepRows.value = b.runs
    .filter((r) => r.segment === 'train')
    .map((train) => ({ params: train.params, train, test: tests.get(key(train)) }))
    .sort((x, y) => (y.train.metrics?.sharpe ?? -1e9) - (x.train.metrics?.sharpe ?? -1e9));
  message.success(t('backtests.sweepDone', { n: b.total }));
});

async function runSweep(): Promise<void> {
  if (!sweepSymbol.value || !sweepStrategy.value) return;
  sweeping.value = true;
  sweepRows.value = [];
  try {
    const paramGrid = toParamGrid(grid.value);
    const { batchId } = await call(
      api.POST('/api/backtests/sweep', {
        body: {
          ...settings(),
          symbol: sweepSymbol.value,
          strategy: { code: sweepStrategy.value },
          paramGrid,
          trainRatio: trainRatio.value,
          top: top.value,
        },
      }),
    );
    await sweep.poll(batchId);
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    sweeping.value = false;
  }
}

/** Sweep rows as runs for the table: train metrics, with the test run next to the best ones. */
const sweepTrainRuns = computed(() => sweepRows.value.map((r) => r.train));
const sweepTestRuns = computed(() => sweepRows.value.flatMap((r) => (r.test ? [r.test] : [])));
</script>

<template>
  <div class="stack">
    <PageHead :title="t('nav.backtests')" :text="t('backtests.intro')" />

    <NCard :title="t('backtests.shared')" size="small">
      <NForm inline label-placement="top" size="small">
        <NFormItem :label="t('backtests.period')">
          <NDatePicker v-model:value="range" type="daterange" clearable />
        </NFormItem>
        <NFormItem :label="t('backtest.capital')">
          <NInputNumber v-model:value="capital" :min="100" :step="1000" style="width: 130px" />
        </NFormItem>
        <NFormItem>
          <template #label
            ><Term k="bps">{{ t('backtests.feeBps') }}</Term></template
          >
          <NInputNumber v-model:value="feeBps" :min="0" :max="1000" style="width: 100px" />
        </NFormItem>
        <NFormItem>
          <template #label><Term k="slippage">Slippage (bps)</Term></template>
          <NInputNumber v-model:value="slippageBps" :min="0" :max="1000" style="width: 100px" />
        </NFormItem>
        <NFormItem :label="t('backtest.sizing')">
          <div class="hstack" style="--gap: 4px">
            <NSelect v-model:value="sizingType" :options="sizingOptions" style="width: 160px" />
            <NInputNumber
              v-if="sizingType !== 'all_in'"
              v-model:value="sizingValue"
              :min="0.01"
              :max="sizingType === 'fixed_fraction' ? 1 : 100"
              :step="sizingType === 'fixed_fraction' ? 0.05 : 0.5"
              style="width: 100px"
            />
          </div>
        </NFormItem>
        <NFormItem>
          <template #label
            ><Term k="rollAdjust">{{ t('backtest.rollAdjust') }}</Term></template
          >
          <NCheckbox v-model:checked="adjustRolls">{{ t('backtests.onFutures') }}</NCheckbox>
        </NFormItem>
        <NFormItem>
          <template #label
            ><Term k="earnings">{{ t('backtest.earningsFilter') }}</Term></template
          >
          <div class="hstack" style="--gap: 4px 8px">
            <NCheckbox v-model:checked="earningsExit">{{ t('backtest.closeBefore') }}</NCheckbox>
            <span>{{ t('backtests.entryBlock') }}</span>
            <NInputNumber
              v-model:value="earningsBlockDays"
              :min="0"
              :max="30"
              style="width: 90px"
            />
            <span>{{ t('backtests.days') }}</span>
          </div>
        </NFormItem>
        <NFormItem>
          <template #label
            ><Term k="short">{{ t('signals.side') }}</Term></template
          >
          <div class="hstack" style="--gap: 4px 8px">
            <NSelect v-model:value="direction" :options="directionOptions()" style="width: 150px" />
            <template v-if="direction !== 'long'">
              <span>{{ t('backtests.borrow') }}</span>
              <NInputNumber v-model:value="borrowPct" :min="0" :max="100" style="width: 90px" />
              <span>{{ t('backtests.perYear') }}</span>
            </template>
          </div>
        </NFormItem>
      </NForm>
      <NAlert v-if="direction !== 'long'" type="info" :show-icon="false" style="margin-top: 8px">
        {{ t('backtests.shortOnly', { list: shortCapable || '—' }) }}
      </NAlert>
    </NCard>

    <NTabs type="line" animated>
      <NTabPane name="matrix" :tab="t('backtests.tabs.matrix')">
        <div class="stack" style="--gap: 12px">
          <NSpace align="center">
            <NSelect
              v-model:value="runSymbols"
              :options="symbolOptions"
              multiple
              :placeholder="t('backtests.symbols')"
              style="width: 280px"
            />
            <NSelect
              v-model:value="runConfigs"
              :options="configOptions"
              multiple
              clearable
              :placeholder="t('backtests.strategies')"
              style="width: 420px"
            />
            <NButton
              type="primary"
              :loading="submitting"
              :disabled="runSymbols.length === 0"
              @click="runMatrix"
            >
              {{ t('backtests.run') }}
            </NButton>
          </NSpace>
          <NProgress
            v-if="submitting && matrix.batch.value"
            type="line"
            :percentage="progress(matrix.batch.value)"
          />

          <NSpace align="center">
            <span>{{ t('backtests.ranking') }}</span>
            <NSelect
              v-model:value="boardSymbol"
              :options="symbolOptions"
              clearable
              :placeholder="t('backtests.allSymbols')"
              style="width: 160px"
              @update:value="loadBoard"
            />
            <NSelect
              v-model:value="boardSegment"
              :options="segmentOptions"
              style="width: 190px"
              @update:value="loadBoard"
            />
            <NSelect
              v-model:value="boardMetric"
              :options="metricOptions"
              style="width: 220px"
              @update:value="loadBoard"
            />
          </NSpace>
          <RunsTable :runs="board" :loading="boardLoading" />
          <span class="hint">{{ t('backtests.boardHelp') }}</span>
        </div>
      </NTabPane>

      <NTabPane name="sweep" :tab="t('backtests.tabs.sweep')">
        <div class="stack" style="--gap: 12px">
          <NSpace align="center">
            <NSelect
              v-model:value="sweepSymbol"
              :options="symbolOptions"
              :placeholder="t('trades.symbol')"
              style="width: 140px"
            />
            <NSelect
              :value="sweepStrategy"
              :options="strategyOptions"
              :placeholder="t('trades.strategy')"
              style="width: 300px"
              @update:value="onSweepStrategy"
            />
            <Term k="segment">{{ t('walkForward.trainRatio') }}</Term>
            <NInputNumber
              v-model:value="trainRatio"
              :min="0.1"
              :max="0.95"
              :step="0.05"
              style="width: 90px"
            />
            <span>{{ t('backtests.topToTest') }}</span>
            <NInputNumber v-model:value="top" :min="1" :max="50" style="width: 80px" />
          </NSpace>

          <ParamGridForm :rows="grid" />

          <NSpace align="center">
            <NButton
              type="primary"
              :loading="sweeping"
              :disabled="!sweepSymbol || !sweepStrategy || combinations > 500"
              @click="runSweep"
            >
              {{ t('backtests.startSweep') }}
            </NButton>
            <span :class="{ error: combinations > 500 }">
              {{ t('backtests.combinations', { n: combinations, max: 500 }) }}
            </span>
          </NSpace>
          <NProgress
            v-if="sweeping && sweep.batch.value"
            type="line"
            :percentage="progress(sweep.batch.value)"
          />

          <template v-if="sweepRows.length">
            <NAlert type="info" :show-icon="false">
              {{ t('backtests.sweepHelp', { n: sweepTestRuns.length }) }}
            </NAlert>
            <h3 class="section">{{ t('backtests.testPeriod') }}</h3>
            <RunsTable :runs="sweepTestRuns" />
            <h3 class="section">{{ t('backtests.trainPeriod') }}</h3>
            <RunsTable :runs="sweepTrainRuns" />
          </template>
        </div>
      </NTabPane>

      <NTabPane name="walk-forward" tab="Walk-forward">
        <WalkForwardPanel :strategies="strategies" :settings="settings" />
      </NTabPane>
    </NTabs>
  </div>
</template>

<style scoped>
.hint {
  font-size: 12px;
  opacity: 0.6;
}
.error {
  color: #ef5350;
}
.section {
  margin: 8px 0 0;
}
</style>
