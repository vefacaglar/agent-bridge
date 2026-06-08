import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { tryOnScopeDispose, useThrottleFn } from '@vueuse/core';
import type { ProviderMetadata, Run, RunMessage, RunStatus, Plan } from '@agent-bridge/shared';
import { api, type PermissionDecision } from '../api/client';
import { ACTIVE_STATUSES } from '../lib/format';
import { groupMessages, type MessageGroup } from '../lib/messageGroups';
import { getConfirmationOptions } from '../lib/confirmation';
import { useCustomDialog } from './useCustomDialog';
import { clearMarkdownCache } from '../lib/markdown';

interface ChatSessionOptions {
  activeRunId: Ref<string | null>;
  activeRun: Ref<Run | null>;
  providers: Ref<ProviderMetadata[]>;
  runs: Ref<Run[]>;
  selectedModelCombined: Ref<string>;
  selectedReasoningEffort: Ref<string>;
  effectiveReasoningEffort: ComputedRef<string | undefined>;
  // The effective main/architect model (preset architect or single-model pick)
  // and the optional dual-model fields, both derived in useComposerSettings.
  effectiveModel: ComputedRef<{ providerId: string; model: string }>;
  agentRunFields: ComputedRef<{
    coderProviderId?: string;
    coderModel?: string;
    coderReasoningEffort?: string;
    utilityProviderId?: string;
    utilityModel?: string;
    utilityReasoningEffort?: string;
    agentPreset?: string;
  }>;
  currentMode: Ref<string>;
  bypassPermissions: Ref<boolean>;
  selectedPresetId: Ref<string>;
  activeProject: ComputedRef<{ path: string; name: string } | undefined>;
  activeProjectPath: Ref<string>;
}

/**
 * Core chat state machine: provider/run/message lists, the live SSE stream,
 * sending and continuing runs, cancellation and permission handling.
 * The providers and runs refs are owned by the caller and shared with the
 * project/settings composables to avoid circular dependencies.
 */
