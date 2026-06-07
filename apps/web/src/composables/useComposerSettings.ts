import { computed, ref, watch, type Ref } from 'vue';
import type { ProviderMetadata, AgentPreset, ReasoningOption, ProviderModelSettings } from '@agent-bridge/shared';
import { splitCombined } from '../lib/format';

// Four modes are exposed: Chat (lightweight conversation — no proactive
// workspace scanning, minimal context), Build (applies edits directly; the
// backend's 'accept_edits' mode), Plan (planning via the plan panel) and
// Full Access (autonomous — runs every tool, including commands, with NO
// approval prompts; still confined to the project folder).
export type ChatMode = 'chat' | 'accept_edits' | 'plan' | 'full_access';

export const MODES_LIST = [
  { id: 'chat', label: 'Chat', shortcut: '1' },
  { id: 'accept_edits', label: 'Build', shortcut: '2' },
  { id: 'plan', label: 'Plan', shortcut: '3' },
  { id: 'full_access', label: 'Full Access', shortcut: '4' }
] as const;

export interface ModelOption {
  value: string;
  label: string;
  providerId: string;
  model: string;
  reasoningOptions: ReasoningOption[];
}

export const REASONING_EFFORTS = [
  { id: 'default', label: 'Default' },
  { id: 'none', label: 'None' },
  { id: 'minimal', label: 'Minimal' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'XHigh' },
  { id: 'max', label: 'Max' }
] as const;

const REASONING_EFFORT_IDS = new Set(REASONING_EFFORTS.map(x => x.id));

/**
 * Owns the composer's persisted settings: selected model, operational mode
 * and the bypass-permissions toggle, plus derived model option lists.
 */
