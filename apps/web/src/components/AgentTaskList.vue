<script setup lang="ts">
import { computed, ref } from 'vue';

const props = defineProps<{
  taskListText: string;
}>();

interface Task {
  text: string;
  completed: boolean;
}

const collapsed = ref(false);

const tasks = computed<Task[]>(() => {
  if (!props.taskListText) return [];

  const lines = props.taskListText.split('\n');
  const parsedTasks: Task[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- [ ]') || trimmed.startsWith('- [x]') || trimmed.startsWith('- [X]')) {
      const completed = trimmed.startsWith('- [x]') || trimmed.startsWith('- [X]');
      const text = trimmed.substring(5).trim();
      if (text) {
        parsedTasks.push({ text, completed });
      }
    }
  }

  return parsedTasks;
});

const doneCount = computed(() => tasks.value.filter(t => t.completed).length);
const allDone = computed(() => tasks.value.length > 0 && doneCount.value === tasks.value.length);
</script>

<template>
  <div v-if="tasks.length > 0" class="agent-task-list" :class="{ 'all-done': allDone }">
    <header class="task-list-header" @click="collapsed = !collapsed">
      <span class="task-title">Tasks</span>
      <span class="task-count">{{ doneCount }} / {{ tasks.length }}</span>
      <button type="button" class="task-toggle">{{ collapsed ? 'Show' : 'Hide' }}</button>
    </header>
    <ul v-if="!collapsed" class="task-items">
      <li
        v-for="(task, index) in tasks"
        :key="index"
        class="task-item"
        :class="{ completed: task.completed }"
      >
        <span class="task-box" :class="{ checked: task.completed }"></span>
        <span class="task-text">{{ task.text }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.agent-task-list {
  width: min(800px, 100%);
  margin: 0 auto 8px;
  background: var(--surface-strong);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}

.task-list-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  font-size: 0.78rem;
  color: var(--muted);
  font-weight: 500;
  cursor: pointer;
  user-select: none;
}

.task-list-header:hover {
  background: rgba(255, 255, 255, 0.02);
}

.task-title {
  letter-spacing: 0.02em;
}

.task-count {
  font-variant-numeric: tabular-nums;
  font-family: monospace;
  font-size: 0.72rem;
  color: var(--faint);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1px 8px;
}

.all-done .task-count {
  color: var(--success);
  border-color: var(--success);
}

.task-toggle {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--faint);
  font-size: 0.72rem;
  cursor: pointer;
  padding: 2px 4px;
}

.task-toggle:hover {
  color: var(--muted);
}

.task-items {
  list-style: none;
  padding: 6px 8px 10px;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-top: 1px solid var(--border);
  max-height: 220px;
  overflow-y: auto;
}

.task-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 5px 8px;
  border-radius: 6px;
}

.task-box {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  border-radius: 4px;
  border: 1.5px solid var(--faint);
  margin-top: 2px;
  transition: background 0.18s ease, border-color 0.18s ease;
}

.task-box.checked {
  background: var(--success);
  border-color: var(--success);
}

.task-text {
  font-size: 0.84rem;
  color: var(--text);
  line-height: 1.45;
}

.task-item.completed .task-text {
  color: var(--faint);
  text-decoration: line-through;
}
</style>
