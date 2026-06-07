<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { Memory, MemoryCategory, MemoryScope, PermissionRule, ProviderMetadata } from '@agent-bridge/shared';
import PermissionsTab from './PermissionsTab.vue';
import ProvidersTab from './ProvidersTab.vue';
import AgentPresetsTab from './AgentPresetsTab.vue';
import MemoryTab from './MemoryTab.vue';

const props = defineProps<{
  show: boolean;
  permissions: PermissionRule[];
  isLoading: boolean;
  providers: ProviderMetadata[];
  memories: Memory[];
  memoriesLoading: boolean;
  activeProjectPath: string;
  activeProjectName: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'revoke', id: number): void;
  (e: 'clear-all'): void;
  (e: 'presets-saved'): void;
  (e: 'add-memory', payload: { scope: MemoryScope; category: MemoryCategory; content: string; projectPath?: string }): void;
  (e: 'update-memory', payload: { id: number; content: string }): void;
  (e: 'delete-memory', id: number): void;
  (e: 'clear-memories'): void;
}>();

const TABS = [
  { id: 'permissions', label: 'Permissions' },
  { id: 'memory', label: 'Memory' },
  { id: 'providers', label: 'Providers' },
  { id: 'agents', label: 'Agents' }
] as const;
type TabId = (typeof TABS)[number]['id'];

const activeTab = ref<TabId>('permissions');

function onKey(e: KeyboardEvent) {
  if (props.show && e.key === 'Escape') {
    e.preventDefault();
    emit('close');
  }
}

onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <transition name="settings-fade">
    <div v-if="show" class="settings-screen">
      <div class="app-shell">
        <aside class="sidebar">
          <div class="sidebar-header">
            <span class="sidebar-label">Settings</span>
          </div>

          <div class="sidebar-block" style="flex: 1; display: flex; flex-direction: column; gap: 6px;">
            <button
              v-for="tab in TABS"
              :key="tab.id"
              class="nav-action"
              :class="{ active: activeTab === tab.id }"
              @click="activeTab = tab.id"
            >
              {{ tab.label }}
            </button>
          </div>

          <button class="nav-action muted" style="margin-top: auto; display: flex; align-items: center; gap: 8px;" @click="emit('close')">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m15 18-6-6 6-6"/>
            </svg>
            Back to Chat
          </button>
        </aside>

        <main class="chat-shell">
          <header class="chat-header">
            <div class="chat-header-inner">
              <div class="thread-title">
                <div class="project-breadcrumb">
                  <span class="breadcrumb-project">Settings</span>
                  <span class="breadcrumb-separator">/</span>
                  <span class="breadcrumb-chat-title">{{ TABS.find(t => t.id === activeTab)?.label }}</span>
                </div>
              </div>
              <div class="header-actions">
              </div>
            </div>
          </header>

          <section class="messages-scroll">
            <div class="settings-container-wrap">
              <PermissionsTab
                v-if="activeTab === 'permissions'"
                :permissions="permissions"
                :is-loading="isLoading"
                @revoke="emit('revoke', $event)"
                @clear-all="emit('clear-all')"
              />
              <MemoryTab
                v-else-if="activeTab === 'memory'"
                :memories="memories"
                :is-loading="memoriesLoading"
                :active-project-path="activeProjectPath"
                :active-project-name="activeProjectName"
                @add="emit('add-memory', $event)"
                @update="emit('update-memory', $event)"
                @delete="emit('delete-memory', $event)"
                @clear-all="emit('clear-memories')"
              />
              <ProvidersTab v-else-if="activeTab === 'providers'" :providers="providers" />
              <AgentPresetsTab
                v-else-if="activeTab === 'agents'"
                :providers="providers"
                @saved="emit('presets-saved')"
              />
            </div>
          </section>
        </main>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.settings-screen {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: var(--bg);
  display: flex;
  flex-direction: column;
}

.settings-screen .nav-action.active {
  background: var(--sidebar-active);
  color: var(--text);
  font-weight: 600;
}

.sidebar-header {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  height: var(--top-bar-h);
  flex: 0 0 auto;
  padding: 0;
  background: transparent;
  border: none;
}

.sidebar-label {
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--text);
}

.settings-container-wrap {
  width: min(800px, 100%);
  margin: 0 auto;
}

/* Shared panel style overrides for tab components */
.messages-scroll :deep(.settings-tab-panel) {
  width: 100%;
}

.messages-scroll :deep(.settings-section-head) {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.messages-scroll :deep(.settings-section-title) {
  margin: 0 0 4px;
  font-size: 1.1rem;
  color: var(--text);
}

.messages-scroll :deep(.settings-section-desc) {
  margin: 0;
  font-size: 0.82rem;
  color: var(--muted);
  line-height: 1.5;
  max-width: 460px;
}

.messages-scroll :deep(.settings-section-desc code) {
  font-family: monospace;
  background: var(--surface-strong);
  padding: 1px 5px;
  border-radius: 4px;
}

.messages-scroll :deep(.settings-empty) {
  padding: 40px 12px;
  text-align: center;
  color: var(--faint);
  font-size: 0.88rem;
  font-style: italic;
}

.messages-scroll :deep(.settings-section-title) {
  display: none;
}

.chat-header {
  display: block;
  padding: 0;
  border-bottom: 1px solid var(--border);
}

.chat-header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 58px;
  width: 100%;
  padding: 0 24px;
  box-sizing: border-box;
}

.thread-title {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.project-breadcrumb {
  display: flex;
  align-items: center;
  font-size: 0.95rem;
  font-weight: 500;
  color: var(--text);
  min-width: 0;
  flex: 1;
}

.breadcrumb-project {
  color: var(--muted);
  font-weight: 400;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 180px;
  flex-shrink: 0;
}

.breadcrumb-separator {
  margin: 0 8px;
  color: var(--faint);
  user-select: none;
  flex-shrink: 0;
}

.breadcrumb-chat-title {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.settings-fade-enter-active,
.settings-fade-leave-active {
  transition: opacity 0.2s ease;
}

.settings-fade-enter-from,
.settings-fade-leave-to {
  opacity: 0;
}
</style>
