<script setup lang="ts">
import { ref } from 'vue';
import type { Run, RunStatus, RunMessage } from '@bridgemind/shared';

// Reactive state utilizing imported shared types
const currentStatus = ref<RunStatus>('created');
const taskText = ref('Create a simple node script that parses JSON safely.');
const plannerModel = ref('claude-sonnet-4.5');
const coderModel = ref('qwen');
const maxRounds = ref(3);

// Mock history matching the Run structure
const mockRuns = ref<Run[]>([
  {
    id: '1',
    title: 'JSON Safe Parser Script',
    task: 'Create a simple node script that parses JSON safely.',
    status: 'done',
    plannerProviderId: 'anthropic',
    plannerProviderDisplayName: 'Anthropic',
    plannerModel: 'claude-sonnet-4.5',
    coderProviderId: 'opencode',
    coderProviderDisplayName: 'OpenCode',
    coderModel: 'qwen',
    maxRounds: 3,
    currentRound: 1,
    createdAt: '2026-06-05 16:00',
    updatedAt: '2026-06-05 16:05',
    finalOutput: '```js\nfunction parseJSON(str) {\n  try {\n    return JSON.parse(str);\n  } catch (e) {\n    return null;\n  }\n}\n```'
  },
  {
    id: '2',
    title: 'Vue Counter Component',
    task: 'Write a simple Vue counter with increment and decrement buttons.',
    status: 'failed',
    plannerProviderId: 'openai',
    plannerProviderDisplayName: 'OpenAI',
    plannerModel: 'gpt-4o',
    coderProviderId: 'commandcode',
    coderProviderDisplayName: 'CommandCode',
    coderModel: 'default',
    maxRounds: 3,
    currentRound: 0,
    createdAt: '2026-06-05 15:30',
    updatedAt: '2026-06-05 15:31',
    errorMessage: 'API Key is missing or invalid'
  }
]);

// Mock message lists for active visualization
const plannerMessages = ref<RunMessage[]>([
  {
    id: 'm1',
    runId: '1',
    role: 'assistant',
    agentRole: 'planner',
    providerId: 'anthropic',
    providerDisplayName: 'Anthropic',
    model: 'claude-sonnet-4.5',
    content: 'PLAN:\n1. Create a function "safeParse" that accepts a string.\n2. Wrap JSON.parse in a try-catch block.\n3. Return a default fallback value or null if parsing fails.',
    createdAt: '2026-06-05 16:01'
  },
  {
    id: 'm3',
    runId: '1',
    role: 'assistant',
    agentRole: 'reviewer',
    providerId: 'anthropic',
    providerDisplayName: 'Anthropic',
    model: 'claude-sonnet-4.5',
    content: 'FINAL_ACCEPTED\n\nReason:\nThe coder followed the guidelines exactly and implemented fallback support.',
    createdAt: '2026-06-05 16:04'
  }
]);

const coderMessages = ref<RunMessage[]>([
  {
    id: 'm2',
    runId: '1',
    role: 'assistant',
    agentRole: 'coder',
    providerId: 'opencode',
    providerDisplayName: 'OpenCode',
    model: 'qwen',
    content: 'IMPLEMENTATION:\n\n```javascript\nfunction safeParse(str, fallback = null) {\n  try {\n    return JSON.parse(str);\n  } catch (error) {\n    return fallback;\n  }\n}\nmodule.exports = { safeParse };\n```',
    createdAt: '2026-06-05 16:03'
  }
]);

const startRun = () => {
  currentStatus.value = 'planning';
  setTimeout(() => {
    currentStatus.value = 'implementing';
  }, 1500);
};
</script>

