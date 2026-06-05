<script setup lang="ts">
import { statusClass, statusLabel } from './lib/format';
import { useAppShell } from './composables/useAppShell';
import AppSidebar from './components/AppSidebar.vue';
import MessageThread from './components/MessageThread.vue';
import ChatComposer from './components/ChatComposer.vue';
import AddProjectModal from './components/AddProjectModal.vue';

const {
  runs,
  setMessagesContainer,
  settings,
  projects,
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
</script>

<template>
  <div class="app-shell">
    <AppSidebar
      :project-options="projects.projectOptions.value"
      :active-project-path="projects.activeProjectPath.value"
      :runs="runs"
      :active-run-id="activeRunId"
      :is-running="isRunning"
      @new-chat="chat.startNewRunSetup"
      @add-project="projects.openAddProjectModal"
      @select-project="selectProject"
      @select-run="chat.selectRun"
      @delete-project="deleteProject"
    />

    <main class="chat-shell">
      <header class="chat-header">
        <div class="thread-title">
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
        :active-project-path="activeRun?.projectPath"
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
  </div>
</template>
