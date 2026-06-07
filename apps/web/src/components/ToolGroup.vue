<script setup lang="ts">
import { ref, computed } from 'vue';
import type { RunMessage } from '@agent-bridge/shared';
import { isToolSuccess } from '../lib/messageGroups';
import { cleanMessageContent, renderMarkdown } from '../lib/markdown';

const props = defineProps<{
  thought?: string;
  toolCalls: any[];
  toolResponses: RunMessage[];
  agentRole?: RunMessage['agentRole'];
  model?: string;
}>();

const isCoder = computed(() => props.agentRole === 'coder');

const emit = defineEmits<{
  (e: 'open-plan'): void;
}>();

const detailsExpanded = ref<Record<number, boolean>>({});

const copiedParameters = ref<Record<number, boolean>>({});
const copiedResults = ref<Record<number, boolean>>({});

// Consecutive read-only inspection calls in the same turn are visually noisy
// (a long stack of "File read: …" / "Directory listed: …" rows). We fold any
// run of >= CLUSTER_MIN such calls into a single collapsible summary row.
const CLUSTERABLE = new Set(['read_file', 'list_directory', 'search_files']);
const CLUSTER_MIN = 3;

interface ToolCluster {
  firstIdx: number;
  indices: number[];
}

const clusters = computed<ToolCluster[]>(() => {
  const out: ToolCluster[] = [];
  let run: number[] = [];
  const flush = () => {
    if (run.length >= CLUSTER_MIN) out.push({ firstIdx: run[0], indices: [...run] });
    run = [];
  };
  props.toolCalls.forEach((tc, idx) => {
    if (CLUSTERABLE.has(tc.function?.name)) run.push(idx);
    else flush();
  });
  flush();
  return out;
});

// idx -> the cluster it belongs to (if any), and idx -> cluster it starts.
const clusterByIndex = computed(() => {
  const m = new Map<number, ToolCluster>();
  for (const c of clusters.value) for (const i of c.indices) m.set(i, c);
  return m;
});
const clusterByFirst = computed(() => {
  const m = new Map<number, ToolCluster>();
  for (const c of clusters.value) m.set(c.firstIdx, c);
  return m;
});

const clustersExpanded = ref<Record<number, boolean>>({});

function toggleCluster(firstIdx: number) {
  clustersExpanded.value[firstIdx] = !clustersExpanded.value[firstIdx];
}
function isClusterExpanded(firstIdx: number): boolean {
  return !!clustersExpanded.value[firstIdx];
}

/** The cluster that STARTS at this index, for rendering the summary header. */
function clusterStart(idx: number): ToolCluster | undefined {
  return clusterByFirst.value.get(idx);
}
function isClustered(idx: number): boolean {
  return clusterByIndex.value.has(idx);
}
/** A clustered row is hidden until its summary header is expanded. */
function isRowVisible(idx: number): boolean {
  const c = clusterByIndex.value.get(idx);
  return c ? isClusterExpanded(c.firstIdx) : true;
}

function clusterLabel(c: ToolCluster): string {
  const names = c.indices.map(i => props.toolCalls[i].function?.name);
  const n = c.indices.length;
  if (names.every(name => name === 'read_file')) return `Read ${n} files`;
  if (names.every(name => name === 'list_directory')) return `Listed ${n} directories`;
  if (names.every(name => name === 'search_files')) return `Ran ${n} searches`;
  return `Inspected ${n} items`;
}

function clusterStatus(c: ToolCluster): 'success' | 'failed' | 'pending' {
  let anyPending = false;
  for (const i of c.indices) {
    const res = props.toolResponses[i];
    if (!res) anyPending = true;
    else if (!isToolSuccess(res.content)) return 'failed';
  }
  return anyPending ? 'pending' : 'success';
}

function copyParameters(idx: number, text: string) {
  navigator.clipboard.writeText(text);
  copiedParameters.value[idx] = true;
  setTimeout(() => {
    copiedParameters.value[idx] = false;
  }, 2000);
}

function copyResult(idx: number, text: string) {
  navigator.clipboard.writeText(text);
  copiedResults.value[idx] = true;
  setTimeout(() => {
    copiedResults.value[idx] = false;
  }, 2000);
}

function getSingleBoxHeaderLabel(name: string, argumentsJson: string): string {
  if (name === 'run_command') return 'bash';
  if (name === 'read_file' || name === 'write_file' || name === 'edit_file') {
    const path = getToolPath(argumentsJson);
    return path.split('/').pop() || name;
  }
  return name;
}

