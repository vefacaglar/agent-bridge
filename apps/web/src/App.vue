<script setup lang="ts">
import { ref } from 'vue';
import type { Run, RunStatus, RunMessage } from '@bridgemind/shared';

// Configurations State
const plannerProvider = ref('anthropic');
const plannerModel = ref('claude-sonnet-4.5');
const coderProvider = ref('opencode');
const coderModel = ref('qwen');
const maxRounds = ref(3);
const taskInput = ref('Create a simple node script that parses JSON safely.');

// Simulation States
const isRunning = ref(false);
const activeRunStatus = ref<RunStatus>('done');
const activeRunId = ref('run-1');
const finalOutputCode = ref(`function safeParse(str, fallback = null) {
  try {
    return JSON.parse(str);
  } catch (error) {
    return fallback;
  }
}
module.exports = { safeParse };`);

// Feed timeline (includes user requests, agent logs, and system events)
type FeedItem = 
  | { type: 'system'; id: string; text: string; time: string }
  | { type: 'message'; id: string; message: RunMessage };

const feedItems = ref<FeedItem[]>([
  {
    type: 'system',
    id: 'sys-1',
    text: 'Run setup locked. Models initialized.',
    time: '16:00'
  },
  {
    type: 'message',
    id: 'msg-u1',
    message: {
      id: 'u1',
      runId: 'run-1',
      role: 'user',
      agentRole: 'user',
      content: 'Create a simple node script that parses JSON safely.',
      createdAt: '16:00'
    }
  },
  {
    type: 'system',
    id: 'sys-2',
    text: 'Round 1 / 3 started',
    time: '16:01'
  },
  {
    type: 'message',
    id: 'msg-p1',
    message: {
      id: 'p1',
      runId: 'run-1',
      role: 'assistant',
      agentRole: 'planner',
      providerId: 'anthropic',
      providerDisplayName: 'Anthropic',
      model: 'claude-sonnet-4.5',
      content: 'PLAN:\n1. Create a function "safeParse" that accepts a string.\n2. Wrap JSON.parse in a try-catch block.\n3. Return a default fallback value or null if parsing fails.',
      createdAt: '16:01'
    }
  },
  {
    type: 'message',
    id: 'msg-c1',
    message: {
      id: 'c1',
      runId: 'run-1',
      role: 'assistant',
      agentRole: 'coder',
      providerId: 'opencode',
      providerDisplayName: 'OpenCode',
      model: 'qwen',
      content: 'IMPLEMENTATION:\n\n```javascript\nfunction safeParse(str, fallback = null) {\n  try {\n    return JSON.parse(str);\n  } catch (error) {\n    return fallback;\n  }\n}\nmodule.exports = { safeParse };\n```',
      createdAt: '16:03'
    }
  },
  {
    type: 'system',
    id: 'sys-3',
    text: 'Orchestrator invoking Planner for code review...',
    time: '16:04'
  },
  {
    type: 'message',
    id: 'msg-p2',
    message: {
      id: 'p2',
      runId: 'run-1',
      role: 'assistant',
      agentRole: 'reviewer',
      providerId: 'anthropic',
      providerDisplayName: 'Anthropic',
      model: 'claude-sonnet-4.5',
      content: 'FINAL_ACCEPTED\n\nReason:\nThe coder followed the guidelines exactly and implemented fallback support.',
      createdAt: '16:04'
    }
  },
  {
    type: 'system',
    id: 'sys-4',
    text: 'Run completed successfully.',
    time: '16:04'
  }
]);

// Past Runs History
const mockRuns = ref<Run[]>([
  {
    id: 'run-1',
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
    createdAt: '16:00',
    updatedAt: '16:04',
    finalOutput: '...'
  },
  {
    id: 'run-2',
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
    createdAt: 'Yesterday',
    updatedAt: 'Yesterday',
    errorMessage: 'API Key is missing or invalid'
  }
]);

