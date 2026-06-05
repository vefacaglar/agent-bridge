<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { ProviderMetadata, Run, RunMessage, RunStatus, Project } from '@bridgemind/shared';

const API_BASE = 'http://localhost:3000';

const providers = ref<ProviderMetadata[]>([]);
const runs = ref<Run[]>([]);
const messagesContainer = ref<HTMLElement | null>(null);

const activeRunId = ref<string | null>(null);
const activeRun = ref<Run | null>(null);
const messages = ref<RunMessage[]>([]);

const selectedModelCombined = ref(localStorage.getItem('bm_selected_model') || '');
const taskInput = ref('');
const activeProjectPath = ref('/Users/vefa/Projects/agent-bridge');

const isRunning = ref(false);

const projects = ref<Project[]>([]);
const showAddProjectModal = ref(false);
const showPermissionModal = ref(false);
const pendingPermissionRequest = ref<any>(null);
const newProjectName = ref('');
const newProjectPath = ref('');

const isSubmittingProject = ref(false);

watch(selectedModelCombined, (newVal) => {
  if (newVal) localStorage.setItem('bm_selected_model', newVal);
});

const currentMode = ref<'ask_permissions' | 'accept_edits' | 'plan' | 'auto'>(
  (localStorage.getItem('bm_current_mode') as any) || 'accept_edits'
);
const bypassPermissions = ref<boolean>(
  localStorage.getItem('bm_bypass_permissions') === 'true'
);

watch(currentMode, (newVal) => {
  localStorage.setItem('bm_current_mode', newVal);
});

watch(bypassPermissions, (newVal) => {
  localStorage.setItem('bm_bypass_permissions', String(newVal));
});

const showModeMenu = ref(false);
const showModelMenu = ref(false);

const modesList = [
  { id: 'ask_permissions', label: 'Ask permissions', shortcut: '1' },
  { id: 'accept_edits', label: 'Accept edits', shortcut: '2' },
  { id: 'plan', label: 'Plan mode', shortcut: '3' },
  { id: 'auto', label: 'Auto mode', shortcut: '4' }
] as const;

function getModeLabel(modeId: string): string {
  const mode = modesList.find(m => m.id === modeId);
  return mode ? mode.label : 'Accept edits';
}

function selectMode(modeId: 'ask_permissions' | 'accept_edits' | 'plan' | 'auto') {
  currentMode.value = modeId;
  showModeMenu.value = false;
}

function toggleBypassPermissions() {
  bypassPermissions.value = !bypassPermissions.value;
}

function handlePlusClick() {
  console.log('Plus clicked');
}

function handleMicClick() {
  console.log('Mic clicked');
}

const activeModelDisplayName = computed(() => {
  const opt = modelOptions.value.find(o => o.value === selectedModelCombined.value);
  if (!opt) return 'Select Model';
  return opt.label.split(' / ').pop() || opt.label;
});

const isMac = computed(() => {
  return navigator.userAgent.toLowerCase().includes('mac') || navigator.platform.toLowerCase().includes('mac');
});

let eventSource: EventSource | null = null;

const activeStatuses: RunStatus[] = ['created', 'generating', 'awaiting_permission'];

const modelOptions = computed(() => {
  const options: { value: string; label: string; providerId: string }[] = [];
  for (const provider of providers.value) {
    for (const model of provider.models) {
      options.push({
        value: `${provider.id}:${model}`,
        label: `${provider.displayName} / ${model}`,
        providerId: provider.id
      });
    }
  }
  return options;
});

const visibleTitle = computed(() => activeRun.value?.title || 'New chat');

const expandedMessageIds = ref<Record<string, boolean>>({});

function toggleMessageExpansion(messageId: string) {
  expandedMessageIds.value[messageId] = !expandedMessageIds.value[messageId];
}

