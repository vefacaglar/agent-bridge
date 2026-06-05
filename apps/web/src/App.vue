<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue';
import type { Run, RunStatus, RunMessage, ProviderMetadata } from '@bridgemind/shared';

const API_BASE = 'http://localhost:3000';

// API Loaded States
const providers = ref<ProviderMetadata[]>([]);
const runs = ref<Run[]>([]);
const activeRunId = ref<string | null>(null);
const activeRun = ref<Run | null>(null);
const messages = ref<RunMessage[]>([]);

// Selection Dropdowns Combined Values (providerId:modelName)
const selectedPlannerCombined = ref('');
const selectedCoderCombined = ref('');
const maxRounds = ref(3);
const taskInput = ref('Create a simple node script that parses JSON safely.');

// Runtime States
const isRunning = ref(false);
const finalOutputCode = ref('');
let eventSource: EventSource | null = null;

// UI Tabs State
const activeTab = ref<'overview' | 'review' | 'code'>('code');

// Formats UTC string to local time representation
function formatTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return '';
  }
}

// Flat list of model options for dropdown selectors
const modelOptions = computed(() => {
  const options: { value: string; label: string; providerId: string }[] = [];
  for (const p of providers.value) {
    for (const m of p.models) {
      options.push({
        value: `${p.id}:${m}`,
        label: `${p.displayName} — ${m}`,
        providerId: p.id
      });
    }
  }
  return options;
});

// Human readable model name computation
const selectedPlannerName = computed(() => {
  if (!selectedPlannerCombined.value) return 'Select Planner';
  const opt = modelOptions.value.find(o => o.value === selectedPlannerCombined.value);
  return opt ? opt.label : 'Select Planner';
});

const selectedCoderName = computed(() => {
  if (!selectedCoderCombined.value) return 'Select Coder';
  const opt = modelOptions.value.find(o => o.value === selectedCoderCombined.value);
  return opt ? opt.label : 'Select Coder';
});

// Filter reviewer feedbacks
const reviewerMessages = computed(() => {
  return messages.value.filter(m => m.agentRole === 'reviewer');
});

// Reset form values to trigger a clean run
function startNewRunSetup() {
  if (isRunning.value) return;
  activeRunId.value = null;
  activeRun.value = null;
  messages.value = [];
  finalOutputCode.value = '';
  taskInput.value = '';
}

// Chronological chat feed containing both message bubbles and system logs
interface FeedItem {
  type: 'system' | 'message';
  id: string;
  text?: string;
  time: string;
  message?: RunMessage;
  status?: string;
}

const feedItems = computed<FeedItem[]>(() => {
  const items: FeedItem[] = [];
  if (!activeRun.value) return items;

  // Sort messages by creation date
  const sortedMsgs = [...messages.value].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  let currentRoundInFeed = 0;
  for (const msg of sortedMsgs) {
    // Round change event
    if (msg.agentRole === 'coder') {
      currentRoundInFeed++;
      items.push({
        type: 'system',
        id: `sys-round-${msg.id}`,
        text: `Round ${currentRoundInFeed} / ${activeRun.value.maxRounds} started`,
        time: formatTime(msg.createdAt)
      });
    }

    // Reviewer trigger event
    if (msg.agentRole === 'reviewer') {
      items.push({
        type: 'system',
        id: `sys-review-${msg.id}`,
        text: 'Orchestrator invoking Planner for code review...',
        time: formatTime(msg.createdAt)
      });
    }

    items.push({
      type: 'message',
      id: msg.id,
      time: formatTime(msg.createdAt),
      message: msg
    });
  }

  // 2. Final state system message
  if (activeRun.value.status === 'done') {
    items.push({
      type: 'system',
      id: 'sys-done',
      text: 'Orchestration completed successfully.',
      time: formatTime(activeRun.value.updatedAt),
      status: 'done'
    });
  } else if (activeRun.value.status === 'failed') {
    items.push({
      type: 'system',
      id: 'sys-failed',
      text: `Run failed: ${activeRun.value.errorMessage || 'Unknown error'}`,
      time: formatTime(activeRun.value.updatedAt),
      status: 'failed'
    });
  } else if (activeRun.value.status === 'cancelled') {
    items.push({
      type: 'system',
      id: 'sys-cancelled',
      text: 'Orchestration cancelled by user.',
      time: formatTime(activeRun.value.updatedAt),
      status: 'cancelled'
    });
  } else if (activeRun.value.status === 'max_rounds_reached') {
    items.push({
      type: 'system',
      id: 'sys-max',
      text: 'Loop stopped: Maximum rounds reached without acceptance.',
      time: formatTime(activeRun.value.updatedAt),
      status: 'max_rounds_reached'
    });
  }

  return items;
});

