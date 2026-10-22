<script setup lang="ts">
import { computed } from 'vue';
import { NForm, NFormItem, NInputNumber, NSwitch } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { paramFields } from '../params';

const props = defineProps<{ schema: Record<string, unknown> }>();
const { t } = useI18n();
const model = defineModel<Record<string, unknown>>({ required: true });

const fields = computed(() => paramFields(props.schema));

const numberValue = (name: string) => model.value[name] as number | null | undefined;
</script>

<template>
  <NForm label-placement="left" label-width="140" size="small">
    <NFormItem v-for="f in fields" :key="f.name" :label="f.name">
      <NSwitch
        v-if="f.type === 'boolean'"
        :value="model[f.name] as boolean"
        @update:value="(v: boolean) => (model = { ...model, [f.name]: v })"
      />
      <NInputNumber
        v-else
        :value="numberValue(f.name)"
        :min="f.min"
        :max="f.max"
        :step="f.integer ? 1 : 0.1"
        :precision="f.integer ? 0 : undefined"
        :placeholder="String(f.default ?? '')"
        clearable
        style="width: 180px"
        @update:value="(v: number | null) => (model = { ...model, [f.name]: v ?? undefined })"
      />
      <span class="hint">
        {{ t('params.default') }} {{ f.default
        }}<template v-if="f.min !== undefined"> · {{ f.min }}–{{ f.max }}</template>
      </span>
    </NFormItem>
  </NForm>
</template>

<style scoped>
.hint {
  margin-left: 12px;
  font-size: 12px;
  opacity: 0.6;
}
</style>
