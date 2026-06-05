<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { PermissionRule, ProviderMetadata } from '@bridgemind/shared';
import PermissionsTab from './PermissionsTab.vue';
import ProvidersTab from './ProvidersTab.vue';

const props = defineProps<{
  show: boolean;
  permissions: PermissionRule[];
  isLoading: boolean;
  providers: ProviderMetadata[];
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'revoke', id: number): void;
  (e: 'clear-all'): void;
}>();

const TABS = [
  { id: 'permissions', label: 'Permissions' },
  { id: 'providers', label: 'Providers' }
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
      <header class="settings-topbar">
        <h2 class="settings-title">Settings</h2>
        <button class="settings-close" title="Close (Esc)" @click="emit('close')">Close</button>
      </header>

      <div class="settings-main">
        <nav class="settings-rail">
          <button
            v-for="tab in TABS"
            :key="tab.id"
            class="settings-rail-item"
            :class="{ active: activeTab === tab.id }"
            @click="activeTab = tab.id"
          >
            {{ tab.label }}
          </button>
        </nav>

        <section class="settings-content">
          <PermissionsTab
            v-if="activeTab === 'permissions'"
            :permissions="permissions"
            :is-loading="isLoading"
            @revoke="emit('revoke', $event)"
            @clear-all="emit('clear-all')"
          />
          <ProvidersTab v-else-if="activeTab === 'providers'" :providers="providers" />
        </section>
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

.settings-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 56px;
  padding: 0 22px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
}

.settings-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--text);
}

.settings-close {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted);
  font-size: 0.85rem;
  line-height: 1;
  cursor: pointer;
  padding: 7px 14px;
  border-radius: 8px;
  transition: all 0.2s ease;
}

.settings-close:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.06);
}

.settings-main {
  flex: 1;
  min-height: 0;
  display: flex;
}

.settings-rail {
  flex: 0 0 220px;
  border-right: 1px solid var(--border);
  background: var(--sidebar);
  padding: 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.settings-rail-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  font-size: 0.9rem;
  text-align: left;
  cursor: pointer;
  transition: all 0.15s ease;
}

.settings-rail-item:hover {
  color: var(--text);
  background: var(--sidebar-active);
}

.settings-rail-item.active {
  color: var(--text);
  background: var(--sidebar-active);
  font-weight: 600;
}

.settings-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 28px 32px;
}

/* Shared panel chrome used by tab components */
.settings-content :deep(.settings-tab-panel) {
  max-width: 720px;
  margin: 0 auto;
}

.settings-content :deep(.settings-section-head) {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.settings-content :deep(.settings-section-title) {
  margin: 0 0 4px;
  font-size: 1.1rem;
  color: var(--text);
}

.settings-content :deep(.settings-section-desc) {
  margin: 0;
  font-size: 0.82rem;
  color: var(--muted);
  line-height: 1.5;
  max-width: 460px;
}

.settings-content :deep(.settings-section-desc code) {
  font-family: monospace;
  background: var(--surface-strong);
  padding: 1px 5px;
  border-radius: 4px;
}

.settings-content :deep(.settings-empty) {
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
