<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import type { Plan } from '@agent-bridge/shared';
import type { AgentSummary } from '../lib/messageGroups';
import { renderMarkdown, cleanMessageContent } from '../lib/markdown';
import { changeDiffRows, type WorkspaceChange } from '../lib/workspaceChanges';
import ToolGroup from './ToolGroup.vue';
import ReasoningPanel from './ReasoningPanel.vue';

const props = defineProps<{
  plan: Plan | null;
  changes?: WorkspaceChange[];
  agents?: AgentSummary[];
  showActions?: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'view-agent', id: string): void;
  (e: 'start'): void;
  (e: 'revise'): void;
  (e: 'reject'): void;
}>();

type StaticTab = 'plan' | 'agents' | 'review';
type PanelTab = StaticTab | `file:${string}`;

const activeTab = ref<PanelTab>('plan');
const openFileTabs = ref<string[]>([]);

const changes = computed(() => props.changes ?? []);
const agents = computed(() => props.agents ?? []);
const doneCount = computed(() => props.plan?.tasks.filter(t => t.status === 'completed').length ?? 0);
const totalCount = computed(() => props.plan?.tasks.length ?? 0);
const totalAdded = computed(() => changes.value.reduce((sum, c) => sum + c.added, 0));
const totalDeleted = computed(() => changes.value.reduce((sum, c) => sum + c.deleted, 0));
const runningAgentCount = computed(() => agents.value.filter(agent => agent.status === 'running').length);

const tabs = computed(() => {
  const list: { id: PanelTab; label: string }[] = [];
  if (props.plan) list.push({ id: 'plan', label: 'Plan' });
  if (agents.value.length) list.push({ id: 'agents', label: 'Agents' });
  if (changes.value.length) list.push({ id: 'review', label: 'Review' });
  for (const id of openFileTabs.value) {
    const change = changes.value.find(c => c.id === id);
    if (change) list.push({ id: `file:${id}`, label: shortPath(change.path) });
  }
  return list;
});

const activeChange = computed(() => {
  if (!activeTab.value.startsWith('file:')) return null;
  const id = activeTab.value.slice(5);
  return changes.value.find(c => c.id === id) ?? null;
});

const activeDiffRows = computed(() => activeChange.value ? changeDiffRows(activeChange.value) : []);

watch(
  () => [props.plan?.id, agents.value.length, changes.value.length] as const,
  () => {
    openFileTabs.value = openFileTabs.value.filter(id => changes.value.some(c => c.id === id));
    if (tabs.value.some(tab => tab.id === activeTab.value)) return;
    activeTab.value = props.plan ? 'plan' : agents.value.length ? 'agents' : 'review';
  },
  { immediate: true }
);

watch(
  () => agents.value.length,
  (count, previous) => {
    if (count > 0 && previous === 0) activeTab.value = 'agents';
  }
);

function openFile(change: WorkspaceChange) {
  if (!openFileTabs.value.includes(change.id)) {
    openFileTabs.value.push(change.id);
  }
  activeTab.value = `file:${change.id}`;
}

function closeFileTab(id: string) {
  openFileTabs.value = openFileTabs.value.filter(x => x !== id);
  if (activeTab.value === `file:${id}`) {
    activeTab.value = changes.value.length ? 'review' : 'plan';
  }
}

function shortPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] || path || 'File';
}

function compactReviewPath(path: string): string {
  if (path.includes(' -> ')) {
    return path
      .split(' -> ')
      .map(part => compactReviewPath(part))
      .join(' -> ');
  }
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 2) return normalized;
  return `.../${parts.slice(-2).join('/')}`;
}

function statusLabel(status: string): string {
  if (status === 'completed') return 'Done';
  if (status === 'in_progress') return 'Doing';
  return 'To do';
}

function changeKindLabel(kind: WorkspaceChange['kind']): string {
  if (kind === 'created') return 'Created';
  if (kind === 'edited') return 'Edited';
  if (kind === 'deleted') return 'Deleted';
  if (kind === 'moved') return 'Moved';
  return 'Changed';
}

