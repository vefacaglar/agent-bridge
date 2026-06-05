<script setup lang="ts">
import { ref, computed } from 'vue';
import type { RunMessage } from '@agent-bridge/shared';
import { isToolSuccess } from '../lib/messageGroups';
import { cleanMessageContent, renderMarkdown } from '../lib/markdown';

const props = defineProps<{
  thought?: string;
  toolCalls: any[];
  toolResponses: RunMessage[];
}>();

const emit = defineEmits<{
  (e: 'open-plan'): void;
}>();

const detailsExpanded = ref<Record<number, boolean>>({});

/** Title of an update_plan call, for the clickable plan card. */
function getPlanTitle(argumentsJson: string): string {
  const parsed = parseArgs(argumentsJson);
  return typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : 'Plan';
}

/** Number of steps in an update_plan call's tasks array. */
function getPlanTaskCount(argumentsJson: string): number {
  const parsed = parseArgs(argumentsJson);
  return Array.isArray(parsed.tasks) ? parsed.tasks.length : 0;
}

/** A short plain-text summary for the plan card: first real line of the body,
 *  falling back to the first few step titles. */
function getPlanSummary(argumentsJson: string): string {
  const parsed = parseArgs(argumentsJson);
  const clip = (s: string) => (s.length > 150 ? s.slice(0, 150).trim() + '…' : s);

  const body = typeof parsed.body === 'string' ? parsed.body : '';
  for (const raw of body.split('\n')) {
    let line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('```') || line.startsWith('|') || line.startsWith('---')) continue;
    line = line
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links/images -> text
      .replace(/[*_`>#]/g, '')                    // emphasis/markers
      .trim();
    if (line) return clip(line);
  }

  if (Array.isArray(parsed.tasks) && parsed.tasks.length) {
    const joined = parsed.tasks
      .slice(0, 3)
      .map((t: any) => (typeof t?.text === 'string' ? t.text : ''))
      .filter(Boolean)
      .join(' · ');
    if (joined) return clip(joined);
  }
  return '';
}

function toggleDetails(index: number) {
  detailsExpanded.value[index] = !detailsExpanded.value[index];
}

const cleanedThought = computed(() => {
  if (!props.thought) return '';
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

function parseArgs(argumentsJson: string): Record<string, any> {
  if (!argumentsJson) return {};
  try {
    return JSON.parse(argumentsJson) || {};
  } catch (e) {
    return {};
  }
}

function getToolLabel(name: string, args: string): string {
  const path = getToolPath(args);
  const parsed = parseArgs(args);
  switch (name) {
    case 'read_file':
      return `File read: ${path}`;
    case 'write_file':
      return `File written/updated: ${path}`;
    case 'edit_file':
      return `File edited: ${path}`;
    case 'delete_file':
      return `File deleted: ${path}`;
    case 'list_directory':
      return `Directory listed: ${path || 'root'}`;
    case 'create_directory':
      return `Folder created: ${path}`;
    case 'move_file':
      return `Moved: ${parsed.source_path ?? ''} → ${parsed.destination_path ?? ''}`;
    case 'search_files':
      return `Searched: ${parsed.query ?? ''}`;
    case 'run_command':
      return `Command: ${parsed.command ?? ''}`;
    default:
      return `Tool ${name} executed`;
  }
}

function truncateText(str: string, maxLen: number = 1000): string {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '\n... [truncated]';
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatToolParams(name: string, argumentsJson: string): string {
  if (!argumentsJson) return '';
  try {
    const args = JSON.parse(argumentsJson);
    switch (name) {
      case 'run_command':
        return args.command || '';
      case 'read_file':
      case 'delete_file':
      case 'list_directory':
      case 'create_directory':
        return `Path: ${args.path || '.'}`;
      case 'write_file':
        return `Path: ${args.path || '.'}\n\nContent:\n${truncateText(args.content || '', 800)}`;
      case 'edit_file':
        return `Path: ${args.path || '.'}\n\nFind:\n${truncateText(args.old_string || '', 300)}\n\nReplace:\n${truncateText(args.new_string || '', 300)}`;
      case 'move_file':
        return `Source: ${args.source_path || ''}\nDestination: ${args.destination_path || ''}`;
      case 'search_files':
        return `Query: "${args.query || ''}"${args.path ? `\nIn path: ${args.path}` : ''}`;
      default:
        return JSON.stringify(args, null, 2);
    }
  } catch (e) {
    return argumentsJson;
  }
}

function formatToolResult(name: string, contentJson: string): string {
  if (!contentJson) return '';
  try {
    const res = JSON.parse(contentJson);
    
    if (res.success === false) {
      const codeStr = res.exitCode !== undefined && res.exitCode !== null ? ` (Exit code: ${res.exitCode})` : '';
      let errStr = `Error: ${res.error || res.message || `Operation failed${codeStr}`}`;
      if (res.stdout) {
        errStr += `\n\nstdout:\n${res.stdout}`;
      }
      if (res.stderr) {
        errStr += `\n\nstderr:\n${res.stderr}`;
      }
      return errStr;
    }

    switch (name) {
      case 'run_command': {
        const codeStr = res.exitCode !== undefined && res.exitCode !== null ? `Exit code: ${res.exitCode}\n\n` : '';
        let out = codeStr;
        if (res.stdout) {
          out += res.stdout;
        }
        if (res.stderr) {
          if (res.stdout) out += '\n';
          out += res.stderr;
        }
        if (res.error) {
          if (out) out += '\n\n';
          out += `Error: ${res.error}`;
        }
        return out || 'Command completed successfully with no output.';
      }
      case 'read_file':
        return res.content !== undefined ? res.content : JSON.stringify(res, null, 2);
      case 'list_directory': {
        if (Array.isArray(res.files)) {
          if (res.files.length === 0) return 'Directory is empty.';
          return res.files
            .map((f: any) => {
              const icon = f.isDirectory ? '📁' : '📄';
              const size = f.isDirectory ? '' : ` (${formatBytes(f.size)})`;
              return `${icon} ${f.name}${size}`;
            })
            .join('\n');
        }
        return JSON.stringify(res, null, 2);
      }
      case 'search_files': {
        if (Array.isArray(res.matches)) {
          const count = res.matchCount ?? res.matches.length;
          if (count === 0) return 'No matches found.';
          const list = res.matches
            .map((m: any) => {
              const lineInfo = m.line ? `:${m.line}` : '';
              const previewInfo = m.preview ? ` - ${m.preview}` : '';
              return `- ${m.path}${lineInfo}${previewInfo}`;
            })
            .join('\n');
          return `Found ${count} match(es):\n${list}`;
        }
        return JSON.stringify(res, null, 2);
      }
      case 'write_file':
      case 'edit_file':
      case 'delete_file':
      case 'create_directory':
      case 'move_file':
        return res.message || 'Success';
      default:
        if (res.content !== undefined) return res.content;
        if (res.message !== undefined) return res.message;
        return JSON.stringify(res, null, 2);
    }
  } catch (e) {
    return contentJson;
  }
}
</script>

<template>
  <div class="tool-group-wrap">
    <!-- Thought Step -->
    <div 
      v-if="cleanedThought" 
      class="tool-thought-body markdown-body" 
      v-html="renderMarkdown(cleanedThought)"
    ></div>

    <!-- Tool Call Accordions -->
    <div class="tool-calls-list">
      <template v-for="(tc, idx) in toolCalls" :key="idx">
      <!-- update_plan renders as a clickable card that opens the plan panel -->
      <button
        v-if="tc.function?.name === 'update_plan'"
        type="button"
        class="plan-tool-card"
        @click="emit('open-plan')"
      >
        <div class="plan-tool-head">
          <span class="plan-tool-eyebrow">Plan</span>
          <span v-if="getPlanTaskCount(tc.function?.arguments)" class="plan-tool-count">
            {{ getPlanTaskCount(tc.function?.arguments) }} steps
          </span>
        </div>
        <span class="plan-tool-title">{{ getPlanTitle(tc.function?.arguments) }}</span>
        <span v-if="getPlanSummary(tc.function?.arguments)" class="plan-tool-summary">
          {{ getPlanSummary(tc.function?.arguments) }}
        </span>
        <span class="plan-tool-action">Open in panel</span>
      </button>

      <div
        v-else
        class="tool-call-accordion"
        :class="{ 'is-expanded': detailsExpanded[idx] }"
      >
        <header class="tool-call-header" @click="toggleDetails(idx)">
          <svg class="chevron-icon" :class="{ rotated: detailsExpanded[idx] }" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m6 9 6 6 6-6"></path>
          </svg>
          
          <!-- Icon -->
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
          <svg v-else-if="tc.function?.name === 'edit_file'" class="step-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"></path>
          </svg>
          <svg v-else-if="tc.function?.name === 'create_directory'" class="step-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"></path>
            <path d="M12 10v6M9 13h6"></path>
          </svg>
          <svg v-else-if="tc.function?.name === 'move_file'" class="step-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12h14"></path>
            <path d="m13 6 6 6-6 6"></path>
          </svg>
          <svg v-else-if="tc.function?.name === 'search_files'" class="step-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <path d="m21 21-4.3-4.3"></path>
          </svg>
          <svg v-else-if="tc.function?.name === 'run_command'" class="step-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m4 17 6-6-6-6"></path>
            <path d="M12 19h8"></path>
          </svg>
          <svg v-else class="step-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
          
          <span class="tool-call-label">{{ getToolLabel(tc.function?.name, tc.function?.arguments) }}</span>
          
          <template v-if="toolResponses[idx]">
            <svg v-if="isToolSuccess(toolResponses[idx].content)" class="status-icon success" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" title="Success">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <svg v-else class="status-icon error" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" title="Error">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </template>
          <span v-else class="status-dot pending" title="Running..."></span>
        </header>

        <div v-if="detailsExpanded[idx]" class="tool-call-details">
          <div class="detail-section">
            <div class="detail-label">Parameters:</div>
            <pre class="faint-code">{{ formatToolParams(tc.function?.name, tc.function?.arguments) }}</pre>
          </div>
          <div class="detail-section response-section">
            <div class="detail-label">Result:</div>
            <pre v-if="toolResponses[idx]" class="faint-code">{{ formatToolResult(tc.function?.name, toolResponses[idx].content) }}</pre>
            <div v-else class="tool-running-shimmer">
              <div class="shimmer-bar"></div>
            </div>
          </div>
        </div>
      </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.plan-tool-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 7px;
  width: 100%;
  text-align: left;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-strong);
  color: var(--text);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.plan-tool-card:hover {
  border-color: var(--muted);
  background: rgba(255, 255, 255, 0.04);
}

.plan-tool-head {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}

.plan-tool-eyebrow {
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--faint);
}

.plan-tool-count {
  margin-left: auto;
  font-family: monospace;
  font-size: 0.72rem;
  color: var(--faint);
}

.plan-tool-title {
  font-weight: 650;
  font-size: 1rem;
  line-height: 1.3;
  color: var(--text);
}

.plan-tool-summary {
  font-size: 0.82rem;
  line-height: 1.5;
  color: var(--muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.plan-tool-action {
  margin-top: 3px;
  font-size: 0.74rem;
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 3px 10px;
}

.tool-group-wrap {
  margin: 14px 0;
  width: 100%;
}

.tool-thought-body {
  margin-bottom: 12px;
  color: #deded8;
  line-height: 1.6;
}

.tool-calls-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tool-call-accordion {
  border-radius: 8px;
  background: transparent;
  border: none;
  font-size: 0.82rem;
  width: 100%;
  overflow: hidden;
  box-shadow: none;
  font-style: italic;
  color: var(--faint);
  transition: color 0.2s ease;
}

.tool-call-accordion:hover {
  background: transparent;
  color: var(--muted);
}

.tool-call-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  cursor: pointer;
  user-select: none;
}

.step-icon {
  color: inherit;
  flex-shrink: 0;
}

.tool-call-label {
  font-weight: 300;
  color: inherit;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex-shrink: 1;
}

.status-icon {
  flex-shrink: 0;
  display: inline-block;
  vertical-align: middle;
}

.status-icon.success {
  color: var(--success);
}

.status-icon.error {
  color: var(--danger);
}

.status-dot.pending {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--warning);
  animation: shimmerPulse 1.5s infinite ease-in-out;
  flex-shrink: 0;
}

@keyframes shimmerPulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}

.chevron-icon {
  color: inherit;
  transition: transform 0.2s ease;
  flex-shrink: 0;
}

.chevron-icon.rotated {
  transform: rotate(180deg);
}

.tool-call-details {
  padding: 8px 0 12px;
  background: transparent;
  border-top: 1px dashed rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-style: normal;
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
