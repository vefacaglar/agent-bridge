import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { ProviderMetadata, Run, AgentPreset } from '@agent-bridge/shared';
import { api } from '../api/client';
import { useChatAutoScroll } from './useChatAutoScroll';
import { useChatSession } from './useChatSession';
import { useComposerSettings } from './useComposerSettings';
import { useProjects } from './useProjects';
import { usePermissions } from './usePermissions';

export function useAppShell() {
  const providers = ref<ProviderMetadata[]>([]);
  const agentPresets = ref<AgentPreset[]>([]);
  const runs = ref<Run[]>([]);
  const messagesContainer = ref<HTMLElement | null>(null);

  const settings = useComposerSettings(providers, agentPresets);

  async function loadAgentPresets() {
    agentPresets.value = (await api.getAgentPresets()) ?? [];
  }
  const projects = useProjects(runs);
  const permissions = usePermissions();
  const chat = useChatSession({
    providers,
    runs,
    selectedModelCombined: settings.selectedModelCombined,
    effectiveModel: settings.effectiveModel,
    agentRunFields: settings.agentRunFields,
    currentMode: settings.currentMode,
    bypassPermissions: settings.bypassPermissions,
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
    if (chat.isRunning.value) return;
    if (projects.activeProjectPath.value === projectPath) {
      projects.activeProjectPath.value = '';
    } else {
      projects.activeProjectPath.value = projectPath;
      chat.startNewRunSetup();
    }
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
      await chat.selectRun(runs.value[0]);
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
    chat,
    isMac,
    selectProject,
    submitProject,
    deleteProject
  };
}