function hasToolCalls(message: RunMessage): boolean {
  if (!message.rawResponse) return false;
  try {
    const parsed = JSON.parse(message.rawResponse);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch (e) {
    return false;
  }
}

function isToolSuccess(content: string): boolean {
  try {
    const parsed = JSON.parse(content);
    return parsed.success !== false;
  } catch (e) {
    return true;
  }
}

function formatJson(content: string): string {
  try {
    const parsed = JSON.parse(content);
    return JSON.stringify(parsed, null, 2);
  } catch (e) {
    return content;
  }
}



function cleanMessageContent(content: string): string {
  return content.replace(/<plan>[\s\S]*?<\/plan>/g, '').trim();
}


const projectOptions = computed(() => {
  return projects.value.map(p => {
    const count = runs.value.filter(run => (run.projectPath || '/Users/vefa/Projects/agent-bridge') === p.path).length;
    return {
      path: p.path,
      name: p.name,
      count
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
});

const filteredRuns = computed(() => {
  return runs.value.filter(run => (run.projectPath || '/Users/vefa/Projects/agent-bridge') === activeProjectPath.value);
});

const activeProject = computed(() => {
  return projectOptions.value.find(project => project.path === activeProjectPath.value) || projectOptions.value[0];
});

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function statusLabel(status?: RunStatus): string {
  if (!status) return 'idle';
  const labels: Record<RunStatus, string> = {
    created: 'queued',
    generating: 'generating',
    awaiting_permission: 'waiting permission',
    done: 'completed',
    failed: 'failed',
    cancelled: 'cancelled'
  };
  return labels[status];
}

function statusClass(status?: RunStatus): string {
  if (!status) return 'idle';
  if (status === 'done') return 'success';
  if (status === 'failed' || status === 'cancelled') return 'danger';
  if (status === 'awaiting_permission') return 'warning';
  if (activeStatuses.includes(status)) return 'active';
  return 'idle';
}

function splitCombined(value: string): { providerId: string; model: string } {
  const [providerId, ...modelParts] = value.split(':');
  return { providerId, model: modelParts.join(':') };
}

async function loadProviders() {
  const response = await fetch(`${API_BASE}/api/providers`);
  if (!response.ok) return;

  providers.value = await response.json();

  if (modelOptions.value.length === 0) return;
  selectedModelCombined.value ||= modelOptions.value.find(option => option.providerId === 'anthropic')?.value || modelOptions.value[0].value;
}

async function loadRuns() {
  const response = await fetch(`${API_BASE}/api/runs`);
  if (response.ok) {
    runs.value = await response.json();
  }
}

async function loadMessages(runId: string) {
  const response = await fetch(`${API_BASE}/api/runs/${runId}/messages`);
  if (response.ok) {
    messages.value = await response.json();
  }
}

async function selectRun(run: Run) {
  eventSource?.close();
  eventSource = null;

  activeRunId.value = run.id;
  activeRun.value = { ...run };
  activeProjectPath.value = run.projectPath || activeProjectPath.value;
  taskInput.value = '';

  await loadMessages(run.id);

  if (activeStatuses.includes(run.status)) {
    isRunning.value = true;
    connectEventSource(run.id);
  } else {
    isRunning.value = false;
  }
}

function startNewRunSetup() {
  if (isRunning.value) return;
  activeRunId.value = null;
  activeRun.value = null;
  messages.value = [];
  taskInput.value = '';
}

function selectProject(projectPath: string) {
  if (isRunning.value) return;
  activeProjectPath.value = projectPath;
  startNewRunSetup();
}

function connectEventSource(runId: string) {
  eventSource?.close();
  eventSource = new EventSource(`${API_BASE}/api/runs/${runId}/events`);

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'connected') return;

    if (data.type === 'status_changed') {
      updateRunStatus(runId, data.status);
      if (data.status !== 'awaiting_permission') {
        showPermissionModal.value = false;
        pendingPermissionRequest.value = null;
      }
    }

    if (data.type === 'permission_requested' && activeRun.value?.id === runId) {
      pendingPermissionRequest.value = data;
      showPermissionModal.value = true;
    }

    if (data.type === 'message_created' && activeRun.value?.id === runId) {
      if (!messages.value.some(message => message.id === data.message.id)) {
        messages.value.push(data.message);
      }
    }

    if (data.type === 'run_completed') {
      if (activeRun.value?.id === runId) {
        updateRunStatus(runId, 'done');
      }
      finishEventStream();
    }

    if (data.type === 'run_failed') {
      if (activeRun.value?.id === runId) {
        activeRun.value.errorMessage = data.errorMessage;
        updateRunStatus(runId, 'failed');
      }
      finishEventStream();
    }
  };

  eventSource.onerror = () => {
    finishEventStream();
  };
}

function updateRunStatus(runId: string, status: RunStatus) {
  if (activeRun.value?.id === runId) {
    activeRun.value.status = status;
  }

  const run = runs.value.find(item => item.id === runId);
  if (run) {
    run.status = status;
  }
}

function finishEventStream() {
  eventSource?.close();
  eventSource = null;
  isRunning.value = false;
  loadRuns();
}

async function handleSendTask() {
  if (!taskInput.value.trim() || isRunning.value || !selectedModelCombined.value) return;

  const modelInfo = splitCombined(selectedModelCombined.value);

  isRunning.value = true;

  if (activeRun.value && !activeStatuses.includes(activeRun.value.status)) {
    // CONTINUE existing run
    const runId = activeRun.value.id;
    const currentTask = taskInput.value;
    taskInput.value = '';

    const response = await fetch(`${API_BASE}/api/runs/${runId}/continue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: currentTask,
        providerId: modelInfo.providerId,
        model: modelInfo.model,
        mode: currentMode.value,
        bypassPermissions: bypassPermissions.value
      })
    });

    if (!response.ok) {
      isRunning.value = false;
      taskInput.value = currentTask; // Restore input on error
      const error = await response.json();
      window.alert(error.error || 'Mesaj gonderilemedi.');
      return;
    }

    await loadMessages(runId);
    connectEventSource(runId);
  } else {
    // CREATE new run
    messages.value = [];

    const response = await fetch(`${API_BASE}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: taskInput.value,
        projectPath: activeProject.value?.path,
        projectName: activeProject.value?.name,
        providerId: modelInfo.providerId,
        model: modelInfo.model,
        mode: currentMode.value,
        bypassPermissions: bypassPermissions.value
      })
    });

    if (!response.ok) {
      isRunning.value = false;
      const error = await response.json();
      window.alert(error.error || 'Sohbet baslatilamadi.');
      return;
    }

    const run = await response.json() as Run;
    taskInput.value = '';
    activeRunId.value = run.id;
    activeRun.value = run;
    runs.value.unshift(run);
    connectEventSource(run.id);
  }
}

