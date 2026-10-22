<script setup lang="ts">
import { computed } from 'vue';
import { NButton, NInputNumber } from 'naive-ui';

/**
 * Price field whose − / + buttons start from `base` (the current price) while the field is empty,
 * so a stop or limit can be nudged from the market price instead of from zero.
 */
const props = defineProps<{ base: number | null; placeholder?: string }>();
const value = defineModel<number | null>({ required: true });

/** One step is about 0.3% of the price, rounded to a tick-like size: 350 → 1, 35 → 0.1, 3.5 → 0.01. */
const step = computed(() => {
  const price = value.value ?? props.base ?? 0;
  if (price >= 100) return 1;
  if (price >= 10) return 0.1;
  return 0.01;
});

function nudge(direction: 1 | -1): void {
  const from = value.value ?? props.base;
  if (from === null || from === undefined) return;
  const next = Number((from + direction * step.value).toFixed(2));
  value.value = next > 0 ? next : from;
}
</script>

<template>
  <div class="price-input">
    <NButton size="small" :disabled="value === null && base === null" @click="nudge(-1)">−</NButton>
    <NInputNumber
      v-model:value="value"
      :min="0"
      :show-button="false"
      :placeholder="placeholder"
      style="width: 110px"
    />
    <NButton size="small" :disabled="value === null && base === null" @click="nudge(1)">+</NButton>
  </div>
</template>

<style scoped>
.price-input {
  display: inline-flex;
  gap: 4px;
  align-items: center;
}
</style>
