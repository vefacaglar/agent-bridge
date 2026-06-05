<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { ProviderMetadata, Run, RunMessage, RunStatus, Project } from '@bridgemind/shared';

const API_BASE = 'http://localhost:3000';

const providers = ref<ProviderMetadata[]>([]);
const runs = ref<Run[]>([]);
const activeRunId = ref<string | null>(null);
const activeRun = ref<Run | null>(null);
const messages = ref<RunMessage[]>([]);

const selectedModelCombined = ref(localStorage.getItem('bm_selected_model') || '');
const taskInput = ref('');
const activeProjectPath = ref('/Users/vefa/Projects/agent-bridge');

const isRunning = ref(false);

const projects = ref<Project[]>([]);
const showAddProjectModal = ref(false);
const newProjectName = ref('');
const newProjectPath = ref('');

const isSubmittingProject = ref(false);

watch(selectedModelCombined, (newVal) => {
  if (newVal) localStorage.setItem('bm_selected_model', newVal);
});

const isMac = computed(() => {
  return navigator.userAgent.toLowerCase().includes('mac') || navigator.platform.toLowerCase().includes('mac');
});

let eventSource: EventSource | null = null;

const activeStatuses: RunStatus[] = ['created', 'generating'];

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
        model: modelInfo.model
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
        model: modelInfo.model
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

onMounted(async () => {
  await loadProviders();
  await loadProjects();
  await loadRuns();
  if (runs.value.length > 0) {
    await selectRun(runs.value[0]);
  } else if (projectOptions.value.length > 0) {
    activeProjectPath.value = projectOptions.value[0].path;
  }
});

onBeforeUnmount(() => {
  eventSource?.close();
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

      <section class="messages-scroll">
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

            <!-- Assistant message -->
            <article
              v-else
              class="assistant-message"
            >
              <div class="assistant-meta">
                <span class="agent-badge">AI Assistant</span>
                <span>{{ message.providerDisplayName }} / {{ message.model }}</span>
                <span>{{ formatTime(message.createdAt) }}</span>
              </div>
              <pre>{{ message.content }}</pre>
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
        <div class="composer">
          <textarea
            v-model="taskInput"
            :disabled="isRunning"
            placeholder="Type a message..."
            @keydown.enter.exact.prevent="handleSendTask"
          />

          <div class="composer-footer">
            <div class="model-picks">
              <label class="model-pill">
                <span>Model</span>
                <select v-model="selectedModelCombined" :disabled="isRunning">
                  <option v-for="option in modelOptions" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
              </label>
            </div>

            <button
              class="send-button"
              :disabled="isRunning || !taskInput.trim() || !selectedModelCombined"
              @click="handleSendTask"
              aria-label="Send message"
            >
              ↑
            </button>
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
</style>