function formatSingleBoxContent(name: string, argumentsJson: string, response: any): string {
  const params = hasToolParams(name, argumentsJson) ? formatToolParams(name, argumentsJson) : '';
  const result = response ? formatToolResult(name, response.content) : 'Running...';
  
  if (params && result) {
    return `Parameters:\n${params}\n\nResult:\n${result}`;
  }
  if (params) {
    return `Parameters:\n${params}`;
  }
  if (result) {
    return result;
  }
  return '';
}

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

/** Label for a step; for orphaned/standalone tool outputs (no known tool name)
 *  we surface the trimmed result message instead of a generic placeholder. */
function getStepLabel(name: string, args: string, idx: number): string {
  if (name === 'Workspace Tool Output') {
    const res = props.toolResponses[idx];
    if (res) {
      const delegated = parseDelegatedResult(res.content);
      if (delegated?.length) {
        return delegated.length === 1 ? `Utility result: ${delegated[0].title}` : `${delegated.length} utility results`;
      }
      try {
        const parsed = JSON.parse(res.content);
        if (parsed.error) return `Error: ${parsed.error}`;
        if (typeof parsed.message === 'string' && parsed.message) return parsed.message;
      } catch (e) { /* fall through */ }
    }
    return 'Workspace tool output';
  }
  return getToolLabel(name, args);
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
    case 'fetch_url':
      return `Fetched: ${parsed.url ?? ''}`;
    case 'delegate_tasks': {
      const count = Array.isArray(parsed.tasks) ? parsed.tasks.length : 0;
      return `Delegated ${count} task${count === 1 ? '' : 's'} to coder${parsed.parallel ? ' (parallel)' : ''}`;
    }
    case 'delegate_to_utility': {
      const count = Array.isArray(parsed.tasks) ? parsed.tasks.length : 0;
      return `Delegated ${count} task${count === 1 ? '' : 's'} to utility${parsed.parallel ? ' (parallel)' : ''}`;
    }
    default:
      return `Tool ${name} executed`;
  }
}

function formatObjectToLines(obj: any): string {
  if (obj === null || obj === undefined) return '';
  if (typeof obj !== 'object') return String(obj);
  
  if (Array.isArray(obj)) {
    return obj.map(item => formatObjectToLines(item)).filter(Boolean).join('\n');
  }
  
  return Object.entries(obj)
    .map(([key, val]) => {
      if (typeof val === 'boolean' || val === null || val === undefined) {
        return '';
      }
      
      if (key === 'exitCode') {
        return '';
      }
      
      if (typeof val === 'object') {
        return formatObjectToLines(val);
      }
      
      return `${key}: ${String(val).trim()}`;
    })
    .filter(Boolean)
    .join('\n');
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
      case 'Workspace Tool Output':
        return '';
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
      case 'fetch_url':
        return `URL: ${args.url || ''}`;
      case 'set_chat_title':
        return `Title: ${args.title || ''}`;
      case 'ask_user_question': {
        if (!Array.isArray(args.questions) || args.questions.length === 0) return '';
        return args.questions
          .map((q: any, idx: number) => {
            const head = typeof q?.header === 'string' && q.header.trim() ? `${q.header.trim()} — ` : '';
            const text = typeof q?.question === 'string' ? q.question.trim() : '';
            const opts = Array.isArray(q?.options)
              ? q.options
                  .map((o: any) => {
                    const label = typeof o?.label === 'string' ? o.label : '';
                    const desc = typeof o?.description === 'string' && o.description.trim() ? ` — ${o.description.trim()}` : '';
                    return `   • ${label}${desc}`;
                  })
                  .join('\n')
              : '';
            return `${idx + 1}. ${head}${text}${opts ? `\n${opts}` : ''}`;
          })
          .join('\n\n');
      }
      case 'delegate_tasks':
      case 'delegate_to_utility': {
        if (!Array.isArray(args.tasks) || args.tasks.length === 0) return '';
        return args.tasks
          .map((task: any, idx: number) => {
            const title = typeof task?.title === 'string' && task.title.trim() ? task.title.trim() : `Task ${idx + 1}`;
            const body = typeof task?.task === 'string' && task.task.trim() ? `\n${task.task.trim()}` : '';
            return `${idx + 1}. ${title}${body}`;
          })
          .join('\n\n');
      }
      default:
        return formatObjectToLines(args);
    }
  } catch (e) {
    return argumentsJson;
  }
}

