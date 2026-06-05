<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { api } from '../../api/client';

const configs = ref<Record<string, any>>({});
const isEditing = ref(false);
const editingProviderId = ref<string | null>(null);
const isLoading = ref(false);

// Form fields
const formId = ref('');
const formType = ref<'openai-compatible' | 'anthropic'>('openai-compatible');
const formDisplayName = ref('');
const formBaseUrl = ref('');
const formApiKey = ref('');
const formModelsList = ref<string[]>([]);

async function fetchConfigs() {
  isLoading.value = true;
  try {
    const data = await api.getProvidersConfig();
    if (data) {
      configs.value = data;
    }
  } catch (err) {
    console.error('Failed to load configs:', err);
  } finally {
    isLoading.value = false;
  }
}

onMounted(() => {
  fetchConfigs();
});

function handleAddProvider() {
  editingProviderId.value = null;
  formId.value = '';
  formType.value = 'openai-compatible';
  formDisplayName.value = '';
  formBaseUrl.value = '';
  formApiKey.value = '';
  formModelsList.value = [''];
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
  formApiKey.value = block.apiKey || '';
  formModelsList.value = block.models ? [...block.models] : [''];
  isEditing.value = true;
}

function addModelInput() {
  formModelsList.value.push('');
}

function removeModelInput(index: number) {
  formModelsList.value.splice(index, 1);
}

async function handleDeleteProvider() {
  if (!editingProviderId.value) return;
  if (!window.confirm(`Are you sure you want to delete the provider "${editingProviderId.value}"?`)) return;

  const newConfigs = { ...configs.value };
  delete newConfigs[editingProviderId.value];

  try {
    await api.saveProvidersConfig(newConfigs);
    configs.value = newConfigs;
    isEditing.value = false;
    window.location.reload();
  } catch (err: any) {
    window.alert(err.message || 'Hata oluştu.');
  }
}

async function handleSave() {
  const idSlug = formId.value.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
  if (!idSlug) {
    window.alert('Provider ID is required (only lowercase letters, numbers, hyphens, and underscores).');
    return;
  }
  if (!formDisplayName.value.trim()) {
    window.alert('Display Name is required.');
    return;
  }
  if (!formBaseUrl.value.trim()) {
    window.alert('Base URL is required.');
    return;
  }

  const modelsArray = formModelsList.value
    .map(m => m.trim())
    .filter(Boolean);

  const updatedBlock = {
    type: formType.value,
    displayName: formDisplayName.value.trim(),
    baseUrl: formBaseUrl.value.trim(),
    apiKey: formApiKey.value.trim(),
    models: modelsArray
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
    window.location.reload();
  } catch (err: any) {
    window.alert(err.message || 'Hata oluştu.');
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
    window.alert('Please enter a Base URL first to fetch models.');
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
      formModelsList.value = res.models;
    } else if (res.error) {
      window.alert(`Failed to fetch models: ${res.error}`);
    } else {
      window.alert('No models returned from provider.');
    }
  } catch (err: any) {
    window.alert(`Error fetching models: ${err.message || err}`);
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
          Configure model providers and API keys. The configurations are saved to <code>providers.local.json</code>.
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
          <select v-model="formType">
            <option value="openai-compatible">OpenAI Compatible</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </div>

        <div class="form-group">
          <label>Base URL</label>
          <input v-model="formBaseUrl" type="text" placeholder="e.g. http://localhost:11434/v1" />
        </div>

        <div class="form-group">
          <label>API Key</label>
          <input v-model="formApiKey" type="password" placeholder="API Key or secret token" />
        </div>

        <div class="form-group full-width">
          <label>Available Models</label>
          <div class="models-edit-list">
            <div v-for="(_, index) in formModelsList" :key="index" class="model-input-row">
              <input 
                v-model="formModelsList[index]" 
                type="text" 
                placeholder="e.g. gpt-4o or deepseek/deepseek-chat" 
              />
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
          <div class="detail-item"><strong>API Key:</strong> <code>••••••••••••••••</code></div>
        </div>
        <div class="provider-models">
          <span v-for="model in provider.models" :key="model" class="provider-model-pill">{{ model }}</span>
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
  background: rgba(255, 255, 255, 0.02);
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
  background: rgba(255, 255, 255, 0.02);
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

.form-group input,
.form-group select {
  background: #111111;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 12px;
  color: var(--text);
  outline: none;
  font-size: 0.88rem;
  transition: border-color 0.2s ease;
}

.form-group input:focus,
.form-group select:focus {
  border-color: #555;
}

.form-group input:disabled {
  background: rgba(255, 255, 255, 0.02);
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
}

.model-input-row input {
  flex: 1;
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
  background: rgba(255, 138, 128, 0.1);
  border-color: rgba(255, 138, 128, 0.3);
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
  border-color: rgba(74, 222, 128, 0.2);
  transition: all 0.2s ease;
}

.fetch-models-btn:hover:not(:disabled) {
  background: rgba(74, 222, 128, 0.08);
  border-color: rgba(74, 222, 128, 0.4);
  color: #6ee7b7;
}

.fetch-models-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