async function cancelActiveRun() {
  if (!activeRunId.value || !isRunning.value) return;
  const response = await fetch(`${API_BASE}/api/runs/${activeRunId.value}/cancel`, { method: 'POST' });
  if (response.ok) {
    updateRunStatus(activeRunId.value, 'cancelled');
    finishEventStream();
  }
}

async function handlePermissionDecision(decision: 'allow_once' | 'allow_project' | 'allow_always' | 'deny') {
  if (!activeRunId.value) return;
  try {
    const response = await fetch(`${API_BASE}/api/runs/${activeRunId.value}/permission`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision })
    });
    if (response.ok) {
      showPermissionModal.value = false;
      pendingPermissionRequest.value = null;
    } else {
      const err = await response.json();
      window.alert(err.error || 'Permission decision could not be processed.');
    }
  } catch (err) {
    console.error(err);
    window.alert('Connection error.');
  }
}

function copyText(value: string) {
  navigator.clipboard.writeText(value);
}

async function loadProjects() {
  const response = await fetch(`${API_BASE}/api/projects`);
  if (response.ok) {
    projects.value = await response.json();
  }
}

async function handleBrowseFolder() {
  try {
    const response = await fetch(`${API_BASE}/api/projects/select-dir`, {
      method: 'POST'
    });
    if (!response.ok) {
      const err = await response.json();
      window.alert(err.error || 'Klasor secilemedi.');
      return;
    }
    const data = await response.json();
    newProjectPath.value = data.path;
    newProjectName.value = data.name;
  } catch (err) {
    console.error(err);
    window.alert('Mac klasor secme penceresi acilamadi.');
  }
}

