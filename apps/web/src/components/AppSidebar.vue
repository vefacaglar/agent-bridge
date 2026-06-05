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
  isSidebarCollapsed: boolean;
}>();

const emit = defineEmits<{
  (e: 'new-chat'): void;
  (e: 'add-project'): void;
  (e: 'select-project', path: string): void;
  (e: 'select-run', run: Run): void;
  (e: 'delete-project', path: string): void;
  (e: 'open-settings'): void;
  (e: 'toggle-sidebar'): void;
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
  <aside class="sidebar" :class="{ collapsed: isSidebarCollapsed }">
    <div class="sidebar-header">
      <button class="search-btn" title="Search">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/>
          <path d="m21 21-4.3-4.3"/>
        </svg>
      </button>
      <button class="collapse-btn" @click="emit('toggle-sidebar')" title="Collapse Sidebar">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <path d="M9 3v18" />
        </svg>
      </button>
    </div>

    <button class="nav-action" :disabled="isRunning" @click="emit('new-chat')">New chat</button>

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
            <div class="project-header-left">
              <!-- Open Folder SVG when active -->
              <svg v-if="project.path === activeProjectPath" class="folder-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2A2 2 0 0 0 12.07 6H20a2 2 0 0 1 2 2v2"/>
              </svg>
              <!-- Closed Folder SVG when inactive -->
              <svg v-else class="folder-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
              </svg>
              <span class="project-name-text">{{ project.name }}</span>
            </div>
            <button class="delete-project-btn" title="Remove Project" @click="onDeleteProject(project.path, $event)">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18"/>
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
              </svg>
            </button>
          </div>

          <Transition name="expand">
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
          </Transition>
        </div>
      </div>
    </div>

    <button class="nav-action muted settings-action" @click="emit('open-settings')">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
      <span>Settings</span>
    </button>
  </aside>
</template>

<style scoped>
.sidebar-header {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  padding: 0 0 4px 0;
  background: transparent;
  border: none;
  gap: 8px;
}

.search-btn,
.collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
}

.search-btn:hover,
.collapse-btn:hover {
  background: var(--sidebar-active);
  color: var(--text);
}

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

.project-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}

.project-accordion-item {
  border-radius: 6px;
  overflow: hidden;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.project-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 6px;
  color: var(--muted);
  cursor: pointer;
  user-select: none;
  transition: all 0.2s ease;
}

.project-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.folder-icon {
  flex-shrink: 0;
  color: var(--faint);
  transition: color 0.2s ease;
}

.project-header:hover .folder-icon {
  color: var(--muted);
}

.project-header.active .folder-icon {
  color: var(--muted);
}

.project-header:hover {
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
}

.project-header.active {
  color: var(--text);
  font-weight: 500;
}

.project-name-text {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.88rem;
}

.project-chats-list {
  padding: 4px 6px 8px 16px;
  margin-top: 0;
  border-left: none;
  margin-left: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.delete-project-btn {
  background: transparent;
  color: var(--faint);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: all 0.2s ease;
}

.project-header:hover .delete-project-btn {
  opacity: 1;
}

.delete-project-btn:hover {
  color: var(--danger);
  background: rgba(255, 138, 128, 0.15);
}

/* Slide expand transition for the accordion */
.expand-enter-active,
.expand-leave-active {
  transition: max-height 0.22s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.22s ease;
  max-height: 400px;
  overflow: hidden;
}

.expand-enter-from,
.expand-leave-to {
  max-height: 0;
  opacity: 0;
}
</style>