// Load providers list
async function loadProviders() {
  try {
    const res = await fetch(`${API_BASE}/api/providers`);
    if (res.ok) {
      providers.value = await res.json();
      // Set default models if options exist
      if (modelOptions.value.length > 0) {
        if (!selectedPlannerCombined.value) {
          const anthropicOpt = modelOptions.value.find(o => o.providerId === 'anthropic');
          selectedPlannerCombined.value = anthropicOpt ? anthropicOpt.value : modelOptions.value[0].value;
        }
        if (!selectedCoderCombined.value) {
          const openCodeOpt = modelOptions.value.find(o => o.providerId === 'opencode');
          selectedCoderCombined.value = openCodeOpt ? openCodeOpt.value : modelOptions.value[0].value;
        }
      }
    }
  } catch (err) {
    console.error('Failed to load providers:', err);
  }
}

// Load runs list
async function loadRuns() {
  try {
    const res = await fetch(`${API_BASE}/api/runs`);
    if (res.ok) {
      runs.value = await res.json();
    }
  } catch (err) {
    console.error('Failed to load runs history:', err);
  }
}

// Load messages for specific run
async function loadMessages(runId: string) {
  try {
    const res = await fetch(`${API_BASE}/api/runs/${runId}/messages`);
    if (res.ok) {
      messages.value = await res.json();
    }
  } catch (err) {
    console.error(`Failed to load messages for run ${runId}:`, err);
  }
}

// Select a run from history sidebar
async function selectRun(run: Run) {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
    isRunning.value = false;
  }

  activeRunId.value = run.id;
  activeRun.value = run;
  finalOutputCode.value = run.finalOutput || '';
  
  // Set tab automatically
  if (run.finalOutput) {
    activeTab.value = 'code';
  } else {
    activeTab.value = 'overview';
  }

  await loadMessages(run.id);

  // If the selected run is still active, connect to the event stream!
  const activeStatuses: RunStatus[] = ['created', 'planning', 'implementing', 'reviewing', 'fixing'];
  if (activeStatuses.includes(run.status)) {
    isRunning.value = true;
    connectEventSource(run.id);
  }
}

// Establish Server-Sent Events connection for a run
function connectEventSource(runId: string) {
  if (eventSource) eventSource.close();

  eventSource = new EventSource(`${API_BASE}/api/runs/${runId}/events`);

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'connected') return;

      if (data.type === 'run_started') {
        if (activeRun.value && activeRun.value.id === runId) {
          activeRun.value.status = 'planning';
        }
      } else if (data.type === 'status_changed') {
        if (activeRun.value && activeRun.value.id === runId) {
          activeRun.value.status = data.status;
        }
        // Update runs history list
        const idx = runs.value.findIndex(r => r.id === runId);
        if (idx !== -1) {
          runs.value[idx].status = data.status;
        }
      } else if (data.type === 'message_created') {
        if (activeRun.value && activeRun.value.id === runId) {
          // Avoid duplicates
          if (!messages.value.some(m => m.id === data.message.id)) {
            messages.value.push(data.message);
          }
        }
      } else if (data.type === 'run_completed') {
        if (activeRun.value && activeRun.value.id === runId) {
          activeRun.value.finalOutput = data.finalOutput;
          finalOutputCode.value = data.finalOutput;
        }
        activeTab.value = 'code'; // Auto switch to code
        eventSource?.close();
        eventSource = null;
        isRunning.value = false;
        loadRuns(); // Refresh all
      } else if (data.type === 'run_failed') {
        if (activeRun.value && activeRun.value.id === runId) {
          activeRun.value.errorMessage = data.errorMessage;
        }
        eventSource?.close();
        eventSource = null;
        isRunning.value = false;
        loadRuns(); // Refresh all
      }
    } catch (err) {
      console.error('Failed to parse run event stream data:', err);
    }
  };

  eventSource.onerror = (err) => {
    console.warn('EventSource connection error, closing...', err);
    eventSource?.close();
    eventSource = null;
    isRunning.value = false;
  };
}

