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
  <div class="plan-terminal-container reasoning-terminal-container">
    <header class="terminal-header" @click="emit('toggle')">
      <div class="terminal-header-left">
        <svg class="header-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"></circle>
          <circle cx="12" cy="5" r="1"></circle>
          <circle cx="12" cy="19" r="1"></circle>
          <circle cx="5" cy="12" r="1"></circle>
          <circle cx="19" cy="12" r="1"></circle>
          <path d="M12 8v3M12 13v3M8 12h3M13 12h3"></path>
        </svg>
        <span class="terminal-title">Reasoning</span>
      </div>
      <button class="terminal-toggle-btn">
        {{ expanded ? 'Collapse' : 'Expand' }}
      </button>
    </header>
    <div v-if="expanded" class="terminal-body plan-body">
      <pre class="plan-text">{{ content }}</pre>
    </div>
  </div>
</template>

<style scoped>
.plan-terminal-container {
  margin: 1px 0;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  font-family: 'Fira Code', 'Courier New', monospace;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.25);
  transition: border-color 0.2s ease;
}

.reasoning-terminal-container {
  border-color: rgba(207, 162, 147, 0.25);
}

.reasoning-terminal-container:hover {
  border-color: rgba(207, 162, 147, 0.45);
}

.terminal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--surface);
  padding: 8px 14px;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid var(--border);
}

.terminal-header-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.header-icon {
  color: var(--planner);
  flex-shrink: 0;
}

.terminal-title {
  color: #a6a6a0;
  font-size: 0.8rem;
  font-weight: 500;
}

.terminal-toggle-btn {
  background: transparent;
  color: var(--faint);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 0.72rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.terminal-toggle-btn:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.04);
  border-color: var(--border);
}

.terminal-body {
  padding: 12px;
  max-height: 220px;
  overflow-y: auto;
  font-size: 0.78rem;
  line-height: 1.5;
  display: flex;
  flex-direction: column;
  gap: 4px;
  scroll-behavior: smooth;
}

.plan-body {
  max-height: 200px;
}

.plan-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--muted);
  font-family: inherit;
  font-size: inherit;
}
</style>
