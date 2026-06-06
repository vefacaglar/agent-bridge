<script setup lang="ts">
import { useAppShell } from './composables/useAppShell';
import AppSidebar from './components/AppSidebar.vue';
import MessageThread from './components/MessageThread.vue';
import ChatComposer from './components/ChatComposer.vue';
import AddProjectModal from './components/AddProjectModal.vue';
import SettingsScreen from './components/settings/SettingsScreen.vue';
import AgentTaskList from './components/AgentTaskList.vue';
import PlanPanel from './components/PlanPanel.vue';
import { collectWorkspaceChanges } from './lib/workspaceChanges';
import { collectAgentSummaries } from './lib/messageGroups';

const {
  runs,
  agentPresets,
  loadAgentPresets,
  setMessagesContainer,
  settings,
  projects,
  permissions,
  memories,
  openSettings,
  chat,
  isMac,
  selectProject,
  selectProjectAndNewChat,
  submitProject,
  deleteProject
} = useAppShell();

const {
  activeRunId,
  activeRun,
  isRunning,
  taskInput,
  queuedTaskInput,
  focusSignal,
  showPermissionModal,
  pendingPermissionRequest,
  pendingQuestionRequest,
  groupedMessages,
  visibleTitle,
  activeConfirmationGroup,
  messages,
  currentPlan
} = chat;

import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useCustomDialog } from './composables/useCustomDialog';

const { activeDialog } = useCustomDialog();

function handleEscape(e: KeyboardEvent) {
  if (e.key === 'Escape' && activeDialog.value) {
    activeDialog.value.resolve(false);
  }
}
onMounted(() => {
  window.addEventListener('keydown', handleEscape);
});
onUnmounted(() => {
  window.removeEventListener('keydown', handleEscape);
  clearSidePanelToggleTimer();
});

const isSidebarCollapsed = ref(false);
function toggleSidebar() {
  isSidebarCollapsed.value = !isSidebarCollapsed.value;
}

const currentProjectName = computed(() => {
  const current = projects.projectOptions.value.find(p => p.path === projects.activeProjectPath.value);
  return current ? current.name : 'Unknown Project';
});

// The live task checklist pinned above the composer. It is driven entirely by
// the latest <task_list> text block the assistant emitted, so it refreshes with
// every message and stays independent of the right-hand plan panel (which holds
// the stable plan document and only changes on an explicit revision request).
const currentTaskList = computed<string | null>(() => {
  const list = messages.value;
  if (!list) return null;
  for (let i = list.length - 1; i >= 0; i--) {
    const msg = list[i];
    if (msg.role !== 'assistant') continue;
    const match = msg.content.match(/<task_list>([\s\S]*?)<\/task_list>/);
    if (match) return match[1].trim();
  }
  return null;
});

const workspaceChanges = computed(() => collectWorkspaceChanges(messages.value, activeRun.value?.projectPath));
const agentSummaries = computed(() => collectAgentSummaries(groupedMessages.value, isRunning.value));

// The side panel mirrors Codex / Claude desktop: it opens automatically as soon
// as the assistant creates a plan, edits workspace files, or starts sub-agents.
// Closing it collapses every panel tab until the user re-opens a thread link or
// switches chats.
const sidePanelCollapsed = ref(false);
const hasSidePanelContent = computed(() =>
  !!currentPlan.value || workspaceChanges.value.length > 0 || agentSummaries.value.length > 0
);
const sidePanelOpen = computed(() =>
  hasSidePanelContent.value && !sidePanelCollapsed.value
);
const showSidePanelToggle = ref(false);
const SIDE_PANEL_TRANSITION_MS = 300;
let sidePanelToggleTimer: ReturnType<typeof setTimeout> | null = null;

function clearSidePanelToggleTimer() {
  if (sidePanelToggleTimer) {
    clearTimeout(sidePanelToggleTimer);
    sidePanelToggleTimer = null;
  }
}