async function submitNewProject() {
  if (!newProjectPath.value.trim()) return;
  isSubmittingProject.value = true;
  try {
    const response = await fetch(`${API_BASE}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: newProjectPath.value.trim(),
        name: newProjectName.value.trim()
      })
    });
    if (!response.ok) {
      const err = await response.json();
      window.alert(err.error || 'Proje eklenemedi.');
      return;
    }
    const addedProject = await response.json() as Project;
    await loadProjects();
    selectProject(addedProject.path);
    closeAddProjectModal();
  } catch (err) {
    console.error(err);
    window.alert('Proje kaydedilirken hata olustu.');
  } finally {
    isSubmittingProject.value = false;
  }
}

async function deleteProject(projectPath: string, event: Event) {
  event.stopPropagation();
  if (projectOptions.value.length <= 1) {
    window.alert('En az bir proje tanimli olmalidir.');
    return;
  }
  if (!window.confirm('Bu projeyi listeden kaldirmak istediginize emin misiniz? (Mevcut sohbet gecmisi silinmeyecektir)')) {
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/api/projects?path=${encodeURIComponent(projectPath)}`, {
      method: 'DELETE'
    });
    if (response.ok) {
      await loadProjects();
      if (activeProjectPath.value === projectPath) {
        selectProject(projectOptions.value[0]?.path || '');
      }
    }
  } catch (err) {
    console.error(err);
  }
}

function openAddProjectModal() {
  newProjectName.value = '';
  newProjectPath.value = '';
  showAddProjectModal.value = true;
}

function closeAddProjectModal() {
  showAddProjectModal.value = false;
}

function scrollToBottom() {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
}

watch(
  messages,
  () => {
    nextTick(scrollToBottom);
  },
  { deep: true }
);

watch(isRunning, () => {
  nextTick(scrollToBottom);
});

watch(activeRunId, () => {
  nextTick(scrollToBottom);
});

onMounted(async () => {
  await loadProviders();
  await loadProjects();
  await loadRuns();
  if (runs.value.length > 0) {
    await selectRun(runs.value[0]);
  } else if (projectOptions.value.length > 0) {
    activeProjectPath.value = projectOptions.value[0].path;
  }

  // Close menus when clicked outside
  const handleDocumentClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.mode-selector-wrap')) {
      showModeMenu.value = false;
    }
    if (!target.closest('.model-dropdown-wrap')) {
      showModelMenu.value = false;
    }
  };
  document.addEventListener('click', handleDocumentClick);

  // Keydown shortcuts when mode menu is open
  const handleKeyDown = (e: KeyboardEvent) => {
    if (showModeMenu.value) {
      if (['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        const modeKeys: Record<string, 'ask_permissions' | 'accept_edits' | 'plan' | 'auto'> = {
          '1': 'ask_permissions',
          '2': 'accept_edits',
          '3': 'plan',
          '4': 'auto'
        };
        selectMode(modeKeys[e.key]);
      }
    }
  };
  window.addEventListener('keydown', handleKeyDown);

  // Store cleanup references
  (window as any)._bmCleanup = () => {
    document.removeEventListener('click', handleDocumentClick);
    window.removeEventListener('keydown', handleKeyDown);
  };
});

