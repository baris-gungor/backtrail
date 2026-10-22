<script setup lang="ts">
import { NButton } from 'naive-ui';

/** Empty list or page: what is missing, why it matters, and the action that fills it. */
defineProps<{ title: string; text?: string; action?: string; icon?: string }>();
const emit = defineEmits<{ action: [] }>();
</script>

<template>
  <div class="empty">
    <div class="icon" aria-hidden="true">{{ icon ?? '∅' }}</div>
    <strong>{{ title }}</strong>
    <p v-if="text">{{ text }}</p>
    <NButton v-if="action" type="primary" size="small" @click="emit('action')">{{
      action
    }}</NButton>
    <slot />
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 28px 16px;
  text-align: center;
}
.icon {
  font-size: 28px;
  opacity: 0.4;
}
p {
  margin: 0 0 10px;
  max-width: 420px;
  color: var(--muted);
  font-size: 13px;
}
</style>
