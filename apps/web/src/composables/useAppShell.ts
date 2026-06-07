import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { ProviderMetadata, Run, AgentPreset } from '@agent-bridge/shared';
import { api } from '../api/client';
import { useChatAutoScroll } from './useChatAutoScroll';
import { useChatSession } from './useChatSession';
import { useComposerSettings } from './useComposerSettings';
import { useProjects } from './useProjects';
import { usePermissions } from './usePermissions';
import { useMemories } from './useMemories';

export function useAppShell() {
  const providers = ref<ProviderMetadata[]>([]);
  const agentPresets = ref<AgentPreset[]>([]);
  const runs = ref<Run[]>([]);
  const messagesContainer = ref<HTMLElement | null>(null);
  const providersConfig = ref<Record<string, any>>({});
  const isProvidersConfigLoading = ref(false);

  const activeRunId = ref<string | null>(localStorage.getItem('activeRunId'));
  const activeRun = ref<Run | null>(null);

  const settings = useComposerSettings(providers, agentPresets, activeRunId, activeRun);

  async function loadAgentPresets() {
    agentPresets.value = (await api.getAgentPresets()) ?? [];
  }

  async function loadProvidersConfig() {
    isProvidersConfigLoading.value = true;
    try {
      const data = await api.getProvidersConfig();
      if (data) providersConfig.value = data;
    } finally {
      isProvidersConfigLoading.value = false;
    }
  }

  async function reloadProviders() {
    await Promise.all([
      loadProvidersConfig(),
      chat.loadProviders()
    ]);
  }

  const projects = useProjects(runs);
  const permissions = usePermissions();
  const memories = useMemories();

  // Opening the settings screen loads all settings tabs so they are ready when
  // the user switches between them.
  async function openSettings() {
    await Promise.all([
      permissions.openSettings(),
      memories.loadMemories(),
      loadProvidersConfig(),
      loadAgentPresets()
    ]);
  }
  const chat = useChatSession({
    activeRunId,
    activeRun,
    providers,
    runs,
    selectedModelCombined: settings.selectedModelCombined,
    selectedReasoningEffort: settings.selectedReasoningEffort,
    effectiveReasoningEffort: settings.effectiveReasoningEffort,
    effectiveModel: settings.effectiveModel,
    agentRunFields: settings.agentRunFields,
    currentMode: settings.currentMode,
    bypassPermissions: settings.bypassPermissions,
    selectedPresetId: settings.selectedPresetId,
    activeProject: projects.activeProject,
    activeProjectPath: projects.activeProjectPath
  });

  const isMac = computed(() =>
    navigator.userAgent.toLowerCase().includes('mac') || navigator.platform.toLowerCase().includes('mac')
  );

  useChatAutoScroll(messagesContainer, chat.messages, chat.isRunning, chat.activeRunId);

  function setMessagesContainer(el: unknown) {
    messagesContainer.value = el instanceof HTMLElement ? el : null;
  }

  function selectProject(projectPath: string) {
    if (projects.activeProjectPath.value !== projectPath) {
      projects.activeProjectPath.value = projectPath;
    }
  }

  function selectProjectAndNewChat(projectPath: string) {
    projects.activeProjectPath.value = projectPath;
    chat.startNewRunSetup();
  }

  async function submitProject() {
    const path = await projects.submitNewProject();
    if (path) selectProject(path);
  }

  async function deleteProject(projectPath: string) {
    const fallback = await projects.deleteProject(projectPath);
    if (fallback !== null) selectProject(fallback);
  }

  async function initialize() {
    await chat.loadProviders();
    await loadAgentPresets();
    settings.ensureDefaultModel();
    await projects.loadProjects();
    await chat.loadRuns();

    if (runs.value.length > 0) {
      const storedRunId = localStorage.getItem('activeRunId');
      const storedRun = storedRunId ? runs.value.find(r => r.id === storedRunId) : null;
      if (storedRun) {
        await chat.selectRun(storedRun);
      } else {
        await chat.selectRun(runs.value[0]);
      }
    } else if (projects.projectOptions.value.length > 0) {
      projects.activeProjectPath.value = projects.projectOptions.value[0].path;
    }
  }

  onMounted(initialize);
  onBeforeUnmount(() => chat.disconnect());

  return {
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
    deleteProject,
    providersConfig,
    isProvidersConfigLoading,
    reloadProviders
  };
}