// Triggers simulation of a run sequence
const handleSendTask = () => {
  if (!taskInput.value.trim() || isRunning.value) return;

  // Clear timeline and start simulation
  feedItems.value = [];
  isRunning.value = true;
  activeRunStatus.value = 'planning';
  activeRunId.value = `run-${Date.now()}`;
  finalOutputCode.value = '';

  // 1. User Message
  feedItems.value.push({
    type: 'message',
    id: `u-${Date.now()}`,
    message: {
      id: `u-${Date.now()}`,
      runId: activeRunId.value,
      role: 'user',
      agentRole: 'user',
      content: taskInput.value,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  });

  // 2. System Init
  setTimeout(() => {
    feedItems.value.push({
      type: 'system',
      id: `sys-init-${Date.now()}`,
      text: 'Run setup locked. Models initialized.',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
    
    // 3. Round Started & Planner Think
    setTimeout(() => {
      feedItems.value.push({
        type: 'system',
        id: `sys-r1-${Date.now()}`,
        text: 'Round 1 / 3 started',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
      
      feedItems.value.push({
        type: 'message',
        id: `p-${Date.now()}`,
        message: {
          id: `p-${Date.now()}`,
          runId: activeRunId.value,
          role: 'assistant',
          agentRole: 'planner',
          providerId: plannerProvider.value,
          providerDisplayName: plannerProvider.value === 'anthropic' ? 'Anthropic' : 'OpenAI',
          model: plannerModel.value,
          content: `PLAN:\n1. Implement parser matching the user request: "${taskInput.value}"\n2. Design clear interfaces.\n3. Return clean code block output.`,
          createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      });

      // 4. Coder Reply
      setTimeout(() => {
        activeRunStatus.value = 'implementing';
        
        feedItems.value.push({
          type: 'message',
          id: `c-${Date.now()}`,
          message: {
            id: `c-${Date.now()}`,
            runId: activeRunId.value,
            role: 'assistant',
            agentRole: 'coder',
            providerId: coderProvider.value,
            providerDisplayName: coderProvider.value === 'opencode' ? 'OpenCode' : 'CommandCode',
            model: coderModel.value,
            content: `IMPLEMENTATION:\n\n\`\`\`javascript\n// Safe processing generated by Coder\nconsole.log("Processing task: ${taskInput.value}");\n\`\`\``,
            createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        });

        // 5. Reviewer Accept
        setTimeout(() => {
          activeRunStatus.value = 'reviewing';
          
          feedItems.value.push({
            type: 'system',
            id: `sys-rev-${Date.now()}`,
            text: 'Orchestrator invoking Planner for code review...',
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          });
          
          feedItems.value.push({
            type: 'message',
            id: `rev-${Date.now()}`,
            message: {
              id: `rev-${Date.now()}`,
              runId: activeRunId.value,
              role: 'assistant',
              agentRole: 'reviewer',
              providerId: plannerProvider.value,
              providerDisplayName: plannerProvider.value === 'anthropic' ? 'Anthropic' : 'OpenAI',
              model: plannerModel.value,
              content: 'FINAL_ACCEPTED\n\nReason:\nThe output meets the goal and complies with the rules.',
              createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            }
          });

          // 6. Complete
          setTimeout(() => {
            activeRunStatus.value = 'done';
            isRunning.value = false;
            finalOutputCode.value = `// Safe processing generated by Coder\nconsole.log("Processing task: ${taskInput.value}");`;
            
            feedItems.value.push({
              type: 'system',
              id: `sys-done-${Date.now()}`,
              text: 'Run completed successfully.',
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });

            // Add to mock history
            mockRuns.value.unshift({
              id: activeRunId.value,
              title: taskInput.value.length > 25 ? taskInput.value.substring(0, 25) + '...' : taskInput.value,
              task: taskInput.value,
              status: 'done',
              plannerProviderId: plannerProvider.value,
              plannerProviderDisplayName: plannerProvider.value === 'anthropic' ? 'Anthropic' : 'OpenAI',
              plannerModel: plannerModel.value,
              coderProviderId: coderProvider.value,
              coderProviderDisplayName: coderProvider.value === 'opencode' ? 'OpenCode' : 'CommandCode',
              coderModel: coderModel.value,
              maxRounds: maxRounds.value,
              currentRound: 1,
              createdAt: 'Just now',
              updatedAt: 'Just now',
              finalOutput: finalOutputCode.value
            });
          }, 1000);
        }, 1200);
      }, 1500);
    }, 1200);
  }, 800);
};

const copyCode = () => {
  navigator.clipboard.writeText(finalOutputCode.value);
};
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
              <select v-model="plannerModel" class="form-select" :disabled="isRunning">
                <option value="claude-sonnet-4.5">Anthropic Claude Sonnet 4.5</option>
                <option value="gpt-4o">OpenAI GPT-4o</option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">Coder Model</label>
              <select v-model="coderModel" class="form-select" :disabled="isRunning">
                <option value="qwen">OpenCode Qwen</option>
                <option value="glm">OpenCode GLM</option>
                <option value="default">CommandCode Default</option>
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
            <div 
              v-for="run in mockRuns" 
              :key="run.id" 
              class="history-item"
              :class="{ active: run.id === activeRunId }"
            >
              <div class="history-title">{{ run.title }}</div>
              <div class="history-meta">
                <span>{{ run.plannerModel }} ➔ {{ run.coderModel }}</span>
                <span class="badge" :style="{
                  backgroundColor: run.status === 'done' ? 'var(--success-glow)' : 'rgba(239, 68, 68, 0.05)',
                  color: run.status === 'done' ? 'var(--success-color)' : 'var(--error-color)'
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
        <div>
          <span class="chat-header-title">Active Run: {{ activeRunId }}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <span class="badge badge-success">API Online</span>
          <span class="badge" :style="{
            backgroundColor: isRunning ? 'var(--accent-glow)' : 'rgba(255, 255, 255, 0.03)',
            color: isRunning ? 'var(--accent-light)' : 'var(--text-secondary)'
          }">
            Status: {{ activeRunStatus }}
          </span>
        </div>
      </header>

      <!-- Chat Messages Timeline -->
      <div class="chat-feed">
        <div 
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
            v-else 
            class="chat-bubble-row" 
            :class="{ 'user-row': item.message.role === 'user' }"
          >
            <!-- Planner/Coder bubbles left aligned, User bubbles right aligned -->
            <div 
              class="message-bubble"
              :class="{ 
                'planner-bubble': item.message.agentRole === 'planner' || item.message.agentRole === 'reviewer',
                'coder-bubble': item.message.agentRole === 'coder'
              }"
            >
              <!-- Left Avatar for Agent, Right Avatar for User -->
              <div v-if="item.message.role !== 'user'" class="avatar" :class="item.message.agentRole">
                {{ item.message.agentRole === 'planner' || item.message.agentRole === 'reviewer' ? 'P' : 'C' }}
              </div>
              
              <div class="bubble-main">
                <div class="bubble-header">
                  <span class="bubble-author">
                    {{ item.message.role === 'user' ? 'User' : (item.message.agentRole === 'reviewer' ? 'Reviewer (Planner)' : item.message.agentRole?.toUpperCase()) }}
                  </span>
                  <span>{{ item.message.createdAt }}</span>
                </div>
                <div class="bubble-body">{{ item.message.content }}</div>
              </div>

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
                {{ plannerModel }}
              </span>
              <span class="badge" style="background-color: var(--coder-glow); color: var(--coder-color); border: none">
                {{ coderModel }}
              </span>
            </div>
            
            <button 
              @click="handleSendTask" 
              class="btn-icon" 
              :disabled="isRunning || !taskInput.trim()"
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
