<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import {
  NButton,
  NCard,
  NDataTable,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NRadioButton,
  NRadioGroup,
  NSwitch,
  NTag,
  useMessage,
  type DataTableColumns,
} from 'naive-ui';
import { api, call, errorMessage, type BrokerStatus, type PortfolioSummary } from '../api/client';
import EmptyState from '../components/EmptyState.vue';
import PageHead from '../components/PageHead.vue';
import Term from '../components/Term.vue';
import { useDeletePortfolio } from '../composables/useDeletePortfolio';
import { fmtDec, fmtPct, pnlColor } from '../format';

const message = useMessage();
const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const portfolios = ref<PortfolioSummary[]>([]);
const broker = ref<BrokerStatus>();
const loading = ref(false);
const confirmDelete = useDeletePortfolio(load);

async function load(): Promise<void> {
  loading.value = true;
  try {
    [portfolios.value, broker.value] = await Promise.all([
      call(api.GET('/api/portfolios')),
      call(api.GET('/api/brokers/status')),
    ]);
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  await load();
  // Links like "Portföy oluştur" on the overview open the form directly.
  if (route.query.create) showCreate.value = true;
});

const columns = computed<DataTableColumns<PortfolioSummary>>(() => [
  {
    title: t('reports.tabs.portfolio'),
    key: 'name',
    render: (p) => h(RouterLink, { to: `/portfolios/${p.id}` }, () => p.name),
  },
  {
    title: t('portfolios.mode'),
    key: 'mode',
    width: 120,
    render: (p) =>
      h(
        NTag,
        { size: 'small', bordered: false, type: p.mode === 'alpaca_paper' ? 'info' : 'default' },
        () => (p.mode === 'alpaca_paper' ? 'Alpaca demo' : t('portfolios.simulation')),
      ),
  },
  {
    title: t('runs.status'),
    key: 'isActive',
    width: 110,
    render: (p) =>
      p.haltedAt
        ? h(NTag, { size: 'small', type: 'error' }, () => t('portfolios.halted'))
        : h(NTag, { size: 'small', type: p.isActive ? 'success' : 'default' }, () =>
            p.isActive ? t('portfolios.active') : t('assets.inactive'),
          ),
  },
  {
    title: () => h(Term, { k: 'equity' }, () => 'Equity'),
    key: 'equity',
    render: (p) => fmtDec(p.equity),
  },
  { title: t('broker.cash'), key: 'cash', render: (p) => fmtDec(p.cash) },
  {
    title: t('reports.return'),
    key: 'totalReturn',
    render: (p) => h('span', { style: { color: pnlColor(p.totalReturn) } }, fmtPct(p.totalReturn)),
  },
  {
    title: t('portfolios.today'),
    key: 'dayPnl',
    render: (p) => h('span', { style: { color: pnlColor(p.dayPnl) } }, fmtDec(p.dayPnl)),
  },
  {
    title: () => h(Term, { k: 'realizedPnl' }, () => t('portfolioReport.realized')),
    key: 'realizedPnl',
    render: (p) => h('span', { style: { color: pnlColor(p.realizedPnl) } }, fmtDec(p.realizedPnl)),
  },
  { title: t('portfolios.openPositions'), key: 'openPositions', width: 110 },
  {
    title: '',
    key: 'actions',
    width: 70,
    render: (p) =>
      h(
        NButton,
        { size: 'tiny', type: 'error', ghost: true, onClick: () => confirmDelete(p) },
        () => t('common.delete'),
      ),
  },
]);

// Create form
const showCreate = ref(false);
const creating = ref(false);
const form = reactive({
  mode: 'paper' as 'paper' | 'alpaca_paper',
  name: '',
  initialCash: 100_000,
  feeBps: 5,
  slippageBps: 5,
  maxPositionPct: 25,
  maxOpenPositions: 5,
  maxDailyLossPct: 3,
  requireStopLoss: true,
  cashBufferPct: 0,
  earningsExit: false,
  allowShort: false,
});

