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
let pollingInterval: any = null;

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

// Chronological chat feed containing both message bubbles and system logs
interface FeedItem {
  type: 'system' | 'message';
  id: string;
  text?: string;
  time: string;
  message?: RunMessage;
}

const feedItems = computed<FeedItem[]>(() => {
  const items: FeedItem[] = [];
  if (!activeRun.value) return items;

  // 1. Initial setup system message
  items.push({
    type: 'system',
    id: 'sys-start',
    text: `Orchestration setup locked. Models: Planner (${activeRun.value.plannerModel}) ➔ Coder (${activeRun.value.coderModel})`,
    time: formatTime(activeRun.value.createdAt)
  });

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
      time: formatTime(activeRun.value.updatedAt)
    });
  } else if (activeRun.value.status === 'failed') {
    items.push({
      type: 'system',
      id: 'sys-failed',
      text: `Run failed: ${activeRun.value.errorMessage || 'Unknown error'}`,
      time: formatTime(activeRun.value.updatedAt)
    });
  } else if (activeRun.value.status === 'cancelled') {
    items.push({
      type: 'system',
      id: 'sys-cancelled',
      text: 'Orchestration cancelled by user.',
      time: formatTime(activeRun.value.updatedAt)
    });
  } else if (activeRun.value.status === 'max_rounds_reached') {
    items.push({
      type: 'system',
      id: 'sys-max',
      text: 'Loop stopped: Maximum rounds reached without acceptance.',
      time: formatTime(activeRun.value.updatedAt)
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
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    isRunning.value = false;
  }

  activeRunId.value = run.id;
  activeRun.value = run;
  finalOutputCode.value = run.finalOutput || '';
  await loadMessages(run.id);

  // If the selected run is still active, restart polling for it!
  const activeStatuses: RunStatus[] = ['created', 'planning', 'implementing', 'reviewing', 'fixing'];
  if (activeStatuses.includes(run.status)) {
    isRunning.value = true;
    startPolling(run.id);
  }
}

// Start active polling for a running job
function startPolling(runId: string) {
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = setInterval(async () => {
    // 1. Fetch run details
    const runRes = await fetch(`${API_BASE}/api/runs/${runId}`);
    if (runRes.ok) {
      const runData = await runRes.json() as Run;
      
      // Update active run reference
      if (activeRunId.value === runId) {
        activeRun.value = runData;
        finalOutputCode.value = runData.finalOutput || '';
      }

      // Update in history list
      const idx = runs.value.findIndex(r => r.id === runId);
      if (idx !== -1) {
        runs.value[idx] = runData;
      }

      // Check if termination status reached
      const activeStatuses: RunStatus[] = ['created', 'planning', 'implementing', 'reviewing', 'fixing'];
      if (!activeStatuses.includes(runData.status)) {
        clearInterval(pollingInterval);
        pollingInterval = null;
        isRunning.value = false;
        loadRuns(); // Reload history final state
      }
    }

    // 2. Fetch updated messages
    if (activeRunId.value === runId) {
      await loadMessages(runId);
    }
  }, 1000);
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

      // Start active polling loop
      startPolling(runData.id);
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
      // Status will stabilize on next poll tick or we reload
      clearInterval(pollingInterval);
      pollingInterval = null;
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
  if (pollingInterval) {
    clearInterval(pollingInterval);
  }
});
</script>