function hasToolParams(name: string, argumentsJson: string): boolean {
  return !!formatToolParams(name, argumentsJson).trim();
}

function parseDelegatedResult(contentJson: string): { title: string; summary: string }[] | null {
  if (!contentJson) return null;
  try {
    const res = JSON.parse(contentJson);
    if (!Array.isArray(res.results)) return null;
    const sections = res.results
      .map((item: any, idx: number) => ({
        title: typeof item?.title === 'string' && item.title.trim() ? item.title.trim() : `Result ${idx + 1}`,
        summary: typeof item?.summary === 'string' ? item.summary.trim() : ''
      }))
      .filter((item: { title: string; summary: string }) => item.summary);
    return sections.length ? sections : null;
  } catch (e) {
    return null;
  }
}

/** Parsed answers for an ask_user_question result, ready for the Q&A card. */
function parseAskAnswers(contentJson: string): { header: string; question: string; selected: string[]; note: string }[] | null {
  if (!contentJson) return null;
  try {
    const res = JSON.parse(contentJson);
    if (!Array.isArray(res.answers)) return null;
    return res.answers.map((a: any) => ({
      header: typeof a?.header === 'string' ? a.header.trim() : '',
      question: typeof a?.question === 'string' ? a.question.trim() : '',
      selected: Array.isArray(a?.selected) ? a.selected.filter((s: any) => typeof s === 'string') : [],
      note: typeof a?.note === 'string' ? a.note.trim() : ''
    }));
  } catch (e) {
    return null;
  }
}

function shouldRenderAskAnswers(name: string, contentJson: string): boolean {
  if (name !== 'ask_user_question') return false;
  return !!parseAskAnswers(contentJson)?.length;
}

function shouldRenderDelegatedResult(name: string, contentJson: string): boolean {
  if (name !== 'delegate_tasks' && name !== 'delegate_to_utility' && name !== 'Workspace Tool Output') return false;
  return !!parseDelegatedResult(contentJson)?.length;
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
      case 'set_chat_title':
        return `Chat title updated to: ${res.title || 'Success'}`;
      default:
        if (res.content !== undefined) return res.content;
        if (res.message !== undefined) return res.message;
        return formatObjectToLines(res);
    }
  } catch (e) {
    return contentJson;
  }
}
</script>

