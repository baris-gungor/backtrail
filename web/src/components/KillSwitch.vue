<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  NButton,
  NCheckbox,
  NInput,
  NModal,
  NPopconfirm,
  NTag,
  NTooltip,
  useMessage,
} from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { api, call, errorMessage, type TradingState } from '../api/client';
import { usePolling } from '../composables/usePolling';

/** Global kill switch in the header: state, halt (with reason) and resume. */
const message = useMessage();
const { t } = useI18n();
const state = ref<TradingState>();
const show = ref(false);
const reason = ref('');
const closePositions = ref(false);
const busy = ref(false);

async function load(): Promise<void> {
  try {
    state.value = await call(api.GET('/api/trading/state'));
  } catch {
    // The health tag already shows a down backend.
  }
}
onMounted(() => void load());
usePolling(load, 30_000);

async function halt(): Promise<void> {
  busy.value = true;
  try {
    state.value = await call(
      api.POST('/api/trading/halt', {
        body: { reason: reason.value || 'manual', closePositions: closePositions.value },
      }),
    );
    show.value = false;
    message.warning(t('killSwitch.halted'));
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    busy.value = false;
  }
}

async function resume(): Promise<void> {
  busy.value = true;
  try {
    state.value = await call(api.POST('/api/trading/resume'));
    message.success(t('killSwitch.resumed'));
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="hstack" style="--gap: 6px; flex-wrap: nowrap; flex-shrink: 0">
    <NTooltip v-if="state">
      <template #trigger>
        <NTag
          size="small"
          :type="state.halted ? 'error' : state.haltedPortfolios.length ? 'warning' : 'success'"
        >
          {{
            state.halted
              ? t('killSwitch.stateHalted')
              : state.haltedPortfolios.length
                ? t('killSwitch.statePortfolios', { n: state.haltedPortfolios.length })
                : t('killSwitch.stateOpen')
          }}
        </NTag>
      </template>
      <template v-if="state.halted">{{ state.reason }}</template>
      <template v-else-if="state.haltedPortfolios.length">
        {{ state.haltedPortfolios.map((p) => `${p.name}: ${p.reason}`).join(' · ') }}
      </template>
      <template v-else>{{ t('killSwitch.off') }}</template>
    </NTooltip>
    <NPopconfirm v-if="state?.halted" @positive-click="resume">
      <template #trigger>
        <NButton size="tiny" :loading="busy">{{ t('killSwitch.resume') }}</NButton>
      </template>
      {{ t('killSwitch.resumeConfirm') }}
    </NPopconfirm>
    <NButton v-else size="tiny" type="error" ghost @click="show = true">{{
      t('killSwitch.halt')
    }}</NButton>

    <NModal
      v-model:show="show"
      preset="card"
      title="Kill switch"
      style="width: 460px; max-width: calc(100vw - 32px)"
    >
      <div class="stack" style="--gap: 12px">
        <span>{{ t('killSwitch.explain') }}</span>
        <NInput v-model:value="reason" :placeholder="t('killSwitch.reason')" />
        <NCheckbox v-model:checked="closePositions">{{ t('killSwitch.closePositions') }}</NCheckbox>
      </div>
      <template #footer>
        <div class="hstack between">
          <NButton @click="show = false">{{ t('common.cancel') }}</NButton>
          <NButton type="error" :loading="busy" @click="halt">{{ t('killSwitch.halt') }}</NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>
