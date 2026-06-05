<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue';
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
  isLanding?: boolean;
  projectOptions?: { path: string; name: string }[];
  activeProjectPath?: string;
  messages?: any[];
}>();

const emit = defineEmits<{
  (e: 'update:taskInput', value: string): void;
  (e: 'update:currentMode', value: ChatMode): void;
  (e: 'update:bypassPermissions', value: boolean): void;
  (e: 'update:selectedModel', value: string): void;
  (e: 'send'): void;
  (e: 'quick-reply', option: string): void;
  (e: 'permission-decision', decision: PermissionDecision): void;
  (e: 'select-project', path: string): void;
}>();

const textarea = ref<HTMLTextAreaElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const attachedFiles = ref<{ name: string; content: string; extension: string }[]>([]);

function estimateTokens(text: string): number {
  if (!text) return 0;
  const charCount = text.length;
  const wordCount = text.trim().split(/\s+/).length;
  return Math.round(Math.max(charCount / 3.7, wordCount * 1.3));
}

const draftTokens = computed(() => {
  let text = props.taskInput || '';
  for (const file of attachedFiles.value) {
    const syntaxLang = file.extension ? file.extension.toLowerCase() : '';
    text += `\n\n### File: ${file.name}\n\`\`\`${syntaxLang}\n${file.content}\n\`\`\``;
  }
  return estimateTokens(text);
});

const contextTokens = computed(() => {
  let total = 250; // system prompt estimate
  if (props.messages) {
    for (const msg of props.messages) {
      if (msg.content) total += estimateTokens(msg.content);
      if (msg.reasoningContent) total += estimateTokens(msg.reasoningContent);
    }
  }
  return total;
});

const activeMessageStats = computed(() => {
  if (!props.messages || props.messages.length === 0) {
    return { status: 'idle', tokens: 0 };
  }
  
  const lastMsg = props.messages[props.messages.length - 1];
  
  if (props.isRunning) {
    if (lastMsg && lastMsg.role === 'assistant') {
      const tokens = estimateTokens((lastMsg.content || '') + (lastMsg.reasoningContent || ''));
      const isThinking = lastMsg.reasoningContent && !lastMsg.content;
      return {
        status: isThinking ? 'thinking' : 'generating',
        tokens
      };
    }
    return { status: 'running', tokens: 0 };
  }
  
  // Idle: find last assistant message in the conversation
  const assistantMessages = props.messages.filter(m => m.role === 'assistant');
  if (assistantMessages.length > 0) {
    const lastAssistant = assistantMessages[assistantMessages.length - 1];
    const tokens = estimateTokens((lastAssistant.content || '') + (lastAssistant.reasoningContent || ''));
    return { status: 'last_response', tokens };
  }
  
  return { status: 'idle', tokens: 0 };
});

const canSend = computed(() => {
  return !props.isRunning && props.selectedModel && (props.taskInput.trim() || attachedFiles.value.length > 0);
});

function triggerFileSelect() {
  fileInput.value?.click();
}

