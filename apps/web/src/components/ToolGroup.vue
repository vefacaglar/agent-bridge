<script setup lang="ts">
import { ref } from 'vue';
import type { RunMessage } from '@bridgemind/shared';
import { formatJson } from '../lib/format';
import { isToolSuccess, getToolStatusClass, formatToolArgs } from '../lib/messageGroups';

defineProps<{
  toolCalls: any[];
  toolResponses: RunMessage[];
}>();

const expanded = ref(false);
</script>

<template>
  <article class="tool-group-block">
    <header class="tool-group-header" @click="expanded = !expanded">
      <div class="tool-group-summary-left">
        <span class="tool-group-title">Workspace Tools</span>
        <span class="tool-group-count">{{ toolCalls.length }} calls</span>
      </div>
      <div class="tool-group-summary-right">
        <span
          v-for="(tc, idx) in toolCalls"
          :key="idx"
          class="tool-status-badge"
          :class="getToolStatusClass(toolResponses[idx])"
        >
          {{ tc.function?.name || 'unknown' }}
        </span>
      </div>
      <span class="tool-group-toggle-arrow">{{ expanded ? '▼' : '▶' }}</span>
    </header>

    <div v-if="expanded" class="tool-group-details-list">
      <div v-for="(tc, idx) in toolCalls" :key="idx" class="tool-call-response-pair">
        <div class="tool-call-sub-block">
          <div class="sub-block-title">
            <span class="label-badge call">CALL</span>
            <code class="tool-code-name">{{ tc.function?.name }}</code>
          </div>
          <pre class="faint-code">{{ formatToolArgs(tc.function?.arguments) }}</pre>
        </div>

        <div class="tool-response-sub-block">
          <div class="sub-block-title">
            <span class="label-badge response" :class="getToolStatusClass(toolResponses[idx])">RESPONSE</span>
            <span v-if="toolResponses[idx]" class="status-text">
              {{ isToolSuccess(toolResponses[idx].content) ? 'Success' : 'Failed' }}
            </span>
            <span v-else class="status-text pending">Running...</span>
          </div>
          <pre v-if="toolResponses[idx]" class="faint-code">{{ formatJson(toolResponses[idx].content) }}</pre>
          <div v-else class="tool-running-shimmer">
            <div class="shimmer-bar"></div>
          </div>
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped>
.tool-group-block {
  margin: 10px 0;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 0.85rem;
  width: 100%;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.tool-group-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
  background: rgba(255, 255, 255, 0.01);
  transition: background 0.2s ease, border-color 0.2s ease;
}

.tool-group-header:hover {
  background: rgba(255, 255, 255, 0.04);
}

.tool-group-summary-left {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-color, #e0e0e0);
}

.tool-group-title {
  font-weight: 500;
  font-size: 0.85rem;
}

.tool-group-count {
  font-size: 0.75rem;
  color: var(--muted);
  background: rgba(255, 255, 255, 0.06);
  padding: 2px 6px;
  border-radius: 12px;
}

.tool-group-summary-right {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  margin-right: 12px;
}

.tool-status-badge {
  font-size: 0.7rem;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: monospace;
  font-weight: 500;
  border: 1px solid transparent;
}

.tool-status-badge.success {
  background: rgba(76, 175, 80, 0.1);
  color: #81c784;
  border-color: rgba(76, 175, 80, 0.2);
}

.tool-status-badge.failed {
  background: rgba(244, 67, 54, 0.1);
  color: #e57373;
  border-color: rgba(244, 67, 54, 0.2);
}

.tool-status-badge.pending {
  background: rgba(255, 152, 0, 0.1);
  color: #ffb74d;
  border-color: rgba(255, 152, 0, 0.2);
  animation: toolPulse 1.5s infinite ease-in-out;
}

.tool-group-toggle-arrow {
  font-size: 0.7rem;
  color: var(--muted);
}

.tool-group-details-list {
  padding: 12px;
  background: #121212;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tool-call-response-pair {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: rgba(255, 255, 255, 0.01);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: 6px;
  padding: 10px;
}

.tool-call-sub-block,
.tool-response-sub-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tool-response-sub-block {
  border-top: 1px dashed rgba(255, 255, 255, 0.05);
  padding-top: 8px;
}

.sub-block-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--muted);
}

.label-badge {
  font-size: 0.65rem;
  font-weight: 600;
  padding: 1px 4px;
  border-radius: 3px;
  color: #ffffff;
}

.label-badge.call {
  background: #2196f3;
}

.label-badge.response {
  background: #9e9e9e;
}

.label-badge.response.success {
  background: #4caf50;
}

.label-badge.response.failed {
  background: #f44336;
}

.label-badge.response.pending {
  background: #ff9800;
}

.tool-code-name {
  font-family: monospace;
  font-size: 0.8rem;
  color: #ffcb6b;
}

.status-text {
  font-size: 0.75rem;
  font-weight: 500;
}

.status-text.pending {
  color: #ffb74d;
  animation: toolPulse 1.5s infinite ease-in-out;
}

.tool-running-shimmer {
  height: 24px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 4px;
  overflow: hidden;
  position: relative;
}

.tool-running-shimmer::after {
  content: '';
  display: block;
  width: 100%;
  height: 100%;
  transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.05), transparent);
  animation: toolShimmer 1.5s infinite;
}

@keyframes toolShimmer {
  100% {
    transform: translateX(100%);
  }
}

@keyframes toolPulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}

.faint-code {
  font-family: monospace;
  font-size: 0.75rem;
  color: var(--muted);
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
}
</style>
