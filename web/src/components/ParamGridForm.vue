<script setup lang="ts">
import { NCheckbox, NForm, NFormItem, NInputNumber } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import type { GridRow } from '../params';

/** Edits grid rows in place (the parent owns the array). */
defineProps<{ rows: GridRow[] }>();
const { t } = useI18n();
</script>

<template>
  <NForm v-if="rows.length" label-placement="left" label-width="160" size="small">
    <NFormItem v-for="g in rows" :key="g.name" :label="g.name">
      <div class="hstack">
        <NCheckbox v-model:checked="g.enabled">{{ t('params.scan') }}</NCheckbox>
        <template v-if="g.enabled">
          <span>min</span>
          <NInputNumber v-model:value="g.min" style="width: 100px" />
          <span>max</span>
          <NInputNumber v-model:value="g.max" style="width: 100px" />
          <span>{{ t('params.step') }}</span>
          <NInputNumber v-model:value="g.step" :min="0" style="width: 90px" />
        </template>
      </div>
    </NFormItem>
  </NForm>
</template>
