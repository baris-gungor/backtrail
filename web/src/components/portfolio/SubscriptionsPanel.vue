<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  NButton,
  NDataTable,
  NInputNumber,
  NPopconfirm,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NTag,
  NTooltip,
  useMessage,
  type DataTableColumns,
} from 'naive-ui';
import {
  api,
  call,
  errorMessage,
  type PortfolioDetail,
  type Strategy,
  type Subscription,
} from '../../api/client';
import { useAction } from '../../composables/useAction';
import { useAssets } from '../../composables/useAssets';
import {
  configLabel,
  directionLabel,
  directionOptions,
  fmtDate,
  healthLabel,
  HEALTH_TAGS,
  strategyFullName,
} from '../../format';
import EmptyState from '../EmptyState.vue';
import Term from '../Term.vue';

const props = defineProps<{ portfolio: PortfolioDetail }>();
const emit = defineEmits<{ changed: [] }>();
const message = useMessage();
const { t } = useI18n();
const { assets, refresh: refreshAssets } = useAssets();
const { busy, act } = useAction(() => emit('changed'));

const strategies = ref<Strategy[]>([]);
onMounted(() => {
  Promise.all([
    refreshAssets(),
    call(api.GET('/api/analysis/strategies')).then((s) => (strategies.value = s)),
  ]).catch((e: unknown) => message.error(errorMessage(e)));
});

const path = computed(() => ({ id: props.portfolio.id }));

async function checkHealth(): Promise<void> {
  await act(
    () => call(api.POST('/api/portfolios/{id}/health', { params: { path: path.value } })),
    t('subscriptions.healthChecked'),
  );
}

const columns = computed<DataTableColumns<Subscription>>(() => [
  { title: t('trades.symbol'), key: 'symbol', width: 80 },
  {
    title: t('trades.strategy'),
    key: 'strategyCode',
    render: (s) =>
      h(
        'span',
        { title: strategyFullName(s.strategyCode) },
        configLabel(s.strategyCode, s.configName),
      ),
  },
  {
    title: () => h(Term, { k: 'source' }, () => t('trades.source')),
    key: 'source',
    render: (s) =>
      s.source === 'signals'
        ? t('portfolioReport.storedSignals')
        : t('portfolioReport.strategyRules'),
  },
  {
    title: t('subscriptions.allocation'),
    key: 'allocationPct',
    render: (s) =>
      s.allocationPct
        ? t('subscriptions.allocationPct', { pct: s.allocationPct })
        : t('subscriptions.portfolioSetting'),
  },
  {
    title: () => h(Term, { k: 'short' }, () => t('signals.side')),
    key: 'direction',
    render: (s) => directionLabel(s.direction),
  },
  {
    title: t('subscriptions.lastBar'),
    key: 'lastBarTime',
    render: (s) => fmtDate(s.lastBarTime),
  },
  {
    title: () => h(Term, { k: 'health' }, () => t('subscriptions.health')),
    key: 'health',
    render: (s) => {
      const health = s.health;
      if (!health) return h('span', { class: 'hint' }, t('subscriptions.notChecked'));
      const tag = h(NTag, { size: 'small', bordered: false, type: HEALTH_TAGS[health.level] }, () =>
        healthLabel(health.level),
      );
      const lines = health.checks.map((c) =>
        h('div', `${c.level === 'warning' ? '⚠ ' : c.level === 'info' ? 'ℹ ' : '· '}${c.message}`),
      );
      return h(
        NTooltip,
        { style: { maxWidth: '320px' } },
        {
          trigger: () => tag,
          default: () => [
            ...lines,
            h(
              'div',
              { class: 'hint' },
              t('subscriptions.checkedAt', { time: fmtDate(health.checkedAt) }),
            ),
          ],
        },
      );
    },
  },
  {
    title: t('runs.status'),
    key: 'isActive',
    render: (s) =>
      h(NTag, { size: 'small', type: s.isActive ? 'success' : 'default' }, () =>
        s.isActive ? t('portfolios.active') : t('subscriptions.stopped'),
      ),
  },
  {
    title: '',
    key: 'remove',
    width: 90,
    render: (s) =>
      s.isActive
        ? h(
            NPopconfirm,
            {
              onPositiveClick: () =>
                act(
                  () =>
                    call(
                      api.DELETE('/api/portfolios/{id}/subscriptions/{subId}', {
                        params: { path: { id: props.portfolio.id, subId: s.id } },
                      }),
                    ),
                  t('subscriptions.stoppedDone'),
                ),
            },
            {
              trigger: () => h(NButton, { size: 'tiny' }, () => t('subscriptions.stop')),
              default: () => t('subscriptions.stopConfirm'),
            },
          )
        : null,
  },
]);

