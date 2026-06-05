<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { ProviderMetadata, Run } from '@bridgemind/shared';
import { statusClass, statusLabel } from './lib/format';
import { useComposerSettings } from './composables/useComposerSettings';
import { useProjects } from './composables/useProjects';
import { useChatSession } from './composables/useChatSession';
import AppSidebar from './components/AppSidebar.vue';
import MessageThread from './components/MessageThread.vue';
import ChatComposer from './components/ChatComposer.vue';
import AddProjectModal from './components/AddProjectModal.vue';

// Shared top-level state, owned here and passed down to avoid circular deps.
const providers = ref<ProviderMetadata[]>([]);
const runs = ref<Run[]>([]);
const messagesContainer = ref<HTMLElement | null>(null);

const settings = useComposerSettings(providers);
const projects = useProjects(runs);
const chat = useChatSession({
  providers,
  runs,
  selectedModelCombined: settings.selectedModelCombined,
  currentMode: settings.currentMode,
  bypassPermissions: settings.bypassPermissions,
  activeProject: projects.activeProject,
  activeProjectPath: projects.activeProjectPath
});

const {
  messages,
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

const isMac = computed(() =>
  navigator.userAgent.toLowerCase().includes('mac') || navigator.platform.toLowerCase().includes('mac')
);

function selectProject(projectPath: string) {
  if (isRunning.value) return;
  projects.activeProjectPath.value = projectPath;
  chat.startNewRunSetup();
}

async function onSubmitProject() {
  const path = await projects.submitNewProject();
  if (path) selectProject(path);
}

async function onDeleteProject(projectPath: string) {
  const fallback = await projects.deleteProject(projectPath);
  if (fallback !== null) selectProject(fallback);
}

function scrollToBottom() {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
}

watch(messages, () => nextTick(scrollToBottom), { deep: true });
watch(isRunning, () => nextTick(scrollToBottom));
watch(activeRunId, () => nextTick(scrollToBottom));

onMounted(async () => {
  await chat.loadProviders();
  settings.ensureDefaultModel();
  await projects.loadProjects();
  await chat.loadRuns();

  if (runs.value.length > 0) {
    await chat.selectRun(runs.value[0]);
  } else if (projects.projectOptions.value.length > 0) {
    projects.activeProjectPath.value = projects.projectOptions.value[0].path;
  }
});

onBeforeUnmount(() => chat.disconnect());
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
      @delete-project="onDeleteProject"
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

      <section ref="messagesContainer" class="messages-scroll">
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
      @submit="onSubmitProject"
    />
  </div>
</template>