onBeforeUnmount(() => {
  eventSource?.close();
  if (typeof (window as any)._bmCleanup === 'function') {
    (window as any)._bmCleanup();
  }
});
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="window-dots" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </div>

      <button class="nav-action" :disabled="isRunning" @click="startNewRunSetup">New chat</button>
      <button class="nav-action muted">Search</button>

      <div class="sidebar-block projects-accordion">
        <div class="sidebar-label flex-between">
          <span>Projects</span>
          <button class="add-project-btn" title="Add Project" @click="openAddProjectModal">+</button>
        </div>
        <div class="project-list">
          <div
            v-for="project in projectOptions"
            :key="project.path"
            class="project-accordion-item"
            :class="{ active: project.path === activeProjectPath }"
          >
            <div 
              class="project-header"
              :class="{ active: project.path === activeProjectPath }"
              @click="selectProject(project.path)"
            >
              <span class="chevron-icon">{{ project.path === activeProjectPath ? '▼' : '▶' }}</span>
              <span class="project-name-text">{{ project.name }}</span>
              <button 
                class="delete-project-btn" 
                title="Remove Project" 
                @click="deleteProject(project.path, $event)"
              >
                ×
              </button>
            </div>

            <div v-if="project.path === activeProjectPath" class="project-chats-list">
              <div v-if="filteredRuns.length === 0" class="empty-sidebar">No chats in this project.</div>
              <button
                v-for="run in filteredRuns"
                :key="run.id"
                class="chat-history-item"
                :class="{ active: run.id === activeRunId }"
                @click="selectRun(run)"
              >
                <span>{{ run.title }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>

    <main class="chat-shell">
      <header class="chat-header">
        <div class="thread-title">
          <strong>{{ visibleTitle }}</strong>
          <span v-if="activeRun" class="status-pill" :class="statusClass(activeRun.status)">
            {{ statusLabel(activeRun.status) }}
          </span>
        </div>

        <div class="header-actions">
          <button v-if="isRunning" class="danger-button" @click="cancelActiveRun">Cancel</button>
        </div>
      </header>

      <section ref="messagesContainer" class="messages-scroll">
        <div v-if="!activeRun" class="empty-chat">
          <div class="welcome-gradient-logo">BM</div>
          <h1>BridgeMind</h1>
          <p>Select a model below and type a prompt to start a local or cloud chat session.</p>
        </div>

        <div v-else class="messages-inner">
          <article class="user-bubble">
            <pre>{{ activeRun.task }}</pre>
          </article>

          <template v-for="message in messages" :key="message.id">
            <!-- User message (continuation) -->
            <article v-if="message.role === 'user'" class="user-bubble">
              <pre>{{ message.content }}</pre>
            </article>

            <!-- Tool Invocation Block -->
            <article
              v-else-if="message.role === 'assistant' && message.rawResponse && hasToolCalls(message)"
              class="tool-log-block"
            >
              <header class="tool-log-header" @click="toggleMessageExpansion(message.id)">
                <span class="tool-log-title">
                  <i>🔧 Calling workspace tools...</i>
                </span>
                <span class="tool-log-toggle">
                  {{ expandedMessageIds[message.id] ? '▼' : '▶' }}
                </span>
              </header>
              <div v-if="expandedMessageIds[message.id]" class="tool-log-details">
                <pre class="faint-code">{{ formatJson(message.rawResponse) }}</pre>
              </div>
            </article>

            <!-- Tool Execution Result Block -->
            <article
              v-else-if="message.role === 'tool'"
              class="tool-log-block"
            >
              <header class="tool-log-header" @click="toggleMessageExpansion(message.id)">
                <span class="tool-log-title">
                  <i>{{ isToolSuccess(message.content) ? '✅' : '❌' }} Tool response</i>
                </span>
                <span class="tool-log-toggle">
                  {{ expandedMessageIds[message.id] ? '▼' : '▶' }}
                </span>
              </header>
              <div v-if="expandedMessageIds[message.id]" class="tool-log-details">
                <pre class="faint-code">{{ formatJson(message.content) }}</pre>
              </div>
            </article>

            <!-- Assistant message -->
            <article
              v-else-if="message.role === 'assistant'"
              class="assistant-message"
            >
              <div class="assistant-meta">
                <span class="agent-badge">AI Assistant</span>
                <span>{{ message.providerDisplayName }} / {{ message.model }}</span>
                <span>{{ formatTime(message.createdAt) }}</span>
              </div>
              <pre>{{ cleanMessageContent(message.content) }}</pre>
              <button class="copy-button" @click="copyText(message.content)">Copy</button>
            </article>
          </template>

          <div v-if="activeRun.status === 'failed'" class="system-line danger">
            {{ activeRun.errorMessage || 'Chat generation failed.' }}
          </div>

          <div v-if="isRunning" class="system-line active pulsing-loader">
            AI is thinking...
          </div>
        </div>
      </section>

      <footer class="composer-wrap">
        <div class="composer-container">
          <!-- Text Input Box -->
          <div class="composer-input-box">
            <textarea
              v-model="taskInput"
              :disabled="isRunning"
              placeholder="Type a message..."
              @keydown.enter.exact.prevent="handleSendTask"
            />
            <button 
              class="composer-send-icon-btn" 
              :disabled="isRunning || !taskInput.trim() || !selectedModelCombined"
              @click="handleSendTask"
              title="Send message"
            >
              <span class="send-arrow-icon">↩</span>
            </button>
          </div>

          <!-- Bottom Menu Row -->
          <div class="composer-menu-row">
            <!-- Left Side: Mode Pill with Popup Menu -->
            <div class="mode-selector-wrap">
              <button class="mode-pill-btn" @click.stop="showModeMenu = !showModeMenu">
                <span class="mode-pill-text">{{ getModeLabel(currentMode) }}</span>
                <span class="mode-pill-divider">|</span>
                <span class="mode-pill-icon-btn" @click.stop="handlePlusClick" title="Add">+</span>
                <span class="mode-pill-divider">|</span>
                <span class="mode-pill-icon-btn" @click.stop="handleMicClick" title="Voice Input">🎙️</span>
                <span class="mode-pill-divider">|</span>
                <span class="mode-pill-chevron">▼</span>
              </button>

              <!-- Mode Popup Menu -->
              <div v-if="showModeMenu" class="mode-popup-menu">
                <header class="mode-popup-header">
                  <span class="mode-popup-title">Mode</span>
                  <div class="mode-popup-icons">
                    <span>↕</span>
                    <span>⌘</span>
                    <span>M</span>
                  </div>
                </header>
                <ul class="mode-popup-list">
                  <li 
                    v-for="modeItem in modesList" 
                    :key="modeItem.id"
                    :class="{ active: currentMode === modeItem.id }"
                    @click.stop="selectMode(modeItem.id)"
                  >
                    <span class="mode-item-name">
                      <span class="checkmark-placeholder">
                        <span v-if="currentMode === modeItem.id">✓</span>
                      </span>
                      {{ modeItem.label }}
                    </span>
                    <span class="mode-item-shortcut">{{ modeItem.shortcut }}</span>
                  </li>
                  <li class="mode-popup-divider"></li>
                  <li @click.stop="toggleBypassPermissions">
                    <span class="mode-item-name">
                      <span class="checkmark-placeholder"></span>
                      Bypass permissions
                    </span>
                    <span class="bypass-toggle-badge" :class="{ enabled: bypassPermissions }">
                      {{ bypassPermissions ? 'Disable' : 'Enable' }}
                    </span>
                  </li>
                </ul>
              </div>
            </div>

            <!-- Right Side: Model Name, Parameter, and Status Ring -->
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
                    :class="{ active: selectedModelCombined === option.value }"
                    @click.stop="selectedModelCombined = option.value; showModelMenu = false"
                  >
                    {{ option.label }}
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
    </main>

    <!-- Add Project Modal -->
    <div v-if="showAddProjectModal" class="modal-overlay" @click.self="closeAddProjectModal">
      <div class="modal-card">
        <header class="modal-header">
          <h3>Add Project Folder</h3>
          <button class="close-modal-btn" @click="closeAddProjectModal">×</button>
        </header>
        
        <main class="modal-body">
          <div class="form-group" v-if="isMac">
            <button class="primary-button browse-btn" @click="handleBrowseFolder">
              📂 Select Folder (macOS Finder)
            </button>
            <div class="separator-text">or enter path manually</div>
          </div>
          
          <div class="form-group">
            <label for="project-path">Absolute Folder Path</label>
            <input 
              id="project-path" 
              type="text" 
              v-model="newProjectPath" 
              placeholder="/Users/username/Projects/my-app"
            />
          </div>
          
          <div class="form-group">
            <label for="project-name">Display Name (Optional)</label>
            <input 
              id="project-name" 
              type="text" 
              v-model="newProjectName" 
              placeholder="my-app"
            />
          </div>
        </main>
        
        <footer class="modal-footer">
          <button class="ghost-button" @click="closeAddProjectModal">Cancel</button>
          <button 
            class="primary-button" 
            :disabled="!newProjectPath.trim() || isSubmittingProject" 
            @click="submitNewProject"
          >
            {{ isSubmittingProject ? 'Adding...' : 'Add Project' }}
          </button>
        </footer>
      </div>
    </div>

    <!-- Permission Request Modal -->
    <div v-if="showPermissionModal && pendingPermissionRequest" class="modal-overlay">
      <div class="modal-card permission-modal-card">
        <header class="modal-header">
          <h3>📂 Permission Request</h3>
        </header>
        
        <main class="modal-body">
          <p class="permission-prompt-text">
            The agent is requesting permission to execute a tool:
          </p>
          <div class="tool-call-details-box">
            <div class="detail-row">
              <strong>Tool:</strong> <span>{{ pendingPermissionRequest.toolCall?.function?.name }}</span>
            </div>
            <div class="detail-row" v-if="pendingPermissionRequest.toolCall?.function?.arguments">
              <strong>Arguments:</strong>
              <pre class="permission-args-pre">{{ formatJson(pendingPermissionRequest.toolCall.function.arguments) }}</pre>
            </div>
          </div>
          <p class="permission-warning-info">
            Please select how you would like to handle this request:
          </p>
        </main>
        
        <footer class="modal-footer permission-footer">
          <div class="permission-button-grid">
            <button class="primary-button perm-btn green" @click="handlePermissionDecision('allow_once')">
              ✅ Allow now
            </button>
            <button class="primary-button perm-btn blue" @click="handlePermissionDecision('allow_project')">
              💼 Always allow in this project
            </button>
            <button class="primary-button perm-btn purple" @click="handlePermissionDecision('allow_always')">
              🌍 Always allow (Global)
            </button>
            <button class="danger-button perm-btn red" @click="handlePermissionDecision('deny')">
              ❌ Do not allow
            </button>
          </div>
        </footer>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Extra component level styles for visual wow factor */
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
  background: linear-gradient(135deg, #7bd88f, #9db7ff);
  color: #111111;
  box-shadow: 0 10px 25px rgba(123, 216, 143, 0.25);
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

.composer textarea:focus {
  border-color: #555;
}

.projects-accordion {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  margin-top: 14px;
}

.project-accordion-item {
  margin-bottom: 4px;
  border-radius: 8px;
  overflow: hidden;
}

.project-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 8px;
  color: var(--muted);
  cursor: pointer;
  user-select: none;
  transition: all 0.2s ease;
}

.project-header:hover {
  background: var(--sidebar-active);
  color: var(--text);
}

.project-header.active {
  color: var(--text);
  font-weight: 600;
}

.chevron-icon {
  font-size: 0.65rem;
  margin-right: 8px;
  color: var(--faint);
  display: inline-block;
  width: 10px;
}

.project-chats-list {
  padding-left: 10px;
  margin-top: 2px;
  border-left: 1px solid var(--border);
  margin-left: 14px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.project-header .delete-project-btn {
  background: transparent;
  color: var(--faint);
  font-size: 1.1rem;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
  border-radius: 4px;
  display: none;
  transition: all 0.2s ease;
}

.project-header:hover .delete-project-btn {
  display: block;
}

.project-header .delete-project-btn:hover {
  color: var(--danger);
  background: rgba(255, 138, 128, 0.15);
}

.tool-log-block {
  margin: 6px 0;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px dashed rgba(255, 255, 255, 0.05);
  font-size: 0.8rem;
  width: 100%;
}

.tool-log-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  color: var(--muted);
  transition: background 0.2s ease;
}

.tool-log-header:hover {
  background: rgba(255, 255, 255, 0.04);
}

.tool-log-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: var(--muted);
}

