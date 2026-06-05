import { computed, ref, watch, type Ref } from 'vue';
import type { ProviderMetadata } from '@agent-bridge/shared';

// Three modes are exposed: Chat (lightweight conversation — no proactive
// workspace scanning, minimal context), Build (applies edits directly; the
// backend's 'accept_edits' mode) and Plan (planning via the plan panel).
export type ChatMode = 'chat' | 'accept_edits' | 'plan';

export const MODES_LIST = [
  { id: 'chat', label: 'Chat', shortcut: '1' },
  { id: 'accept_edits', label: 'Build', shortcut: '2' },
  { id: 'plan', label: 'Plan', shortcut: '3' }
] as const;

export interface ModelOption {
  value: string;
  label: string;
  providerId: string;
}

/**
 * Owns the composer's persisted settings: selected model, operational mode
 * and the bypass-permissions toggle, plus derived model option lists.
 */
export function useComposerSettings(providers: Ref<ProviderMetadata[]>) {
  const selectedModelCombined = ref(localStorage.getItem('bm_selected_model') || '');
  // Keep a persisted Plan/Build choice; migrate anything else (or first run) to Chat.
  const storedMode = localStorage.getItem('bm_current_mode');
  const currentMode = ref<ChatMode>(
    storedMode === 'plan' ? 'plan' : storedMode === 'accept_edits' ? 'accept_edits' : 'chat'
  );
  const bypassPermissions = ref(localStorage.getItem('bm_bypass_permissions') === 'true');

  watch(selectedModelCombined, (v) => { if (v) localStorage.setItem('bm_selected_model', v); });
  watch(currentMode, (v) => localStorage.setItem('bm_current_mode', v));
  watch(bypassPermissions, (v) => localStorage.setItem('bm_bypass_permissions', String(v)));

  const modelOptions = computed<ModelOption[]>(() => {
    const options: ModelOption[] = [];
    for (const provider of providers.value) {
      for (const model of provider.models) {
        options.push({
          value: `${provider.id}:${model}`,
          label: `${provider.displayName} / ${model}`,
          providerId: provider.id
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

  function getModeLabel(modeId: string): string {
    return MODES_LIST.find(m => m.id === modeId)?.label ?? 'Chat';
  }

  /** Picks a sensible default model (preferring Anthropic) once providers load. */
  function ensureDefaultModel() {
    if (modelOptions.value.length === 0) return;
    selectedModelCombined.value ||=
      modelOptions.value.find(o => o.providerId === 'anthropic')?.value || modelOptions.value[0].value;
  }

  return {
    selectedModelCombined,
    currentMode,
    bypassPermissions,
    modelOptions,
    activeModelDisplayName,
    getModeLabel,
    ensureDefaultModel
  };
}