async function create(): Promise<void> {
  creating.value = true;
  try {
    const created = await call(
      api.POST('/api/portfolios', {
        body: {
          name: form.name,
          mode: form.mode,
          ...(form.mode === 'paper' ? { initialCash: form.initialCash } : {}),
          execution: { feeBps: form.feeBps, slippageBps: form.slippageBps },
          riskRules: {
            maxPositionPct: form.maxPositionPct,
            maxOpenPositions: form.maxOpenPositions,
            maxDailyLossPct: form.maxDailyLossPct,
            requireStopLoss: form.requireStopLoss,
            cashBufferPct: form.cashBufferPct,
            earningsExit: form.earningsExit,
            allowShort: form.allowShort,
          },
        },
      }),
    );
    showCreate.value = false;
    await router.push(`/portfolios/${created.id}`);
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <div class="stack">
    <PageHead :title="t('nav.portfolios')" :text="t('portfolios.intro')">
      <NButton @click="load">{{ t('common.refresh') }}</NButton>
      <NButton type="primary" @click="showCreate = true">{{ t('portfolios.new') }}</NButton>
    </PageHead>

    <NCard size="small">
      <EmptyState
        v-if="!loading && !portfolios.length"
        icon="📁"
        :title="t('portfolios.emptyTitle')"
        :text="t('portfolios.emptyText')"
        :action="t('portfolios.emptyAction')"
        @action="showCreate = true"
      />
      <NDataTable v-else :columns="columns" :data="portfolios" :loading="loading" size="small" />
    </NCard>

    <NModal
      v-model:show="showCreate"
      preset="card"
      :title="t('portfolios.newTitle')"
      style="width: 520px; max-width: calc(100vw - 32px)"
    >
      <NForm label-placement="left" label-width="170" size="small">
        <NFormItem :label="t('portfolios.name')">
          <NInput v-model:value="form.name" :placeholder="t('portfolios.namePlaceholder')" />
        </NFormItem>
        <NFormItem :label="t('portfolios.mode')">
          <div class="stack" style="--gap: 4px">
            <NRadioGroup v-model:value="form.mode" size="small">
              <NRadioButton value="paper">{{ t('portfolios.internalSimulation') }}</NRadioButton>
              <NRadioButton value="alpaca_paper" :disabled="!broker?.enabled">
                Alpaca demo
              </NRadioButton>
            </NRadioGroup>
            <span v-if="!broker?.enabled" class="hint">{{ t('portfolios.alpacaDisabled') }}</span>
            <span v-else-if="form.mode === 'alpaca_paper'" class="hint">
              {{ t('portfolios.alpacaCash', { cash: broker.account?.cash }) }}
            </span>
          </div>
        </NFormItem>
        <NFormItem v-show="form.mode === 'paper'" :label="t('portfolios.initialCash')">
          <NInputNumber v-model:value="form.initialCash" :min="1" :step="1000" />
        </NFormItem>
        <NFormItem>
          <template #label
            ><Term k="bps">{{ t('portfolios.feeSlippage') }}</Term></template
          >
          <div class="hstack">
            <NInputNumber v-model:value="form.feeBps" :min="0" style="width: 100px" />
            <NInputNumber v-model:value="form.slippageBps" :min="0" style="width: 100px" />
          </div>
        </NFormItem>
        <NFormItem :label="t('risk.maxPositionPct')">
          <NInputNumber v-model:value="form.maxPositionPct" :min="0.1" :max="100" />
        </NFormItem>
        <NFormItem :label="t('risk.maxOpenPositions')">
          <NInputNumber v-model:value="form.maxOpenPositions" :min="1" :max="100" />
        </NFormItem>
        <NFormItem :label="t('risk.maxDailyLossPct')">
          <NInputNumber v-model:value="form.maxDailyLossPct" :min="0.1" :max="100" />
        </NFormItem>
        <NFormItem :label="t('risk.cashBufferPct')">
          <NInputNumber v-model:value="form.cashBufferPct" :min="0" :max="100" />
        </NFormItem>
        <NFormItem>
          <template #label
            ><Term k="stopLoss">{{ t('risk.requireStopLoss') }}</Term></template
          >
          <NSwitch v-model:value="form.requireStopLoss" />
        </NFormItem>
        <NFormItem>
          <template #label
            ><Term k="earnings">{{ t('risk.earningsExit') }}</Term></template
          >
          <NSwitch v-model:value="form.earningsExit" />
        </NFormItem>
        <NFormItem>
          <template #label
            ><Term k="short">{{ t('risk.allowShort') }}</Term></template
          >
          <NSwitch v-model:value="form.allowShort" />
        </NFormItem>
      </NForm>
      <template #footer>
        <div class="hstack between">
          <span class="hint">{{ t('portfolios.subscriptionsLater') }}</span>
          <NButton type="primary" :loading="creating" :disabled="!form.name" @click="create">
            {{ t('common.create') }}
          </NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>

<style scoped></style>
