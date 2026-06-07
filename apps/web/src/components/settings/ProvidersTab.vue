<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { ProviderModelSettings, ReasoningEffort, ReasoningOption, ReasoningStyle } from '@agent-bridge/shared';
import { api } from '../../api/client';
import { useCustomDialog } from '../../composables/useCustomDialog';
import ThemedSelect from './ThemedSelect.vue';

const props = defineProps<{
  providersConfig: Record<string, any>;
  isLoading: boolean;
}>();

const emit = defineEmits<{
  (e: 'saved'): void;
}>();

const { showAlert, showConfirm } = useCustomDialog();

const PRESERVE_API_KEY_VALUE = '__LOCAGENS_PRESERVE_API_KEY__';

const configs = ref<Record<string, any>>({});
watch(() => props.providersConfig, (newVal) => {
  configs.value = { ...newVal };
}, { immediate: true });

const isEditing = ref(false);
const editingProviderId = ref<string | null>(null);

// Form fields
const formId = ref('');
const formType = ref<'openai-compatible' | 'anthropic'>('openai-compatible');
const formDisplayName = ref('');
const formBaseUrl = ref('');
const formApiKey = ref('');
const formModelRows = ref<ModelRow[]>([]);
const providerTypeOptions = [
  { value: 'openai-compatible', label: 'OpenAI Compatible' },
  { value: 'anthropic', label: 'Anthropic' }
];

const reasoningEffortChoices: { id: ReasoningEffort; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'minimal', label: 'Minimal' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'XHigh' },
  { id: 'max', label: 'Max' }
];

const reasoningStyleChoices: { id: ReasoningStyle; label: string }[] = [
  { id: 'openai-chat', label: 'OpenAI-compatible reasoning_effort' },
  { id: 'anthropic-budget', label: 'Anthropic thinking budget' }
];

type ModelRow = {
  name: string;
  reasoningStyle: ReasoningStyle;
  reasoningOptions: ReasoningOption[];
};

function defaultReasoningStyle(): ReasoningStyle {
  return formType.value === 'anthropic' ? 'anthropic-budget' : 'openai-chat';
}

function emptyModelRow(name = ''): ModelRow {
  return { name, reasoningStyle: defaultReasoningStyle(), reasoningOptions: [] };
}



function handleAddProvider() {
  editingProviderId.value = null;
  formId.value = '';
  formType.value = 'openai-compatible';
  formDisplayName.value = '';
  formBaseUrl.value = '';
  formApiKey.value = '';
  formModelRows.value = [emptyModelRow()];
  isEditing.value = true;
}

function handleEditProvider(id: string) {
  const block = configs.value[id];
  if (!block) return;
  
  editingProviderId.value = id;
  formId.value = id;
  formType.value = block.type;
  formDisplayName.value = block.displayName;
  formBaseUrl.value = block.baseUrl;
  formApiKey.value = block.apiKey === PRESERVE_API_KEY_VALUE ? '' : block.apiKey || '';
  formModelRows.value = block.models && block.models.length > 0
    ? block.models.map((model: string) => modelRowFromSettings(model, block.modelSettings?.[model]))
    : [emptyModelRow()];
  isEditing.value = true;
}

function addModelInput() {
  formModelRows.value.push(emptyModelRow());
}

function removeModelInput(index: number) {
  formModelRows.value.splice(index, 1);
}

function toggleReasoningEffort(index: number, effort: ReasoningEffort) {
  const row = formModelRows.value[index];
  if (!row) return;
  row.reasoningOptions = row.reasoningOptions.some(x => x.id === effort)
    ? row.reasoningOptions.filter(x => x.id !== effort)
    : [...row.reasoningOptions, defaultReasoningOption(row.reasoningStyle, effort)];
}

function setReasoningStyle(row: ModelRow, style: ReasoningStyle) {
  row.reasoningStyle = style;
  row.reasoningOptions = row.reasoningOptions.map(option => ({
    ...option,
    ...(style === 'anthropic-budget'
      ? { budgetTokens: option.budgetTokens || defaultBudgetTokens(option.id) }
      : { budgetTokens: undefined })
  }));
}

function isReasoningEffortSelected(row: ModelRow, effort: ReasoningEffort): boolean {
  return row.reasoningOptions.some(option => option.id === effort);
}

function modelRowFromSettings(name: string, settings?: ProviderModelSettings): ModelRow {
  const reasoning = settings?.reasoning || settings;
  const style = reasoning?.style || defaultReasoningStyle();
  const options = reasoning?.options?.length
    ? reasoning.options.map(option => ({ ...option }))
    : (reasoning?.reasoningEfforts || []).map(id => defaultReasoningOption(style, id));
  return { name, reasoningStyle: style, reasoningOptions: options };
}

