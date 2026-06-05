<script setup lang="ts">
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

import { ref, computed } from 'vue';

const isSidebarCollapsed = ref(false);
function toggleSidebar() {
  isSidebarCollapsed.value = !isSidebarCollapsed.value;
}

const currentProjectName = computed(() => {
  const current = projects.projectOptions.value.find(p => p.path === projects.activeProjectPath.value);
  return current ? current.name : 'Unknown Project';
});
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
            <button v-if="isRunning" class="danger-button" @click="chat.cancelActiveRun">Cancel</button>
          </div>
        </div>
      </header>

      <template v-if="activeRun">
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
            @send="chat.handleSendTask"
            @quick-reply="chat.sendQuickReply"
            @permission-decision="chat.handlePermissionDecision"
            @select-project="selectProject"
          />
        </div>
      </template>
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

<style scoped>
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
</style>