function compactNumber(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return String(value);
}

// Inline accordion collapse states
const expandedTranscripts = ref<Record<string, boolean>>({});
const expandedReasoning = ref<Record<string, boolean>>({});
const panelBody = ref<HTMLElement | null>(null);

function latestReasoningBody(root: HTMLElement | null): HTMLElement | undefined {
  const bodies = root?.querySelectorAll('.reasoning-terminal-container .plan-body');
  return bodies?.[bodies.length - 1] as HTMLElement | undefined;
}

watch(
  agents,
  () => {
    const el = panelBody.value;
    if (!el) return;

    const activeReasoningBodyBefore = latestReasoningBody(el);
    const reasoningWasAtBottom = activeReasoningBodyBefore
      ? activeReasoningBodyBefore.scrollHeight - activeReasoningBodyBefore.scrollTop - activeReasoningBodyBefore.clientHeight <= 60
      : true;
    const previousReasoningScrollTop = activeReasoningBodyBefore?.scrollTop ?? 0;

    const panelWasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 180;
    
    nextTick(() => {
      const activeReasoningBodyAfter = latestReasoningBody(el);
      if (activeReasoningBodyAfter) {
        activeReasoningBodyAfter.scrollTop = reasoningWasAtBottom
          ? activeReasoningBodyAfter.scrollHeight
          : previousReasoningScrollTop;
      }

      if (panelWasAtBottom) {
        el.scrollTop = el.scrollHeight;
      }
    });
  },
  { deep: true }
);

function isReasoningExpanded(childId: string, children: any[]): boolean {
  const explicit = expandedReasoning.value[childId];
  if (explicit !== undefined) return explicit;
  
  // By default, only expand the latest reasoning panel of the agent's children
  let latestId = null;
  for (let i = children.length - 1; i >= 0; i--) {
    if (children[i].message.reasoningContent) {
      latestId = children[i].id;
      break;
    }
  }
  return childId === latestId;
}

