<script setup lang="ts">
import { useAppShell } from './composables/useAppShell';
import AppSidebar from './components/AppSidebar.vue';
import MessageThread from './components/MessageThread.vue';
import ChatComposer from './components/ChatComposer.vue';
import AddProjectModal from './components/AddProjectModal.vue';
import SettingsScreen from './components/settings/SettingsScreen.vue';
import AgentTaskList from './components/AgentTaskList.vue';
import PlanPanel from './components/PlanPanel.vue';

const {
  runs,
  setMessagesContainer,
  settings,
  projects,
  permissions,
  chat,
  isMac,
  selectProject,
  submitProject,
  deleteProject
} = useAppShell();

const {
  activeRunId,
  activeRun,
  isRunning,
  taskInput,
  focusSignal,
  showPermissionModal,
  pendingPermissionRequest,
  groupedMessages,
  visibleTitle,
  activeConfirmationGroup,
  messages,
  currentPlan
} = chat;

import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
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

// The plan side panel mirrors Codex / Claude desktop: it opens automatically as
// soon as the assistant has created a plan (via the update_plan tool) for the
// active run, and then stays open regardless of mode until the user closes it.
// Switching modes (e.g. plan -> accept) never hides it; only the Close button
// or the plan link in the thread toggle it.
const planPanelCollapsed = ref(false);
const planPanelOpen = computed(() =>
  !!currentPlan.value && !planPanelCollapsed.value
);

// Reset the collapsed state when switching chats so each run's plan shows.
watch(activeRunId, () => { planPanelCollapsed.value = false; });
</script>

<template>
  <div class="app-shell" :class="{ 'sidebar-collapsed': isSidebarCollapsed, 'plan-open': planPanelOpen }">
    <AppSidebar
      :project-options="projects.projectOptions.value"
      :active-project-path="projects.activeProjectPath.value"
      :runs="runs"
      :active-run-id="activeRunId"
      :is-running="isRunning"
      :is-sidebar-collapsed="isSidebarCollapsed"
      @new-chat="chat.startNewRunSetup"
      @add-project="projects.openAddProjectModal"
      @select-project="selectProject"
      @select-run="chat.selectRun"
      @delete-project="deleteProject"
      @open-settings="permissions.openSettings"
      @toggle-sidebar="toggleSidebar"
    />

    <main class="chat-shell" :class="{ 'landing-mode': !activeRun }">
      <header v-if="activeRun" class="chat-header">
        <div class="chat-header-inner">
          <div class="thread-title">
            <button v-if="isSidebarCollapsed" class="expand-sidebar-btn" @click="toggleSidebar" title="Expand Sidebar">
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
            :plan-panel-open="planPanelOpen"
            @open-plan="planPanelCollapsed = false"
          />
        </section>

        <AgentTaskList
          v-if="currentTaskList"
          :task-list-text="currentTaskList"
          class="pinned-task-list"
        />

        <ChatComposer
          v-model:task-input="taskInput"
          v-model:current-mode="settings.currentMode.value"
          v-model:bypass-permissions="settings.bypassPermissions.value"
          v-model:selected-model="settings.selectedModelCombined.value"
          :is-running="isRunning"
          :model-options="settings.modelOptions.value"
          :active-model-display-name="settings.activeModelDisplayName.value"
          :focus-signal="focusSignal"
          :confirmation-group="activeConfirmationGroup"
          :show-permission="showPermissionModal"
          :permission-request="pendingPermissionRequest"
          :messages="messages"
          @send="chat.handleSendTask"
          @quick-reply="chat.sendQuickReply"
          @permission-decision="chat.handlePermissionDecision"
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
            :is-running="isRunning"
            :model-options="settings.modelOptions.value"
            :active-model-display-name="settings.activeModelDisplayName.value"
            :focus-signal="focusSignal"
            :confirmation-group="activeConfirmationGroup"
            :show-permission="showPermissionModal"
            :permission-request="pendingPermissionRequest"
            :is-landing="true"
            :project-options="projects.projectOptions.value"
            :active-project-path="projects.activeProjectPath.value"
            :messages="messages"
            @send="chat.handleSendTask"
            @quick-reply="chat.sendQuickReply"
            @permission-decision="chat.handlePermissionDecision"
            @select-project="selectProject"
            @cancel="chat.cancelActiveRun"
          />
        </div>
      </template>
    </main>

    <PlanPanel
      v-if="planPanelOpen"
      :plan="currentPlan"
      @close="planPanelCollapsed = true"
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
      @close="permissions.closeSettings"
      @revoke="permissions.revokePermission"
      @clear-all="permissions.clearPermissions"
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
.pinned-task-list {
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
  min-height: 58px;
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
  font-size: 0.95rem;
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
  color: var(--muted);
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
  font-weight: 600;
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
