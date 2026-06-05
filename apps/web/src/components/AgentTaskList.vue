<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  taskListText: string;
}>();

interface Task {
  text: string;
  completed: boolean;
}

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
</script>

<template>
  <div v-if="tasks.length > 0" class="agent-task-list">
    <div class="task-list-header">
      <svg class="task-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 20h9"/>
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
      </svg>
      <span class="task-title">Agent Tasks</span>
      <span class="task-count">{{ tasks.filter(t => t.completed).length }} / {{ tasks.length }}</span>
    </div>
    <ul class="task-items">
      <li v-for="(task, index) in tasks" :key="index" class="task-item" :class="{ completed: task.completed }">
        <div class="checkbox-wrapper">
          <svg v-if="task.completed" class="check-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        <span class="task-text">{{ task.text }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.agent-task-list {
  margin: 12px 0;
  background: rgba(20, 20, 22, 0.4);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.task-list-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.02);
  border-bottom: 1px solid var(--border);
  font-size: 0.8rem;
  color: var(--muted);
  font-weight: 500;
}

.task-icon {
  color: var(--planner);
}

.task-title {
  flex: 1;
}

.task-count {
  font-variant-numeric: tabular-nums;
  background: rgba(255, 255, 255, 0.05);
  padding: 2px 6px;
  border-radius: 12px;
  font-size: 0.7rem;
}

.task-items {
  list-style: none;
  padding: 8px;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.task-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 6px;
  transition: background 0.2s ease;
}

.task-item:hover {
  background: rgba(255, 255, 255, 0.03);
}

.checkbox-wrapper {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1.5px solid var(--faint);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 2px;
  transition: all 0.2s ease;
}

.task-item.completed .checkbox-wrapper {
  background: var(--success);
  border-color: var(--success);
}

.check-icon {
  color: var(--bg);
}

.task-text {
  font-size: 0.85rem;
  color: var(--text);
  line-height: 1.4;
  transition: color 0.2s ease;
}

.task-item.completed .task-text {
  color: var(--faint);
  text-decoration: line-through;
}
</style>
