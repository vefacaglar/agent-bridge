import { computed, ref, watch, type Ref } from 'vue';
import type { ProviderMetadata } from '@agent-bridge/shared';

export type ChatMode = 'ask_permissions' | 'accept_edits' | 'plan' | 'auto';

export const MODES_LIST = [
  { id: 'ask_permissions', label: 'Ask permissions', shortcut: '1' },
  { id: 'accept_edits', label: 'Accept edits', shortcut: '2' },
  { id: 'plan', label: 'Plan mode', shortcut: '3' },
  { id: 'auto', label: 'Auto mode', shortcut: '4' }
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
  const currentMode = ref<ChatMode>((localStorage.getItem('bm_current_mode') as ChatMode) || 'accept_edits');
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
    return MODES_LIST.find(m => m.id === modeId)?.label ?? 'Accept edits';
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