async function handleFileChange(event: Event) {
  const target = event.target as HTMLInputElement;
  if (!target.files || target.files.length === 0) return;

  for (const file of Array.from(target.files)) {
    if (file.size > 2 * 1024 * 1024) {
      window.alert(`File too large (max 2MB): ${file.name}`);
      continue;
    }
    try {
      const content = await readFileAsText(file);
      const extension = file.name.split('.').pop() || '';
      attachedFiles.value.push({
        name: file.name,
        content,
        extension
      });
    } catch (err) {
      console.error(`Error reading file ${file.name}:`, err);
      window.alert(`Failed to read file: ${file.name}`);
    }
  }
  target.value = '';
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function removeAttachment(idx: number) {
  attachedFiles.value.splice(idx, 1);
}

function handleSend() {
  if (!canSend.value) return;

  if (attachedFiles.value.length > 0) {
    let finalTask = props.taskInput;
    for (const file of attachedFiles.value) {
      const syntaxLang = file.extension ? file.extension.toLowerCase() : '';
      finalTask += `\n\n### File: ${file.name}\n\`\`\`${syntaxLang}\n${file.content}\n\`\`\``;
    }
    emit('update:taskInput', finalTask);
    attachedFiles.value = [];
    nextTick(() => {
      emit('send');
    });
  } else {
    emit('send');
  }
}

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

const showProjectMenu = ref(false);

const activeProjectName = computed(() => {
  const current = props.projectOptions?.find(p => p.path === props.activeProjectPath);
  return current ? current.name : 'Select project...';
});

function selectProjectItem(path: string) {
  emit('select-project', path);
  showProjectMenu.value = false;
}

// Focus is driven by a signal counter incremented by the parent session.
watch(() => props.focusSignal, () => {
  requestAnimationFrame(() => textarea.value?.focus());
});

watch(() => props.isRunning, (running) => {
  if (!running) requestAnimationFrame(() => textarea.value?.focus());
});

function adjustHeight() {
  const el = textarea.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

watch(() => props.taskInput, (val) => {
  if (!val) {
    if (textarea.value) textarea.value.style.height = '';
  } else {
    nextTick(adjustHeight);
  }
});

function handleDocumentClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (!target.closest('.mode-selector-wrap')) showModeMenu.value = false;
  if (!target.closest('.model-dropdown-wrap')) showModelMenu.value = false;
  if (!target.closest('.project-dropdown-wrap')) showProjectMenu.value = false;
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
  requestAnimationFrame(() => {
    textarea.value?.focus();
    adjustHeight();
  });
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

      <!-- Token info bar (placed outside the input box) -->
      <div class="composer-token-info">
        <span class="draft-tokens">
          <template v-if="activeMessageStats.status === 'thinking'">
            <span class="token-dot active thinking"></span>
            Thinking: {{ activeMessageStats.tokens }} tokens
          </template>
          <template v-else-if="activeMessageStats.status === 'generating'">
            <span class="token-dot active generating"></span>
            Generating: {{ activeMessageStats.tokens }} tokens
          </template>

        </span>
        <span class="context-tokens" title="Total context (system prompt + history + draft) sent to model">
          Context: {{ contextTokens + draftTokens }} tokens
        </span>
      </div>

      <div class="composer-input-box" style="position: relative; z-index: 2;">
        <!-- Attached Files List -->
        <div v-if="attachedFiles.length > 0" class="composer-attachments">
          <div
            v-for="(file, idx) in attachedFiles"
            :key="idx"
            class="attachment-pill"
          >
            <svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>
              <path d="M14 2v4a2 2 0 0 0 2 2h4"/>
            </svg>
            <span class="attachment-name" :title="file.name">{{ file.name }}</span>
            <button class="remove-attachment-btn" @click="removeAttachment(idx)" title="Remove file">
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18"/>
                <path d="m6 6 12 12"/>
              </svg>
            </button>
          </div>
        </div>

        <textarea
          ref="textarea"
          :value="taskInput"
          :disabled="isRunning"
          placeholder="Type a message..."
          @input="emit('update:taskInput', ($event.target as HTMLTextAreaElement).value)"
          @keydown.enter.exact.prevent="handleSend"
        />
        <button
          class="composer-send-btn"
          :disabled="!canSend"
          title="Send message"
          @click="handleSend"
        >
          Send
        </button>
      </div>

      <div class="composer-menu-row" style="position: relative; z-index: 2;">
        <div class="composer-menu-left" style="display: flex; gap: 8px; align-items: center;">
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

          <input
            type="file"
            ref="fileInput"
            style="display: none;"
            multiple
            @change="handleFileChange"
          />
          <button
            class="mode-pill-btn attach-file-btn"
            title="Attach files"
            :disabled="isRunning"
            @click="triggerFileSelect"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 12h14"/>
              <path d="M12 5v14"/>
            </svg>
          </button>

          <!-- Project selection dropdown (only on landing screen) -->
          <div v-if="isLanding" class="project-dropdown-wrap">
            <button class="mode-pill-btn" @click.stop="showProjectMenu = !showProjectMenu" title="Active Project">
              <svg class="folder-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--muted); opacity: 0.85; margin-right: 6px;">
                <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
              </svg>
              <span class="mode-pill-text">{{ activeProjectName }}</span>
            </button>

            <div v-if="showProjectMenu" class="mode-popup-menu project-popup-menu">
              <header class="mode-popup-header">
                <span class="mode-popup-title">Active Project</span>
              </header>
              <ul class="mode-popup-list">
                <li
                  v-for="project in projectOptions"
                  :key="project.path"
                  :class="{ active: activeProjectPath === project.path }"
                  @click.stop="selectProjectItem(project.path)"
                >
                  <span class="mode-item-name" style="display: flex; align-items: center; gap: 6px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--faint);">
                      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
                    </svg>
                    {{ project.name }}
                  </span>
                </li>
              </ul>
            </div>
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
                <span class="model-name-text">{{ option.label }}</span>
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

.composer-token-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  font-size: 0.72rem;
  color: var(--faint);
  user-select: none;
  padding: 0 4px;
}

.draft-tokens {
  display: flex;
  align-items: center;
  gap: 5px;
}

.token-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #3a3a3c;
  transition: all 0.2s ease;
}

