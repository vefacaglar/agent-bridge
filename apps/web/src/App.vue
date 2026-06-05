<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { ProviderMetadata, Run, RunMessage, RunStatus, Project } from '@bridgemind/shared';

const API_BASE = 'http://localhost:3000';

const providers = ref<ProviderMetadata[]>([]);
const runs = ref<Run[]>([]);
const activeRunId = ref<string | null>(null);
const activeRun = ref<Run | null>(null);
const messages = ref<RunMessage[]>([]);

const selectedPlannerCombined = ref('');
const selectedCoderCombined = ref('');
const maxRounds = ref(3);
const taskInput = ref('');
const activeProjectPath = ref('/Users/vefa/Projects/agent-bridge');

const isRunning = ref(false);
const finalOutput = ref('');

const projects = ref<Project[]>([]);
const showAddProjectModal = ref(false);
const newProjectName = ref('');
const newProjectPath = ref('');
const isMac = computed(() => {
  return navigator.userAgent.toLowerCase().includes('mac') || navigator.platform.toLowerCase().includes('mac');
});
const isSubmittingProject = ref(false);

let eventSource: EventSource | null = null;

const activeStatuses: RunStatus[] = ['created', 'planning', 'implementing', 'reviewing', 'fixing'];

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

const plannerMessage = computed(() => messages.value.find(message => message.agentRole === 'planner'));
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
    planning: 'planning',
    implementing: 'executing',
    reviewing: 'reviewing',
    fixing: 'fixing',
    done: 'accepted',
    failed: 'failed',
    cancelled: 'cancelled',
    max_rounds_reached: 'max rounds'
  };
  return labels[status];
}

function statusClass(status?: RunStatus): string {
  if (!status) return 'idle';
  if (status === 'done') return 'success';
  if (status === 'failed' || status === 'cancelled' || status === 'max_rounds_reached') return 'danger';
  if (activeStatuses.includes(status)) return 'active';
  return 'idle';
}

function roleLabel(message: RunMessage): string {
  if (message.agentRole === 'planner') return 'Planner';
  if (message.agentRole === 'reviewer') return 'Planner review';
  if (message.agentRole === 'coder') return 'Executor';
  return 'Message';
}

function roleClass(message: RunMessage): string {
  if (message.agentRole === 'coder') return 'executor';
  if (message.agentRole === 'reviewer') return 'reviewer';
  return 'planner';
}

