<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{
  content: string;
  expanded: boolean;
}>();

const emit = defineEmits<{
  (e: 'toggle'): void;
}>();

const copied = ref(false);

function copyContent() {
  navigator.clipboard.writeText(props.content);
  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 2000);
}
</script>

<template>
  <!-- Rendered as a plain, inline-expanding row matching the workspace tool steps
       (ToolGroup). The 'reasoning-terminal-container' / 'plan-body' classes are
       kept for the thread's auto-scroll + entrance-animation hooks. -->
  <div class="reasoning-terminal-container reasoning-accordion" :class="{ 'is-expanded': expanded }">
    <header class="reasoning-header" @click="emit('toggle')">
      <svg class="chevron-icon" :class="{ rotated: expanded }" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m6 9 6 6 6-6"></path>
      </svg>
      <svg class="step-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3"></circle>
        <circle cx="12" cy="5" r="1"></circle>
        <circle cx="12" cy="19" r="1"></circle>
        <circle cx="5" cy="12" r="1"></circle>
        <circle cx="19" cy="12" r="1"></circle>
        <path d="M12 8v3M12 13v3M8 12h3M13 12h3"></path>
      </svg>
      <span class="reasoning-label">Reasoning</span>
    </header>
    <div v-if="expanded" class="reasoning-details">
      <div class="code-block-wrapper">
        <div class="code-block-header">
          <span class="code-block-lang">reasoning</span>
          <button 
            class="code-block-copy-btn" 
            :class="{ copied }" 
            @click.stop="copyContent"
          >
            {{ copied ? 'Copied!' : 'Copy' }}
          </button>
        </div>
        <pre class="reasoning-text plan-body"><code>{{ content }}</code></pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Plain row, no box — mirrors ToolGroup's .tool-call-accordion. */
.reasoning-accordion {
  margin: 1px 0;
  width: 100%;
  background: transparent;
  border: none;
  box-shadow: none;
  font-size: 0.82rem;
  font-style: italic;
  color: var(--faint);
  transition: color 0.2s ease;
}

.reasoning-accordion:hover {
  color: var(--muted);
}

.reasoning-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  cursor: pointer;
  user-select: none;
}

.chevron-icon {
  color: inherit;
  transition: transform 0.2s ease;
  flex-shrink: 0;
}

.chevron-icon.rotated {
  transform: rotate(180deg);
}

.step-icon {
  color: inherit;
  flex-shrink: 0;
}

.reasoning-label {
  font-weight: 300;
  color: inherit;
}

.reasoning-details {
  padding: 8px 0 12px;
  border-top: 1px dashed rgba(255, 255, 255, 0.08);
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