.token-dot.active.thinking {
  background: #ffb74d;
  box-shadow: 0 0 6px #ffb74d;
  animation: pulseDot 1.2s infinite alternate;
}

.token-dot.active.generating {
  background: var(--success);
  box-shadow: 0 0 6px var(--success);
  animation: pulseDot 1.2s infinite alternate;
}

.token-dot.last-response {
  background: var(--muted);
}

.context-tokens {
  color: var(--faint);
  font-weight: 500;
}

@keyframes pulseDot {
  0% { opacity: 0.4; }
  100% { opacity: 1; }
}

.composer-input-box textarea {
  display: block;
  width: 100%;
  min-height: 44px;
  max-height: 180px;
  resize: none;
  overflow-y: auto;
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

.mode-selector-wrap,
.project-dropdown-wrap {
  position: relative;
}

.project-popup-menu {
  width: 250px;
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
  width: max-content;
  min-width: 280px;
  max-width: 460px;
  max-height: 280px;
  overflow-y: auto;
  background: #161618;
  border: 1px solid #2d2d30;
  border-radius: 10px;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.55);
  z-index: 1000;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.model-dropdown-list::-webkit-scrollbar {
  width: 6px;
}

.model-dropdown-list::-webkit-scrollbar-thumb {
  background: #2d2d30;
  border-radius: 3px;
}

.model-dropdown-list::-webkit-scrollbar-thumb:hover {
  background: #3f3f45;
}

.model-dropdown-item {
  display: flex;
  align-items: center;
  height: 42px;
  padding: 0 14px;
  border-radius: 6px;
  color: var(--muted);
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.15s ease;
  min-width: 0;
}

.model-name-text {
  display: block;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: normal;
  text-align: left;
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

/* File attachments styling inside the input box */
.composer-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid #2d2d30;
}

.attachment-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #252528;
  border: 1px solid #333;
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 0.78rem;
  color: var(--text);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.15);
}

.attachment-pill .file-icon {
  color: var(--muted);
  flex-shrink: 0;
}

.attachment-name {
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.remove-attachment-btn {
  background: transparent;
  color: var(--faint);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 2px;
  border-radius: 3px;
  transition: all 0.2s ease;
}

.remove-attachment-btn:hover {
  color: var(--danger);
  background: rgba(255, 138, 128, 0.1);
}

/* Attach file button styling */
.attach-file-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  flex-shrink: 0;
}
</style>
