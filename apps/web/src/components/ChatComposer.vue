<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { PermissionDecision } from '../api/client';
import type { MessageGroup } from '../lib/messageGroups';
import { MODES_LIST, type ChatMode, type ModelOption } from '../composables/useComposerSettings';
import ConfirmationCard from './ConfirmationCard.vue';
import PermissionCard from './PermissionCard.vue';

const props = defineProps<{
  taskInput: string;
  isRunning: boolean;
  currentMode: ChatMode;
  bypassPermissions: boolean;
  selectedModel: string;
  modelOptions: ModelOption[];
  activeModelDisplayName: string;
  focusSignal: number;
  confirmationGroup: MessageGroup | null;
  showPermission: boolean;
  permissionRequest: any;
}>();

const emit = defineEmits<{
  (e: 'update:taskInput', value: string): void;
  (e: 'update:currentMode', value: ChatMode): void;
  (e: 'update:bypassPermissions', value: boolean): void;
  (e: 'update:selectedModel', value: string): void;
  (e: 'send'): void;
  (e: 'quick-reply', option: string): void;
  (e: 'permission-decision', decision: PermissionDecision): void;
}>();

const textarea = ref<HTMLTextAreaElement | null>(null);
const showModeMenu = ref(false);
const showModelMenu = ref(false);

function getModeLabel(modeId: string): string {
  return MODES_LIST.find(m => m.id === modeId)?.label ?? 'Accept edits';
}

function selectMode(modeId: ChatMode) {
  emit('update:currentMode', modeId);
  showModeMenu.value = false;
}

function selectModel(value: string) {
  emit('update:selectedModel', value);
  showModelMenu.value = false;
}

// Focus is driven by a signal counter incremented by the parent session.
watch(() => props.focusSignal, () => {
  requestAnimationFrame(() => textarea.value?.focus());
});

watch(() => props.isRunning, (running) => {
  if (!running) requestAnimationFrame(() => textarea.value?.focus());
});

function handleDocumentClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (!target.closest('.mode-selector-wrap')) showModeMenu.value = false;
  if (!target.closest('.model-dropdown-wrap')) showModelMenu.value = false;
}

function handleKeyDown(e: KeyboardEvent) {
  if (!showModeMenu.value) return;
  const modeKeys: Record<string, ChatMode> = {
    '1': 'ask_permissions',
    '2': 'accept_edits',
    '3': 'plan',
    '4': 'auto'
  };
  if (modeKeys[e.key]) {
    e.preventDefault();
    selectMode(modeKeys[e.key]);
  }
}

onMounted(() => {
  document.addEventListener('click', handleDocumentClick);
  window.addEventListener('keydown', handleKeyDown);
  requestAnimationFrame(() => textarea.value?.focus());
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick);
  window.removeEventListener('keydown', handleKeyDown);
});
</script>

<template>
  <footer class="composer-wrap">
    <div class="composer-container" style="position: relative;">
      <ConfirmationCard :group="confirmationGroup" @reply="emit('quick-reply', $event)" />

      <PermissionCard
        :request="showPermission ? permissionRequest : null"
        @decide="emit('permission-decision', $event)"
      />

      <div class="composer-input-box" style="position: relative; z-index: 2;">
        <textarea
          ref="textarea"
          :value="taskInput"
          :disabled="isRunning"
          placeholder="Type a message..."
          @input="emit('update:taskInput', ($event.target as HTMLTextAreaElement).value)"
          @keydown.enter.exact.prevent="emit('send')"
        />
        <button
          class="composer-send-btn"
          :disabled="isRunning || !taskInput.trim() || !selectedModel"
          title="Send message"
          @click="emit('send')"
        >
          Send
        </button>
      </div>

      <div class="composer-menu-row" style="position: relative; z-index: 2;">
        <div class="mode-selector-wrap">
          <button class="mode-pill-btn" @click.stop="showModeMenu = !showModeMenu">
            <span class="mode-pill-text">{{ getModeLabel(currentMode) }}</span>
          </button>

          <div v-if="showModeMenu" class="mode-popup-menu">
            <header class="mode-popup-header">
              <span class="mode-popup-title">Mode</span>
            </header>
            <ul class="mode-popup-list">
              <li
                v-for="modeItem in MODES_LIST"
                :key="modeItem.id"
                :class="{ active: currentMode === modeItem.id }"
                @click.stop="selectMode(modeItem.id)"
              >
                <span class="mode-item-name">{{ modeItem.label }}</span>
                <span class="mode-item-shortcut">{{ modeItem.shortcut }}</span>
              </li>
              <li class="mode-popup-divider"></li>
              <li @click.stop="emit('update:bypassPermissions', !bypassPermissions)">
                <span class="mode-item-name">Bypass permissions</span>
                <span class="bypass-toggle-badge" :class="{ enabled: bypassPermissions }">
                  {{ bypassPermissions ? 'Disable' : 'Enable' }}
                </span>
              </li>
            </ul>
          </div>
        </div>

        <div class="composer-status-section">
          <div class="model-dropdown-wrap">
            <button class="model-select-display-btn" @click.stop="showModelMenu = !showModelMenu">
              {{ activeModelDisplayName }}
            </button>
            <div v-if="showModelMenu" class="model-dropdown-list">
              <div
                v-for="option in modelOptions"
                :key="option.value"
                class="model-dropdown-item"
                :class="{ active: selectedModel === option.value }"
                @click.stop="selectModel(option.value)"
              >
                {{ option.label }}
              </div>
            </div>
          </div>

          <span class="status-divider">/</span>
          <span class="parameter-pill">Medium</span>
          <span class="status-indicator-ring" :class="{ active: isRunning }">
            <span class="ring-dot"></span>
          </span>
        </div>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.composer-container {
  width: min(1080px, 100%);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
}

