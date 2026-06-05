<script setup lang="ts">
import { computed } from 'vue';
import type { Plan } from '@agent-bridge/shared';
import { renderMarkdown } from '../lib/markdown';

const props = defineProps<{
  plan: Plan | null;
}>();

defineEmits<{
  (e: 'close'): void;
}>();

const doneCount = computed(() => props.plan?.tasks.filter(t => t.status === 'completed').length ?? 0);
const totalCount = computed(() => props.plan?.tasks.length ?? 0);

function statusLabel(status: string): string {
  if (status === 'completed') return 'Done';
  if (status === 'in_progress') return 'Doing';
  return 'To do';
}
</script>

<template>
  <aside class="plan-panel">
    <header class="plan-panel-header">
      <div class="plan-panel-heading">
        <span class="plan-panel-title">{{ plan?.title || 'Plan' }}</span>
        <span v-if="totalCount" class="plan-panel-count">{{ doneCount }} / {{ totalCount }}</span>
      </div>
      <button type="button" class="plan-panel-close" title="Hide plan panel" @click="$emit('close')">Close</button>
    </header>

    <div class="plan-panel-body">
      <div v-if="plan?.body" class="plan-panel-prose" v-html="renderMarkdown(plan.body)"></div>

      <ul v-if="plan && plan.tasks.length" class="plan-tasks">
        <li
          v-for="(task, index) in plan.tasks"
          :key="index"
          class="plan-task"
          :class="task.status"
        >
          <span class="plan-task-box" :class="task.status"></span>
          <span class="plan-task-text">{{ task.text }}</span>
          <span class="plan-task-status" :class="task.status">{{ statusLabel(task.status) }}</span>
        </li>
      </ul>

      <p v-else-if="!plan?.body" class="plan-panel-empty">
        The assistant's plan will appear here once it drafts one.
      </p>
    </div>
  </aside>
</template>

<style scoped>
.plan-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 12px;
  margin: 12px 12px 12px 0;
  background: var(--sidebar);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}

.plan-panel-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  flex: 0 0 auto;
}

.plan-panel-heading {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.plan-panel-title {
  font-size: 0.95rem;
  font-weight: 650;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plan-panel-count {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
  font-family: monospace;
  font-size: 0.72rem;
  color: var(--faint);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1px 8px;
}

.plan-panel-close {
  margin-left: auto;
  flex: 0 0 auto;
  background: none;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--muted);
  font-size: 0.72rem;
  cursor: pointer;
  padding: 3px 9px;
}

.plan-panel-close:hover {
  color: var(--text);
  background: var(--surface-strong);
}

.plan-panel-body {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.plan-panel-prose {
  font-size: 0.86rem;
  line-height: 1.55;
  color: var(--muted);
  margin-bottom: 16px;
  word-break: break-word;
}

.plan-panel-prose :deep(p) {
  margin: 0.5em 0;
}

.plan-panel-prose :deep(h1),
.plan-panel-prose :deep(h2),
.plan-panel-prose :deep(h3),
.plan-panel-prose :deep(h4) {
  color: var(--text);
  font-weight: 650;
  line-height: 1.3;
  margin: 1em 0 0.4em;
}

.plan-panel-prose :deep(h1) { font-size: 1rem; }
.plan-panel-prose :deep(h2) { font-size: 0.94rem; }
.plan-panel-prose :deep(h3),
.plan-panel-prose :deep(h4) { font-size: 0.88rem; }

.plan-panel-prose :deep(ul),
.plan-panel-prose :deep(ol) {
  padding-left: 1.25em;
  margin: 0.5em 0;
}

.plan-panel-prose :deep(li) {
  margin: 0.25em 0;
}

.plan-panel-prose :deep(strong) {
  color: var(--text);
}

.plan-panel-prose :deep(a) {
  color: var(--text);
  text-decoration: underline;
}

.plan-panel-prose :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.82em;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 5px;
}

.plan-panel-prose :deep(pre) {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  overflow-x: auto;
  margin: 0.6em 0;
}

.plan-panel-prose :deep(pre code) {
  background: none;
  border: 0;
  padding: 0;
}

.plan-panel-prose :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 0.6em 0;
  font-size: 0.8rem;
}

.plan-panel-prose :deep(th),
.plan-panel-prose :deep(td) {
  border: 1px solid var(--border);
  padding: 5px 8px;
  text-align: left;
  vertical-align: top;
}

.plan-panel-prose :deep(th) {
  color: var(--text);
  background: var(--surface);
  font-weight: 600;
}

.plan-panel-prose :deep(blockquote) {
  border-left: 2px solid var(--border);
  margin: 0.6em 0;
  padding-left: 12px;
  color: var(--faint);
}

.plan-panel-empty {
  font-size: 0.85rem;
  color: var(--faint);
  line-height: 1.5;
  margin: 0;
}

.plan-tasks {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.plan-task {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 7px 8px;
  border-radius: 6px;
}

.plan-task.in_progress {
  background: rgba(255, 255, 255, 0.03);
}

.plan-task-box {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  border-radius: 4px;
  border: 1.5px solid var(--faint);
  margin-top: 2px;
}

.plan-task-box.completed {
  background: var(--success);
  border-color: var(--success);
}

.plan-task-box.in_progress {
  border-color: var(--text);
  background: repeating-linear-gradient(
    45deg,
    var(--faint),
    var(--faint) 2px,
    transparent 2px,
    transparent 4px
  );
}

.plan-task-text {
  flex: 1 1 auto;
  font-size: 0.84rem;
  color: var(--text);
  line-height: 1.45;
}

.plan-task.completed .plan-task-text {
  color: var(--faint);
  text-decoration: line-through;
}

.plan-task-status {
  flex: 0 0 auto;
  font-size: 0.66rem;
  font-family: monospace;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--faint);
  margin-top: 2px;
}

.plan-task-status.in_progress {
  color: var(--text);
}

.plan-task-status.completed {
  color: var(--success);
}
</style>