<template>
  <div class="app-layout">
    <!-- Header -->
    <header class="app-header">
      <div class="brand">
        <span class="brand-logo">BridgeMind</span>
        <span class="badge">MVP v0.1.0</span>
      </div>
      <div class="header-actions">
        <span class="badge" style="background-color: var(--success-glow); color: var(--success-color); border-color: rgba(16, 185, 129, 0.3)">
          API Server: Online
        </span>
      </div>
    </header>

    <!-- Main Dashboard -->
    <main class="dashboard">
      <!-- Sidebar / Config -->
      <aside class="sidebar">
        <div>
          <h2 class="sidebar-title">Run Setup</h2>
          
          <div style="display: flex; flex-direction: column; gap: 1rem;">
            <div class="form-group">
              <label class="form-label">Task description</label>
              <textarea v-model="taskText" class="form-textarea" placeholder="Describe the task..."></textarea>
            </div>

            <div class="form-group">
              <label class="form-label">Planner Model</label>
              <select v-model="plannerModel" class="form-select">
                <option value="claude-sonnet-4.5">Anthropic - Claude Sonnet 4.5</option>
                <option value="gpt-4o">OpenAI - GPT-4o</option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">Coder Model</label>
              <select v-model="coderModel" class="form-select">
                <option value="qwen">OpenCode - Qwen</option>
                <option value="glm">OpenCode - GLM</option>
                <option value="default">CommandCode - Default</option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">Max Rounds</label>
              <input v-model.number="maxRounds" type="number" class="form-input" min="1" max="10" />
            </div>

            <button @click="startRun" class="btn btn-primary" :disabled="currentStatus !== 'created'">
              Start Orchestration
            </button>
          </div>
        </div>

        <div>
          <h2 class="sidebar-title">Run History</h2>
          <div class="history-list">
            <div 
              v-for="run in mockRuns" 
              :key="run.id" 
              class="history-item" 
              :class="{ active: run.id === '1' }"
            >
              <span class="history-item-title">{{ run.title }}</span>
              <div class="history-item-meta">
                <span>{{ run.plannerModel }} ➔ {{ run.coderModel }}</span>
                <span class="badge" :style="{ 
                  backgroundColor: run.status === 'done' ? 'var(--success-glow)' : 'rgba(239, 68, 68, 0.1)',
                  color: run.status === 'done' ? 'var(--success-color)' : 'var(--error-color)',
                  borderColor: 'transparent'
                }">
                  {{ run.status }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <!-- Main Workspace Panels -->
      <section class="workspace">
        <div class="panels-grid">
          <!-- Planner Column -->
          <div class="panel">
            <header class="panel-header">
              <h3 class="panel-title" style="color: var(--planner-color)">
                <span>●</span> Planner / Reviewer
              </h3>
              <span class="badge" style="background-color: var(--planner-glow); color: var(--planner-color); border: none;">
                {{ plannerModel }}
              </span>
            </header>
            <div class="panel-content">
              <div 
                v-for="msg in plannerMessages" 
                :key="msg.id" 
                class="message planner"
              >
                <div class="message-meta">
                  <span>{{ msg.agentRole?.toUpperCase() }}</span>
                  <span>{{ msg.createdAt }}</span>
                </div>
                <div class="message-body">{{ msg.content }}</div>
              </div>
            </div>
          </div>

          <!-- Coder Column -->
          <div class="panel">
            <header class="panel-header">
              <h3 class="panel-title" style="color: var(--coder-color)">
                <span>●</span> Coder / Implementation
              </h3>
              <span class="badge" style="background-color: var(--coder-glow); color: var(--coder-color); border: none;">
                {{ coderModel }}
              </span>
            </header>
            <div class="panel-content">
              <div 
                v-for="msg in coderMessages" 
                :key="msg.id" 
                class="message coder"
              >
                <div class="message-meta">
                  <span>{{ msg.agentRole?.toUpperCase() }}</span>
                  <span>{{ msg.createdAt }}</span>
                </div>
                <div class="message-body">{{ msg.content }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Bottom Output -->
        <footer class="output-panel">
          <h3 class="sidebar-title" style="margin-bottom: 0.75rem;">Final Output</h3>
          <pre style="font-family: var(--font-mono); font-size: 0.825rem; background-color: var(--bg-tertiary); padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--border-color); color: var(--text-primary); overflow-x: auto;"><code>function safeParse(str, fallback = null) {
  try {
    return JSON.parse(str);
  } catch (error) {
    return fallback;
  }
}
module.exports = { safeParse };</code></pre>
        </footer>
      </section>
    </main>
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}
</style>