// Trigger background run creation
async function handleSendTask() {
  if (!taskInput.value.trim() || isRunning.value) return;

  const [plannerProviderId, plannerModel] = selectedPlannerCombined.value.split(':');
  const [coderProviderId, coderModel] = selectedCoderCombined.value.split(':');

  try {
    isRunning.value = true;
    finalOutputCode.value = '';
    messages.value = [];
    activeTab.value = 'overview';

    const res = await fetch(`${API_BASE}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: taskInput.value,
        plannerProviderId,
        plannerModel,
        coderProviderId,
        coderModel,
        maxRounds: maxRounds.value
      })
    });

    if (res.ok) {
      const runData = await res.json() as Run;
      activeRunId.value = runData.id;
      activeRun.value = runData;

      // Add to local runs history list
      runs.value.unshift(runData);

      // Connect EventSource to receive live streaming events
      connectEventSource(runData.id);
    } else {
      isRunning.value = false;
      const errData = await res.json();
      alert(`Error starting run: ${errData.error || 'Unknown error'}`);
    }
  } catch (err: any) {
    isRunning.value = false;
    alert(`Network error: ${err.message}`);
  }
}

// Cancel a running orchestration job
async function cancelActiveRun() {
  if (!activeRunId.value || !isRunning.value) return;

  try {
    const res = await fetch(`${API_BASE}/api/runs/${activeRunId.value}/cancel`, {
      method: 'POST'
    });

    if (res.ok) {
      if (activeRun.value) {
        activeRun.value.status = 'cancelled';
      }
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      isRunning.value = false;
      loadRuns();
    } else {
      const errData = await res.json();
      alert(`Cancellation failed: ${errData.error}`);
    }
  } catch (err: any) {
    alert(`Network error during cancel: ${err.message}`);
  }
}

// Duplicate a run with selectable planner/coder configuration
async function duplicateRun() {
  if (!activeRun.value || isRunning.value) return;
  const runId = activeRun.value.id;

  const [plannerProviderId, plannerModel] = selectedPlannerCombined.value.split(':');
  const [coderProviderId, coderModel] = selectedCoderCombined.value.split(':');

  try {
    isRunning.value = true;
    finalOutputCode.value = '';
    messages.value = [];
    activeTab.value = 'overview';

    const res = await fetch(`${API_BASE}/api/runs/${runId}/duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plannerProviderId,
        plannerModel,
        coderProviderId,
        coderModel,
        maxRounds: maxRounds.value
      })
    });

    if (res.ok) {
      const runData = await res.json() as Run;
      activeRunId.value = runData.id;
      activeRun.value = runData;
      runs.value.unshift(runData);
      connectEventSource(runData.id);
    } else {
      isRunning.value = false;
      const errData = await res.json();
      alert(`Duplication failed: ${errData.error}`);
    }
  } catch (err: any) {
    isRunning.value = false;
    alert(`Network error during duplicate: ${err.message}`);
  }
}

