<script setup lang="ts">
import { computed } from 'vue';
import type { Run } from '@bridgemind/shared';
import { DEFAULT_PROJECT_PATH } from '../lib/format';

interface ProjectOption {
  path: string;
  name: string;
  count: number;
}

const props = defineProps<{
  projectOptions: ProjectOption[];
  activeProjectPath: string;
  runs: Run[];
  activeRunId: string | null;
  isRunning: boolean;
}>();

const emit = defineEmits<{
  (e: 'new-chat'): void;
  (e: 'add-project'): void;
  (e: 'select-project', path: string): void;
  (e: 'select-run', run: Run): void;
  (e: 'delete-project', path: string): void;
  (e: 'open-settings'): void;
}>();

const filteredRuns = computed(() =>
  props.runs.filter(run => (run.projectPath || DEFAULT_PROJECT_PATH) === props.activeProjectPath)
);

function onDeleteProject(path: string, event: Event) {
  event.stopPropagation();
  emit('delete-project', path);
}
</script>

<template>
  <aside class="sidebar">
    <div class="window-dots" aria-hidden="true">
      <span></span>
      <span></span>
      <span></span>
    </div>

    <button class="nav-action" :disabled="isRunning" @click="emit('new-chat')">New chat</button>
    <button class="nav-action muted">Search</button>

    <div class="sidebar-block projects-accordion">
      <div class="sidebar-label flex-between">
        <span>Projects</span>
        <button class="add-project-btn" title="Add Project" @click="emit('add-project')">+</button>
      </div>
      <div class="project-list">
        <div
          v-for="project in projectOptions"
          :key="project.path"
          class="project-accordion-item"
          :class="{ active: project.path === activeProjectPath }"
        >
          <div
            class="project-header"
            :class="{ active: project.path === activeProjectPath }"
            @click="emit('select-project', project.path)"
          >
            <span class="project-name-text">{{ project.name }}</span>
            <button class="delete-project-btn" title="Remove Project" @click="onDeleteProject(project.path, $event)">
              Remove
            </button>
          </div>

          <div v-if="project.path === activeProjectPath" class="project-chats-list">
            <div v-if="filteredRuns.length === 0" class="empty-sidebar">No chats in this project.</div>
            <button
              v-for="run in filteredRuns"
              :key="run.id"
              class="chat-history-item"
              :class="{ active: run.id === activeRunId }"
              @click="emit('select-run', run)"
            >
              <span>{{ run.title }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <button class="nav-action muted settings-action" @click="emit('open-settings')">
      Settings
    </button>
  </aside>
</template>

<style scoped>
.projects-accordion {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  margin-top: 14px;
}

.settings-action {
  margin-top: 8px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.project-accordion-item {
  margin-bottom: 4px;
  border-radius: 8px;
  overflow: hidden;
}

.project-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 8px;
  color: var(--muted);
  cursor: pointer;
  user-select: none;
  transition: all 0.2s ease;
}

.project-header:hover {
  background: var(--sidebar-active);
  color: var(--text);
}

.project-header.active {
  color: var(--text);
  font-weight: 600;
}

.project-name-text {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-chats-list {
  padding-left: 10px;
  margin-top: 2px;
  border-left: 1px solid var(--border);
  margin-left: 14px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.delete-project-btn {
  background: transparent;
  color: var(--faint);
  font-size: 0.72rem;
  cursor: pointer;
  padding: 2px 6px;
  line-height: 1;
  border-radius: 4px;
  display: none;
  transition: all 0.2s ease;
}

.project-header:hover .delete-project-btn {
  display: block;
}

.delete-project-btn:hover {
  color: var(--danger);
  background: rgba(255, 138, 128, 0.15);
}
</style>
