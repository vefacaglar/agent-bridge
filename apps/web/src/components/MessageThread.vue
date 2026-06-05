<script setup lang="ts">
import { ref, watch, nextTick, onUnmounted } from 'vue';
import type { Run, Plan } from '@agent-bridge/shared';
import type { MessageGroup } from '../lib/messageGroups';
import { renderMarkdown, cleanMessageContent } from '../lib/markdown';
import { formatTime } from '../lib/format';
import ToolGroup from './ToolGroup.vue';

const props = defineProps<{
  activeRun: Run | null;
  groupedMessages: MessageGroup[];
  isRunning: boolean;
  plan?: Plan | null;
  planPanelOpen?: boolean;
  canOpenPlan?: boolean;
}>();

const emit = defineEmits<{
  (e: 'open-plan'): void;
}>();

// Progress summary shown on the in-thread plan link.
const planDoneCount = computed(() => props.plan?.tasks.filter(t => t.status === 'completed').length ?? 0);

const copiedMessageId = ref<string | null>(null);

function copyTextWithStatus(value: string, messageId: string) {
  navigator.clipboard.writeText(value);
  copiedMessageId.value = messageId;
  setTimeout(() => {
    if (copiedMessageId.value === messageId) {
      copiedMessageId.value = null;
    }
  }, 2000);
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  const charCount = text.length;
  const wordCount = text.trim().split(/\s+/).length;
  return Math.round(Math.max(charCount / 3.7, wordCount * 1.3));
}

function getMessageTokens(msg: any): number {
  if (!msg) return 0;
  return estimateTokens((msg.content || '') + (msg.reasoningContent || ''));
}

// Plan Accordion State
const expandedPlans = ref<Record<string, boolean>>({});

function togglePlan(messageId: string) {
  expandedPlans.value[messageId] = !expandedPlans.value[messageId];
}

function isPlanExpanded(messageId: string): boolean {
  if (expandedPlans.value[messageId] === undefined) {
    expandedPlans.value[messageId] = true;
  }
  return expandedPlans.value[messageId];
}

function extractPlan(content: string): string | null {
  const match = content.match(/<plan>([\s\S]*?)<\/plan>/);
  return match ? match[1].trim() : null;
}

import { computed } from 'vue';

const hasActiveMessage = computed(() => {
  if (props.groupedMessages.length === 0) return false;
  const last = props.groupedMessages[props.groupedMessages.length - 1];
  return last && (last.type === 'assistant' || last.type === 'tool_group');
});

const hasSystemErrorInHistory = computed(() => {
  return props.groupedMessages.some(g => g.type === 'system');
});

watch(() => props.groupedMessages, () => {
  if (!props.isRunning) return;
  nextTick(() => {
    const activeReasoningBody = document.querySelector('.assistant-message:last-of-type .reasoning-terminal-container .plan-body');
    if (activeReasoningBody) {
      activeReasoningBody.scrollTop = activeReasoningBody.scrollHeight;
    }
  });
}, { deep: true });

// Lightbox state
const activeLightboxImage = ref<string | null>(null);

function handleImageClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (target && target.tagName === 'IMG' && target.closest('.user-markdown-body')) {
    activeLightboxImage.value = (target as HTMLImageElement).src;
  }
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    activeLightboxImage.value = null;
  }
}

watch(activeLightboxImage, (newVal) => {
  if (newVal) {
    window.addEventListener('keydown', handleKeyDown);
  } else {
    window.removeEventListener('keydown', handleKeyDown);
  }
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
});
</script>

