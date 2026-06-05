<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import type { Run } from '@bridgemind/shared';
import type { MessageGroup } from '../lib/messageGroups';
import { renderMarkdown, cleanMessageContent } from '../lib/markdown';
import { formatTime } from '../lib/format';
import ToolGroup from './ToolGroup.vue';

const props = defineProps<{
  activeRun: Run | null;
  groupedMessages: MessageGroup[];
  isRunning: boolean;
}>();

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
</script>

<template>
  <div v-if="!activeRun" class="empty-chat"></div>

  <div v-else class="messages-inner">
    <article class="user-bubble">
      <pre>{{ activeRun.task }}</pre>
    </article>

    <template v-for="group in groupedMessages" :key="group.id">
      <article v-if="group.type === 'user'" class="user-bubble">
        <pre>{{ group.message.content }}</pre>
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

        <!-- AI Plan Accordion -->
        <div v-if="extractPlan(group.message.content)" class="plan-terminal-container">
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
  </div>
</template>

<style scoped>
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
</style>
