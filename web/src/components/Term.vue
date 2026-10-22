<script setup lang="ts">
import { computed } from 'vue';
import { NTooltip } from 'naive-ui';
import { glossaryEntry } from '../glossary';

/** A label with an ⓘ that explains the term from the glossary on hover. */
const props = defineProps<{ k: string }>();
const entry = computed(() => glossaryEntry(props.k));
// Fixed colors: the tooltip is dark in both themes.
const SCALE_COLORS = ['#63e2b7', '#f2c97d', '#e88080'];
</script>

<template>
  <span class="term">
    <slot />
    <NTooltip v-if="entry" :style="{ maxWidth: '320px' }">
      <template #trigger>
        <span class="info" tabindex="0" @click.stop>i</span>
      </template>
      <div class="stack" style="--gap: 6px">
        <strong>{{ entry.title }}</strong>
        <span>{{ entry.text }}</span>
        <div v-if="entry.scale" class="hstack" style="--gap: 4px 12px">
          <span v-for="(s, i) in entry.scale" :key="s" class="scale">
            <span class="dot" :style="{ background: SCALE_COLORS[i] }" />{{ s }}
          </span>
        </div>
      </div>
    </NTooltip>
  </span>
</template>

<style scoped>
.term {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.info {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid currentColor;
  font-size: 9px;
  font-style: italic;
  font-weight: 600;
  opacity: 0.55;
  cursor: help;
  flex-shrink: 0;
}
.scale {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.info:hover,
.info:focus {
  opacity: 1;
  outline: none;
}
</style>