const symbolOptions = computed(() =>
  assets.value.map((a) => ({ label: `${a.symbol} · ${a.name}`, value: a.symbol })),
);
const configOptions = computed(() =>
  strategies.value.flatMap((s) =>
    s.configs.map((c) => ({
      label: `${configLabel(s.code, c.name)}${c.isActive ? '' : ` (${t('assets.inactive')})`}`,
      value: c.id,
    })),
  ),
);

const sub = reactive({
  symbol: null as string | null,
  strategyConfigId: null as string | null,
  source: 'strategy' as 'strategy' | 'signals',
  allocationPct: null as number | null,
  direction: 'long' as 'long' | 'short' | 'both',
});
/** The selected config's strategy has short rules. */
const canShort = computed(
  () =>
    strategies.value.find((s) => s.configs.some((c) => c.id === sub.strategyConfigId))?.canShort ??
    false,
);
// The saved rule decides, not the unsaved risk form: the backend rejects shorts otherwise.
const showDirection = computed(
  () => !!props.portfolio.riskRules.allowShort && canShort.value && sub.source === 'strategy',
);

const subscribe = () =>
  act(async () => {
    await call(
      api.POST('/api/portfolios/{id}/subscriptions', {
        params: { path: path.value },
        body: {
          symbol: sub.symbol!,
          strategyConfigId: sub.strategyConfigId!,
          source: sub.source,
          ...(sub.allocationPct ? { allocationPct: sub.allocationPct } : {}),
          ...(sub.direction !== 'long' && showDirection.value ? { direction: sub.direction } : {}),
        },
      }),
    );
  }, t('subscriptions.added'));
</script>

<template>
  <div class="stack" style="--gap: 12px">
    <template v-if="portfolio.subscriptions.length">
      <NDataTable :columns="columns" :data="portfolio.subscriptions" size="small" />
      <div class="hstack">
        <NButton size="small" :loading="busy" @click="checkHealth">{{
          t('subscriptions.checkHealth')
        }}</NButton>
        <span class="hint">{{ t('subscriptions.healthHelp') }}</span>
      </div>
    </template>
    <EmptyState
      v-else
      icon="🔗"
      :title="t('subscriptions.emptyTitle')"
      :text="t('subscriptions.emptyText')"
    />
    <div class="hstack">
      <NSelect
        v-model:value="sub.symbol"
        :options="symbolOptions"
        filterable
        :placeholder="t('trades.symbol')"
        style="width: 200px"
      />
      <NSelect
        v-model:value="sub.strategyConfigId"
        :options="configOptions"
        filterable
        :placeholder="t('trades.strategy')"
        style="width: 340px"
      />
      <NRadioGroup v-model:value="sub.source" size="small">
        <NRadioButton value="strategy">{{ t('subscriptions.sourceStrategy') }}</NRadioButton>
        <NRadioButton value="signals">{{ t('subscriptions.sourceSignals') }}</NRadioButton>
      </NRadioGroup>
      <NSelect
        v-if="showDirection"
        v-model:value="sub.direction"
        :options="directionOptions()"
        style="width: 150px"
      />
      <NInputNumber
        v-model:value="sub.allocationPct"
        :min="0.1"
        :max="100"
        clearable
        :placeholder="t('subscriptions.allocationPlaceholder')"
        style="width: 140px"
      />
      <NButton
        type="primary"
        :disabled="!sub.symbol || !sub.strategyConfigId"
        :loading="busy"
        @click="subscribe"
      >
        {{ t('search.add') }}
      </NButton>
    </div>
    <span class="hint">
      <strong>{{ t('subscriptions.sourceStrategy') }}</strong>
      {{ t('subscriptions.sourceStrategyHelp') }}
      <strong>{{ t('subscriptions.sourceSignals') }}</strong
      >{{ t('subscriptions.sourceSignalsHelp') }}
    </span>
  </div>
</template>

<style scoped>
.hint {
  font-size: 12px;
  opacity: 0.6;
}
</style>