function defaultReasoningOption(style: ReasoningStyle, id: ReasoningEffort): ReasoningOption {
  return {
    id,
    label: reasoningEffortChoices.find(effort => effort.id === id)?.label || id,
    value: id,
    ...(style === 'anthropic-budget' ? { budgetTokens: defaultBudgetTokens(id) } : {})
  };
}

function defaultBudgetTokens(id: ReasoningEffort): number {
  if (id === 'low' || id === 'minimal') return 1024;
  if (id === 'medium') return 4096;
  if (id === 'high') return 10000;
  if (id === 'xhigh') return 32000;
  if (id === 'max') return 64000;
  return 1024;
}

function reasoningSummary(settings?: ProviderModelSettings): string {
  const reasoning = settings?.reasoning || settings;
  const options = reasoning?.options?.length
    ? reasoning.options
    : (reasoning?.reasoningEfforts || []).map(id => defaultReasoningOption(reasoning?.style || defaultReasoningStyle(), id));
  return options.map(option => option.label || option.id).join(', ');
}

async function handleDeleteProvider() {
  if (!editingProviderId.value) return;
  if (!(await showConfirm(`Are you sure you want to delete the provider "${editingProviderId.value}"?`))) return;

  const newConfigs = { ...configs.value };
  delete newConfigs[editingProviderId.value];

  try {
    await api.saveProvidersConfig(newConfigs);
    configs.value = newConfigs;
    isEditing.value = false;
    emit('saved');
  } catch (err: any) {
    await showAlert(err.message || 'An error occurred.');
  }
}

async function handleSave() {
  const idSlug = formId.value.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
  if (!idSlug) {
    await showAlert('Provider ID is required (only lowercase letters, numbers, hyphens, and underscores).');
    return;
  }
  if (!formDisplayName.value.trim()) {
    await showAlert('Display Name is required.');
    return;
  }
  if (!formBaseUrl.value.trim()) {
    await showAlert('Base URL is required.');
    return;
  }

  const modelRows = formModelRows.value
    .map(row => ({
      name: row.name.trim(),
      reasoningStyle: row.reasoningStyle,
      reasoningOptions: row.reasoningOptions
    }))
    .filter(row => row.name);
  const modelsArray = modelRows
    .map(row => row.name)
    .filter((model, index, arr) => arr.indexOf(model) === index);
  const modelSettings = Object.fromEntries(modelRows
    .filter(row => row.reasoningOptions.length > 0)
    .map(row => [row.name, { reasoning: { style: row.reasoningStyle, options: row.reasoningOptions } }]));

  const currentBlock = editingProviderId.value ? configs.value[editingProviderId.value] : null;
  const trimmedApiKey = formApiKey.value.trim();
  const updatedBlock = {
    type: formType.value,
    displayName: formDisplayName.value.trim(),
    baseUrl: formBaseUrl.value.trim(),
    apiKey: trimmedApiKey || (currentBlock?.hasApiKey ? PRESERVE_API_KEY_VALUE : ''),
    models: modelsArray,
    modelSettings
  };

  const newConfigs = { ...configs.value };
  
  if (editingProviderId.value && editingProviderId.value !== idSlug) {
    delete newConfigs[editingProviderId.value];
  }
  
  newConfigs[idSlug] = updatedBlock;

  try {
    await api.saveProvidersConfig(newConfigs);
    configs.value = newConfigs;
    isEditing.value = false;
    emit('saved');
  } catch (err: any) {
    await showAlert(err.message || 'An error occurred.');
  }
}

const canFetchModels = computed(() => {
  if (formType.value === 'anthropic') return false;
  const idLower = formId.value.trim().toLowerCase();
  if (idLower === 'openai') return false;
  const urlLower = formBaseUrl.value.trim().toLowerCase();
  if (urlLower.includes('api.openai.com')) return false;
  return true;
});

const isFetchingModels = ref(false);

async function handleFetchModels() {
  if (!formBaseUrl.value.trim()) {
    await showAlert('Please enter a Base URL first to fetch models.');
    return;
  }

  isFetchingModels.value = true;
  try {
    const res = await api.fetchModels({
      type: formType.value,
      baseUrl: formBaseUrl.value.trim(),
      apiKey: formApiKey.value.trim(),
      providerId: editingProviderId.value || undefined
    });

    if (res.success && res.models && res.models.length > 0) {
      formModelRows.value = res.models.map(model => emptyModelRow(model));
    } else if (res.error) {
      await showAlert(`Failed to fetch models: ${res.error}`);
    } else {
      await showAlert('No models returned from provider.');
    }
  } catch (err: any) {
    await showAlert(`Error fetching models: ${err.message || err}`);
  } finally {
    isFetchingModels.value = false;
  }
}
</script>