function reviewMarker(content: string): string {
  if (content.includes('FINAL_ACCEPTED')) return 'accepted';
  if (content.includes('CHANGES_REQUIRED')) return 'changes requested';
  return 'review';
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
  selectedPlannerCombined.value ||= modelOptions.value.find(option => option.providerId === 'anthropic')?.value || modelOptions.value[0].value;
  selectedCoderCombined.value ||= modelOptions.value.find(option => option.providerId === 'opencode')?.value || modelOptions.value[0].value;
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
  finalOutput.value = run.finalOutput || '';

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
  finalOutput.value = '';
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
      finalOutput.value = data.finalOutput;
      if (activeRun.value?.id === runId) {
        activeRun.value.finalOutput = data.finalOutput;
      }
      finishEventStream();
    }

    if (data.type === 'run_failed') {
      if (activeRun.value?.id === runId) {
        activeRun.value.errorMessage = data.errorMessage;
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
  if (!taskInput.value.trim() || isRunning.value || !selectedPlannerCombined.value || !selectedCoderCombined.value) return;

  const planner = splitCombined(selectedPlannerCombined.value);
  const coder = splitCombined(selectedCoderCombined.value);

  isRunning.value = true;
  messages.value = [];
  finalOutput.value = '';

  const response = await fetch(`${API_BASE}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      task: taskInput.value,
      projectPath: activeProject.value?.path,
      projectName: activeProject.value?.name,
      plannerProviderId: planner.providerId,
      plannerModel: planner.model,
      coderProviderId: coder.providerId,
      coderModel: coder.model,
      maxRounds: maxRounds.value
    })
  });

  if (!response.ok) {
    isRunning.value = false;
    const error = await response.json();
    window.alert(error.error || 'Run baslatilamadi.');
    return;
  }

  const run = await response.json() as Run;
  activeRunId.value = run.id;
  activeRun.value = run;
  runs.value.unshift(run);
  connectEventSource(run.id);
}

async function cancelActiveRun() {
  if (!activeRunId.value || !isRunning.value) return;
  const response = await fetch(`${API_BASE}/api/runs/${activeRunId.value}/cancel`, { method: 'POST' });
  if (response.ok) {
    updateRunStatus(activeRunId.value, 'cancelled');
    finishEventStream();
  }
}

async function duplicateRun() {
  if (!activeRun.value || isRunning.value) return;

  const planner = splitCombined(selectedPlannerCombined.value);
  const coder = splitCombined(selectedCoderCombined.value);

  await startDerivedRun(`/api/runs/${activeRun.value.id}/duplicate`, {
    plannerProviderId: planner.providerId,
    plannerModel: planner.model,
    coderProviderId: coder.providerId,
    coderModel: coder.model,
    maxRounds: maxRounds.value
  });
}

async function retryCoder() {
  if (!activeRun.value || isRunning.value) return;

  const coder = splitCombined(selectedCoderCombined.value);

  await startDerivedRun(`/api/runs/${activeRun.value.id}/retry-coder`, {
    coderProviderId: coder.providerId,
    coderModel: coder.model,
    maxRounds: maxRounds.value
  });
}

async function startDerivedRun(path: string, payload: Record<string, unknown>) {
  isRunning.value = true;
  messages.value = [];
  finalOutput.value = '';

  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    isRunning.value = false;
    const error = await response.json();
    window.alert(error.error || 'Run olusturulamadi.');
    return;
  }

  const run = await response.json() as Run;
  activeRunId.value = run.id;
  activeRun.value = run;
  activeProjectPath.value = run.projectPath || activeProjectPath.value;
  taskInput.value = '';
  runs.value.unshift(run);
  connectEventSource(run.id);
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

      <div class="sidebar-block">
        <div class="sidebar-label flex-between">
          <span>Projects</span>
          <button class="add-project-btn" title="Add Project" @click="openAddProjectModal">+</button>
        </div>
        <div class="project-list">
          <button
            v-for="project in projectOptions"
            :key="project.path"
            class="project-item"
            :class="{ active: project.path === activeProjectPath }"
            @click="selectProject(project.path)"
          >
            <span class="project-name-text">{{ project.name }}</span>
            <button 
              class="delete-project-btn" 
              title="Remove Project" 
              @click="deleteProject(project.path, $event)"
            >
              ×
            </button>
          </button>
        </div>
      </div>


      <div class="sidebar-block runs-block">
        <div class="sidebar-label">{{ activeProject?.name || 'Project' }} chats</div>
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
          <template v-else-if="activeRun">
            <button class="ghost-button" @click="duplicateRun">Duplicate</button>
            <button v-if="plannerMessage" class="ghost-button" @click="retryCoder">Retry executor</button>
          </template>
        </div>
      </header>

      <section class="messages-scroll">
        <div v-if="!activeRun" class="empty-chat">
          <h1>BridgeMind</h1>
          <p>Planner ve executor modellerini sec, tek mesajla kontrollu bir iki-agent run baslat.</p>
        </div>

        <div v-else class="messages-inner">
          <article class="user-bubble">
            <pre>{{ activeRun.task }}</pre>
          </article>

          <div v-if="activeRun.status === 'failed'" class="system-line danger">
            {{ activeRun.errorMessage || 'Run failed.' }}
          </div>

          <article
            v-for="message in messages"
            :key="message.id"
            class="assistant-message"
            :class="roleClass(message)"
          >
            <div class="assistant-meta">
              <span class="agent-badge">{{ roleLabel(message) }}</span>
              <span>{{ message.providerDisplayName }} / {{ message.model }}</span>
              <span>{{ formatTime(message.createdAt) }}</span>
              <span v-if="message.agentRole === 'reviewer'" class="review-pill">
                {{ reviewMarker(message.content) }}
              </span>
            </div>
            <pre>{{ message.content }}</pre>
            <button class="copy-button" @click="copyText(message.content)">Copy</button>
          </article>

          <div
            v-if="activeRun.status === 'done' || activeRun.status === 'max_rounds_reached' || activeRun.status === 'cancelled'"
            class="system-line"
            :class="statusClass(activeRun.status)"
          >
            {{ statusLabel(activeRun.status) }}
          </div>
        </div>
      </section>

      <footer class="composer-wrap">
        <div class="composer">
          <textarea
            v-model="taskInput"
            :disabled="isRunning"
            placeholder="Planner ve executor'a yaptirmak istedigin isi yaz..."
            @keydown.enter.exact.prevent="handleSendTask"
          />

          <div class="composer-footer">
            <div class="model-picks">
              <label class="model-pill">
                <span>Planner</span>
                <select v-model="selectedPlannerCombined" :disabled="isRunning">
                  <option v-for="option in modelOptions" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
              </label>

              <label class="model-pill">
                <span>Executor</span>
                <select v-model="selectedCoderCombined" :disabled="isRunning">
                  <option v-for="option in modelOptions" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
              </label>

              <label class="round-pill">
                <span>Rounds</span>
                <input v-model.number="maxRounds" :disabled="isRunning" type="number" min="1" max="10" />
              </label>
            </div>

            <button
              class="send-button"
              :disabled="isRunning || !taskInput.trim() || !selectedPlannerCombined || !selectedCoderCombined"
              @click="handleSendTask"
              aria-label="Run workflow"
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
