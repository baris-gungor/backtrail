<script setup lang="ts">
import { reactive, watch } from 'vue';
import { NButton, NForm, NFormItem, NInputNumber, NSwitch } from 'naive-ui';
import { api, call, type PortfolioDetail } from '../../api/client';
import { useI18n } from 'vue-i18n';
import { useAction } from '../../composables/useAction';
import Term from '../Term.vue';

const props = defineProps<{ portfolioId: string; riskRules: PortfolioDetail['riskRules'] }>();
const emit = defineEmits<{ changed: [] }>();
const { t } = useI18n();
const { busy, act } = useAction(() => emit('changed'));

const rules = reactive({
  maxPositionPct: 25,
  maxOpenPositions: 5,
  maxDailyLossPct: 3,
  requireStopLoss: true,
  cashBufferPct: 0,
  earningsExit: false,
  earningsBlockDays: 0,
  allowShort: false,
});
// The form follows the saved rules when they change, not on every poll: an unchanged reload keeps
// unsaved edits. Saving is explicit.
watch(
  () => JSON.stringify(props.riskRules),
  () => Object.assign(rules, props.riskRules),
  { immediate: true },
);

const save = () =>
  act(
    () =>
      call(
        api.PATCH('/api/portfolios/{id}', {
          params: { path: { id: props.portfolioId } },
          body: { riskRules: { ...rules } },
        }),
      ),
    t('risk.saved'),
  );
</script>

<template>
  <NForm label-placement="left" label-width="200" size="small" style="max-width: 480px">
    <NFormItem :label="t('risk.maxPositionPct')">
      <NInputNumber v-model:value="rules.maxPositionPct" :min="0.1" :max="100" />
    </NFormItem>
    <NFormItem :label="t('risk.maxOpenPositions')">
      <NInputNumber v-model:value="rules.maxOpenPositions" :min="1" :max="100" />
    </NFormItem>
    <NFormItem :label="t('risk.maxDailyLossPct')">
      <NInputNumber v-model:value="rules.maxDailyLossPct" :min="0.1" :max="100" />
    </NFormItem>
    <NFormItem :label="t('risk.cashBufferPct')">
      <NInputNumber v-model:value="rules.cashBufferPct" :min="0" :max="100" />
    </NFormItem>
    <NFormItem :label="t('risk.requireStopLoss')">
      <NSwitch v-model:value="rules.requireStopLoss" />
    </NFormItem>
    <NFormItem>
      <template #label
        ><Term k="earnings">{{ t('risk.earningsExit') }}</Term></template
      >
      <NSwitch v-model:value="rules.earningsExit" />
    </NFormItem>
    <NFormItem :label="t('risk.earningsBlockDays')">
      <NInputNumber v-model:value="rules.earningsBlockDays" :min="0" :max="30" />
    </NFormItem>
    <NFormItem>
      <template #label
        ><Term k="short">{{ t('risk.allowShort') }}</Term></template
      >
      <NSwitch v-model:value="rules.allowShort" />
    </NFormItem>
    <NFormItem label=" ">
      <NButton type="primary" :loading="busy" @click="save">{{ t('common.save') }}</NButton>
    </NFormItem>
  </NForm>
</template>