.tool-log-toggle {
  font-size: 0.65rem;
  color: var(--faint);
}

.tool-log-details {
  padding: 10px 12px;
  background: #141414;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  overflow-x: auto;
}

.faint-code {
  font-family: monospace;
  font-size: 0.75rem;
  color: var(--muted);
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
}

/* Bottom Panel and Split Content Styling */
.main-content-split {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  position: relative;
}

.bottom-panel {
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-top: 1px solid var(--border);
  transition: height 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  flex-shrink: 0;
  height: 320px;
}

.bottom-panel.collapsed {
  height: 41px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 16px;
  background: var(--surface-strong);
  border-bottom: 1px solid var(--border);
  user-select: none;
}

.bottom-panel.collapsed .panel-header {
  border-bottom: none;
}

.panel-tabs {
  display: flex;
  gap: 4px;
  height: 100%;
  align-items: center;
}

.tab-btn {
  background: transparent;
  color: var(--muted);
  padding: 6px 12px;
  font-size: 0.85rem;
  font-weight: 500;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 6px;
}

.tab-btn:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.05);
}

.tab-btn.active {
  color: var(--text);
  background: rgba(255, 255, 255, 0.1);
  font-weight: 600;
}

.panel-collapse-btn {
  background: transparent;
  color: var(--faint);
  font-size: 0.8rem;
  cursor: pointer;
  padding: 6px 10px;
  border-radius: 6px;
  transition: all 0.2s ease;
}