function toggleReasoning(childId: string) {
  const willExpand = !expandedReasoning.value[childId];
  expandedReasoning.value[childId] = willExpand;
  if (willExpand) {
    nextTick(() => {
      const el = document.querySelector(`[data-reasoning-child-id="${childId}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }
}

function thoughtFor(child: any): string {
  return child.message.role === 'tool' ? '' : child.message.content;
}

function expandAgentTranscript(agentId: string) {
  activeTab.value = 'agents';
  expandedTranscripts.value[agentId] = true;
  nextTick(() => {
    const el = document.querySelector(`[data-agent-row-id="${agentId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

defineExpose({
  expandAgentTranscript
});
</script>

<template>
  <aside class="workspace-panel">
    <header class="workspace-panel-header">
      <div class="panel-tabs" role="tablist" aria-label="Workspace panel">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="panel-tab"
          :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          <span>{{ tab.label }}</span>
          <span
            v-if="tab.id.startsWith('file:')"
            class="panel-tab-close"
            title="Close file tab"
            @click.stop="closeFileTab(tab.id.slice(5))"
          >
            x
          </span>
        </button>
      </div>
      <button type="button" class="workspace-panel-close" title="Hide side panel" @click="$emit('close')">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <path d="M15 3v18" />
        </svg>
      </button>
    </header>

    <div ref="panelBody" class="workspace-panel-body">
      <section v-if="activeTab === 'plan'" class="panel-section">
        <div class="panel-section-heading">
          <div>
            <h2>{{ plan?.title || 'Plan' }}</h2>
            <p v-if="totalCount">{{ doneCount }} / {{ totalCount }} completed</p>
          </div>
        </div>

        <div v-if="plan?.body" class="plan-panel-prose" v-html="renderMarkdown(plan.body)"></div>

        <ul v-if="plan && plan.tasks.length" class="plan-tasks">
          <li
            v-for="(task, index) in plan.tasks"
            :key="index"
            class="plan-task"
            :class="task.status"
          >
            <span class="plan-task-box" :class="task.status"></span>
            <span class="plan-task-text">{{ task.text }}</span>
            <span class="plan-task-status" :class="task.status">{{ statusLabel(task.status) }}</span>
          </li>
        </ul>

        <p v-else-if="!plan?.body" class="panel-empty">
          The assistant's plan will appear here once it drafts one.
        </p>
      </section>

      <section v-else-if="activeTab === 'agents'" class="panel-section">
        <div class="panel-section-heading">
          <div>
            <h2>Background agents</h2>
            <p>{{ runningAgentCount }} running · {{ agents.length }} total</p>
          </div>
        </div>

        <div v-if="agents.length" class="agent-list">
          <article
            v-for="agent in agents"
            :key="agent.id"
            class="agent-row"
            :class="{ running: agent.status === 'running', expanded: expandedTranscripts[agent.id] }"
            :data-agent-row-id="agent.id"
          >
            <div class="agent-row-main" @click="expandedTranscripts[agent.id] = !expandedTranscripts[agent.id]" style="cursor: pointer;">
              <span class="agent-status-dot" :class="agent.status"></span>
              <div class="agent-row-text">
                <h3>{{ agent.title }}</h3>
                <p>
                  <span>{{ agent.roleLabel }}</span>
                  <span v-if="agent.model">{{ agent.model }}</span>
                </p>
              </div>
            </div>
            <div class="agent-row-meta">
              <span>{{ compactNumber(agent.tokenEstimate) }} tokens</span>
              <span>{{ agent.toolUseCount }} tool {{ agent.toolUseCount === 1 ? 'use' : 'uses' }}</span>
              <span>{{ agent.status === 'running' ? 'Running' : 'Done' }}</span>
              <button 
                type="button" 
                class="agent-transcript-btn" 
                @click="expandedTranscripts[agent.id] = !expandedTranscripts[agent.id]"
                :title="expandedTranscripts[agent.id] ? 'Hide transcript' : 'View transcript'"
              >
                <svg 
                  class="chevron-icon" 
                  :class="{ rotated: expandedTranscripts[agent.id] }" 
                  xmlns="http://www.w3.org/2000/svg" 
                  width="14" 
                  height="14" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  stroke-width="2.5" 
                  stroke-linecap="round" 
                  stroke-linejoin="round"
                >
                  <path d="m6 9 6 6 6-6"></path>
                </svg>
              </button>
            </div>

            <!-- Inline Accordion Transcript -->
            <div v-if="expandedTranscripts[agent.id] && agent.children" class="agent-transcript-body">
              <template v-for="child in agent.children" :key="child.id">
                <ReasoningPanel
                  v-if="child.message.reasoningContent"
                  :content="child.message.reasoningContent"
                  :expanded="isReasoningExpanded(child.id, agent.children)"
                  :data-reasoning-child-id="child.id"
                  @toggle="toggleReasoning(child.id)"
                />

                <ToolGroup
                  v-if="child.type === 'tool_group'"
                  :thought="thoughtFor(child)"
                  :tool-calls="child.toolCalls"
                  :tool-responses="child.toolResponses"
                  @open-plan="activeTab = 'plan'"
                />

                <div
                  v-else-if="child.type === 'assistant' && cleanMessageContent(child.message.content)"
                  class="coder-text markdown-body"
                  v-html="renderMarkdown(cleanMessageContent(child.message.content), child.message.id)"
                ></div>
              </template>
            </div>
          </article>
        </div>

        <p v-else class="panel-empty">
          Sub-agents will appear here when the architect delegates work.
        </p>
      </section>

      <section v-else-if="activeTab === 'review'" class="panel-section">
        <div class="panel-section-heading">
          <div>
            <h2>Review</h2>
            <p>{{ changes.length }} changed {{ changes.length === 1 ? 'item' : 'items' }}</p>
          </div>
          <div v-if="changes.length" class="change-total">
            <span class="add">+{{ totalAdded }}</span>
            <span class="del">-{{ totalDeleted }}</span>
          </div>
        </div>

        <div v-if="changes.length" class="change-list">
          <button
            v-for="change in changes"
            :key="change.id"
            type="button"
            class="change-row"
            @click="openFile(change)"
          >
            <span class="change-main">
              <span class="change-path" :title="change.displayPath">{{ compactReviewPath(change.displayPath) }}</span>
              <span class="change-kind">{{ changeKindLabel(change.kind) }}</span>
            </span>
            <span class="change-stats">
              <span v-if="change.added" class="add">+{{ change.added }}</span>
              <span v-if="change.deleted" class="del">-{{ change.deleted }}</span>
            </span>
          </button>
        </div>

        <p v-else class="panel-empty">
          File changes will appear here after the assistant edits the workspace.
        </p>
      </section>

      <section v-else-if="activeChange" class="panel-section file-section">
        <div class="panel-section-heading file-heading">
          <div>
            <h2>{{ activeChange.path }}</h2>
            <p>{{ changeKindLabel(activeChange.kind) }} by {{ activeChange.tool }}</p>
          </div>
          <div class="change-total">
            <span v-if="activeChange.added" class="add">+{{ activeChange.added }}</span>
            <span v-if="activeChange.deleted" class="del">-{{ activeChange.deleted }}</span>
          </div>
        </div>

        <div v-if="activeChange.kind === 'moved'" class="rename-block">
          <span>{{ activeChange.oldText }}</span>
          <span>-></span>
          <span>{{ activeChange.newText }}</span>
        </div>

        <div v-else-if="activeDiffRows.length" class="diff-view">
          <div
            v-for="(row, index) in activeDiffRows"
            :key="index"
            class="diff-row"
            :class="row.type"
          >
            <span class="diff-line old">{{ row.oldNo ?? '' }}</span>
            <span class="diff-line new">{{ row.newNo ?? '' }}</span>
            <span class="diff-mark">{{ row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' ' }}</span>
            <code>{{ row.text || ' ' }}</code>
          </div>
        </div>

        <p v-else class="panel-empty">
          No inline diff is available for this change.
        </p>
      </section>
    </div>

    <footer v-if="showActions && plan && activeTab === 'plan'" class="plan-panel-actions">
      <button type="button" class="plan-action start" @click="$emit('start')">Start building</button>
      <button type="button" class="plan-action" @click="$emit('revise')">Revise</button>
      <button type="button" class="plan-action reject" @click="$emit('reject')">Reject</button>
    </footer>
  </aside>
</template>

<style scoped>
.workspace-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--border-soft);
  border-radius: 14px;
  margin: 12px 12px 12px 0;
  background: var(--card-bg);
  box-shadow:
    0 20px 60px rgba(0, 0, 0, 0.34),
    inset 0 1px 0 rgba(255, 255, 255, 0.035);
  overflow: hidden;
  opacity: 1;
  transform: translateX(0);
  transition:
    margin 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.2s ease,
    transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    border-color 0.2s ease;
}

.workspace-panel.collapsed {
  margin: 12px 0;
  border-color: transparent;
  opacity: 0;
  pointer-events: none;
  transform: translateX(16px);
}

.workspace-panel-header {
  display: flex;
  align-items: center;
  gap: 10px;
  height: var(--top-bar-h);
  padding: 0 var(--card-pad-x);
  border-bottom: 1px solid var(--border-soft);
  flex: 0 0 auto;
}

.panel-tabs {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.panel-tabs::-webkit-scrollbar {
  display: none;
}

.panel-tab {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  max-width: 150px;
  min-height: 30px;
  padding: 5px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.015);
  color: var(--muted);
  font-size: 0.82rem;
  cursor: pointer;
}

.panel-tab span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-tab:hover,
.panel-tab.active {
  background: rgba(255, 255, 255, 0.055);
  border-color: rgba(255, 255, 255, 0.11);
  color: var(--text);
}

.panel-tab-close {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background: transparent;
  color: var(--faint);
  cursor: pointer;
  line-height: 1;
}

.panel-tab-close:hover {
  background: var(--surface-strong);
  color: var(--text);
}

.workspace-panel-close {
  margin-left: auto;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--muted);
  cursor: pointer;
  padding: 0;
  transition: all 0.2s ease;
}

.workspace-panel-close:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.07);
  border-color: rgba(255, 255, 255, 0.16);
}

.workspace-panel-body {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: var(--card-pad-x);
}

.panel-section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.panel-section-heading h2 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 650;
  color: var(--text);
  word-break: break-word;
}