// Retry coder on the same task and planner plan, but with different coder model
async function retryCoder() {
  if (!activeRun.value || isRunning.value) return;
  const runId = activeRun.value.id;

  const [coderProviderId, coderModel] = selectedCoderCombined.value.split(':');

  try {
    isRunning.value = true;
    finalOutputCode.value = '';
    messages.value = [];
    activeTab.value = 'overview';

    const res = await fetch(`${API_BASE}/api/runs/${runId}/retry-coder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        coderProviderId,
        coderModel,
        maxRounds: maxRounds.value
      })
    });

    if (res.ok) {
      const runData = await res.json() as Run;
      activeRunId.value = runData.id;
      activeRun.value = runData;
      runs.value.unshift(runData);
      connectEventSource(runData.id);
    } else {
      isRunning.value = false;
      const errData = await res.json();
      alert(`Coder retry failed: ${errData.error}`);
    }
  } catch (err: any) {
    isRunning.value = false;
    alert(`Network error during retry: ${err.message}`);
  }
}

// Copy finalized code to clipboard
const copyCode = () => {
  navigator.clipboard.writeText(finalOutputCode.value);
};

onMounted(async () => {
  await loadProviders();
  await loadRuns();
  // If history list has items, auto-select the latest one
  if (runs.value.length > 0) {
    selectRun(runs.value[0]);
  }
});

onBeforeUnmount(() => {
  if (eventSource) {
    eventSource.close();
  }
});
</script>

<template>
  <div class="app-layout">
    <!-- Left Sidebar: Run Setup and List -->
    <aside class="sidebar-left">
      <div class="sidebar-header">
        <span class="brand">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--planner-color)">
            <polyline points="16 18 22 12 16 6"></polyline>
            <polyline points="8 6 2 12 8 18"></polyline>
          </svg>
          BridgeMind
        </span>
      </div>

      <!-- + New Run Action -->
      <button @click="startNewRunSetup" class="btn-new-run" :disabled="isRunning">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        New Run Setup
      </button>
      
      <div class="sidebar-scroll">
        <!-- Configuration settings (Max Rounds) -->
        <div>
          <h2 class="sidebar-section-title">Settings</h2>
          <div style="padding: 0 0.5rem; display: flex; flex-direction: column; gap: 0.75rem;">
            <div class="form-group">
              <label class="form-label">Max Loop Rounds</label>
              <input v-model.number="maxRounds" type="number" class="form-input" min="1" max="10" :disabled="isRunning" style="background-color: rgba(255,255,255,0.02); border-color: rgba(255,255,255,0.05);" />
            </div>
          </div>
        </div>

        <!-- Run History Section -->
        <div>
          <h2 class="sidebar-section-title">Run History</h2>
          <div class="history-list">
            <div v-if="runs.length === 0" style="font-size: 0.8rem; color: var(--text-muted); text-align: center; padding: 1rem;">
              No history found.
            </div>
            <div 
              v-for="run in runs" 
              :key="run.id" 
              class="history-item"
              :class="{ active: run.id === activeRunId }"
              @click="selectRun(run)"
            >
              <div class="history-title">{{ run.title }}</div>
              <div class="history-meta">
                <span>{{ run.plannerModel.split('-')[0] }} ➔ {{ run.coderModel.split('-')[0] }}</span>
                <span class="badge" :style="{
                  backgroundColor: run.status === 'done' ? 'rgba(16, 185, 129, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                  color: run.status === 'done' ? 'var(--success-color)' : (run.status === 'failed' ? 'var(--error-color)' : 'var(--text-secondary)')
                }">
                  {{ run.status }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer Gear Button -->
      <div class="sidebar-footer">
        <button class="msg-action-btn" title="Settings">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </button>
        <span style="font-size: 0.75rem; color: var(--text-muted); margin-left: 0.5rem;">Settings</span>
      </div>
    </aside>

    <!-- Center Workspace: Chat View -->
    <section class="chat-container">
      <!-- Chat Header -->
      <header class="chat-header">
        <div v-if="activeRun">
          <span class="chat-header-title">BridgeMind / {{ activeRun.id }}</span>
        </div>
        <div v-else>
          <span class="chat-header-title">Create a new run</span>
        </div>
        
        <div v-if="activeRun" style="display: flex; align-items: center; gap: 0.5rem;">
          <button v-if="isRunning" @click="cancelActiveRun" class="btn btn-secondary" style="border-color: var(--error-color); color: var(--error-color); font-size: 0.75rem; padding: 0.25rem 0.50rem;">
            Cancel Run
          </button>
          <template v-else-if="activeRun.status !== 'created'">
            <button @click="duplicateRun" class="btn btn-secondary" style="font-size: 0.75rem; padding: 0.25rem 0.50rem;">
              Duplicate Run
            </button>
            <button v-if="messages.some(m => m.agentRole === 'planner')" @click="retryCoder" class="btn btn-secondary" style="font-size: 0.75rem; padding: 0.25rem 0.50rem;">
              Retry Coder
            </button>
          </template>
        </div>
      </header>

      <!-- Top Error Banner -->
      <div v-if="activeRun && activeRun.status === 'failed'" class="error-banner">
        <svg class="error-banner-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <div class="error-banner-content">
          <strong>Run Failed:</strong> {{ activeRun.errorMessage || 'An error occurred during execution.' }}
        </div>
      </div>

      <!-- Chat Feed scroll -->
      <div class="chat-feed">
        <div v-if="!activeRun" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); text-align: center; gap: 0.5rem;">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="9" y1="3" x2="9" y2="21"></line>
          </svg>
          <span style="font-size: 0.85rem;">Specify a task, lock models, and run orchestration.</span>
        </div>

        <div 
          v-else
          v-for="item in feedItems" 
          :key="item.id" 
          class="chat-feed-row"
        >
          <!-- System event log badges -->
          <div v-if="item.type === 'system'" class="system-event" :class="item.status">
            <span class="system-event-indicator"></span>
            <span>{{ item.text }}</span>
          </div>

          <!-- Message Card Bubbles (User is card box, Assistant is printed direct) -->
          <div 
            v-else-if="item.message" 
            class="chat-bubble-row" 
            :class="{ 'user-row': item.message.role === 'user', 'assistant-row': item.message.role !== 'user' }"
          >
            <!-- User message bubble -->
            <div v-if="item.message.role === 'user'" class="message-bubble user-bubble">
              <div class="bubble-main">
                <div class="bubble-header">
                  <span class="bubble-author">User</span>
                  <span>{{ item.time }}</span>
                </div>
                <div class="bubble-body">{{ item.message.content }}</div>
              </div>
            </div>

            <!-- Assistant direct borderless layout -->
            <template v-else>
              <div class="assistant-msg-header">
                <div class="assistant-msg-avatar" :class="item.message.agentRole">
                  {{ item.message.agentRole === 'planner' || item.message.agentRole === 'reviewer' ? 'P' : 'C' }}
                </div>
                <span>
                  {{ item.message.agentRole === 'reviewer' ? 'Reviewer (Planner)' : item.message.agentRole?.toUpperCase() }} 
                  &nbsp;•&nbsp; 
                  {{ item.message.providerDisplayName }} ({{ item.message.model }})
                </span>
              </div>

              <!-- Collapsible execution log token usage representation -->
              <div class="work-duration-log">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
                <span>Worked for 8s • Completion success</span>
              </div>

              <!-- Body of agent logs -->
              <div class="assistant-msg-content">{{ item.message.content }}</div>

              <div class="assistant-msg-footer">
                <span>{{ item.time }}</span>
                <div class="assistant-msg-actions">
                  <button class="msg-action-btn" title="Copy Content">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                  </button>
                  <button class="msg-action-btn" title="Thumbs Up">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path>
                    </svg>
                  </button>
                  <button class="msg-action-btn" title="Thumbs Down">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm12-3h3a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2h-3"></path>
                    </svg>
                  </button>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- Floating Input Box (Visual Match to Antigravity bottom textarea panel) -->
      <div class="chat-input-area">
        <div class="chat-input-wrapper">
          <textarea 
            v-model="taskInput" 
            class="chat-textarea" 
            placeholder="Ask anything, @ to mention, / for actions" 
            :disabled="isRunning"
            @keydown.enter.prevent="handleSendTask"
          ></textarea>
          
          <div class="chat-input-actions">
            <!-- Model selection overlay badges -->
            <div class="model-selector-badge-container">
              <button class="msg-action-btn" style="color: var(--text-muted); margin-right: 0.25rem;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
              </button>

              <!-- Planner selector badge -->
              <div class="model-selector-badge">
                <span>Planner: {{ selectedPlannerName.split(' — ')[1] || selectedPlannerName }}</span>
                <select v-model="selectedPlannerCombined" class="badge-select-overlay" :disabled="isRunning">
                  <option v-for="opt in modelOptions" :key="opt.value" :value="opt.value">
                    {{ opt.label }}
                  </option>
                </select>
              </div>

              <!-- Coder selector badge -->
              <div class="model-selector-badge">
                <span>Coder: {{ selectedCoderName.split(' — ')[1] || selectedCoderName }}</span>
                <select v-model="selectedCoderCombined" class="badge-select-overlay" :disabled="isRunning">
                  <option v-for="opt in modelOptions" :key="opt.value" :value="opt.value">
                    {{ opt.label }}
                  </option>
                </select>
              </div>
            </div>

            <!-- Send button -->
            <button 
              @click="handleSendTask" 
              class="btn-icon" 
              :disabled="isRunning || !taskInput.trim() || !selectedPlannerCombined || !selectedCoderCombined"
              title="Start Orchestration"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- Right Sidebar: Tabbed Drawer Workspace -->
    <aside class="drawer-right">
      <!-- Tabs header row -->
      <nav class="drawer-tabs">
        <button 
          class="drawer-tab" 
          :class="{ active: activeTab === 'overview' }"
          @click="activeTab = 'overview'"
        >
          Overview
        </button>
        <button 
          class="drawer-tab" 
          :class="{ active: activeTab === 'review' }"
          @click="activeTab = 'review'"
        >
          Review
        </button>
        <button 
          class="drawer-tab" 
          :class="{ active: activeTab === 'code' }"
          @click="activeTab = 'code'"
        >
          Implementation Plan
        </button>
      </nav>

      <!-- Scrollable content drawer -->
      <div class="drawer-content">
        <!-- Overview Tab Panel -->
        <div v-if="activeTab === 'overview'" class="overview-details">
          <h2 class="section-title">Run Information</h2>
          <div v-if="activeRun" class="overview-card">
            <div class="overview-row">
              <span class="overview-label">Run ID</span>
              <span class="overview-value">{{ activeRun.id }}</span>
            </div>
            <div class="overview-row">
              <span class="overview-label">Status</span>
              <span class="overview-value" style="text-transform: uppercase; font-size: 0.75rem;">{{ activeRun.status }}</span>
            </div>
            <div class="overview-row">
              <span class="overview-label">Created At</span>
              <span class="overview-value">{{ new Date(activeRun.createdAt).toLocaleString() }}</span>
            </div>
            <div class="overview-row">
              <span class="overview-label">Planner Model</span>
              <span class="overview-value">{{ activeRun.plannerModel }}</span>
            </div>
            <div class="overview-row">
              <span class="overview-label">Coder Model</span>
              <span class="overview-value">{{ activeRun.coderModel }}</span>
            </div>
            <div class="overview-row">
              <span class="overview-label">Max Rounds Limit</span>
              <span class="overview-value">{{ activeRun.maxRounds }}</span>
            </div>
            <div v-if="activeRun.sourceRunId" class="overview-row">
              <span class="overview-label">Source Run</span>
              <span class="overview-value" style="font-family: var(--font-mono); font-size: 0.7rem;">{{ activeRun.sourceRunId }} ({{ activeRun.retryType }})</span>
            </div>
          </div>
          <div v-else style="color: var(--text-muted); font-size: 0.85rem; text-align: center; padding: 2rem 0;">
            No active run selected.
          </div>
        </div>

        <!-- Review History Tab Panel -->
        <div v-if="activeTab === 'review'" style="display: flex; flex-direction: column; gap: 1rem;">
          <h2 class="section-title">Planner Review Comments</h2>
          <div v-if="reviewerMessages.length === 0" style="color: var(--text-muted); font-size: 0.85rem; text-align: center; padding: 2rem 0;">
            No review comments yet.
          </div>
          <div 
            v-for="(msg, index) in reviewerMessages" 
            :key="msg.id" 
            class="overview-card"
            style="display: flex; flex-direction: column; gap: 0.5rem;"
          >
            <div style="display: flex; justify-content: space-between; font-size: 0.725rem; color: var(--text-muted);">
              <strong>Round Review #{{ index + 1 }}</strong>
              <span>{{ formatTime(msg.createdAt) }}</span>
            </div>
            <div style="font-size: 0.85rem; line-height: 1.5; color: #cbd5e1; white-space: pre-wrap;">{{ msg.content }}</div>
          </div>
        </div>

        <!-- Code Output Tab Panel (Implementation Plan / Generated Script) -->
        <div v-show="activeTab === 'code'" style="display: flex; flex-direction: column; height: 100%; gap: 1rem;">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <h2 class="section-title" style="margin: 0">Implementation Plan</h2>
            <button 
              v-if="finalOutputCode" 
              @click="copyCode" 
              class="btn btn-secondary" 
              style="padding: 0.2rem 0.5rem; font-size: 0.725rem;"
            >
              Copy Code
            </button>
          </div>

          <div v-if="finalOutputCode" class="code-container">
            <div class="code-header">
              <span>generated_script.js</span>
              <span class="badge badge-success">READY</span>
            </div>
            <div class="code-body">
              <pre class="code-pre"><code>{{ finalOutputCode }}</code></pre>
            </div>
          </div>
          
          <div v-else style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); text-align: center; gap: 0.5rem; padding: 4rem 0;">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <polyline points="16 18 22 12 16 6"></polyline>
              <polyline points="8 6 2 12 8 18"></polyline>
            </svg>
            <span style="font-size: 0.825rem;">Waiting for finalized code output...</span>
          </div>
        </div>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.app-layout {
  height: 100vh;
}
</style>
