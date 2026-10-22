<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue';
import {
  NButton,
  NCard,
  NDataTable,
  NSelect,
  NTag,
  NTooltip,
  useMessage,
  type DataTableColumns,
} from 'naive-ui';
import { api, call, errorMessage, type AuditEvent } from '../api/client';
import PageHead from '../components/PageHead.vue';
import { useI18n } from 'vue-i18n';
import { te } from '../i18n';
import { fmtDate } from '../format';

const message = useMessage();
const { t } = useI18n();
const events = ref<AuditEvent[]>([]);
const entityType = ref<string | null>(null);
const loading = ref(false);

const ENTITY_TYPES = ['portfolio', 'subscription', 'order', 'strategy_config', 'trading'];
const typeLabel = (type: string) => (te(`audit.types.${type}`) ? t(`audit.types.${type}`) : type);
// Readable names for the audit actions ("portfolio.create" -> audit.actions.portfolio_create); the
// code is kept in the tooltip of the cell.
const actionLabel = (action: string) => {
  const key = `audit.actions.${action.replace('.', '_')}`;
  return te(key) ? t(key) : action;
};
const types = computed(() => ENTITY_TYPES.map((value) => ({ label: typeLabel(value), value })));

async function load(): Promise<void> {
  loading.value = true;
  try {
    events.value = await call(
      api.GET('/api/audit', {
        params: { query: entityType.value ? { entityType: entityType.value } : {} },
      }),
    );
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch(entityType, load);

const json = (value: unknown) => (value ? JSON.stringify(value, null, 1) : '—');

const columns = computed<DataTableColumns<AuditEvent>>(() => [
  { title: t('audit.time'), key: 'createdAt', width: 150, render: (e) => fmtDate(e.createdAt) },
  {
    title: t('audit.actor'),
    key: 'actor',
    width: 100,
    render: (e) =>
      h(
        NTag,
        { size: 'small', bordered: false, type: e.actor === 'system' ? 'warning' : 'default' },
        () => (e.actor === 'system' ? t('audit.system') : t('audit.user')),
      ),
  },
  {
    title: t('audit.action'),
    key: 'action',
    width: 220,
    render: (e) => h('span', { title: e.action }, actionLabel(e.action)),
  },
  {
    title: t('audit.entityType'),
    key: 'entityType',
    width: 130,
    render: (e) => typeLabel(e.entityType),
  },
  { title: 'Id', key: 'entityId', ellipsis: { tooltip: true } },
  {
    title: t('audit.beforeAfter'),
    key: 'diff',
    render: (e) =>
      h(
        NTooltip,
        { style: { maxWidth: '640px' } },
        {
          trigger: () => h('span', { class: 'link' }, t('audit.show')),
          default: () =>
            h('pre', { style: { margin: 0, fontSize: '11px', whiteSpace: 'pre-wrap' } }, [
              `${t('audit.before')}: ${json(e.before)}\n\n${t('audit.after')}: ${json(e.after)}`,
            ]),
        },
      ),
  },
]);
</script>

<template>
  <div class="stack">
    <PageHead :title="t('nav.audit')" :text="t('audit.intro')">
      <NSelect
        v-model:value="entityType"
        :options="types"
        clearable
        :placeholder="t('audit.allTypes')"
        style="width: 200px"
        size="small"
      />
      <NButton size="small" @click="load">{{ t('common.refresh') }}</NButton>
    </PageHead>
    <NCard size="small">
      <NDataTable
        :columns="columns"
        :data="events"
        :loading="loading"
        size="small"
        :pagination="{ pageSize: 25 }"
      />
    </NCard>
  </div>
</template>

<style scoped>
:deep(.link) {
  text-decoration: underline dotted;
  cursor: help;
}
</style>