<template>
  <div class="settings-tab-panel">
    <header class="settings-section-head">
      <div>
        <h3 class="settings-section-title">Providers</h3>
        <p class="settings-section-desc">
          Configure model providers and API keys. Secrets are stored in macOS Keychain when available.
        </p>
      </div>
      <button 
        v-if="!isEditing" 
        class="primary-button" 
        style="min-height: 32px; padding: 0 12px; font-size: 0.8rem;"
        @click="handleAddProvider"
      >
        + Add Provider
      </button>
    </header>

    <div v-if="isLoading" class="settings-empty">
      Loading configurations...
    </div>

    <div v-else-if="isEditing" class="edit-form-card">
      <h4 class="form-title">
        {{ editingProviderId ? 'Edit Provider: ' + formDisplayName : 'Add New Provider' }}
      </h4>

      <div class="form-grid">
        <div class="form-group">
          <label>Provider ID (slug, e.g. openai, custom-ollama)</label>
          <input 
            v-model="formId" 
            type="text" 
            placeholder="e.g. custom-ollama" 
            :disabled="!!editingProviderId"
          />
        </div>

        <div class="form-group">
          <label>Display Name</label>
          <input v-model="formDisplayName" type="text" placeholder="e.g. Local Ollama" />
        </div>

        <div class="form-group">
          <label>Provider Type</label>
          <ThemedSelect v-model="formType" :options="providerTypeOptions" />
        </div>

        <div class="form-group">
          <label>Base URL</label>
          <input v-model="formBaseUrl" type="text" placeholder="e.g. http://localhost:11434/v1" />
        </div>

        <div class="form-group">
          <label>API Key</label>
          <input v-model="formApiKey" type="password" :placeholder="editingProviderId && configs[editingProviderId]?.hasApiKey ? 'Leave blank to keep existing key' : 'API Key or secret token'" />
        </div>

        <div class="form-group full-width">
          <label>Available Models</label>
          <div class="models-edit-list">
            <div v-for="(row, index) in formModelRows" :key="index" class="model-input-row">
              <input 
                v-model="row.name" 
                type="text" 
                placeholder="e.g. gpt-4o or deepseek/deepseek-chat" 
              />
              <div class="reasoning-style-toggle">
                <button
                  v-for="style in reasoningStyleChoices"
                  :key="style.id"
                  type="button"
                  class="style-chip"
                  :class="{ active: row.reasoningStyle === style.id }"
                  @click="setReasoningStyle(row, style.id)"
                >
                  {{ style.label }}
                </button>
              </div>
              <div class="reasoning-effort-checks">
                <button
                  v-for="effort in reasoningEffortChoices"
                  :key="effort.id"
                  type="button"
                  class="effort-chip"
                  :class="{ active: isReasoningEffortSelected(row, effort.id) }"
                  @click="toggleReasoningEffort(index, effort.id)"
                >
                  {{ effort.label }}
                </button>
              </div>
              <div v-if="row.reasoningStyle === 'anthropic-budget' && row.reasoningOptions.length" class="budget-inputs">
                <label v-for="option in row.reasoningOptions" :key="option.id" class="budget-input">
                  <span>{{ option.label || option.id }}</span>
                  <input v-model.number="option.budgetTokens" type="number" min="1024" step="1024" />
                </label>
              </div>
              <button 
                type="button" 
                class="danger-button delete-model-btn" 
                @click="removeModelInput(index)"
                title="Remove model"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 6h18"/>
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                </svg>
              </button>
            </div>
            <div style="display: flex; gap: 8px;">
              <button 
                type="button" 
                class="ghost-button add-model-btn" 
                @click="addModelInput"
              >
                + Add Model
              </button>
              <button 
                v-if="canFetchModels"
                type="button" 
                class="ghost-button fetch-models-btn" 
                :disabled="isFetchingModels"
                @click="handleFetchModels"
              >
                {{ isFetchingModels ? 'Fetching...' : '⚡ Fetch Models from API' }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="form-actions">
        <button v-if="editingProviderId" class="danger-button delete-btn" @click="handleDeleteProvider">
          Delete Provider
        </button>
        <button class="ghost-button" @click="isEditing = false">Cancel</button>
        <button class="primary-button" @click="handleSave">Save Configuration</button>
      </div>
    </div>

    <div v-else-if="Object.keys(configs).length === 0" class="settings-empty">
      No providers configured. Click "+ Add Provider" to create one.
    </div>

    <ul v-else class="provider-list">
      <li v-for="(provider, id) in configs" :key="id" class="provider-item">
        <div class="provider-head">
          <span class="provider-name">{{ provider.displayName }}</span>
          <span class="provider-type">{{ provider.type }}</span>
          <span class="provider-id-badge">ID: {{ id }}</span>
          <button 
            class="ghost-button edit-btn" 
            style="margin-left: auto; min-height: 26px; padding: 0 10px; font-size: 0.75rem;"
            @click="handleEditProvider(id)"
          >
            Edit
          </button>
        </div>
        <div class="provider-details">
          <div class="detail-item"><strong>Base URL:</strong> <code>{{ provider.baseUrl }}</code></div>
          <div class="detail-item"><strong>API Key:</strong> <code>{{ provider.hasApiKey ? '••••••••••••••••' : 'Not set' }}</code></div>
        </div>
        <div class="provider-models">
          <span v-for="model in provider.models" :key="model" class="provider-model-pill">
            {{ model }}
            <template v-if="reasoningSummary(provider.modelSettings?.[model])">
              · effort: {{ reasoningSummary(provider.modelSettings?.[model]) }}
            </template>
          </span>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.provider-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.provider-item {
  padding: 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.provider-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.provider-name {
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--text);
}

.provider-type {
  font-size: 0.72rem;
  color: var(--muted);
  background: var(--surface-strong);
  border: 1px solid var(--border);
  padding: 2px 8px;
  border-radius: 20px;
  font-family: monospace;
}

.provider-id-badge {
  font-size: 0.72rem;
  color: var(--faint);
  font-family: monospace;
}

.provider-details {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.82rem;
  color: var(--muted);
}

.provider-details code {
  font-family: monospace;
  background: var(--surface-strong);
  padding: 1px 6px;
  border-radius: 4px;
  color: var(--text);
}

.provider-models {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  border-top: 1px dashed var(--border);
  padding-top: 10px;
  margin-top: 2px;
}

.provider-model-pill {
  font-size: 0.75rem;
  font-family: monospace;
  color: var(--muted);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border);
  padding: 3px 8px;
  border-radius: 6px;
}

