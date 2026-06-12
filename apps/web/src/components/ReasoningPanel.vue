<script setup lang="ts">
defineProps<{
  content: string;
  expanded: boolean;
}>();

const emit = defineEmits<{
  (e: 'toggle'): void;
}>();
</script>

<template>
  <!-- Rendered as a plain, inline-expanding row matching the workspace tool steps
       (ToolGroup). The 'reasoning-terminal-container' / 'plan-body' classes are
       kept for the thread's auto-scroll + entrance-animation hooks. -->
  <div class="reasoning-terminal-container reasoning-accordion" :class="{ 'is-expanded': expanded }">
    <header class="step-row" @click="emit('toggle')">
      <svg class="step-row-toggle" :class="{ rotated: expanded }" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m6 9 6 6 6-6"></path>
      </svg>
      <span class="step-row-label">Reasoning</span>
    </header>
    <div v-if="expanded" class="reasoning-details">
      <div class="reasoning-text plan-body">{{ content }}</div>
    </div>
  </div>
</template>

<style scoped>
/* Layout only — the row look (.step-row) is shared in style.css. Margin gives a
   little gap when stacked outside the chat thread (e.g. inside CoderGroup). */
.reasoning-accordion {
  margin: 1px 0;
  width: 100%;
}

.reasoning-details {
  padding: 6px 0 8px;
}

/* The expanded body — plain faded text, no card/chrome. */
.reasoning-text {
  margin: 0;
  max-height: 220px;
  overflow-y: auto;
  scroll-behavior: smooth;
  font-family: inherit;
  font-size: 0.82rem;
  line-height: 1.55;
  color: var(--faint);
  white-space: pre-wrap;
  word-break: break-word;
  background: transparent;
  padding: 0;
  border-radius: 0;
  border: none;
}
</style>