<template>
  <div v-if="!activeRun" class="empty-chat"></div>

  <div v-else class="messages-inner" @click="handleImageClick">
    <article class="user-bubble">
      <div class="user-markdown-body" v-html="renderMarkdown(activeRun.task)"></div>
    </article>

    <!-- In-thread link to the plan; opens the side panel when collapsed. -->
    <button
      v-if="plan && canOpenPlan && !planPanelOpen"
      type="button"
      class="plan-thread-link"
      @click="emit('open-plan')"
    >
      <span class="plan-thread-link-label">Plan: {{ plan.title }}</span>
      <span v-if="plan.tasks.length" class="plan-thread-link-count">{{ planDoneCount }} / {{ plan.tasks.length }}</span>
      <span class="plan-thread-link-action">Open</span>
    </button>

    <template v-for="group in groupedMessages" :key="group.id">
      <article v-if="group.type === 'user'" class="user-bubble">
        <div class="user-markdown-body" v-html="renderMarkdown(group.message.content)"></div>
      </article>

      <ToolGroup
        v-else-if="group.type === 'tool_group'"
        :thought="group.message.content"
        :tool-calls="group.toolCalls"
        :tool-responses="group.toolResponses"
      />

      <article v-else-if="group.type === 'assistant'" class="assistant-message">
        <div class="assistant-meta">
          <span class="agent-badge">AI Assistant</span>
          <span>{{ group.message.providerDisplayName }} / {{ group.message.model }}</span>
          <span>{{ formatTime(group.message.createdAt) }}</span>
        </div>

        <!-- AI Plan Accordion (hidden while the side plan panel is showing it) -->
        <div v-if="extractPlan(group.message.content) && !props.planPanelOpen" class="plan-terminal-container">
          <header class="terminal-header" @click="togglePlan(group.message.id + '-plan')">
            <div class="terminal-header-left">
              <svg class="header-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <circle cx="12" cy="5" r="1"></circle>
                <circle cx="12" cy="19" r="1"></circle>
                <circle cx="5" cy="12" r="1"></circle>
                <circle cx="19" cy="12" r="1"></circle>
                <path d="M12 8v3M12 13v3M8 12h3M13 12h3"></path>
              </svg>
              <span class="terminal-title">AI Plan / Reasoning</span>
            </div>
            <button class="terminal-toggle-btn">
              {{ isPlanExpanded(group.message.id + '-plan') ? 'Collapse' : 'Expand' }}
            </button>
          </header>
          <div v-if="isPlanExpanded(group.message.id + '-plan')" class="terminal-body plan-body">
            <pre class="plan-text">{{ extractPlan(group.message.content) }}</pre>
          </div>
        </div>

        <!-- AI Reasoning (Inner Monologue) Accordion -->
        <div v-if="group.message.reasoningContent" class="plan-terminal-container reasoning-terminal-container">
          <header class="terminal-header" @click="togglePlan(group.message.id + '-reasoning')">
            <div class="terminal-header-left">
              <svg class="header-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <circle cx="12" cy="5" r="1"></circle>
                <circle cx="12" cy="19" r="1"></circle>
                <circle cx="5" cy="12" r="1"></circle>
                <circle cx="19" cy="12" r="1"></circle>
                <path d="M12 8v3M12 13v3M8 12h3M13 12h3"></path>
              </svg>
              <span class="terminal-title">Reasoning</span>
            </div>
            <button class="terminal-toggle-btn">
              {{ isPlanExpanded(group.message.id + '-reasoning') ? 'Collapse' : 'Expand' }}
            </button>
          </header>
          <div v-if="isPlanExpanded(group.message.id + '-reasoning')" class="terminal-body plan-body">
            <pre class="plan-text">{{ group.message.reasoningContent }}</pre>
          </div>
        </div>

        <div class="markdown-body" v-html="renderMarkdown(cleanMessageContent(group.message.content))"></div>
        <div class="assistant-response-footer" style="display: flex; align-items: center; gap: 8px; margin-top: 10px;">
          <button 
            class="copy-button-icon" 
            title="Copy entire response"
            @click="copyTextWithStatus(group.message.content, group.message.id)"
          >
            <svg v-if="copiedMessageId === group.message.id" class="check-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7bd88f" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 6 9 17l-5-5"/>
            </svg>
            <svg v-else class="copy-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
            </svg>
          </button>
          <span class="response-tokens-badge" style="font-size: 0.72rem; color: var(--faint); font-family: monospace; user-select: none;">
            {{ getMessageTokens(group.message) }} tokens
          </span>
        </div>
      </article>

      <article v-else-if="group.type === 'system'" class="assistant-message system-error-message">
        <div class="assistant-meta">
          <span class="agent-badge danger-badge">System Error</span>
          <span>{{ formatTime(group.message.createdAt) }}</span>
        </div>
        <div class="error-bubble">
          <div class="error-icon-wrap">
            <svg class="error-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="m15 9-6 6" />
              <path d="m9 9 6 6" />
            </svg>
          </div>
          <div class="error-text">
            {{ group.message.content }}
          </div>
        </div>
      </article>
    </template>

    <article v-if="activeRun.status === 'failed' && !hasSystemErrorInHistory" class="assistant-message system-error-message">
      <div class="assistant-meta">
        <span class="agent-badge danger-badge">System Error</span>
        <span>{{ formatTime(activeRun.updatedAt) }}</span>
      </div>
      <div class="error-bubble">
        <div class="error-icon-wrap">
          <svg class="error-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <path d="m15 9-6 6" />
            <path d="m9 9 6 6" />
          </svg>
        </div>
        <div class="error-text">
          {{ activeRun.errorMessage || 'Chat generation failed.' }}
        </div>
      </div>
    </article>

    <!-- Subtle loader before message starts streaming -->
    <div v-if="isRunning && !hasActiveMessage" class="system-line active pulsing-loader">
      Thinking...
    </div>

    <!-- Lightbox Modal -->
    <Transition name="fade">
      <div v-if="activeLightboxImage" class="lightbox-overlay" @click="activeLightboxImage = null">
        <div class="lightbox-content" @click.stop>
          <img :src="activeLightboxImage" class="lightbox-img" alt="Enlarged screenshot" />
          <button class="lightbox-close-btn" @click="activeLightboxImage = null">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.plan-thread-link {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-strong);
  color: var(--text);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.plan-thread-link:hover {
  border-color: var(--muted);
}

