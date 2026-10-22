<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue';
import {
  NButton,
  NCard,
  NDataTable,
  NInput,
  NModal,
  NSpace,
  NSpin,
  NSwitch,
  NTag,
  useMessage,
  type DataTableColumns,
} from 'naive-ui';
import { api, call, errorMessage, type Strategy, type StrategyConfig } from '../api/client';
import ParamsForm from '../components/ParamsForm.vue';
import PageHead from '../components/PageHead.vue';
import { useI18n } from 'vue-i18n';
import {
  configName as configDisplayName,
  paramsText,
  strategyMethod,
  strategyName,
} from '../format';

const message = useMessage();
const { t } = useI18n();
const strategies = ref<Strategy[]>([]);
const loading = ref(false);
const rebuilding = ref<string>();

async function load(): Promise<void> {
  loading.value = true;
  try {
    strategies.value = await call(api.GET('/api/analysis/strategies'));
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function setActive(config: StrategyConfig, isActive: boolean): Promise<void> {
  try {
    await call(
      api.PATCH('/api/analysis/configs/{id}', {
        params: { path: { id: config.id } },
        body: { isActive },
      }),
    );
    await load();
  } catch (e) {
    message.error(errorMessage(e));
  }
}

/** Regenerates signals for one strategy, or for all when `code` is undefined. */
async function rebuild(code?: string): Promise<void> {
  rebuilding.value = code ?? '*';
  try {
    const results = await call(
      api.POST('/api/analysis/signals/rebuild', { body: { strategy: code } }),
    );
    const inserted = results.reduce((sum, r) => sum + r.inserted, 0);
    message.success(t('strategies.rebuilt', { assets: results.length, signals: inserted }));
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    rebuilding.value = undefined;
  }
}

// New-config modal.
const editing = ref<Strategy>();
const configName = ref('');
const configParams = ref<Record<string, unknown>>({});
const saving = ref(false);

function openCreate(strategy: Strategy): void {
  editing.value = strategy;
  configName.value = '';
  configParams.value = { ...strategy.defaultParams };
}

async function create(): Promise<void> {
  const strategy = editing.value;
  if (!strategy) return;
  saving.value = true;
  try {
    // Cleared fields are left out so the backend applies the defaults.
    const params = Object.fromEntries(
      Object.entries(configParams.value).filter(([, v]) => v !== undefined && v !== null),
    );
    await call(
      api.POST('/api/analysis/strategies/{code}/configs', {
        params: { path: { code: strategy.code } },
        body: { name: configName.value.trim(), params },
      }),
    );
    message.success(t('strategies.created'));
    editing.value = undefined;
    await load();
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    saving.value = false;
  }
}

const configColumns = computed<DataTableColumns<StrategyConfig>>(() => [
  {
    title: t('strategies.config'),
    key: 'name',
    width: 140,
    render: (c) => configDisplayName(c.name),
  },
  { title: t('strategies.params'), key: 'params', render: (c) => paramsText(c.params) },
  {
    title: t('strategies.active'),
    key: 'isActive',
    width: 80,
    render: (c) =>
      h(NSwitch, { value: c.isActive, onUpdateValue: (v: boolean) => setActive(c, v) }),
  },
]);
</script>

<template>
  <NSpin :show="loading">
    <NSpace vertical :size="16">
      <PageHead :title="t('nav.strategies')" :text="t('strategies.intro')">
        <NButton
          :loading="rebuilding === '*'"
          :title="t('strategies.rebuildAllHelp')"
          @click="rebuild()"
        >
          {{ t('strategies.rebuildAll') }}
        </NButton>
      </PageHead>
      <NCard v-for="s in strategies" :key="s.code" size="small">
        <template #header>
          <div class="hstack">
            <strong>{{ strategyName(s.code) }}</strong>
            <span class="method">{{ strategyMethod(s.code) }}</span>
            <code class="method">{{ s.code }} v{{ s.version }}</code>
            <NTag v-if="s.isBenchmark" size="small" type="warning" :bordered="false">{{
              t('strategies.benchmark')
            }}</NTag>
          </div>
        </template>
        <template #header-extra>
          <NSpace>
            <NButton size="small" @click="openCreate(s)">{{ t('strategies.addConfig') }}</NButton>
            <NButton
              size="small"
              :loading="rebuilding === s.code"
              :title="t('strategies.rebuildHelp')"
              @click="rebuild(s.code)"
            >
              {{ t('strategies.rebuild') }}
            </NButton>
          </NSpace>
        </template>
        <p class="desc">{{ s.description }}</p>
        <NDataTable :columns="configColumns" :data="s.configs" size="small" />
      </NCard>
    </NSpace>
  </NSpin>

  <NModal
    :show="!!editing"
    preset="card"
    :title="t('strategies.newConfig', { strategy: editing ? strategyName(editing.code) : '' })"
    style="width: 560px; max-width: calc(100vw - 32px)"
    @update:show="(v: boolean) => !v && (editing = undefined)"
  >
    <div class="stack" style="--gap: 12px">
      <NInput v-model:value="configName" :placeholder="t('strategies.configName')" />
      <ParamsForm v-if="editing" v-model="configParams" :schema="editing.paramsSchema" />
      <NSpace justify="end">
        <NButton @click="editing = undefined">{{ t('common.cancel') }}</NButton>
        <NButton type="primary" :loading="saving" :disabled="!configName.trim()" @click="create">
          {{ t('common.create') }}
        </NButton>
      </NSpace>
    </div>
  </NModal>
</template>

<style scoped>
.desc {
  margin: 0 0 12px;
  color: var(--muted);
}
.method {
  font-size: 12px;
  color: var(--muted);
}
</style>
