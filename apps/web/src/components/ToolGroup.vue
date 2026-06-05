<script setup lang="ts">
import { ref, computed } from 'vue';
import type { RunMessage } from '@bridgemind/shared';
import { formatJson } from '../lib/format';
import { isToolSuccess, getToolStatusClass, formatToolArgs } from '../lib/messageGroups';
import { cleanMessageContent } from '../lib/markdown';

const props = defineProps<{
  thought?: string;
  toolCalls: any[];
  toolResponses: RunMessage[];
}>();

const expanded = ref(true); // default to expanded so reasoning is visible immediately

const detailsExpanded = ref<Record<number, boolean>>({});

function toggleDetails(index: number) {
  detailsExpanded.value[index] = !detailsExpanded.value[index];
}

const cleanedThought = computed(() => {
  if (!props.thought) return '';
  // Clean off plan tags if any
  return cleanMessageContent(props.thought);
});

function getToolPath(argumentsJson: string): string {
  if (!argumentsJson) return '';
  try {
    const parsed = JSON.parse(argumentsJson);
    return parsed.path || '';
  } catch (e) {
    return '';
  }
}

function getToolLabel(name: string, args: string): string {
  const path = getToolPath(args);
  switch (name) {
    case 'read_file':
      return `File read: ${path}`;
    case 'write_file':
      return `File written/updated: ${path}`;
    case 'delete_file':
      return `File deleted: ${path}`;
    case 'list_directory':
      return `Directory listed: ${path || 'root'}`;
    default:
      return `Tool ${name} executed`;
  }
}

function getToolStatusLabel(response?: RunMessage): string {
  if (!response) return 'Running...';
  return isToolSuccess(response.content) ? 'Success' : 'Error';
}
</script>

<template>
  <article class="tool-group-block">
    <header class="tool-group-header" @click="expanded = !expanded">
      <div class="tool-group-summary-left">
        <!-- Atom/Network/Brain style icon -->
        <svg class="brain-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"></circle>
          <circle cx="12" cy="5" r="1"></circle>
          <circle cx="12" cy="19" r="1"></circle>
          <circle cx="5" cy="12" r="1"></circle>
          <circle cx="19" cy="12" r="1"></circle>
          <path d="M12 8v3M12 13v3M8 12h3M13 12h3"></path>
        </svg>
        <span class="tool-group-title">Reasoning</span>
      </div>
      <div class="tool-group-summary-right">
        <!-- Chevron arrow -->
        <svg class="chevron-icon" :class="{ rotated: expanded }" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m6 9 6 6 6-6"></path>
        </svg>
      </div>
    </header>

    <div v-if="expanded" class="timeline-container">
      <div class="timeline-line"></div>

      <!-- Thought Step -->
      <div v-if="cleanedThought" class="timeline-step">
        <div class="step-icon-wrap">
          <div class="step-dot"></div>
        </div>
        <div class="step-content">
          <div class="step-text">{{ cleanedThought }}</div>
        </div>
      </div>

      <!-- Tool Call Steps -->
      <div v-for="(tc, idx) in toolCalls" :key="idx" class="timeline-step">
        <div class="step-icon-wrap">
          <!-- Render specific icon based on tool type -->
          <svg v-if="tc.function?.name === 'read_file'" class="step-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path>
            <path d="M14 2v4a2 2 0 0 0 2 2h4"></path>
          </svg>
          <svg v-else-if="tc.function?.name === 'write_file'" class="step-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20h9"></path>
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
          </svg>
          <svg v-else-if="tc.function?.name === 'delete_file'" class="step-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18"></path>
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
          </svg>
          <svg v-else-if="tc.function?.name === 'list_directory'" class="step-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"></path>
          </svg>
          <svg v-else class="step-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
        </div>
        <div class="step-content">
          <div class="step-title-row">
            <span class="step-label-text">{{ getToolLabel(tc.function?.name, tc.function?.arguments) }}</span>
            <span class="step-badge" :class="getToolStatusClass(toolResponses[idx])">
              {{ getToolStatusLabel(toolResponses[idx]) }}
            </span>
          </div>

          <button class="step-details-toggle" @click="toggleDetails(idx)">
            <span>{{ detailsExpanded[idx] ? 'Hide Details' : 'Show Details' }}</span>
            <svg class="toggle-arrow" :class="{ rotated: detailsExpanded[idx] }" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="m6 9 6 6 6-6"></path>
            </svg>
          </button>

          <div v-if="detailsExpanded[idx]" class="step-details-box">
            <div class="detail-section">
              <div class="detail-label">Parameters:</div>
              <pre class="faint-code">{{ formatToolArgs(tc.function?.arguments) }}</pre>
            </div>
            <div class="detail-section response-section">
              <div class="detail-label">Result:</div>
              <pre v-if="toolResponses[idx]" class="faint-code">{{ formatJson(toolResponses[idx].content) }}</pre>
              <div v-else class="tool-running-shimmer">
                <div class="shimmer-bar"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped>