<template>
  <div class="tool-group-wrap" :class="{ 'coder-tool-group': isCoder }">
    <!-- Coder sub-agent label -->
    <div v-if="isCoder" class="coder-tool-meta">
      <span class="agent-badge coder-badge">Coder</span>
      <span v-if="model" class="coder-tool-model">{{ model }}</span>
    </div>

    <!-- Thought Step -->
    <div
      v-if="cleanedThought"
      class="tool-thought-body markdown-body"
      v-html="renderMarkdown(cleanedThought)"
    ></div>

    <!-- Tool Call Accordions -->
    <div class="tool-calls-list">
      <template v-for="(tc, idx) in toolCalls" :key="idx">
      <!-- Summary header for a folded run of consecutive inspection calls. -->
      <header
        v-if="clusterStart(idx)"
        class="step-row tool-cluster-header"
        :class="{ 'is-expanded': isClusterExpanded(idx) }"
        @click="toggleCluster(idx)"
      >
        <svg class="step-row-toggle" :class="{ rotated: isClusterExpanded(idx) }" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m6 9 6 6 6-6"></path>
        </svg>
        <svg class="step-row-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="8" y1="6" x2="21" y2="6"></line>
          <line x1="8" y1="12" x2="21" y2="12"></line>
          <line x1="8" y1="18" x2="21" y2="18"></line>
          <line x1="3" y1="6" x2="3.01" y2="6"></line>
          <line x1="3" y1="12" x2="3.01" y2="12"></line>
          <line x1="3" y1="18" x2="3.01" y2="18"></line>
        </svg>
        <span class="step-row-label">{{ clusterLabel(clusterStart(idx)!) }}</span>
        <svg v-if="clusterStatus(clusterStart(idx)!) === 'success'" class="status-icon success" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" title="Success">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <svg v-else-if="clusterStatus(clusterStart(idx)!) === 'failed'" class="status-icon error" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" title="Error">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
        <span v-else class="status-dot pending" title="Running..."></span>
      </header>

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
        v-else-if="isRowVisible(idx)"
        class="tool-call-accordion"
        :class="{ 'is-expanded': detailsExpanded[idx], 'clustered-row': isClustered(idx) }"
      >
        <header class="step-row" @click="toggleDetails(idx)">
          <svg class="step-row-toggle" :class="{ rotated: detailsExpanded[idx] }" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m6 9 6 6 6-6"></path>
          </svg>
          
          <!-- Icon -->
          <svg v-if="tc.function?.name === 'read_file'" class="step-row-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path>
            <path d="M14 2v4a2 2 0 0 0 2 2h4"></path>
          </svg>
          <svg v-else-if="tc.function?.name === 'write_file'" class="step-row-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20h9"></path>
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
          </svg>
          <svg v-else-if="tc.function?.name === 'delete_file'" class="step-row-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18"></path>
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
          </svg>
          <svg v-else-if="tc.function?.name === 'list_directory'" class="step-row-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"></path>
          </svg>
          <svg v-else-if="tc.function?.name === 'edit_file'" class="step-row-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"></path>
          </svg>
          <svg v-else-if="tc.function?.name === 'create_directory'" class="step-row-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"></path>
            <path d="M12 10v6M9 13h6"></path>
          </svg>
          <svg v-else-if="tc.function?.name === 'move_file'" class="step-row-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12h14"></path>
            <path d="m13 6 6 6-6 6"></path>
          </svg>
          <svg v-else-if="tc.function?.name === 'search_files'" class="step-row-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <path d="m21 21-4.3-4.3"></path>
          </svg>
          <svg v-else-if="tc.function?.name === 'run_command'" class="step-row-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m4 17 6-6-6-6"></path>
            <path d="M12 19h8"></path>
          </svg>
          <svg v-else class="step-row-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
          
          <span class="step-row-label">{{ getStepLabel(tc.function?.name, tc.function?.arguments, idx) }}</span>
          
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
          <!-- If it has custom result cards (Q&A or Delegated sub-agents) -->
          <template v-if="toolResponses[idx] && (shouldRenderAskAnswers(tc.function?.name, toolResponses[idx].content) || shouldRenderDelegatedResult(tc.function?.name, toolResponses[idx].content))">
            <!-- Parameters (inside standard wrapper) -->
            <div v-if="hasToolParams(tc.function?.name, tc.function?.arguments)" class="code-block-wrapper">
              <div class="code-block-header">
                <span class="code-block-lang">{{ getSingleBoxHeaderLabel(tc.function?.name, tc.function?.arguments) }} (params)</span>
                <button 
                  class="code-block-copy-btn" 
                  :class="{ copied: copiedParameters[idx] }" 
                  @click.stop="copyParameters(idx, formatToolParams(tc.function?.name, tc.function?.arguments))"
                >
                  {{ copiedParameters[idx] ? 'Copied!' : 'Copy' }}
                </button>
              </div>
              <pre class="faint-code"><code>{{ formatToolParams(tc.function?.name, tc.function?.arguments) }}</code></pre>

              <!-- Answer rendered inside the same params box. -->
              <div
                v-if="shouldRenderAskAnswers(tc.function?.name, toolResponses[idx].content)"
                class="ask-answer-list"
              >
              <section
                v-for="(ans, aIdx) in parseAskAnswers(toolResponses[idx].content)"
                :key="aIdx"
                class="ask-answer-card"
              >
                <div v-if="ans.header" class="ask-answer-header">{{ ans.header }}</div>
                <div class="ask-answer-question">{{ ans.question }}</div>

                <ul v-if="ans.selected.length" class="ask-answer-choices">
                  <li v-for="(choice, cIdx) in ans.selected" :key="cIdx">{{ choice }}</li>
                </ul>

                <!-- Free-text answer: when nothing was picked from the list it IS
                     the answer (checkmark); otherwise it's an added note. -->
                <ul v-if="ans.note && !ans.selected.length" class="ask-answer-choices">
                  <li>{{ ans.note }}</li>
                </ul>
                <div v-else-if="ans.note" class="ask-answer-note">{{ ans.note }}</div>

                <div v-if="!ans.selected.length && !ans.note" class="ask-answer-empty">Seçim yapılmadı</div>
              </section>
              </div>
            </div>

            <div
              v-if="shouldRenderDelegatedResult(tc.function?.name, toolResponses[idx].content)"
              class="delegated-result-list"
            >
              <section
                v-for="section in parseDelegatedResult(toolResponses[idx].content)"
                :key="section.title"
                class="delegated-result-card"
              >
                <div class="delegated-result-title">{{ section.title }}</div>
                <div class="delegated-result-body markdown-body" v-html="renderMarkdown(section.summary)"></div>
              </section>
            </div>
          </template>

          <!-- Standard Tool Case (single wrapper for both params and results) -->
          <template v-else>
            <div class="code-block-wrapper">
              <div class="code-block-header">
                <span class="code-block-lang">{{ getSingleBoxHeaderLabel(tc.function?.name, tc.function?.arguments) }}</span>
                <button 
                  class="code-block-copy-btn" 
                  :class="{ copied: copiedResults[idx] }" 
                  @click.stop="copyResult(idx, formatSingleBoxContent(tc.function?.name, tc.function?.arguments, toolResponses[idx]))"
                >
                  {{ copiedResults[idx] ? 'Copied!' : 'Copy' }}
                </button>
              </div>
              <pre class="faint-code"><code>{{ formatSingleBoxContent(tc.function?.name, tc.function?.arguments, toolResponses[idx]) }}</code></pre>
            </div>
          </template>
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
  border-color: transparent;
  background: #252529;
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
  margin: 1px 0;
  width: 100%;
}