.panel-collapse-btn:hover {
  color: var(--muted);
  background: rgba(255, 255, 255, 0.05);
}

.panel-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

.tab-content {
  height: 100%;
  overflow: hidden;
  padding: 16px;
}

.plan-content {
  color: #deded8;
  font-size: 0.9rem;
  line-height: 1.6;
}

.formatted-text {
  font-family: inherit;
  white-space: pre-wrap;
  word-break: break-word;
  padding-right: 8px;
  margin: 0;
}

.panel-empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--faint);
  font-style: italic;
  font-size: 0.9rem;
}

.build-content {
  overflow-y: auto;
}

.build-split {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
  height: 100%;
}

@media (min-width: 768px) {
  .build-split {
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  }
}

.files-list-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  max-height: 100%;
  overflow-y: auto;
}

.files-list-section h4 {
  margin: 0 0 4px 0;
  font-size: 0.85rem;
  text-transform: uppercase;
  color: var(--muted);
  letter-spacing: 0.5px;
}

.files-log {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.files-log li {
  font-family: monospace;
  font-size: 0.8rem;
  color: var(--success);
  word-break: break-all;
  padding: 4px 8px;
  background: rgba(123, 216, 143, 0.05);
  border-left: 3px solid var(--success);
  border-radius: 2px 4px 4px 2px;
}

.code-blocks-section {
  max-height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.extracted-code-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #141414;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.code-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  background: var(--surface-strong);
  border-bottom: 1px solid var(--border);
  font-size: 0.75rem;
  color: var(--muted);
  font-weight: 600;
}

.copy-code-btn {
  background: transparent;
  color: var(--faint);
  cursor: pointer;
  font-size: 0.75rem;
  padding: 2px 6px;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.copy-code-btn:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.05);
}