watch([hasSidePanelContent, sidePanelOpen], ([hasContent, isOpen]) => {
  clearSidePanelToggleTimer();
  if (!hasContent || isOpen) {
    showSidePanelToggle.value = false;
    return;
  }

  sidePanelToggleTimer = setTimeout(() => {
    showSidePanelToggle.value = true;
    sidePanelToggleTimer = null;
  }, SIDE_PANEL_TRANSITION_MS);
}, { immediate: true });

// Reset the collapsed state when switching chats so each run's panel shows.
watch(activeRunId, () => { sidePanelCollapsed.value = false; });

const planPanelRef = ref<any>(null);

async function openAgentTranscript(agentId: string) {
  sidePanelCollapsed.value = false;
  await nextTick();
  planPanelRef.value?.expandAgentTranscript?.(agentId);
}

// --- Plan approval actions (Start / Revise / Reject) ----------------------
// While in plan mode, the panel offers three choices once a plan is presented.
// The decision is tracked per plan version so the buttons reappear if the
// assistant produces a revised plan.
const isPlanMode = computed(() => settings.currentMode.value === 'plan');
const planKey = computed(() =>
  currentPlan.value ? `${currentPlan.value.id}:${currentPlan.value.version}:${currentPlan.value.updatedAt}` : ''
);
const decidedPlanKey = ref('');
const showPlanActions = computed(() =>
  isPlanMode.value && !!currentPlan.value && decidedPlanKey.value !== planKey.value
);

watch(activeRunId, () => { decidedPlanKey.value = ''; });

// Start: approve the plan, switch to build (accept edits) mode, and kick off
// implementation with a follow-up message. We flip the mode FIRST and wait a
// tick so the continue request (and the system prompt it rebuilds) is already
// in Build mode before the approval message is sent — otherwise the model can
// reply as if it were still in Plan mode and ask to switch again.
async function startPlan() {
  decidedPlanKey.value = planKey.value;
  settings.currentMode.value = 'accept_edits';
  await nextTick();
  chat.sendQuickReply(
    "I approve this plan. We are now in Build mode — implement it step by step right away. Do not ask me to switch modes; you are already in Build mode."
  );
}

// Revise: stay in plan mode and focus the composer so the user can describe the
// changes they want to the plan.
function revisePlan() {
  decidedPlanKey.value = planKey.value;
  focusSignal.value++;
}

// Reject: tell the model the plan is turned down so it does NOT implement it,
// and stay in plan mode. Without sending this message the model never learns it
// was rejected and may go ahead and build the plan anyway.
async function rejectPlan() {
  decidedPlanKey.value = planKey.value;
  if (settings.currentMode.value !== 'plan') {
    settings.currentMode.value = 'plan';
    await nextTick();
  }
  chat.sendQuickReply(
    "I reject this plan. Do NOT implement it or make any changes. Stay in Plan mode and wait for my further instructions."
  );
}
</script>