.composer-input-box {
  position: relative;
  background: #1a1a1c;
  border: 1px solid #2d2d30;
  border-radius: 12px;
  padding: 10px 86px 10px 14px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.composer-input-box:focus-within {
  border-color: #444;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35);
}

.composer-input-box textarea {
  display: block;
  width: 100%;
  min-height: 44px;
  max-height: 180px;
  resize: vertical;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text);
  font-size: 0.95rem;
  line-height: 1.5;
  padding: 0;
  margin: 0;
}

.composer-send-btn {
  position: absolute;
  bottom: 10px;
  right: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-strong);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  padding: 6px 14px;
  font-size: 0.82rem;
  font-weight: 500;
}

.composer-send-btn:hover:not(:disabled) {
  background: var(--sidebar-active);
}

.composer-send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.composer-menu-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 10px;
  padding: 0 4px;
}

.mode-selector-wrap {
  position: relative;
}

.mode-pill-btn {
  display: flex;
  align-items: center;
  background: #1a1a1c;
  border: 1px solid #2d2d30;
  border-radius: 8px;
  padding: 6px 12px;
  color: var(--muted);
  font-size: 0.82rem;
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
  gap: 8px;
}

.mode-pill-btn:hover {
  border-color: #444;
  color: var(--text);
  background: #202022;
}

.mode-pill-text {
  font-weight: 500;
}

.mode-popup-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  width: 230px;
  background: #161618;
  border: 1px solid #2d2d30;
  border-radius: 10px;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.55);
  z-index: 1000;
  overflow: hidden;
  padding: 6px;
  animation: menuAppear 0.15s ease-out;
}

@keyframes menuAppear {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.mode-popup-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px 4px;
  border-bottom: 1px solid #222;
}

.mode-popup-title {
  color: var(--faint);
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.mode-popup-list {
  list-style: none;
  padding: 4px 0 0 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mode-popup-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 7px 10px;
  border-radius: 6px;
  color: var(--muted);
  font-size: 0.82rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.mode-popup-list li:hover {
  background: #252528;
  color: var(--text);
}

.mode-popup-list li.active {
  color: var(--text);
  background: #1e1e21;
}

.mode-item-name {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mode-item-shortcut {
  font-family: monospace;
  font-size: 0.75rem;
  color: var(--faint);
  background: #202022;
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid #2d2d30;
}

.mode-popup-divider {
  height: 1px;
  background: #222;
  margin: 4px 0;
  padding: 0 !important;
  pointer-events: none;
}

.bypass-toggle-badge {
  font-size: 0.72rem;
  padding: 2px 6px;
  border-radius: 4px;
  background: #252528;
  color: var(--muted);
  transition: all 0.2s ease;
  font-weight: 500;
}

.bypass-toggle-badge.enabled {
  background: rgba(123, 216, 143, 0.15);
  color: var(--success);
}

.composer-status-section {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--faint);
  font-size: 0.8rem;
}

.model-dropdown-wrap {
  position: relative;
}

.model-select-display-btn {
  background: transparent;
  color: var(--muted);
  font-size: 0.8rem;
  cursor: pointer;
  transition: color 0.2s ease;
  padding: 4px 6px;
  border-radius: 4px;
  border: 0;
}

.model-select-display-btn:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.05);
}

.model-dropdown-list {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  width: 260px;
  max-height: 220px;
  overflow-y: auto;
  background: #161618;
  border: 1px solid #2d2d30;
  border-radius: 10px;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.55);
  z-index: 1000;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.model-dropdown-item {
  padding: 8px 12px;
  border-radius: 6px;
  color: var(--muted);
  font-size: 0.82rem;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.model-dropdown-item:hover {
  background: #252528;
  color: var(--text);
}

.model-dropdown-item.active {
  color: var(--text);
  background: #1e1e21;
  font-weight: 600;
}

.status-divider {
  color: #2d2d30;
  user-select: none;
}

.parameter-pill {
  color: var(--muted);
  padding: 2px 6px;
  border-radius: 4px;
}

.status-indicator-ring {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1.5px solid #333;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.3s ease;
}

.status-indicator-ring.active {
  border-color: var(--success);
}

.ring-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #444;
  transition: background 0.3s ease;
}

.status-indicator-ring.active .ring-dot {
  background: var(--success);
  animation: pulseDot 1.2s infinite alternate;
}
</style>