export function useChatSession(options: ChatSessionOptions) {
  const { showAlert } = useCustomDialog();
  const providers = options.providers;
  const runs = options.runs;
  const messages = ref<RunMessage[]>([]);

  const activeRunId = options.activeRunId;
  const activeRun = options.activeRun;
  const isRunning = ref(false);
  const currentPlan = ref<Plan | null>(null);

  const taskInput = ref('');
  const queuedTaskInput = ref('');
  const focusSignal = ref(0);

  const showPermissionModal = ref(false);
  const pendingPermissionRequest = ref<any>(null);
  // The active ask_user_question request (questions to render), or null.
  const pendingQuestionRequest = ref<any>(null);

  let eventSource: EventSource | null = null;
  let isDisposed = false;
  // Raw SSE updates stay in a plain Map so high-frequency token/sub-agent
  // events do not touch Vue reactivity until the throttled flush runs.
  const pendingMessageUpdates = new Map<string, RunMessage>();

  const groupedMessages = computed<MessageGroup[]>(() => groupMessages(messages.value));

  const visibleTitle = computed(() => activeRun.value?.title || 'New chat');

  /** The trailing assistant message that is awaiting a yes/no confirmation. */
  const activeConfirmationGroup = computed<MessageGroup | null>(() => {
    if (groupedMessages.value.length === 0) return null;
    const last = groupedMessages.value[groupedMessages.value.length - 1];
    if (last && last.type === 'assistant' && canShowConfirmation(last)) {
      return last;
    }
    return null;
  });

  function requestFocus() {
    focusSignal.value++;
  }

  function canShowConfirmation(group: MessageGroup): boolean {
    if (!getConfirmationOptions(group.message.content)) return false;
    if (isRunning.value) return false;

    const idx = groupedMessages.value.findIndex(g => g.id === group.id);
    if (idx === -1) return false;
    for (let k = idx + 1; k < groupedMessages.value.length; k++) {
      if (groupedMessages.value[k].type === 'user') return false;
    }
    return true;
  }

  // --- Loading -------------------------------------------------------------

  async function loadProviders() {
    const data = await api.getProviders();
    if (data) providers.value = data;
  }

  async function loadRuns() {
    const data = await api.getRuns();
    if (data) runs.value = data;
  }

  async function loadMessages(runId: string) {
    const data = await api.getMessages(runId);
    if (data) messages.value = data;
  }

  // --- Selection -----------------------------------------------------------

  async function selectRun(run: Run) {
    flushPendingMessages();
    eventSource?.close();
    eventSource = null;
    clearPendingMessageUpdates();
    clearMarkdownCache();

    // Refresh the list of runs to get the latest titles, statuses, etc. from server
    await loadRuns();
    const latestRun = runs.value.find(r => r.id === run.id) || run;

    activeRunId.value = latestRun.id;
    localStorage.setItem('activeRunId', latestRun.id);
    activeRun.value = { ...latestRun };
    options.activeProjectPath.value = latestRun.projectPath || options.activeProjectPath.value;
    taskInput.value = '';
    showPermissionModal.value = false;
    pendingPermissionRequest.value = null;
    pendingQuestionRequest.value = null;

    await loadMessages(latestRun.id);
    currentPlan.value = await api.getRunPlan(latestRun.id);
    await hydratePendingRequest(latestRun.id);

    if (ACTIVE_STATUSES.includes(latestRun.status)) {
      isRunning.value = true;
      connectEventSource(latestRun.id);
    } else {
      isRunning.value = false;
    }
    requestFocus();
  }

  async function hydratePendingRequest(runId: string) {
    const pending = await api.getRunPending(runId);
    if (!pending || activeRun.value?.id !== runId) return;

    if (pending.permissionRequest) {
      pendingPermissionRequest.value = pending.permissionRequest;
      showPermissionModal.value = true;
    }
    if (pending.questionRequest) {
      pendingQuestionRequest.value = pending.questionRequest;
    }
  }

  function startNewRunSetup() {
    // Starting a new chat while another run is still generating must NOT cancel
    // that run — it keeps going on the backend. We just stop watching its live
    // stream here; selecting it again later reconnects and reloads its history.
    flushPendingMessages();
    eventSource?.close();
    eventSource = null;
    clearPendingMessageUpdates();
    clearMarkdownCache();

    // Clear draft settings so it initializes with last used settings
    localStorage.removeItem('bm_draft_selected_model');
    localStorage.removeItem('bm_draft_reasoning_effort');
    localStorage.removeItem('bm_draft_selected_preset');
    localStorage.removeItem('bm_draft_current_mode');
    localStorage.removeItem('bm_draft_bypass_permissions');

    isRunning.value = false;
    activeRunId.value = null;
    localStorage.removeItem('activeRunId');
    activeRun.value = null;
    messages.value = [];
    currentPlan.value = null;
    taskInput.value = '';
    queuedTaskInput.value = '';
    requestFocus();
  }

  // --- Live event stream ---------------------------------------------------

  function flushPendingMessages() {
    if (isDisposed || pendingMessageUpdates.size === 0) return;

    const updates = Array.from(pendingMessageUpdates.values());
    pendingMessageUpdates.clear();

    const next = messages.value.slice();
    const indexById = new Map(next.map((message, index) => [message.id, index]));

    for (const message of updates) {
      const index = indexById.get(message.id);
      if (index !== undefined) {
        next[index] = message;
      } else {
        indexById.set(message.id, next.length);
        next.push(message);
      }
    }

    messages.value = next;
  }

  const throttledFlushPendingMessages = useThrottleFn(flushPendingMessages, 200, true, true);

  function queueMessageUpdate(message: RunMessage) {
    if (isDisposed) return;
    pendingMessageUpdates.set(message.id, message);
    void throttledFlushPendingMessages();
  }

  function clearPendingMessageUpdates() {
    pendingMessageUpdates.clear();
  }

  function connectEventSource(runId: string) {
    flushPendingMessages();
    eventSource?.close();
    clearPendingMessageUpdates();
    eventSource = new EventSource(api.eventsUrl(runId));

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'connected') return;

      if (data.type === 'status_changed') {
        updateRunStatus(runId, data.status);
        if (data.status !== 'awaiting_permission') {
          showPermissionModal.value = false;
          pendingPermissionRequest.value = null;
        }
        if (data.status !== 'awaiting_input') {
          pendingQuestionRequest.value = null;
        }
        // The backend closes the SSE stream on a terminal status_changed, so a
        // following run_completed event never arrives. Drive the queued-message
        // send (and stream teardown) from the terminal status itself.
        if (data.status === 'done') {
          finishEventStream({ sendQueuedMessage: true });
        }
      }

      if (data.type === 'permission_requested' && activeRun.value?.id === runId) {
        pendingPermissionRequest.value = data;
        showPermissionModal.value = true;
      }

      if (data.type === 'question_requested' && activeRun.value?.id === runId) {
        pendingQuestionRequest.value = data;
      }

      if (data.type === 'message_created' && activeRun.value?.id === runId) {
        queueMessageUpdate(data.message);
      }

      if (data.type === 'message_updated' && activeRun.value?.id === runId) {
        queueMessageUpdate(data.message);
      }

      if (data.type === 'plan_updated' && activeRun.value?.id === runId) {
        currentPlan.value = data.plan;
      }

      if (data.type === 'run_title_changed') {
        if (activeRun.value?.id === runId) {
          activeRun.value = { ...activeRun.value, title: data.title };
        }
        runs.value = runs.value.map(r => r.id === runId ? { ...r, title: data.title } : r);
      }

      if (data.type === 'run_completed') {
        if (activeRun.value?.id === runId) updateRunStatus(runId, 'done');
        finishEventStream({ sendQueuedMessage: true });
      }

      if (data.type === 'run_failed') {
        if (activeRun.value?.id === runId) {
          activeRun.value = { ...activeRun.value, errorMessage: data.errorMessage, status: 'failed' };
        }
        runs.value = runs.value.map(r => r.id === runId ? { ...r, errorMessage: data.errorMessage, status: 'failed' } : r);
        finishEventStream();
      }
    };

    eventSource.onerror = () => finishEventStream();
  }

  function updateRunStatus(runId: string, status: RunStatus) {
    if (activeRun.value?.id === runId) {
      activeRun.value = { ...activeRun.value, status };
    }
    runs.value = runs.value.map(r => r.id === runId ? { ...r, status } : r);
  }

  function finishEventStream(options: { sendQueuedMessage?: boolean } = {}) {
    // Terminal SSE events may close the stream before a trailing throttle tick,
    // so force the latest buffered message into reactive state before teardown.
    flushPendingMessages();
    eventSource?.close();
    eventSource = null;
    isRunning.value = false;
    loadRuns();

    if (options.sendQueuedMessage && queuedTaskInput.value.trim()) {
      // Capture + clear synchronously so a second finishEventStream call (e.g.
      // both a terminal status_changed and run_completed arriving) can't re-send.
      const queued = queuedTaskInput.value;
      queuedTaskInput.value = '';
      requestAnimationFrame(() => {
        if (!isRunning.value) {
          taskInput.value = queued;
          handleSendTask();
        }
      });
    }
  }

  // --- Sending -------------------------------------------------------------

  async function handleSendTask() {
    if (!taskInput.value.trim() || isRunning.value || !options.selectedModelCombined.value) return;

    // Record last used settings in localStorage
    localStorage.setItem('bm_last_used_selected_model', options.selectedModelCombined.value);
    localStorage.setItem('bm_last_used_reasoning_effort', options.selectedReasoningEffort.value);
    localStorage.setItem('bm_last_used_selected_preset', options.selectedPresetId.value);
    localStorage.setItem('bm_last_used_current_mode', options.currentMode.value);
    localStorage.setItem('bm_last_used_bypass_permissions', String(options.bypassPermissions.value));

    const { providerId, model } = options.effectiveModel.value;
    const agentFields = options.agentRunFields.value;
    isRunning.value = true;

    const isContinuation = activeRun.value && !ACTIVE_STATUSES.includes(activeRun.value.status);

    if (isContinuation) {
      const runId = activeRun.value!.id;
      const currentTask = taskInput.value;
      taskInput.value = '';

      try {
        await api.continueRun(runId, {
          task: currentTask,
          providerId,
          model,
          reasoningEffort: options.effectiveReasoningEffort.value,
          mode: options.currentMode.value,
          bypassPermissions: options.bypassPermissions.value,
          ...agentFields
        });
      } catch (err: any) {
        isRunning.value = false;
        taskInput.value = currentTask; // restore input on error
        await showAlert(err.message);
        return;
      }

      await loadMessages(runId);
      await loadRuns();
      connectEventSource(runId);
    } else {
      messages.value = [];
      currentPlan.value = null;

      try {
        const run = await api.createRun({
          task: taskInput.value,
          projectPath: options.activeProject.value?.path,
          projectName: options.activeProject.value?.name,
          providerId,
          model,
          reasoningEffort: options.effectiveReasoningEffort.value,
          mode: options.currentMode.value,
          bypassPermissions: options.bypassPermissions.value,
          ...agentFields
        });
        taskInput.value = '';

        // Initialize settings for the new run
        localStorage.setItem(`bm_run_${run.id}_selected_model`, options.selectedModelCombined.value);
        localStorage.setItem(`bm_run_${run.id}_reasoning_effort`, options.selectedReasoningEffort.value);
        localStorage.setItem(`bm_run_${run.id}_selected_preset`, options.selectedPresetId.value);
        localStorage.setItem(`bm_run_${run.id}_current_mode`, options.currentMode.value);
        localStorage.setItem(`bm_run_${run.id}_bypass_permissions`, String(options.bypassPermissions.value));

        activeRunId.value = run.id;
        localStorage.setItem('activeRunId', run.id);
        activeRun.value = run;
        runs.value.unshift(run);
        connectEventSource(run.id);
      } catch (err: any) {
        isRunning.value = false;
        await showAlert(err.message);
      }
    }
  }

  async function sendQuickReply(option: string) {
    taskInput.value = option;
    if (isRunning.value) {
      handleQueueTask();
    } else {
      await handleSendTask();
    }
  }

  function handleQueueTask() {
    if (!isRunning.value || !taskInput.value.trim()) return;
    queuedTaskInput.value = taskInput.value;
    taskInput.value = '';
    requestFocus();
  }

  async function cancelActiveRun() {
    if (!activeRunId.value) return;
    const runId = activeRunId.value;
    try {
      const response = await api.cancelRun(runId);
      if (response.ok || response.status === 400) {
        updateRunStatus(runId, 'cancelled');
        finishEventStream();
      } else {
        const err = await response.json().catch(() => ({}));
        await showAlert(err.error || 'Cancel request failed.');
      }
    } catch (err) {
      console.error('Failed to contact server for cancellation:', err);
      updateRunStatus(runId, 'failed');
      finishEventStream();
    }
  }

  async function handleQuestionAnswer(payload: { selections: string[][]; notes: string[] }) {
    if (!activeRunId.value) return;
    try {
      await api.answerQuestion(activeRunId.value, payload.selections, payload.notes);
      pendingQuestionRequest.value = null;
    } catch (err: any) {
      await showAlert(err.message || 'Connection error.');
    }
  }

  async function handlePermissionDecision(decision: PermissionDecision) {
    if (!activeRunId.value) return;
    try {
      await api.sendPermissionDecision(activeRunId.value, decision);
      showPermissionModal.value = false;
      pendingPermissionRequest.value = null;
    } catch (err: any) {
      await showAlert(err.message || 'Connection error.');
    }
  }

  function disconnect() {
    flushPendingMessages();
    eventSource?.close();
    eventSource = null;
    clearPendingMessageUpdates();
  }

  tryOnScopeDispose(() => {
    flushPendingMessages();
    isDisposed = true;
    clearPendingMessageUpdates();
  });

  return {
    providers,
    runs,
    messages,
    activeRunId,
    activeRun,
    isRunning,
    currentPlan,
    taskInput,
    queuedTaskInput,
    focusSignal,
    showPermissionModal,
    pendingPermissionRequest,
    pendingQuestionRequest,
    groupedMessages,
    visibleTitle,
    activeConfirmationGroup,
    loadProviders,
    loadRuns,
    selectRun,
    startNewRunSetup,
    handleSendTask,
    handleQueueTask,
    sendQuickReply,
    cancelActiveRun,
    handlePermissionDecision,
    handleQuestionAnswer,
    disconnect
  };
}