<template>
  <div class="app-layout">
    <!-- Left Sidebar: Configurations & History -->
    <aside class="sidebar-left">
      <div class="sidebar-header">
        <span class="brand">BridgeMind</span>
        <span class="badge" style="background-color: var(--accent-glow); color: var(--accent-light)">MVP</span>
      </div>
      
      <div class="sidebar-scroll">
        <!-- Configuration Section -->
        <div>
          <h2 class="section-title">Run Configuration</h2>
          <div style="display: flex; flex-direction: column; gap: 1rem;">
            <div class="form-group">
              <label class="form-label">Planner Model</label>
              <select v-model="selectedPlannerCombined" class="form-select" :disabled="isRunning">
                <option v-for="opt in modelOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">Coder Model</label>
              <select v-model="selectedCoderCombined" class="form-select" :disabled="isRunning">
                <option v-for="opt in modelOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">Max Rounds</label>
              <input v-model.number="maxRounds" type="number" class="form-input" min="1" max="10" :disabled="isRunning" />
            </div>
          </div>
        </div>

        <!-- History Section -->
        <div>
          <h2 class="section-title">Orchestration History</h2>
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
                <span>{{ run.plannerModel }} ➔ {{ run.coderModel }}</span>
                <span class="badge" :style="{
                  backgroundColor: run.status === 'done' ? 'var(--success-glow)' : 'rgba(255, 255, 255, 0.03)',
                  color: run.status === 'done' ? 'var(--success-color)' : (run.status === 'failed' ? 'var(--error-color)' : 'var(--text-secondary)')
                }">
                  {{ run.status }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>

    <!-- Center Workspace: The Unified Timeline Chat -->
    <section class="chat-container">
      <!-- Chat Header -->
      <header class="chat-header">
        <div v-if="activeRun">
          <span class="chat-header-title">Active Run: {{ activeRun.id }}</span>
        </div>
        <div v-else>
          <span class="chat-header-title">Select or Create a Run</span>
        </div>
        
        <div v-if="activeRun" style="display: flex; align-items: center; gap: 0.75rem;">
          <button v-if="isRunning" @click="cancelActiveRun" class="btn btn-secondary" style="padding: 0.25rem 0.6rem; font-size: 0.75rem; border-color: var(--error-color); color: var(--error-color);">
            Cancel Run
          </button>
          <span class="badge" :style="{
            backgroundColor: isRunning ? 'var(--accent-glow)' : 'rgba(255, 255, 255, 0.03)',
            color: isRunning ? 'var(--accent-light)' : 'var(--text-secondary)'
          }">
            Status: {{ activeRun.status.toUpperCase() }}
          </span>
        </div>
      </header>

      <!-- Chat Messages Timeline -->
      <div class="chat-feed">
        <div v-if="!activeRun" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); text-align: center; gap: 0.5rem;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
          <span>Write a task below and launch the orchestration loop!</span>
        </div>

        <div 
          v-else
          v-for="item in feedItems" 
          :key="item.id" 
          class="chat-feed-row"
        >
          <!-- System logs/notifications -->
          <div v-if="item.type === 'system'" class="system-event">
            <span class="system-event-indicator"></span>
            <span>{{ item.text }}</span>
          </div>

          <!-- Message Card Bubbles -->
          <div 
            v-else-if="item.message" 
            class="chat-bubble-row" 
            :class="{ 'user-row': item.message.role === 'user' }"
          >
            <div 
              class="message-bubble"
              :class="{ 
                'planner-bubble': item.message.agentRole === 'planner' || item.message.agentRole === 'reviewer',
                'coder-bubble': item.message.agentRole === 'coder'
              }"
            >
              <!-- Left Avatar for Agent -->
              <div v-if="item.message.role !== 'user'" class="avatar" :class="item.message.agentRole">
                {{ item.message.agentRole === 'planner' || item.message.agentRole === 'reviewer' ? 'P' : 'C' }}
              </div>
              
              <div class="bubble-main">
                <div class="bubble-header">
                  <span class="bubble-author">
                    {{ item.message.role === 'user' ? 'User' : (item.message.agentRole === 'reviewer' ? 'Reviewer (Planner)' : item.message.agentRole?.toUpperCase()) }}
                  </span>
                  <span>{{ item.time }}</span>
                </div>
                <div class="bubble-body">{{ item.message.content }}</div>
              </div>

              <!-- Right Avatar for User -->
              <div v-if="item.message.role === 'user'" class="avatar user" style="margin-left: 1rem;">
                U
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Chat Bottom Input (Antigravity Style) -->
      <div class="chat-input-area">
        <div class="chat-input-wrapper">
          <textarea 
            v-model="taskInput" 
            class="chat-textarea" 
            placeholder="Type task details or instructions to run..." 
            :disabled="isRunning"
            @keydown.enter.prevent="handleSendTask"
          ></textarea>
          
          <div class="chat-input-actions">
            <div class="chat-input-meta">
              <span class="badge" style="background-color: var(--planner-glow); color: var(--planner-color); border: none">
                Planner: {{ selectedPlannerCombined.split(':')[1] || 'None' }}
              </span>
              <span class="badge" style="background-color: var(--coder-glow); color: var(--coder-color); border: none">
                Coder: {{ selectedCoderCombined.split(':')[1] || 'None' }}
              </span>
            </div>
            
            <button 
              @click="handleSendTask" 
              class="btn-icon" 
              :disabled="isRunning || !taskInput.trim() || !selectedPlannerCombined || !selectedCoderCombined"
              title="Start Orchestration"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- Right Sidebar: Pinned Code Output Drawer -->
    <aside class="drawer-right">
      <div class="drawer-header">
        <h2 class="section-title" style="margin: 0">Code Output</h2>
        <button 
          v-if="finalOutputCode" 
          @click="copyCode" 
          class="btn btn-secondary" 
          style="padding: 0.25rem 0.5rem; font-size: 0.75rem;"
        >
          Copy Code
        </button>
      </div>

      <div class="drawer-content">
        <div v-if="finalOutputCode" class="code-container">
          <div class="code-header">
            <span>generated_script.js</span>
            <span class="badge badge-success">READY</span>
          </div>
          <div class="code-body">
            <pre class="code-pre"><code>{{ finalOutputCode }}</code></pre>
          </div>
        </div>
        
        <div v-else style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); text-align: center; gap: 0.5rem;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="16 18 22 12 16 6"></polyline>
            <polyline points="8 6 2 12 8 18"></polyline>
          </svg>
          <span style="font-size: 0.85rem;">Waiting for finalized orchestration output...</span>
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