.panel-section-heading p {
  margin: 4px 0 0;
  font-size: 0.76rem;
  color: var(--faint);
}

.change-total,
.change-stats {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8rem;
}

.add {
  color: #7bd88f;
}

.del {
  color: #e06c75;
}

.change-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.agent-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.agent-row {
  padding: 14px;
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.025);
  transition: border-color 0.18s ease, background 0.18s ease, transform 0.18s ease;
}

.agent-row:hover {
  border-color: rgba(255, 255, 255, 0.13);
  background: rgba(255, 255, 255, 0.045);
}

/* An open card reads as a raised, distinct container so its transcript is
   clearly "inside" it rather than spilling onto the flat panel. */
.agent-row.expanded {
  background: rgba(255, 255, 255, 0.05);
  border-color: var(--border);
}

.agent-row.running {
  border-color: rgba(150, 167, 143, 0.36);
}

.agent-row-main {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

.agent-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  margin-top: 7px;
  background: var(--faint);
  flex: 0 0 auto;
}

.agent-status-dot.running {
  background: #5ea2eb;
  box-shadow: 0 0 0 4px rgba(94, 162, 235, 0.12);
}

.agent-status-dot.done {
  background: #9fb99f;
  box-shadow: 0 0 0 4px rgba(159, 185, 159, 0.1);
}

