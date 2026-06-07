<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue';
import { useCustomDialog } from '../composables/useCustomDialog';

const { showAlert } = useCustomDialog();
import type { PermissionDecision } from '../api/client';
import type { MessageGroup } from '../lib/messageGroups';
import { MODES_LIST, type ChatMode, type ModelOption } from '../composables/useComposerSettings';
import type { AgentPreset } from '@agent-bridge/shared';
import ConfirmationCard from './ConfirmationCard.vue';
import PermissionCard from './PermissionCard.vue';
import QuestionCard from './QuestionCard.vue';

const props = defineProps<{
  taskInput: string;
  queuedTaskInput: string;
  isRunning: boolean;
  currentMode: ChatMode;
  bypassPermissions: boolean;
  selectedModel: string;
  selectedReasoningEffort: string;
  reasoningEffortOptions: { id: string; label: string }[];
  modelOptions: ModelOption[];
  activeModelDisplayName: string;
  agentPresets?: AgentPreset[];
  selectedPresetId?: string;
  focusSignal: number;
  confirmationGroup: MessageGroup | null;
  showPermission: boolean;
  permissionRequest: any;
  questionRequest: any;
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
  (e: 'update:selectedReasoningEffort', value: string): void;
  (e: 'update:selectedPresetId', value: string): void;
  (e: 'send'): void;
  (e: 'queue'): void;
  (e: 'cancel'): void;
  (e: 'quick-reply', option: string): void;
  (e: 'permission-decision', decision: PermissionDecision): void;
  (e: 'question-answer', payload: { selections: string[][]; notes: string[] }): void;
  (e: 'select-project', path: string): void;
}>();

const textarea = ref<HTMLTextAreaElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const attachedFiles = ref<{ name: string; content: string; extension: string; isImage: boolean }[]>([]);

function estimateTokens(text: string): number {
  if (!text) return 0;
  const cleanText = text.replace(/!\[([^\]]*)\]\(data:image\/[^)]+\)/g, '[Image]');
  const charCount = cleanText.length;
  const wordCount = cleanText.trim().split(/\s+/).length;
  return Math.round(Math.max(charCount / 3.7, wordCount * 1.3));
}

