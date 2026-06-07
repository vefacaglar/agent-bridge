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
    <div v-if="show" class="settings-overlay" @click.self="emit('close')">
      <div class="settings-card">
        <aside class="settings-sidebar">
          <div class="settings-sidebar-header">
            <span class="settings-sidebar-label">Settings</span>
          </div>

          <div class="settings-tabs-list">
            <button
              v-for="tab in TABS"
              :key="tab.id"
              class="settings-tab-btn"
              :class="{ active: activeTab === tab.id }"
              @click="activeTab = tab.id"
            >
              {{ tab.label }}
            </button>
          </div>

          <button class="settings-close-btn" @click="emit('close')">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m15 18-6-6 6-6"/>
            </svg>
            Close Settings
          </button>
        </aside>

        <main class="settings-main">
          <header class="settings-main-header">
            <div class="settings-main-header-inner">
              <div class="settings-breadcrumb">
                <span class="breadcrumb-project">Settings</span>
                <span class="breadcrumb-separator">/</span>
                <span class="breadcrumb-chat-title">{{ TABS.find(t => t.id === activeTab)?.label }}</span>
              </div>
              <button class="settings-top-close-btn" @click="emit('close')" title="Close Settings">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          </header>

          <section class="settings-scroll-area">
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
.settings-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2500;
  background: rgba(8, 8, 8, 0.7);
  backdrop-filter: blur(12px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.settings-card {
  width: min(980px, 100%);
  height: min(680px, 90vh);
  background: #141414;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  box-shadow: 
    0 30px 70px rgba(0, 0, 0, 0.6),
    0 0 1px rgba(255, 255, 255, 0.1) inset;
  display: flex;
  overflow: hidden;
}

.settings-sidebar {
  width: 220px;
  background: #0e0e0e;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  padding: 20px;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.settings-sidebar-header {
  margin-bottom: 24px;
  padding-left: 6px;
}

.settings-sidebar-label {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.01em;
}

.settings-tabs-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}

.settings-tab-btn {
  width: 100%;
  padding: 10px 12px;
  font-size: 0.92rem;
  font-weight: 550;
  color: var(--muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.settings-tab-btn:hover {
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
}

.settings-tab-btn.active {
  background: var(--sidebar-active);
  border-color: rgba(255, 255, 255, 0.06);
  color: var(--text);
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  transform: translateX(2px);
}

.settings-close-btn {
  width: 100%;
  margin-top: auto;
  padding: 10px 12px;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--faint);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s ease;
}

.settings-close-btn:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.04);
}

.settings-close-btn svg {
  transition: transform 0.2s ease;
}

.settings-close-btn:hover svg {
  transform: translateX(-3px);
}

.settings-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: #121212;
}

.settings-main-header {
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  padding: 0 24px;
}

.settings-main-header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 58px;
}

.settings-breadcrumb {
  display: flex;
  align-items: center;
  font-size: 0.95rem;
  font-weight: 500;
  color: var(--text);
}

.breadcrumb-project {
  color: var(--muted);
  font-weight: 400;
}

.breadcrumb-separator {
  margin: 0 8px;
  color: var(--faint);
  user-select: none;
}

.breadcrumb-chat-title {
  font-weight: 600;
}

.settings-top-close-btn {
  background: transparent;
  border: none;
  color: var(--muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  transition: all 0.2s ease;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.settings-top-close-btn:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.15);
}

.settings-scroll-area {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.settings-container-wrap {
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
}

/* Shared panel style overrides for tab components */
.settings-scroll-area :deep(.settings-tab-panel) {
  width: 100%;
}

.settings-scroll-area :deep(.settings-section-head) {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.settings-scroll-area :deep(.settings-section-title) {
  margin: 0 0 4px;
  font-size: 1.1rem;
  color: var(--text);
}

.settings-scroll-area :deep(.settings-section-desc) {
  margin: 0;
  font-size: 0.82rem;
  color: var(--muted);
  line-height: 1.5;
  max-width: 460px;
}

.settings-scroll-area :deep(.settings-section-desc code) {
  font-family: monospace;
  background: var(--surface-strong);
  padding: 1px 5px;
  border-radius: 4px;
}

.settings-scroll-area :deep(.settings-empty) {
  padding: 40px 12px;
  text-align: center;
  color: var(--faint);
  font-size: 0.88rem;
  font-style: italic;
}

.settings-scroll-area :deep(.settings-section-title) {
  display: none;
}

/* Transitions */
.settings-fade-enter-active,
.settings-fade-leave-active {
  transition: opacity 0.25s ease;
}

.settings-fade-enter-from,
.settings-fade-leave-to {
  opacity: 0;
}

.settings-fade-enter-active .settings-card {
  animation: scaleUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.settings-fade-leave-active .settings-card {
  animation: scaleDown 0.2s ease-in forwards;
}

@keyframes scaleUp {
  from {
    transform: scale(0.95);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

@keyframes scaleDown {
  from {
    transform: scale(1);
    opacity: 1;
  }
  to {
    transform: scale(0.95);
    opacity: 0;
  }
}
</style>