.tool-group-block {
  margin: 14px 0;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 0.9rem;
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
  transition: background 0.2s ease;
}

.tool-group-header:hover {
  background: rgba(255, 255, 255, 0.04);
}

.tool-group-summary-left {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text);
}

.brain-icon {
  animation: float 3s infinite ease-in-out;
  color: var(--planner);
}

@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-2px); }
}

.tool-group-title {
  font-weight: 600;
  font-size: 0.88rem;
}

.chevron-icon {
  color: var(--muted);
  transition: transform 0.2s ease;
}

.chevron-icon.rotated {
  transform: rotate(180deg);
}

/* Timeline CSS */
.timeline-container {
  position: relative;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  background: rgba(0, 0, 0, 0.12);
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  max-height: 240px;
  overflow-y: auto;
}

.timeline-line {
  position: absolute;
  top: 24px;
  bottom: 24px;
  left: 27px;
  width: 1px;
  background: rgba(255, 255, 255, 0.1);
  pointer-events: none;
}

.timeline-step {
  display: flex;
  gap: 14px;
  position: relative;
  min-width: 0;
}

.step-icon-wrap {
  width: 16px;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 3px;
  z-index: 1;
  background: transparent;
}

.step-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--planner);
  box-shadow: 0 0 8px rgba(207, 162, 147, 0.6);
  margin-top: 5px;
}

.step-icon {
  color: var(--muted);
  flex-shrink: 0;
}

.step-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.step-text {
  font-size: 0.92rem;
  line-height: 1.6;
  color: var(--text);
}

.step-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--text);
}

.step-label-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.step-badge {
  font-size: 0.7rem;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 600;
  text-transform: uppercase;
}

.step-badge.success {
  background: rgba(123, 216, 143, 0.1);
  color: var(--success);
}

.step-badge.failed {
  background: rgba(255, 138, 128, 0.1);
  color: var(--danger);
}

.step-badge.pending {
  background: rgba(255, 209, 138, 0.1);
  color: var(--warning);
  animation: shimmerPulse 1.5s infinite ease-in-out;
}

@keyframes shimmerPulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}

.step-details-toggle {
  background: transparent;
  color: var(--faint);
  border: none;
  font-size: 0.72rem;
  cursor: pointer;
  padding: 0;
  text-align: left;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  width: fit-content;
}

.step-details-toggle:hover {
  color: var(--muted);
}

.toggle-arrow {
  transition: transform 0.2s ease;
}

.toggle-arrow.rotated {
  transform: rotate(180deg);
}

.step-details-box {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  padding: 10px;
  margin-top: 4px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.detail-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.response-section {
  border-top: 1px dashed rgba(255, 255, 255, 0.05);
  padding-top: 8px;
}

.detail-label {
  font-size: 0.75rem;
  color: var(--muted);
  font-weight: 500;
}

.faint-code {
  font-family: monospace;
  font-size: 0.75rem;
  color: var(--muted);
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
  background: rgba(0, 0, 0, 0.3);
  padding: 6px 10px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.02);
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
</style>
