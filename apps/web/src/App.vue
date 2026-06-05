<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { ProviderMetadata, Run, RunMessage, RunStatus } from '@bridgemind/shared';

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

const isRunning = ref(false);
const finalOutput = ref('');
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
  taskInput.value = '';
  runs.value.unshift(run);
  connectEventSource(run.id);
}

function copyText(value: string) {
  navigator.clipboard.writeText(value);
}

onMounted(async () => {
  await loadProviders();
  await loadRuns();
  if (runs.value.length > 0) {
    await selectRun(runs.value[0]);
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
        <div class="sidebar-label">Project</div>
        <div class="project-name">agent-bridge</div>
      </div>

      <div class="sidebar-block runs-block">
        <div class="sidebar-label">Chats</div>
        <div v-if="runs.length === 0" class="empty-sidebar">No runs yet.</div>
        <button
          v-for="run in runs"
          :key="run.id"
          class="chat-history-item"
          :class="{ active: run.id === activeRunId }"
          @click="selectRun(run)"
        >
          <span>{{ run.title }}</span>
          <small>{{ statusLabel(run.status) }}</small>
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
  </div>
</template>