export function useComposerSettings(
  providers: Ref<ProviderMetadata[]>,
  agentPresets: Ref<AgentPreset[]>
) {
  const selectedModelCombined = ref(localStorage.getItem('bm_selected_model') || '');
  const storedReasoningEffort = localStorage.getItem('bm_reasoning_effort') || 'default';
  const selectedReasoningEffort = ref(
    REASONING_EFFORT_IDS.has(storedReasoningEffort as any) ? storedReasoningEffort : 'default'
  );
  // The optional dual-model preset selected next to the model picker. Empty string
  // (or an id no longer present) means single-model mode — the default.
  const selectedPresetId = ref(localStorage.getItem('bm_selected_preset') || '');
  watch(selectedPresetId, (v) => localStorage.setItem('bm_selected_preset', v));
  // Keep a persisted Plan/Build choice; migrate anything else (or first run) to Chat.
  const storedMode = localStorage.getItem('bm_current_mode');
  const currentMode = ref<ChatMode>(
    storedMode === 'plan' ? 'plan'
      : storedMode === 'accept_edits' ? 'accept_edits'
      : storedMode === 'full_access' ? 'full_access'
      : 'chat'
  );
  const bypassPermissions = ref(localStorage.getItem('bm_bypass_permissions') === 'true');

  watch(selectedModelCombined, (v) => { if (v) localStorage.setItem('bm_selected_model', v); });
  watch(selectedReasoningEffort, (v) => localStorage.setItem('bm_reasoning_effort', v || 'default'));
  watch(currentMode, (v) => localStorage.setItem('bm_current_mode', v));
  watch(bypassPermissions, (v) => localStorage.setItem('bm_bypass_permissions', String(v)));

  const modelOptions = computed<ModelOption[]>(() => {
    const options: ModelOption[] = [];
    for (const provider of providers.value) {
      for (const model of provider.models) {
        options.push({
          value: `${provider.id}:${model}`,
          label: `${provider.displayName} / ${model}`,
          providerId: provider.id,
          model,
          reasoningOptions: normalizedReasoningOptions(provider.modelSettings?.[model])
        });
      }
    }
    return options;
  });

  const activeModelDisplayName = computed(() => {
    const opt = modelOptions.value.find(o => o.value === selectedModelCombined.value);
    if (!opt) return 'Select Model';
    return opt.label.split(' / ').pop() || opt.label;
  });

  // The currently selected dual-model preset, or null for single-model mode.
  const activePreset = computed(() =>
    agentPresets.value.find(p => p.id === selectedPresetId.value) ?? null
  );

  watch(agentPresets, () => {
    if (selectedPresetId.value && !activePreset.value) {
      selectedPresetId.value = '';
    }
  });

  // The main/architect model a run should use: the preset's architect when a
  // preset is active, otherwise the plain single-model selection.
  const effectiveModel = computed<{ providerId: string; model: string }>(() => {
    if (activePreset.value) {
      return { ...activePreset.value.architect };
    }
    return splitCombined(selectedModelCombined.value);
  });

  const activeReasoningOptions = computed<ReasoningOption[]>(() => {
    const effective = effectiveModel.value;
    const provider = providers.value.find(p => p.id === effective.providerId);
    return normalizedReasoningOptions(provider?.modelSettings?.[effective.model]);
  });

  const reasoningEffortOptions = computed(() => [
    REASONING_EFFORTS[0],
    ...activeReasoningOptions.value.map(option => ({
      id: option.id,
      label: option.label || REASONING_EFFORTS.find(x => x.id === option.id)?.label || option.id
    }))
  ]);

  watch(activeReasoningOptions, (options) => {
    if (selectedReasoningEffort.value !== 'default' && !options.some(option => option.id === selectedReasoningEffort.value)) {
      selectedReasoningEffort.value = 'default';
    }
  });

  // Dual-model fields to attach to a run; empty object in single-model mode.
  const agentRunFields = computed<{ coderProviderId?: string; coderModel?: string; coderReasoningEffort?: string; utilityProviderId?: string; utilityModel?: string; utilityReasoningEffort?: string; agentPreset?: string }>(() => {
    if (!activePreset.value) return { agentPreset: '' };
    return {
      agentPreset: activePreset.value.id,
      coderProviderId: activePreset.value.coder.providerId,
      coderModel: activePreset.value.coder.model,
      coderReasoningEffort: activePreset.value.coder.reasoningEffort,
      utilityProviderId: activePreset.value.utility?.providerId,
      utilityModel: activePreset.value.utility?.model,
      utilityReasoningEffort: activePreset.value.utility?.reasoningEffort
    };
  });

  const effectiveReasoningEffort = computed(() =>
    activePreset.value?.architect.reasoningEffort || selectedReasoningEffort.value
  );

  function getModeLabel(modeId: string): string {
    return MODES_LIST.find(m => m.id === modeId)?.label ?? 'Chat';
  }

  /** Picks a sensible default model (preferring Anthropic) once providers load. */
  function ensureDefaultModel() {
    if (modelOptions.value.length === 0) return;
    if (modelOptions.value.some(o => o.value === selectedModelCombined.value)) return;
    selectedModelCombined.value =
      modelOptions.value.find(o => o.providerId === 'anthropic')?.value || modelOptions.value[0].value;
  }

  watch(modelOptions, () => ensureDefaultModel());

  return {
    selectedModelCombined,
    selectedReasoningEffort,
    reasoningEffortOptions,
    selectedPresetId,
    activePreset,
    effectiveModel,
    effectiveReasoningEffort,
    agentRunFields,
    currentMode,
    bypassPermissions,
    modelOptions,
    activeModelDisplayName,
    getModeLabel,
    ensureDefaultModel
  };
}

function normalizedReasoningOptions(settings: ProviderModelSettings | undefined): ReasoningOption[] {
  if (!settings) return [];
  if (settings.reasoning?.options?.length) return settings.reasoning.options;
  if (settings.options?.length) return settings.options;
  return (settings.reasoningEfforts || []).map(id => ({ id }));
}