.code-card-body {
  padding: 12px;
  margin: 0;
  font-family: monospace;
  font-size: 0.8rem;
  color: #e8e8e3;
  overflow-x: auto;
  white-space: pre;
}

/* Premium Composer Styling */
.composer-container {
  width: min(880px, 100%);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
}

.composer-input-box {
  position: relative;
  background: #1a1a1c;
  border: 1px solid #2d2d30;
  border-radius: 12px;
  padding: 10px 48px 10px 14px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.composer-input-box:focus-within {
  border-color: #444;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35);
}

.composer-input-box textarea {
  display: block;
  width: 100%;
  min-height: 44px;
  max-height: 180px;
  resize: vertical;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text);
  font-size: 0.95rem;
  line-height: 1.5;
  padding: 0;
  margin: 0;
}

.composer-send-icon-btn {
  position: absolute;
  bottom: 12px;
  right: 12px;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--faint);
  border: 0;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  padding: 0;
}

.composer-send-icon-btn:hover:not(:disabled) {
  color: var(--text);
  background: rgba(255, 255, 255, 0.05);
}

.send-arrow-icon {
  font-size: 1.15rem;
  line-height: 1;
}

.composer-menu-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 10px;
  padding: 0 4px;
}

/* Mode Selector & Pill */
.mode-selector-wrap {
  position: relative;
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

.mode-pill-divider {
  color: #2d2d30;
  font-weight: 300;
  user-select: none;
}

.mode-pill-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  transition: background 0.2s, color 0.2s;
  color: var(--faint);
}

.mode-pill-icon-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text);
}

.mode-pill-chevron {
  font-size: 0.55rem;
  color: var(--faint);
  margin-left: 2px;
}

/* Mode Popup Menu Card */
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

.mode-popup-icons {
  display: flex;
  gap: 6px;
  color: var(--faint);
  font-size: 0.72rem;
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

.checkmark-placeholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  font-size: 0.8rem;
  color: var(--success);
  font-weight: bold;
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

/* Status & Model Selection Row */
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
  width: 260px;
  max-height: 220px;
  overflow-y: auto;
  background: #161618;
  border: 1px solid #2d2d30;
  border-radius: 10px;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.55);
  z-index: 1000;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.model-dropdown-item {
  padding: 8px 12px;
  border-radius: 6px;
  color: var(--muted);
  font-size: 0.82rem;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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

@keyframes pulseDot {
  0% { transform: scale(0.85); opacity: 0.6; }
  100% { transform: scale(1.15); opacity: 1; }
}
</style>