<template>
  <div class="app-shell" :class="{ 'sidebar-collapsed': isSidebarCollapsed, 'panel-available': hasSidePanelContent, 'panel-open': sidePanelOpen }">
    <AppSidebar
      :project-options="projects.projectOptions.value"
      :active-project-path="projects.activeProjectPath.value"
      :runs="runs"
      :active-run-id="activeRunId"
      :is-sidebar-collapsed="isSidebarCollapsed"
      @new-chat="chat.startNewRunSetup"
      @add-project="projects.openAddProjectModal"
      @select-project="selectProject"
      @select-project-and-new-chat="selectProjectAndNewChat"
      @select-run="chat.selectRun"
      @delete-project="deleteProject"
      @open-settings="openSettings"
      @toggle-sidebar="toggleSidebar"
    />

    <main class="chat-shell" :class="{ 'landing-mode': !activeRun }">
      <header v-if="activeRun" class="chat-header">
        <div class="chat-header-inner">
          <div class="thread-title">
            <button v-if="isSidebarCollapsed" class="panel-toggle-btn expand-sidebar-btn" @click="toggleSidebar" title="Expand Sidebar">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M9 3v18" />
              </svg>
            </button>
            
            <div class="project-breadcrumb">
              <svg class="folder-icon open-folder" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2A2 2 0 0 0 12.07 6H20a2 2 0 0 1 2 2v2"/>
              </svg>
              <span class="breadcrumb-project">{{ currentProjectName }}</span>
              <span class="breadcrumb-separator">/</span>
              <span class="breadcrumb-chat-title">{{ visibleTitle }}</span>
            </div>
            
          </div>
          <div class="header-actions">
            <button
              v-if="showSidePanelToggle"
              class="panel-toggle-btn"
              type="button"
              title="Open side panel"
              @click="sidePanelCollapsed = false"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M15 3v18" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <template v-if="activeRun">
        <section :ref="setMessagesContainer" class="messages-scroll">
          <MessageThread
            :active-run="activeRun"
            :grouped-messages="groupedMessages"
            :is-running="isRunning"
            :plan="currentPlan"
            :plan-panel-open="sidePanelOpen"
            :agent-summaries="agentSummaries"
            @open-plan="sidePanelCollapsed = false"
            @open-agents="sidePanelCollapsed = false"
            @view-agent="openAgentTranscript"
          />
        </section>

        <div v-if="currentTaskList" class="pinned-task-list-wrap">
          <AgentTaskList
            :task-list-text="currentTaskList"
          />
        </div>

        <ChatComposer
          v-model:task-input="taskInput"
          v-model:current-mode="settings.currentMode.value"
          v-model:bypass-permissions="settings.bypassPermissions.value"
          v-model:selected-model="settings.selectedModelCombined.value"
          v-model:selected-preset-id="settings.selectedPresetId.value"
          :is-running="isRunning"
          :queued-task-input="queuedTaskInput"
          :model-options="settings.modelOptions.value"
          :active-model-display-name="settings.activeModelDisplayName.value"
          :agent-presets="agentPresets"
          :focus-signal="focusSignal"
          :confirmation-group="activeConfirmationGroup"
          :show-permission="showPermissionModal"
          :permission-request="pendingPermissionRequest"
          :question-request="pendingQuestionRequest"
          :messages="messages"
          @send="chat.handleSendTask"
          @queue="chat.handleQueueTask"
          @quick-reply="chat.sendQuickReply"
          @permission-decision="chat.handlePermissionDecision"
          @question-answer="chat.handleQuestionAnswer"
          @cancel="chat.cancelActiveRun"
        />
      </template>

      <template v-else>
        <div class="landing-center-wrap">
          <ChatComposer
            v-model:task-input="taskInput"
            v-model:current-mode="settings.currentMode.value"
            v-model:bypass-permissions="settings.bypassPermissions.value"
            v-model:selected-model="settings.selectedModelCombined.value"
            v-model:selected-preset-id="settings.selectedPresetId.value"
            :is-running="isRunning"
            :queued-task-input="queuedTaskInput"
            :model-options="settings.modelOptions.value"
            :active-model-display-name="settings.activeModelDisplayName.value"
            :agent-presets="agentPresets"
            :focus-signal="focusSignal"
            :confirmation-group="activeConfirmationGroup"
            :show-permission="showPermissionModal"
            :permission-request="pendingPermissionRequest"
            :question-request="pendingQuestionRequest"
            :is-landing="true"
            :project-options="projects.projectOptions.value"
            :active-project-path="projects.activeProjectPath.value"
            :messages="messages"
            @send="chat.handleSendTask"
            @queue="chat.handleQueueTask"
            @quick-reply="chat.sendQuickReply"
            @permission-decision="chat.handlePermissionDecision"
            @question-answer="chat.handleQuestionAnswer"
            @select-project="selectProject"
            @cancel="chat.cancelActiveRun"
          />
        </div>
      </template>
    </main>

    <PlanPanel
      ref="planPanelRef"
      v-if="hasSidePanelContent"
      :class="{ collapsed: !sidePanelOpen }"
      :plan="currentPlan"
      :changes="workspaceChanges"
      :agents="agentSummaries"
      :show-actions="showPlanActions"
      @close="sidePanelCollapsed = true"
      @view-agent="openAgentTranscript"
      @start="startPlan"
      @revise="revisePlan"
      @reject="rejectPlan"
    />

    <AddProjectModal
      :show="projects.showAddProjectModal.value"
      :is-mac="isMac"
      :is-submitting="projects.isSubmittingProject.value"
      v-model:name="projects.newProjectName.value"
      v-model:path="projects.newProjectPath.value"
      @close="projects.closeAddProjectModal"
      @browse="projects.browseFolder"
      @submit="submitProject"
    />

    <SettingsScreen
      :show="permissions.showSettings.value"
      :permissions="permissions.permissions.value"
      :is-loading="permissions.isLoading.value"
      :providers="chat.providers.value"
      :memories="memories.memories.value"
      :memories-loading="memories.isLoading.value"
      :active-project-path="projects.activeProjectPath.value"
      :active-project-name="projects.activeProject.value?.name || ''"
      @close="permissions.closeSettings"
      @revoke="permissions.revokePermission"
      @clear-all="permissions.clearPermissions"
      @presets-saved="loadAgentPresets"
      @add-memory="memories.addMemory"
      @update-memory="memories.updateMemory($event.id, $event.content)"
      @delete-memory="memories.deleteMemory"
      @clear-memories="memories.clearMemories"
    />

    <!-- Custom Dialog Modal (Alert/Confirm) -->
    <Transition name="fade">
      <div v-if="activeDialog" class="modal-overlay" @click="activeDialog.resolve(false)">
        <div class="modal-card dialog-modal-card" @click.stop>
          <header class="modal-header">
            <h3>{{ activeDialog.title || (activeDialog.type === 'confirm' ? 'Confirmation' : 'Notification') }}</h3>
            <button class="close-modal-btn" @click="activeDialog.resolve(false)">Close</button>
          </header>
          <div class="modal-body dialog-modal-body">
            <div class="dialog-content-wrapper">
              <div class="dialog-icon-wrap" :class="activeDialog.type">
                <svg v-if="activeDialog.type === 'confirm'" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path>
                  <line x1="12" y1="9" x2="12" y2="13"></line>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
              </div>
              <p class="dialog-message">{{ activeDialog.message }}</p>
            </div>
          </div>
          <footer class="modal-footer">
            <button v-if="activeDialog.type === 'confirm'" class="ghost-button" @click="activeDialog.resolve(false)">
              Cancel
            </button>
            <button class="primary-button" @click="activeDialog.resolve(true)">
              {{ activeDialog.type === 'confirm' ? 'Confirm' : 'OK' }}
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* Align the pinned task list with the composer below it (same inset). */
.pinned-task-list-wrap {
  flex: 0 0 auto;
  padding: 0 24px;
}