.agent-row-text {
  min-width: 0;
}

.agent-row-text h3 {
  margin: 0;
  color: var(--text);
  font-size: 0.9rem;
  font-weight: 650;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.agent-row-text p,
.agent-row-meta {
  margin: 4px 0 0;
  color: var(--faint);
  font-size: 0.76rem;
}

.agent-row-text p,
.agent-row-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.agent-row-meta {
  padding-left: 18px;
}

.agent-transcript-btn {
  padding: 0;
  background: transparent;
  color: var(--faint);
  cursor: pointer;
  font-size: 0.76rem;
  transition: color 0.15s ease;
}

.agent-transcript-btn:hover {
  color: var(--text);
}

.change-row {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 10px;
  border-radius: 7px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  text-align: left;
}

.change-row:hover {
  background: var(--surface);
}

.change-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.change-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.86rem;
}

.change-kind {
  color: var(--faint);
  font-size: 0.72rem;
}

.file-heading h2 {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.82rem;
}

.rename-block {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.78rem;
}

.rename-block span {
  overflow-wrap: anywhere;
}

.diff-view {
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg);
}

.diff-row {
  display: grid;
  grid-template-columns: 42px 42px 18px minmax(0, 1fr);
  min-height: 24px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.76rem;
  line-height: 1.45;
}

.diff-row.add {
  background: rgba(123, 216, 143, 0.12);
}

.diff-row.del {
  background: rgba(224, 108, 117, 0.13);
}

.diff-line,
.diff-mark {
  color: var(--faint);
  user-select: none;
  text-align: right;
  padding: 3px 6px;
  border-right: 1px solid rgba(255, 255, 255, 0.05);
}

.diff-mark {
  text-align: center;
}