/* Coder sub-agent tool group: subtle left accent matching coder messages. */
.tool-group-wrap.coder-tool-group {
  border-left: 2px solid var(--border);
  padding-left: 14px;
  margin-left: 2px;
}

.coder-tool-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.coder-tool-meta .agent-badge.coder-badge {
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text);
  background: var(--surface-strong);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 1px 6px;
}

.coder-tool-model {
  font-size: 0.72rem;
  color: var(--faint);
  font-family: monospace;
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

/* Layout only — the row look + label + toggle come from the shared .step-row
   classes in style.css. */
.tool-call-accordion {
  width: 100%;
  overflow: hidden;
}

/* Folded inspection-call summary header (shares the .step-row look). */
.tool-cluster-header {
  cursor: pointer;
  user-select: none;
}

/* Individual rows revealed under an expanded cluster sit indented beneath it. */
.tool-call-accordion.clustered-row {
  margin-left: 18px;
  border-left: 1px solid var(--border-soft);
  padding-left: 8px;
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

.tool-call-details {
  padding: 8px 0 12px;
  background: transparent;
  border-top: 1px solid var(--border-soft);
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
  border-top: 1px solid var(--border-soft);
  padding-top: 8px;
}

.detail-label {
  font-size: 0.75rem;
  color: var(--muted);
  font-weight: 500;
}

.tool-call-details .code-block-wrapper {
  margin: 6px 0 0;
}

.faint-code {
  font-family: monospace;
  font-size: 0.75rem;
  color: var(--muted);
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
  background: transparent;
  padding: 14px;
  border-radius: 0;
  border: none;
}

.delegated-result-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.delegated-result-card {
  border: none;
  background: transparent;
  padding: 0;
}

.delegated-result-card + .delegated-result-card {
  border-top: 1px solid var(--border-soft);
  padding-top: 10px;
}

.delegated-result-title {
  margin-bottom: 8px;
  color: var(--text);
  font-size: 0.86rem;
  font-weight: 600;
  font-style: normal;
}

.delegated-result-body {
  color: var(--muted);
  font-size: 0.84rem;
  line-height: 1.55;
}

:deep(.delegated-result-body pre) {
  white-space: pre-wrap;
}

:deep(.delegated-result-body table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
}

.ask-answer-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* The answer lives inside the params box: a divider + padding separate it from
   the params above, sharing one container. */
.code-block-wrapper .ask-answer-list {
  padding: 14px;
  border-top: 1px solid var(--border);
  /* Match the params (faint-code) above — same monospace font. */
  font-family: monospace;
}

.ask-answer-card {
  border: none;
  background: transparent;
  padding: 0;
}

.ask-answer-header {
  margin-bottom: 4px;
  color: var(--muted);
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.ask-answer-question {
  margin-bottom: 8px;
  color: var(--text);
  font-size: 0.86rem;
  font-weight: 600;
}

.ask-answer-choices {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ask-answer-choices li {
  position: relative;
  padding-left: 18px;
  color: var(--text);
  font-size: 0.84rem;
  line-height: 1.45;
}

.ask-answer-choices li::before {
  content: '✓';
  position: absolute;
  left: 0;
  color: var(--success);
  font-weight: 700;
}

.ask-answer-empty {
  color: var(--muted);
  font-size: 0.82rem;
  font-style: italic;
}

.ask-answer-note {
  margin-top: 8px;
  color: var(--muted);
  font-size: 0.82rem;
  line-height: 1.5;
  font-style: italic;
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