.landing-center-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: stretch;
  width: 100%;
  margin: 0 auto;
  padding: 40px 0;
  box-sizing: border-box;
  gap: 24px;
}

.chat-header {
  display: block;
  padding: 0;
}

.chat-header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 60px;
  width: 100%;
  padding: 0 24px;
  box-sizing: border-box;
}

.thread-title {
  flex: 1;
  min-width: 0;
}

.project-breadcrumb {
  display: flex;
  align-items: center;
  font-size: 0.93rem;
  font-weight: 500;
  color: var(--text);
  min-width: 0;
  flex: 1;
}

.project-breadcrumb .folder-icon {
  margin-right: 8px;
  color: var(--muted);
  flex-shrink: 0;
}

.breadcrumb-project {
  color: rgba(164, 164, 162, 0.82);
  font-weight: 400;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 180px;
  flex-shrink: 0;
}

.breadcrumb-separator {
  margin: 0 8px;
  color: var(--faint);
  user-select: none;
  flex-shrink: 0;
}

.breadcrumb-chat-title {
  color: var(--text);
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

/* Dialog Modal Custom Styling */
.dialog-modal-card {
  width: min(420px, 90%);
}

.dialog-content-wrapper {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 8px 0;
}

.dialog-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dialog-icon-wrap.confirm {
  background: rgba(94, 162, 235, 0.12);
  color: #5ea2eb;
}

.dialog-icon-wrap.alert {
  background: rgba(255, 170, 0, 0.12);
  color: #ffaa00;
}

.dialog-message {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.5;
  color: var(--text);
  padding-top: 8px;
}
</style>