.diff-row code {
  min-width: 0;
  display: block;
  padding: 3px 8px;
  color: var(--text);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.plan-panel-prose {
  font-size: 0.86rem;
  line-height: 1.55;
  color: var(--muted);
  margin-bottom: 16px;
  word-break: break-word;
}

.plan-panel-prose :deep(p) {
  margin: 0.5em 0;
}

.plan-panel-prose :deep(h1),
.plan-panel-prose :deep(h2),
.plan-panel-prose :deep(h3),
.plan-panel-prose :deep(h4) {
  color: var(--text);
  font-weight: 650;
  line-height: 1.3;
  margin: 1em 0 0.4em;
}

.plan-panel-prose :deep(h1) { font-size: 1rem; }
.plan-panel-prose :deep(h2) { font-size: 0.94rem; }
.plan-panel-prose :deep(h3),
.plan-panel-prose :deep(h4) { font-size: 0.88rem; }

.plan-panel-prose :deep(ul),
.plan-panel-prose :deep(ol) {
  padding-left: 1.25em;
  margin: 0.5em 0;
}

.plan-panel-prose :deep(li) {
  margin: 0.25em 0;
}

.plan-panel-prose :deep(strong) {
  color: var(--text);
}

.plan-panel-prose :deep(a) {
  color: var(--text);
  text-decoration: underline;
}

.plan-panel-prose :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.82em;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 5px;
}

.plan-panel-prose :deep(pre) {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  overflow-x: auto;
  margin: 0.6em 0;
}

.plan-panel-prose :deep(pre code) {
  background: none;
  border: 0;
  padding: 0;
}

.plan-panel-prose :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 0.6em 0;
  font-size: 0.8rem;
}

.plan-panel-prose :deep(th),
.plan-panel-prose :deep(td) {
  border: 1px solid var(--border);
  padding: 5px 8px;
  text-align: left;
  vertical-align: top;
}

.plan-panel-prose :deep(th) {
  color: var(--text);
  background: var(--surface);
  font-weight: 600;
}

.plan-panel-prose :deep(blockquote) {
  border-left: 2px solid var(--border);
  margin: 0.6em 0;
  padding-left: 12px;
  color: var(--faint);
}

.panel-empty {
  font-size: 0.85rem;
  color: var(--faint);
  line-height: 1.5;
  margin: 0;
}

.plan-tasks {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.plan-task {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 7px 8px;
  border-radius: 6px;
}

.plan-task.in_progress {
  background: rgba(255, 255, 255, 0.03);
}

.plan-task-box {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  border-radius: 4px;
  border: 1.5px solid var(--faint);
  margin-top: 2px;
}

.plan-task-box.completed {
  background: var(--success);
  border-color: var(--success);
}

.plan-task-box.in_progress {
  border-color: var(--text);
  background: repeating-linear-gradient(
    45deg,
    var(--faint),
    var(--faint) 2px,
    transparent 2px,
    transparent 4px
  );
}

.plan-task-text {
  flex: 1 1 auto;
  font-size: 0.84rem;
  color: var(--text);
  line-height: 1.45;
}

.plan-task.completed .plan-task-text {
  color: var(--faint);
  text-decoration: line-through;
}

.plan-task-status {
  flex: 0 0 auto;
  font-size: 0.66rem;
  font-family: monospace;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--faint);
  margin-top: 2px;
}

.plan-task-status.in_progress {
  color: var(--text);
}

.plan-task-status.completed {
  color: var(--success);
}

.plan-panel-actions {
  flex: 0 0 auto;
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}

.plan-action {
  flex: 1 1 auto;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font-size: 0.82rem;
  font-weight: 550;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.plan-action:hover {
  border-color: var(--muted);
  background: var(--surface-strong);
}

.plan-action.start {
  border-color: var(--text);
  background: var(--text);
  color: var(--bg);
}

.plan-action.start:hover {
  border-color: var(--text);
  background: var(--text);
  color: var(--bg);
  opacity: 0.85;
}

.plan-action.reject {
  border-color: var(--danger-border);
  background: var(--danger-soft);
  color: var(--danger);
}

.plan-action.reject:hover {
  border-color: var(--danger);
  background: var(--danger-soft-strong);
  color: var(--danger);
}

/* Minimal: the transcript just gets breathing room and a hairline separator —
   no box, no inset, full width. Grouping comes from spacing, not chrome. */
.agent-transcript-body {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-soft);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.coder-text {
  color: #deded8;
  line-height: 1.6;
  font-size: 0.88rem;
  margin: 8px 0;
}

.chevron-icon {
  transition: transform 0.2s ease;
  color: inherit;
  display: block;
}

.chevron-icon.rotated {
  transform: rotate(180deg);
}
</style>