const draftTokens = computed(() => {
  let text = props.taskInput || '';
  let imageTokens = 0;
  for (const file of attachedFiles.value) {
    if (file.isImage) {
      imageTokens += 300;
    } else {
      const syntaxLang = file.extension ? file.extension.toLowerCase() : '';
      text += `\n\n### File: ${file.name}\n\`\`\`${syntaxLang}\n${file.content}\n\`\`\``;
    }
  }
  return estimateTokens(text) + imageTokens;
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

const canSend = computed(() => {
  return !props.isRunning && props.selectedModel && (props.taskInput.trim() || attachedFiles.value.length > 0);
});

const hasQueuedMessage = computed(() => props.queuedTaskInput.trim().length > 0);

const isButtonDisabled = computed(() => {
  if (props.isRunning) return false;
  return !props.selectedModel || (!props.taskInput.trim() && attachedFiles.value.length === 0);
});

function handleButtonClick() {
  if (props.isRunning) {
    emit('cancel');
  } else {
    handleSend();
  }
}

function triggerFileSelect() {
  fileInput.value?.click();
}

async function handleFileChange(event: Event) {
  const target = event.target as HTMLInputElement;
  if (!target.files || target.files.length === 0) return;

  for (const file of Array.from(target.files)) {
    if (file.size > 2 * 1024 * 1024) {
      await showAlert(`File too large (max 2MB): ${file.name}`);
      continue;
    }
    try {
      const extension = file.name.split('.').pop() || '';
      const isImage = file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extension.toLowerCase());
      const content = isImage ? await readFileAsDataURL(file) : await readFileAsText(file);
      attachedFiles.value.push({
        name: file.name,
        content,
        extension,
        isImage
      });
    } catch (err) {
      console.error(`Error reading file ${file.name}:`, err);
      await showAlert(`Failed to read file: ${file.name}`);
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

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function removeAttachment(idx: number) {
  attachedFiles.value.splice(idx, 1);
}

function handleSend() {
  if (props.isRunning) {
    handleQueue();
    return;
  }

  if (!canSend.value) return;

  if (attachedFiles.value.length > 0) {
    let finalTask = props.taskInput;
    for (const file of attachedFiles.value) {
      if (file.isImage) {
        finalTask += `\n\n![${file.name}](${file.content})`;
      } else {
        const syntaxLang = file.extension ? file.extension.toLowerCase() : '';
        finalTask += `\n\n### File: ${file.name}\n\`\`\`${syntaxLang}\n${file.content}\n\`\`\``;
      }
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

function handleQueue() {
  if (!props.taskInput.trim() && attachedFiles.value.length === 0) return;

  if (attachedFiles.value.length > 0) {
    let finalTask = props.taskInput;
    for (const file of attachedFiles.value) {
      if (file.isImage) {
        finalTask += `\n\n![${file.name}](${file.content})`;
      } else {
        const syntaxLang = file.extension ? file.extension.toLowerCase() : '';
        finalTask += `\n\n### File: ${file.name}\n\`\`\`${syntaxLang}\n${file.content}\n\`\`\``;
      }
    }
    emit('update:taskInput', finalTask);
    attachedFiles.value = [];
    nextTick(() => emit('queue'));
  } else {
    emit('queue');
  }
}

const showModeMenu = ref(false);
const showModelMenu = ref(false);
const showReasoningMenu = ref(false);

function getModeLabel(modeId: string): string {
  return MODES_LIST.find(m => m.id === modeId)?.label ?? 'Chat';
}

function selectMode(modeId: ChatMode) {
  emit('update:currentMode', modeId);
  showModeMenu.value = false;
}

function selectModel(value: string) {
  emit('update:selectedModel', value);
  showModelMenu.value = false;
}

const activeReasoningLabel = computed(() =>
  props.reasoningEffortOptions.find(x => x.id === props.selectedReasoningEffort)?.label ?? 'Default'
);
const hasReasoningEffortOptions = computed(() => props.reasoningEffortOptions.length > 1);

function selectReasoningEffort(value: string) {
  emit('update:selectedReasoningEffort', value);
  showReasoningMenu.value = false;
}

// Optional dual-model agent presets (architect + coder). Only shown when at
// least one preset is configured. '' = single model (default).
const showPresetMenu = ref(false);
const hasPresets = computed(() => (props.agentPresets?.length ?? 0) > 0);
const activePresetLabel = computed(() => {
  const p = props.agentPresets?.find(x => x.id === props.selectedPresetId);
  return p ? p.displayName : 'Single model';
});
const selectedPresetIsActive = computed(() =>
  !!props.selectedPresetId && !!props.agentPresets?.some(x => x.id === props.selectedPresetId)
);

function selectPreset(value: string) {
  emit('update:selectedPresetId', value);
  showPresetMenu.value = false;
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
  if (!props.taskInput) {
    el.style.height = '';
    return;
  }
  const lineHeight = 24;
  const maxHeight = 240;
  // Base height from explicit newlines
  el.style.height = 'auto';
  const newlineCount = el.value.split('\n').length;
  const baseHeight = lineHeight * newlineCount;
  // Use scrollHeight if content wraps (long single line) and stays under the cap
  const targetHeight = Math.min(Math.max(baseHeight, el.scrollHeight), maxHeight);
  el.style.height = targetHeight + 'px';
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
  if (!target.closest('.reasoning-dropdown-wrap')) showReasoningMenu.value = false;
  if (!target.closest('.preset-dropdown-wrap')) showPresetMenu.value = false;
  if (!target.closest('.project-dropdown-wrap')) showProjectMenu.value = false;
}

function handleKeyDown(e: KeyboardEvent) {
  if (!showModeMenu.value) return;
  const modeKeys: Record<string, ChatMode> = {
    '1': 'chat',
    '2': 'accept_edits',
    '3': 'plan',
    '4': 'full_access'
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

      <QuestionCard
        :request="questionRequest"
        @submit="emit('question-answer', $event)"
      />

      <!-- Token info bar (placed outside the input box) -->
      <div class="composer-token-info">
        <span class="context-tokens" title="Total context (system prompt + history + draft) sent to model">
          Context: {{ contextTokens + draftTokens }} tokens
        </span>
      </div>

      <div v-if="hasQueuedMessage" class="queued-message-preview">
        <span class="queued-label">Queued</span>
        <span class="queued-text">{{ queuedTaskInput }}</span>
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
          rows="1"
          :value="taskInput"
          :placeholder="isRunning ? 'Queue a follow-up...' : 'Type a message...'"
          @input="emit('update:taskInput', ($event.target as HTMLTextAreaElement).value)"
          @keydown.enter.exact.prevent="handleSend"
        />
        <button
          class="composer-send-btn"
          :class="{ 'stop-mode': isRunning }"
          :disabled="isButtonDisabled"
          :title="isRunning ? 'Cancel generation' : 'Send message'"
          @click="handleButtonClick"
        >
          <svg v-if="isRunning" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="5" y="5" width="14" height="14" rx="1.5" />
          </svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="19" x2="12" y2="5"></line>
            <polyline points="5 12 12 5 19 12"></polyline>
          </svg>
        </button>
      </div>

      <div class="composer-menu-row" style="position: relative; z-index: 2;">
        <div class="composer-menu-left">
          <div class="mode-selector-wrap">
            <button
              class="mode-pill-btn"
              :class="{ 'mode-pill-danger': currentMode === 'full_access' }"
              @click.stop="showModeMenu = !showModeMenu"
            >
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
                  :class="{ active: currentMode === modeItem.id, 'mode-item-danger': modeItem.id === 'full_access' }"
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
          <!-- Optional dual-model agent preset selector (next to the model picker). -->
          <div v-if="hasPresets" class="preset-dropdown-wrap model-dropdown-wrap">
            <button
              class="model-select-display-btn preset-select-btn"
              :class="{ 'preset-active': !!selectedPresetId }"
              @click.stop="showPresetMenu = !showPresetMenu"
            >
              {{ activePresetLabel }}
            </button>
            <div v-if="showPresetMenu" class="model-dropdown-list preset-dropdown-list">
              <div
                class="model-dropdown-item"
                :class="{ active: !selectedPresetId }"
                @click.stop="selectPreset('')"
              >
                <span class="model-name-text">Single model</span>
              </div>
              <div
                v-for="preset in agentPresets"
                :key="preset.id"
                class="model-dropdown-item"
                :class="{ active: selectedPresetId === preset.id }"
                @click.stop="selectPreset(preset.id)"
              >
                <span class="model-name-text">{{ preset.displayName }}</span>
                <span class="preset-sub">{{ preset.architect.model }} → {{ preset.coder.model }}</span>
              </div>
            </div>
          </div>

          <span v-if="hasPresets" class="status-divider">/</span>

          <div class="model-dropdown-wrap">
            <button
              class="model-select-display-btn"
              :disabled="selectedPresetIsActive"
              :title="selectedPresetIsActive ? 'Architect model is set by the selected agent preset' : ''"
              @click.stop="showModelMenu = !showModelMenu"
            >
              {{ selectedPresetIsActive ? 'Architect: preset' : activeModelDisplayName }}
            </button>
            <div v-if="showModelMenu && !selectedPresetIsActive" class="model-dropdown-list">
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

          <span v-if="hasReasoningEffortOptions" class="status-divider">/</span>
          <div v-if="hasReasoningEffortOptions" class="reasoning-dropdown-wrap model-dropdown-wrap">
            <button
              class="model-select-display-btn parameter-pill"
              title="Reasoning effort"
              @click.stop="showReasoningMenu = !showReasoningMenu"
            >
              {{ activeReasoningLabel }}
            </button>
            <div v-if="showReasoningMenu" class="model-dropdown-list reasoning-dropdown-list">
              <div
                v-for="option in reasoningEffortOptions"
                :key="option.id"
                class="model-dropdown-item"
                :class="{ active: selectedReasoningEffort === option.id }"
                @click.stop="selectReasoningEffort(option.id)"
              >
                <span class="model-name-text">{{ option.label }}</span>
              </div>
            </div>
          </div>
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
  width: min(1000px, 100%);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
}

.composer-input-box {
  position: relative;
  background: var(--control-bg);
  border: 1px solid var(--control-border);
  border-radius: 14px;
  padding: 13px 88px 13px 16px;
  box-shadow:
    0 18px 45px var(--composer-input-shadow),
    inset 0 1px 0 var(--composer-input-inset-shadow);
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
}

.composer-input-box:focus-within {
  border-color: var(--control-border-focus);
  box-shadow:
    0 20px 55px var(--composer-input-focus-shadow),
    0 0 0 1px var(--composer-input-focus-border-shadow),
    inset 0 1px 0 var(--composer-input-focus-inset-shadow);
}

.composer-token-info {
  display: flex;
  justify-content: flex-end;
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
  background: var(--composer-token-inactive);
  transition: all 0.2s ease;
}

.token-dot.active.thinking {
  background: var(--warning);
  box-shadow: 0 0 6px var(--warning);
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
  color: var(--composer-token-accent);
  font-weight: 500;
}

.queued-message-preview {
  position: relative;
  z-index: 3;
  display: flex;
  align-items: baseline;
  gap: 10px;
  width: 100%;
  margin-bottom: 8px;
  padding: 9px 12px;
  background: var(--composer-queued-msg-bg);
  border: 1px solid var(--composer-queued-msg-border);
  border-radius: 8px;
  color: var(--muted);
  font-size: 0.86rem;
  font-style: italic;
  box-shadow: 0 8px 22px var(--composer-dropdown-shadow);
}

.queued-label {
  flex: 0 0 auto;
  color: var(--faint);
  font-size: 0.72rem;
  text-transform: uppercase;
}

.queued-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes pulseDot {
  0% { opacity: 0.4; }
  100% { opacity: 1; }
}

.composer-input-box textarea {
  display: block;
  width: 100%;
  height: 24px;
  min-height: 24px;
  max-height: 240px; /* 10 lines * 24px line-height */
  line-height: 24px;
  resize: none;
  overflow-y: auto;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text);
  font-size: 0.96rem;
  padding: 0;
  margin: 0;
}

.composer-send-btn {
  position: absolute;
  bottom: 9px;
  right: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: var(--text);
  color: var(--bg);
  border: none;
  border-radius: 9px;
  cursor: pointer;
  box-shadow: 0 8px 18px var(--composer-shadow);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.composer-send-btn:hover:not(:disabled) {
  background: var(--btn-primary-hover-bg);
  transform: translateY(-1px);
  box-shadow: 0 10px 24px var(--composer-dropdown-shadow);
}

.composer-send-btn:active:not(:disabled) {
  background: var(--btn-primary-active-bg);
  transform: translateY(0);
}

.composer-send-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  background: var(--surface-strong);
  color: var(--faint);
  border: 1px solid var(--border);
}

.composer-send-btn.stop-mode {
  background: var(--danger-soft);
  color: var(--danger);
  border: 1px solid var(--danger-border);
}

.composer-send-btn.stop-mode:hover {
  background: var(--danger-soft-strong);
}

.composer-send-btn.stop-mode:active {
  background: var(--btn-danger-active-bg);
}

.composer-menu-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 11px;
  padding: 6px;
  gap: 10px;
}

.composer-menu-left {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 auto;
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
  min-height: 30px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 5px 10px;
  color: var(--muted);
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
  gap: 8px;
}

.mode-pill-btn:hover {
  border-color: var(--control-border);
  color: var(--text);
  background: var(--nav-action-hover-bg);
}

/* Full Access is a no-confirmation mode — flag it red wherever it surfaces. */
.mode-pill-btn.mode-pill-danger {
  color: var(--danger);
  border-color: var(--danger-border);
  background: var(--danger-soft);
}

.mode-pill-btn.mode-pill-danger:hover {
  color: var(--danger);
  background: var(--danger-soft-strong);
}

.mode-pill-text {
  font-weight: 500;
}

.mode-popup-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  width: 230px;
  background: var(--composer-dropdown-bg);
  border: 1px solid var(--composer-dropdown-border);
  border-radius: 10px;
  box-shadow: 0 12px 30px var(--composer-dropdown-shadow);
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
  border-bottom: 1px solid var(--perm-code-border);
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
  background: var(--attachment-pill-bg);
  color: var(--text);
}

.mode-popup-list li.active {
  color: var(--text);
  background: var(--composer-menu-active-bg);
}

.mode-popup-list li.mode-item-danger .mode-item-name {
  color: var(--danger);
}

.mode-popup-list li.mode-item-danger.active {
  background: var(--danger-soft);
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
  background: var(--composer-menu-shortcut-bg);
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid var(--composer-dropdown-border);
}

.mode-popup-divider {
  height: 1px;
  background: var(--perm-code-border);
  margin: 4px 0;
  padding: 0 !important;
  pointer-events: none;
}

.bypass-toggle-badge {
  font-size: 0.72rem;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--attachment-pill-bg);
  color: var(--muted);
  transition: all 0.2s ease;
  font-weight: 500;
}

.bypass-toggle-badge.enabled {
  background: var(--success-soft);
  color: var(--success);
}

.composer-status-section {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  min-width: 0;
  flex: 0 1 auto;
  color: var(--faint);
  font-size: 0.8rem;
}

.model-dropdown-wrap {
  position: relative;
}

.model-select-display-btn {
  max-width: 220px;
  background: transparent;
  color: var(--muted);
  font-size: 0.8rem;
  cursor: pointer;
  transition: color 0.2s ease, background 0.2s ease, border-color 0.2s ease;
  padding: 5px 8px;
  border-radius: 7px;
  border: 1px solid transparent;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-select-display-btn:hover {
  color: var(--text);
  background: var(--nav-action-hover-bg);
  border-color: var(--control-border);
}

.model-select-display-btn:disabled {
  cursor: default;
  opacity: 0.55;
}

.model-select-display-btn:disabled:hover {
  background: transparent;
  color: var(--muted);
}

/* Dual-model preset selector: emphasize when a preset (not single model) is on. */
.preset-select-btn.preset-active {
  color: var(--text);
  background: var(--composer-preset-active-bg);
  border-color: var(--composer-preset-active-border);
  font-weight: 600;
}

.model-dropdown-item .preset-sub {
  margin-left: auto;
  padding-left: 12px;
  font-size: 0.72rem;
  color: var(--faint);
  white-space: nowrap;
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
  background: var(--composer-dropdown-bg);
  border: 1px solid var(--composer-dropdown-border);
  border-radius: 10px;
  box-shadow: 0 12px 30px var(--composer-dropdown-shadow);
  z-index: 1000;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 3px;
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
  background: var(--attachment-pill-bg);
  color: var(--text);
}

.model-dropdown-item.active {
  color: var(--text);
  background: var(--composer-menu-active-bg);
  font-weight: 600;
}

.status-divider {
  color: var(--composer-indicator-border);
  user-select: none;
}

.parameter-pill {
  color: var(--muted);
  padding: 5px 7px;
  border-radius: 7px;
  background: var(--composer-parameter-bg);
  border: 1px solid transparent;
}

.reasoning-dropdown-list {
  min-width: 140px;
}

.status-indicator-ring {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1.5px solid var(--composer-indicator-border);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.3s ease;
}

.status-indicator-ring.active {
  border-color: var(--success);
}

.ring-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--composer-indicator-dot);
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
  border-bottom: 1px solid var(--composer-dropdown-border);
}

.attachment-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--attachment-pill-bg);
  border: 1px solid var(--attachment-pill-border);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 0.78rem;
  color: var(--text);
  box-shadow: 0 2px 5px var(--attachment-shadow);
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
  background: var(--danger-soft);
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
