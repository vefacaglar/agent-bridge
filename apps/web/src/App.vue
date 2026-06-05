<script setup lang="ts">
import { statusClass, statusLabel } from './lib/format';
import { useAppShell } from './composables/useAppShell';
import AppSidebar from './components/AppSidebar.vue';
import MessageThread from './components/MessageThread.vue';
import ChatComposer from './components/ChatComposer.vue';
import AddProjectModal from './components/AddProjectModal.vue';
import SettingsScreen from './components/settings/SettingsScreen.vue';

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
  activeConfirmationGroup
} = chat;

import { ref } from 'vue';
const isSidebarCollapsed = ref(false);
function toggleSidebar() {
  isSidebarCollapsed.value = !isSidebarCollapsed.value;
}
</script>

<template>
  <div class="app-shell" :class="{ 'sidebar-collapsed': isSidebarCollapsed }">
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

    <main class="chat-shell">
      <header class="chat-header">
        <div class="thread-title">
          <button v-if="isSidebarCollapsed" class="expand-sidebar-btn" @click="toggleSidebar" title="Expand Sidebar">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M9 3v18" />
            </svg>
          </button>
          <strong>{{ visibleTitle }}</strong>
          <span v-if="activeRun" class="status-pill" :class="statusClass(activeRun.status)">
            {{ statusLabel(activeRun.status) }}
          </span>
        </div>
        <div class="header-actions">
          <button v-if="isRunning" class="danger-button" @click="chat.cancelActiveRun">Cancel</button>
        </div>
      </header>

      <section :ref="setMessagesContainer" class="messages-scroll">
        <MessageThread
          :active-run="activeRun"
          :grouped-messages="groupedMessages"
          :is-running="isRunning"
        />
      </section>

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
        @send="chat.handleSendTask"
        @quick-reply="chat.sendQuickReply"
        @permission-decision="chat.handlePermissionDecision"
      />
    </main>

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
  </div>
</template>
