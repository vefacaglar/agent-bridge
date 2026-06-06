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
          <div class="sidebar-header" style="justify-content: flex-start; margin-bottom: 8px; padding-bottom: 4px;">
            <span class="sidebar-label" style="font-size: 1.05rem; font-weight: 600; color: var(--text);">Settings</span>
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

.settings-fade-enter-active,
.settings-fade-leave-active {
  transition: opacity 0.2s ease;
}

.settings-fade-enter-from,
.settings-fade-leave-to {
  opacity: 0;
}
</style>