.plan-thread-link-label {
  flex: 1 1 auto;
  font-size: 0.86rem;
  font-weight: 550;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plan-thread-link-count {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
  font-family: monospace;
  font-size: 0.72rem;
  color: var(--faint);
}

.plan-thread-link-action {
  flex: 0 0 auto;
  font-size: 0.74rem;
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px 8px;
}

.welcome-gradient-logo {
  width: 68px;
  height: 68px;
  border-radius: 20px;
  margin: 0 auto 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 850;
  font-size: 1.6rem;
  background: linear-gradient(135deg, var(--success), var(--planner));
  color: var(--bg);
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
  animation: logoPulse 4s infinite alternate;
}

@keyframes logoPulse {
  0% { transform: scale(1); filter: brightness(1); }
  100% { transform: scale(1.05); filter: brightness(1.1); }
}

.pulsing-loader {
  animation: pulseOpacity 1.5s infinite alternate;
  align-self: flex-start;
}

@keyframes pulseOpacity {
  0% { opacity: 0.6; }
  100% { opacity: 1; }
}

/* Terminal Container Styling */
.plan-terminal-container,
.thinking-terminal-container {
  margin: 12px 0 18px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  font-family: 'Fira Code', 'Courier New', monospace;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.25);
  transition: border-color 0.2s ease;
}

.plan-terminal-container:hover,
.thinking-terminal-container:hover {
  border-color: #3f3f4a;
}

.terminal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--surface);
  padding: 8px 14px;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid var(--border);
}

.terminal-header-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.header-icon {
  color: var(--planner);
  flex-shrink: 0;
}

.terminal-title {
  color: #a6a6a0;
  font-size: 0.8rem;
  font-weight: 500;
}

.terminal-toggle-btn {
  background: transparent;
  color: var(--faint);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 0.72rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.terminal-toggle-btn:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.04);
  border-color: var(--border);
}

.terminal-body {
  padding: 12px;
  max-height: 220px;
  overflow-y: auto;
  font-size: 0.78rem;
  line-height: 1.5;
  display: flex;
  flex-direction: column;
  gap: 4px;
  scroll-behavior: smooth;
}

.plan-body {
  max-height: 200px;
}

.plan-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--muted);
  font-family: inherit;
  font-size: inherit;
}

.terminal-log-line {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.log-timestamp {
  color: #55555d;
  flex-shrink: 0;
  user-select: none;
}

.log-prompt {
  color: #7bd88f;
  flex-shrink: 0;
  user-select: none;
}

.log-text {
  word-break: break-all;
}

.log-text.info {
  color: #deded8;
}

.log-text.success {
  color: #7bd88f;
}

.log-text.warning {
  color: #ffd18a;
}

.log-text.danger {
  color: #ff8a80;
}

.terminal-cursor-line {
  display: flex;
  align-items: center;
  gap: 8px;
}

.terminal-cursor {
  color: #7bd88f;
  animation: blink 1s infinite step-end;
}

@keyframes blink {
  from, to { opacity: 1; }
  50% { opacity: 0; }
}

.reasoning-terminal-container {
  border-color: rgba(207, 162, 147, 0.25);
}

.reasoning-terminal-container:hover {
  border-color: rgba(207, 162, 147, 0.45);
}

.copy-button-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  padding: 4px;
  cursor: pointer;
  color: var(--faint);
  border-radius: 4px;
  transition: all 0.2s ease;
}

.copy-button-icon:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.05);
}

.user-markdown-body :deep(p) {
  margin: 0;
}
.user-markdown-body :deep(p + p) {
  margin-top: 8px;
}
.user-markdown-body :deep(img) {
  width: 80px;
  height: 80px;
  object-fit: cover;
  border-radius: 8px;
  margin-top: 8px;
  display: block;
  border: 1px solid var(--border);
  cursor: zoom-in;
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.2s ease, box-shadow 0.2s ease;
}

.user-markdown-body :deep(img):hover {
  transform: scale(1.05);
  border-color: var(--planner);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

/* Lightbox Modal */
.lightbox-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(10, 10, 12, 0.85);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  cursor: zoom-out;
}

.lightbox-content {
  position: relative;
  max-width: 90%;
  max-height: 90%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.lightbox-img {
  max-width: 100%;
  max-height: 90vh;
  object-fit: contain;
  border-radius: 12px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.1);
  cursor: default;
  user-select: none;
}

.lightbox-close-btn {
  position: absolute;
  top: -40px;
  right: -40px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: var(--text);
  border-radius: 50%;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.lightbox-close-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  transform: scale(1.1);
}

/* Close button responsiveness for small screens */
@media (max-width: 768px) {
  .lightbox-close-btn {
    top: 10px;
    right: 10px;
    background: rgba(0, 0, 0, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.3);
  }
}

/* Transition Animations */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.fade-enter-active .lightbox-img {
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.fade-leave-active .lightbox-img {
  transition: transform 0.2s ease;
}

.fade-enter-from .lightbox-img {
  transform: scale(0.92);
}
.fade-leave-to .lightbox-img {
  transform: scale(0.95);
}
</style>