/* Edit form styling */
.edit-form-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 20px;
  margin-bottom: 20px;
}

.form-title {
  margin: 0 0 18px 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin-bottom: 20px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group.full-width {
  grid-column: span 2;
}

.form-group label {
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--muted);
}

.form-group input {
  background: var(--control-bg);
  border: 1px solid var(--control-border);
  border-radius: 6px;
  padding: 8px 12px;
  color: var(--text);
  outline: none;
  font-size: 0.88rem;
  transition: border-color 0.2s ease;
}

.form-group input:focus {
  border-color: var(--control-border-focus);
}

.form-group input:disabled {
  background: var(--control-bg);
  color: var(--faint);
  cursor: not-allowed;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  border-top: 1px solid var(--border);
  padding-top: 16px;
  margin-top: 10px;
}

.form-actions .delete-btn {
  margin-right: auto;
}

/* Dynamic models list editor styles */
.models-edit-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: rgba(255, 255, 255, 0.01);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px;
}

.model-input-row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.model-input-row input {
  flex: 1;
  min-width: 180px;
}

.reasoning-style-toggle {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  flex: 1 1 100%;
}

.style-chip {
  min-height: 26px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.02);
  color: var(--faint);
  font-size: 0.72rem;
  cursor: pointer;
}

.style-chip.active {
  color: var(--text);
  border-color: rgba(164, 164, 162, 0.28);
  background: rgba(164, 164, 162, 0.1);
}

.reasoning-effort-checks {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  max-width: 320px;
}

.effort-chip {
  min-height: 26px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.02);
  color: var(--faint);
  font-size: 0.72rem;
  cursor: pointer;
}

.effort-chip.active {
  color: var(--text);
  border-color: rgba(164, 164, 162, 0.28);
  background: rgba(164, 164, 162, 0.1);
}

.budget-inputs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex: 1 1 100%;
  padding-left: 2px;
}

.budget-input {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--faint);
  font-size: 0.72rem;
}

.budget-input input {
  width: 96px;
  min-width: 96px;
  padding: 5px 7px;
  font-size: 0.75rem;
}

.delete-model-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  width: 36px;
  height: 36px;
  border-radius: 6px;
  flex-shrink: 0;
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted);
  transition: all 0.2s ease;
}

.delete-model-btn:hover {
  color: var(--danger);
  background: var(--danger-soft);
  border-color: var(--danger-border);
}

.add-model-btn {
  align-self: flex-start;
  min-height: 28px;
  padding: 0 10px;
  font-size: 0.75rem;
  margin-top: 4px;
}

.fetch-models-btn {
  align-self: flex-start;
  min-height: 28px;
  padding: 0 10px;
  font-size: 0.75rem;
  margin-top: 4px;
  color: var(--success);
  border-color: var(--success-border);
  transition: all 0.2s ease;
}

.fetch-models-btn:hover:not(:disabled) {
  background: var(--success-soft);
  border-color: var(--success-border);
  color: var(--success);
}

.fetch-models-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
