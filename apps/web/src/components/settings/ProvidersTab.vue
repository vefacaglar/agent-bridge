<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { ProviderModelSettings, ReasoningEffort, ReasoningOption, ReasoningStyle, PriceTier } from '@locagens/shared';
import { api } from '../../api/client';
import { useCustomDialog } from '../../composables/useCustomDialog';
import ThemedSelect from './ThemedSelect.vue';
import ThemedButton from '../ThemedButton.vue';

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

type PriceTierRow = {
  upToInputTokens: number | null;
  inputRate: number | null;
  outputRate: number | null;
  cacheReadRate: number | null;
  cacheWriteRate: number | null;
};

type ModelRow = {
  name: string;
  reasoningStyle: ReasoningStyle;
  reasoningOptions: ReasoningOption[];
  contextLimit: number | null;
  pricingTiers: PriceTierRow[];
};

function defaultReasoningStyle(): ReasoningStyle {
  return formType.value === 'anthropic' ? 'anthropic-budget' : 'openai-chat';
}

function emptyModelRow(name = ''): ModelRow {
  return { name, reasoningStyle: defaultReasoningStyle(), reasoningOptions: [], contextLimit: null, pricingTiers: [] };
}

function emptyPriceTierRow(): PriceTierRow {
  return { upToInputTokens: null, inputRate: null, outputRate: null, cacheReadRate: null, cacheWriteRate: null };
}

function addPricingTier(row: ModelRow) {
  row.pricingTiers.push(emptyPriceTierRow());
}

