<script setup lang="ts">
/** Page title, a one-sentence explanation of the page, and actions on the right. */
defineProps<{ title: string; text?: string }>();
</script>

<template>
  <div class="hstack between" style="align-items: flex-end">
    <div class="page-head">
      <h2>
        <slot name="title">{{ title }}</slot>
      </h2>
      <p v-if="text || $slots.text">
        <slot name="text">{{ text }}</slot>
      </p>
    </div>
    <div v-if="$slots.default" class="hstack">
      <slot />
    </div>
  </div>
</template>
