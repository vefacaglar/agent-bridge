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
      <svg class="step-row-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3"></circle>
        <circle cx="12" cy="5" r="1"></circle>
        <circle cx="12" cy="19" r="1"></circle>
        <circle cx="5" cy="12" r="1"></circle>
        <circle cx="19" cy="12" r="1"></circle>
        <path d="M12 8v3M12 13v3M8 12h3M13 12h3"></path>
      </svg>
      <span class="step-row-label">Reasoning</span>
    </header>
    <div v-if="expanded" class="reasoning-details">
      <div class="code-block-wrapper">
        <pre class="reasoning-text plan-body"><code>{{ content }}</code></pre>
      </div>
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
  padding: 8px 0 12px;
  border-top: 1px solid var(--border-soft);
  font-style: normal;
}

.reasoning-details .code-block-wrapper {
  margin: 8px 0 0;
}

/* The expanded body, styled like a tool result block (faint-code). */
.reasoning-text {
  margin: 0;
  max-height: 220px;
  overflow-y: auto;
  scroll-behavior: smooth;
  font-family: monospace;
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--muted);
  white-space: pre-wrap;
  word-break: break-word;
  background: transparent;
  padding: 14px;
  border-radius: 0;
  border: none;
}
</style>
