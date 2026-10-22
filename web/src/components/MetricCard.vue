<script setup lang="ts">
import { computed } from 'vue';
import { NCard, NTag } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { RATING_TAG, rate } from '../glossary';
import Term from './Term.vue';

/**
 * One metric: label (with glossary ⓘ when `term` is set), value, optional sub line and a
 * good / fair / weak badge computed from `ratingValue` with the glossary thresholds.
 */
const { t } = useI18n();
const props = defineProps<{
  label: string;
  value: string;
  term?: string;
  sub?: string;
  /** Color of the value: a CSS color, e.g. from pnlColor. */
  color?: string;
  /** Raw number for the rating badge; uses `term` as the metric key. */
  ratingValue?: number | null;
}>();

const rating = computed(() => (props.term ? rate(props.term, props.ratingValue) : null));
</script>

<template>
  <NCard size="small" class="metric">
    <div class="label">
      <Term v-if="term" :k="term">{{ label }}</Term>
      <span v-else>{{ label }}</span>
    </div>
    <div class="value">
      <span :style="{ color }">{{ value }}</span>
      <NTag v-if="rating" size="small" :type="RATING_TAG[rating]" :bordered="false">{{
        t(`labels.rating.${rating}`)
      }}</NTag>
      <slot name="badge" />
    </div>
    <div v-if="sub || $slots.default" class="sub">
      <slot>{{ sub }}</slot>
    </div>
  </NCard>
</template>

<style scoped>
.metric {
  height: 100%;
}
.label {
  font-size: 13px;
  color: var(--muted);
}
.value {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 24px;
  font-weight: 600;
  margin: 2px 0;
  font-variant-numeric: tabular-nums;
}
.sub {
  font-size: 12px;
  color: var(--muted);
}
@media (max-width: 768px) {
  .value {
    font-size: 20px;
  }
}
</style>
