<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue';
import {
  NAlert,
  NButton,
  NDataTable,
  NDescriptions,
  NDescriptionsItem,
  NSpin,
  NTag,
  NTooltip,
  useMessage,
  type DataTableColumns,
} from 'naive-ui';
import { api, call, errorMessage, type BrokerSummary, type ReconciliationRun } from '../api/client';
import { useI18n } from 'vue-i18n';
import { fmtDate, fmtDec } from '../format';
import { useIsMobile } from '../composables/useIsMobile';

/** Alpaca demo account and reconciliation history of a demo-broker portfolio. */
const props = defineProps<{ portfolioId: string }>();
const emit = defineEmits<{ changed: [] }>();
const message = useMessage();
const { t } = useI18n();
const isMobile = useIsMobile();
const summary = ref<BrokerSummary>();
const loading = ref(false);
const reconciling = ref(false);

async function load(): Promise<void> {
  loading.value = true;
  try {
    summary.value = await call(
      api.GET('/api/portfolios/{id}/broker', { params: { path: { id: props.portfolioId } } }),
    );
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function reconcile(): Promise<void> {
  reconciling.value = true;
  try {
    const run = await call(
      api.POST('/api/portfolios/{id}/reconcile', { params: { path: { id: props.portfolioId } } }),
    );
    if (run.status === 'ok') message.success(t('broker.reconcileOk'));
    else if (run.status === 'diff') message.warning(t('broker.reconcileDiff'));
    else message.error(run.error ?? t('broker.reconcileFailed'));
    await load();
    emit('changed');
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    reconciling.value = false;
  }
}

const STATUS = { ok: 'success', diff: 'error', error: 'warning' } as const;
const columns = computed<DataTableColumns<ReconciliationRun>>(() => [
  { title: t('broker.time'), key: 'createdAt', render: (r) => fmtDate(r.createdAt) },
  {
    title: t('broker.result'),
    key: 'status',
    render: (r) =>
      h(
        NTag,
        { size: 'small', type: STATUS[r.status as keyof typeof STATUS] ?? 'default' },
        () => r.status,
      ),
  },
  {
    title: t('broker.diffs'),
    key: 'diffs',
    render: (r) =>
      r.error ??
      (r.diffs.length
        ? h(
            NTooltip,
            {},
            {
              trigger: () => t('broker.diffCount', { n: r.diffs.length }),
              default: () =>
                r.diffs
                  .map((d) => `${d.kind} ${d.symbol ?? ''}: broker ${d.broker}, DB ${d.db}`)
                  .join(' · '),
            },
          )
        : '—'),
  },
  { title: t('broker.brokerCash'), key: 'brokerCash', render: (r) => fmtDec(r.brokerCash) },
  { title: t('broker.brokerEquity'), key: 'brokerEquity', render: (r) => fmtDec(r.brokerEquity) },
]);
</script>

<template>
  <NSpin :show="loading">
    <div v-if="summary" class="stack" style="--gap: 12px">
      <NAlert v-if="summary.error" type="warning">{{ summary.error }}</NAlert>
      <NDescriptions
        v-if="summary.account"
        :column="isMobile ? 1 : 3"
        size="small"
        label-placement="left"
      >
        <NDescriptionsItem :label="t('broker.environment')">
          <NTag size="small" type="info">{{ summary.environment }}</NTag>
        </NDescriptionsItem>
        <NDescriptionsItem :label="t('broker.accountStatus')">{{
          summary.account.status
        }}</NDescriptionsItem>
        <NDescriptionsItem :label="t('broker.account')">{{ summary.account.id }}</NDescriptionsItem>
        <NDescriptionsItem :label="t('broker.cash')">{{
          fmtDec(summary.account.cash)
        }}</NDescriptionsItem>
        <NDescriptionsItem label="Equity">{{ fmtDec(summary.account.equity) }}</NDescriptionsItem>
        <NDescriptionsItem :label="t('broker.buyingPower')">
          {{ fmtDec(summary.account.buyingPower) }}
        </NDescriptionsItem>
      </NDescriptions>
      <div class="hstack">
        <NButton :loading="reconciling" @click="reconcile">{{ t('broker.reconcileNow') }}</NButton>
        <span class="hint">{{ t('broker.reconcileHelp') }}</span>
      </div>
      <NDataTable :columns="columns" :data="summary.reconciliations" size="small" />
    </div>
  </NSpin>
</template>

<style scoped>
.hint {
  font-size: 12px;
  opacity: 0.6;
}
</style>
