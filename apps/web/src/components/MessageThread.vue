<script setup lang="ts">
import { ref, watch, onUnmounted, nextTick } from 'vue';
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

function copyText(value: string) {
  navigator.clipboard.writeText(value);
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
          <header class="terminal-header" @click="togglePlan(group.message.id)">
            <div class="terminal-header-left">
              <span class="terminal-dot red"></span>
              <span class="terminal-dot yellow"></span>
              <span class="terminal-dot green"></span>
              <span class="terminal-title">AI Plan / Reasoning</span>
            </div>
            <button class="terminal-toggle-btn">
              {{ isPlanExpanded(group.message.id) ? 'Collapse' : 'Expand' }}
            </button>
          </header>
          <div v-if="isPlanExpanded(group.message.id)" class="terminal-body plan-body">
            <pre class="plan-text">{{ extractPlan(group.message.content) }}</pre>
          </div>
        </div>

        <!-- AI Reasoning (Inner Monologue) Accordion -->
        <div v-if="group.message.reasoningContent" class="plan-terminal-container reasoning-terminal-container">
          <header class="terminal-header" @click="togglePlan(group.message.id)">
            <div class="terminal-header-left">
              <span class="terminal-dot red"></span>
              <span class="terminal-dot yellow"></span>
              <span class="terminal-dot green"></span>
              <span class="terminal-title">Düşünme Süreci (Reasoning)</span>
            </div>
            <button class="terminal-toggle-btn">
              {{ isPlanExpanded(group.message.id) ? 'Collapse' : 'Expand' }}
            </button>
          </header>
          <div v-if="isPlanExpanded(group.message.id)" class="terminal-body plan-body">
            <pre class="plan-text">{{ group.message.reasoningContent }}</pre>
          </div>
        </div>

        <div class="markdown-body" v-html="renderMarkdown(cleanMessageContent(group.message.content))"></div>
        <button class="copy-button" @click="copyText(group.message.content)">Copy entire response</button>
      </article>
    </template>

    <div v-if="activeRun.status === 'failed'" class="system-line danger">
      {{ activeRun.errorMessage || 'Chat generation failed.' }}
    </div>

    <!-- Subtle loader before message starts streaming -->
    <div v-if="isRunning && !hasActiveMessage" class="system-line active pulsing-loader">
      AI Düşünüyor...
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
}

@keyframes pulseOpacity {
  0% { opacity: 0.6; }
  100% { opacity: 1; }
}

/* Terminal Container Styling */
.plan-terminal-container,
.thinking-terminal-container {
  margin: 12px 0 18px;
  background: #0f0f11;
  border: 1px solid #2d2d34;
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
  background: #18181c;
  padding: 8px 14px;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid #212126;
}

.terminal-header-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.terminal-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}

.terminal-dot.red { background-color: #ff5f56; }
.terminal-dot.yellow { background-color: #ffbd2e; }
.terminal-dot.green { background-color: #27c93f; }

.terminal-title {
  color: #a6a6a0;
  font-size: 0.8rem;
  font-weight: 500;
  margin-left: 6px;
}

.terminal-toggle-btn {
  background: transparent;
  color: #74746f;
  border: 1px solid #2d2d34;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 0.72rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.terminal-toggle-btn:hover {
  color: #e8e8e3;
  background: rgba(255, 255, 255, 0.04);
  border-color: #3f3f4a;
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
  max-height: 350px;
}

.plan-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: #a6a6a0;
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
  border-color: rgba(138, 180, 248, 0.25);
}

.reasoning-terminal-container:hover {
  border-color: rgba(138, 180, 248, 0.45);
}
</style>