function removePricingTier(row: ModelRow, index: number) {
  row.pricingTiers.splice(index, 1);
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
  const pricingTiers = (settings?.pricing?.tiers || []).map(tier => ({
    upToInputTokens: tier.upToInputTokens ?? null,
    inputRate: tier.inputRate ?? null,
    outputRate: tier.outputRate ?? null,
    cacheReadRate: tier.cacheReadRate ?? null,
    cacheWriteRate: tier.cacheWriteRate ?? null
  }));
  return { name, reasoningStyle: style, reasoningOptions: options, contextLimit: settings?.contextLimit ?? null, pricingTiers };
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

function pricingSummary(settings?: ProviderModelSettings): string {
  const tiers = settings?.pricing?.tiers;
  if (!tiers?.length) return '';
  if (tiers.length === 1) return `$${tiers[0].inputRate}/$${tiers[0].outputRate} per 1M`;
  return `${tiers.length} tiers`;
}

function contextSummary(settings?: ProviderModelSettings): string {
  const limit = settings?.contextLimit;
  if (!limit) return '';
  return limit >= 1000 ? `${Math.round(limit / 1000)}k ctx` : `${limit} ctx`;
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
      reasoningOptions: row.reasoningOptions,
      contextLimit: row.contextLimit,
      pricingTiers: row.pricingTiers
    }))
    .filter(row => row.name);
  const modelsArray = modelRows
    .map(row => row.name)
    .filter((model, index, arr) => arr.indexOf(model) === index);
  const modelSettings = Object.fromEntries(modelRows
    .map(row => {
      const settings: Record<string, unknown> = {};
      if (row.reasoningOptions.length > 0) {
        settings.reasoning = { style: row.reasoningStyle, options: row.reasoningOptions };
      }
      if (row.contextLimit && row.contextLimit > 0) {
        settings.contextLimit = row.contextLimit;
      }
      const tiers = row.pricingTiers
        .filter(tier => tier.inputRate != null && tier.outputRate != null)
        .map(tier => {
          const clean: PriceTier = { inputRate: Number(tier.inputRate), outputRate: Number(tier.outputRate) };
          if (tier.upToInputTokens != null && tier.upToInputTokens > 0) clean.upToInputTokens = Number(tier.upToInputTokens);
          if (tier.cacheReadRate != null) clean.cacheReadRate = Number(tier.cacheReadRate);
          if (tier.cacheWriteRate != null) clean.cacheWriteRate = Number(tier.cacheWriteRate);
          return clean;
        });
      if (tiers.length > 0) settings.pricing = { tiers };
      return [row.name, settings] as const;
    })
    .filter(([, settings]) => Object.keys(settings).length > 0));

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
      <ThemedButton 
        v-if="!isEditing" 
        variant="primary" 
        size="sm"
        @click="handleAddProvider"
      >
        Add Provider
      </ThemedButton>
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
                <ThemedButton
                  v-for="style in reasoningStyleChoices"
                  :key="style.id"
                  variant="chip"
                  size="sm"
                  :active="row.reasoningStyle === style.id"
                  @click="setReasoningStyle(row, style.id)"
                >
                  {{ style.label }}
                </ThemedButton>
              </div>
              <div class="reasoning-effort-checks">
                <ThemedButton
                  v-for="effort in reasoningEffortChoices"
                  :key="effort.id"
                  variant="chip"
                  size="sm"
                  :active="isReasoningEffortSelected(row, effort.id)"
                  @click="toggleReasoningEffort(index, effort.id)"
                >
                  {{ effort.label }}
                </ThemedButton>
              </div>
              <div v-if="row.reasoningStyle === 'anthropic-budget' && row.reasoningOptions.length" class="budget-inputs">
                <label v-for="option in row.reasoningOptions" :key="option.id" class="budget-input">
                  <span>{{ option.label || option.id }}</span>
                  <input v-model.number="option.budgetTokens" type="number" min="1024" step="1024" />
                </label>
              </div>

              <div class="pricing-editor">
                <div class="pricing-row context-row">
                  <label class="pricing-field">
                    <span>Context limit (tokens)</span>
                    <input v-model.number="row.contextLimit" type="number" min="0" step="1000" placeholder="e.g. 1000000" />
                  </label>
                </div>

                <div class="pricing-head">
                  <span class="pricing-label">Pricing (USD per 1M tokens)</span>
                  <span class="pricing-hint">Add multiple tiers for size-based rates (e.g. ≤250k vs &gt;250k). Leave the last tier's threshold blank.</span>
                </div>

                <div v-for="(tier, tIndex) in row.pricingTiers" :key="tIndex" class="pricing-row tier-row">
                  <label class="pricing-field">
                    <span>≤ prompt tokens</span>
                    <input v-model.number="tier.upToInputTokens" type="number" min="0" step="1000" placeholder="∞ (last)" />
                  </label>
                  <label class="pricing-field">
                    <span>Input</span>
                    <input v-model.number="tier.inputRate" type="number" min="0" step="0.01" placeholder="0.00" />
                  </label>
                  <label class="pricing-field">
                    <span>Output</span>
                    <input v-model.number="tier.outputRate" type="number" min="0" step="0.01" placeholder="0.00" />
                  </label>
                  <label class="pricing-field">
                    <span>Cache read</span>
                    <input v-model.number="tier.cacheReadRate" type="number" min="0" step="0.01" placeholder="—" />
                  </label>
                  <label class="pricing-field">
                    <span>Cache write</span>
                    <input v-model.number="tier.cacheWriteRate" type="number" min="0" step="0.01" placeholder="—" />
                  </label>
                  <button type="button" class="danger-button tier-remove-btn" @click="removePricingTier(row, tIndex)" title="Remove tier">×</button>
                </div>

                <ThemedButton variant="secondary" size="sm" @click="addPricingTier(row)">
                  {{ row.pricingTiers.length ? 'Add Pricing Tier' : 'Add Pricing' }}
                </ThemedButton>
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
              <ThemedButton 
                variant="secondary"
                size="sm"
                @click="addModelInput"
              >
                Add Model
              </ThemedButton>
              <ThemedButton 
                v-if="canFetchModels"
                variant="secondary"
                size="sm"
                :disabled="isFetchingModels"
                @click="handleFetchModels"
                style="color: var(--success);"
              >
                {{ isFetchingModels ? 'Fetching...' : '⚡ Fetch Models from API' }}
              </ThemedButton>
            </div>
          </div>
        </div>
      </div>

      <div class="form-actions">
        <ThemedButton v-if="editingProviderId" variant="danger" class="delete-btn" @click="handleDeleteProvider">
          Delete Provider
        </ThemedButton>
        <ThemedButton variant="secondary" @click="isEditing = false">Cancel</ThemedButton>
        <ThemedButton variant="primary" @click="handleSave">Save Configuration</ThemedButton>
      </div>
    </div>

    <div v-else-if="Object.keys(configs).length === 0" class="settings-empty">
      No providers configured. Click "Add Provider" to create one.
    </div>

    <ul v-else class="provider-list">
      <li v-for="(provider, id) in configs" :key="id" class="provider-item">
        <div class="provider-head">
          <span class="provider-name">{{ provider.displayName }}</span>
          <span class="provider-type">{{ provider.type }}</span>
          <span class="provider-id-badge">ID: {{ id }}</span>
          <ThemedButton 
            variant="secondary"
            size="sm"
            style="margin-left: auto;"
            @click="handleEditProvider(id)"
          >
            Edit
          </ThemedButton>
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
            <template v-if="contextSummary(provider.modelSettings?.[model])">
              · {{ contextSummary(provider.modelSettings?.[model]) }}
            </template>
            <template v-if="pricingSummary(provider.modelSettings?.[model])">
              · {{ pricingSummary(provider.modelSettings?.[model]) }}
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
  background: var(--surface);
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
  font-weight: 400;
  color: var(--muted);
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
  background: var(--perm-content-bg);
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

.reasoning-effort-checks {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  max-width: 320px;
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

.pricing-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1 1 100%;
  border-top: 1px dashed var(--border);
  padding-top: 10px;
  margin-top: 2px;
}

.pricing-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pricing-label {
  font-size: 0.74rem;
  font-weight: 500;
  color: var(--muted);
}

.pricing-hint {
  font-size: 0.68rem;
  color: var(--faint);
}

.pricing-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: flex-end;
}

.pricing-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  color: var(--faint);
  font-size: 0.68rem;
}

.pricing-field input {
  width: 110px;
  min-width: 90px;
  padding: 5px 7px;
  font-size: 0.75rem;
  background: var(--control-bg);
  border: 1px solid var(--control-border);
  border-radius: 6px;
  color: var(--text);
  outline: none;
}

.pricing-field input:focus {
  border-color: var(--control-border-focus);
}

.tier-remove-btn {
  height: 28px;
  width: 28px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
}

.tier-remove-btn:hover {
  color: var(--danger);
  background: var(--danger-soft);
  border-color: var(--danger-border);
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
</style>
