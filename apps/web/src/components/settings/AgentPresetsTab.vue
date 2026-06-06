<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import type { AgentPreset, ProviderMetadata } from '@agent-bridge/shared';
import { api } from '../../api/client';
import { useCustomDialog } from '../../composables/useCustomDialog';

const props = defineProps<{
  providers: ProviderMetadata[];
}>();

const emit = defineEmits<{
  (e: 'saved'): void;
}>();

const { showAlert, showConfirm } = useCustomDialog();

const presets = ref<AgentPreset[]>([]);
const isEditing = ref(false);
const editingOriginalId = ref<string | null>(null);

// Form fields. Architect/coder are stored as a combined "providerId:model" value.
const formId = ref('');
const formDisplayName = ref('');
const formArchitect = ref('');
const formCoder = ref('');
// Empty string => no utility tier (the "None" option).
const formUtility = ref('');
const formMaxSubAgents = ref(3);
const formFallback = ref(false);

// Flattened provider/model options for the architect + coder dropdowns.
const modelOptions = computed(() => {
  const out: { value: string; label: string }[] = [];
  for (const p of props.providers) {
    for (const m of p.models) {
      out.push({ value: `${p.id}:${m}`, label: `${p.displayName} / ${m}` });
    }
  }
  return out;
});

function combined(providerId: string, model: string): string {
  return `${providerId}:${model}`;
}

function splitCombined(value: string): { providerId: string; model: string } {
  const idx = value.indexOf(':');
  if (idx === -1) return { providerId: value, model: '' };
  return { providerId: value.slice(0, idx), model: value.slice(idx + 1) };
}

async function fetchPresets() {
  presets.value = (await api.getAgentPresets()) ?? [];
}

onMounted(fetchPresets);

function handleAdd() {
  editingOriginalId.value = null;
  formId.value = '';
  formDisplayName.value = '';
  formArchitect.value = modelOptions.value[0]?.value ?? '';
  formCoder.value = modelOptions.value[0]?.value ?? '';
  formUtility.value = '';
  formMaxSubAgents.value = 3;
  formFallback.value = false;
  isEditing.value = true;
}

function handleEdit(preset: AgentPreset) {
  editingOriginalId.value = preset.id;
  formId.value = preset.id;
  formDisplayName.value = preset.displayName;
  formArchitect.value = combined(preset.architect.providerId, preset.architect.model);
  formCoder.value = combined(preset.coder.providerId, preset.coder.model);
  formUtility.value = preset.utility ? combined(preset.utility.providerId, preset.utility.model) : '';
  formMaxSubAgents.value = preset.maxSubAgents;
  formFallback.value = !!preset.fallback;
  isEditing.value = true;
}

function cancelEdit() {
  isEditing.value = false;
  editingOriginalId.value = null;
}

/** Serializes the current preset list (plus the edited one) into the save shape. */
function toBlocks(list: AgentPreset[]): Record<string, any> {
  const blocks: Record<string, any> = {};
  for (const p of list) {
    blocks[p.id] = {
      displayName: p.displayName,
      architect: { providerId: p.architect.providerId, model: p.architect.model },
      coder: { providerId: p.coder.providerId, model: p.coder.model },
      maxSubAgents: p.maxSubAgents,
      ...(p.utility ? { utility: { providerId: p.utility.providerId, model: p.utility.model } } : {}),
      ...(p.fallback ? { fallback: true } : {})
    };
  }
  return blocks;
}

async function persist(list: AgentPreset[]) {
  await api.saveAgentPresets(toBlocks(list));
  await fetchPresets();
  emit('saved');
}

async function handleSave() {
  const id = formId.value.trim();
  if (!id) return showAlert('Please enter an id for the preset (e.g. "opusplan").');
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return showAlert('Preset id may only contain letters, numbers, "-" and "_".');
  if (!formArchitect.value || !formCoder.value) return showAlert('Please choose both an architect and a coder model.');

  // Prevent duplicate ids (unless editing the same one).
  if (id !== editingOriginalId.value && presets.value.some(p => p.id === id)) {
    return showAlert(`A preset with id "${id}" already exists.`);
  }

  const architect = splitCombined(formArchitect.value);
  const coder = splitCombined(formCoder.value);
  const next: AgentPreset = {
    id,
    displayName: formDisplayName.value.trim() || id,
    architect,
    coder,
    maxSubAgents: Math.min(3, Math.max(1, Number(formMaxSubAgents.value) || 1)),
    utility: formUtility.value ? splitCombined(formUtility.value) : undefined,
    fallback: formFallback.value
  };

  // Replace the edited preset (by original id) or append a new one.
  const list = presets.value.filter(p => p.id !== editingOriginalId.value && p.id !== id);
  list.push(next);

  try {
    await persist(list);
    isEditing.value = false;
    editingOriginalId.value = null;
  } catch (err: any) {
    showAlert(err.message || 'Failed to save preset.');
  }
}

async function handleDelete(preset: AgentPreset) {
  const ok = await showConfirm(`Delete the "${preset.displayName}" agent preset?`);
  if (!ok) return;
  try {
    await persist(presets.value.filter(p => p.id !== preset.id));
  } catch (err: any) {
    showAlert(err.message || 'Failed to delete preset.');
  }
}
</script>

<template>
  <div class="settings-tab-panel">
    <div class="settings-section-head">
      <div>
        <h2 class="settings-section-title">Agent presets</h2>
        <p class="settings-section-desc">
          Dual-model pairings (like <code>opusplan</code>): an <strong>architect</strong> model
          plans and delegates code-writing to a <strong>coder</strong> model running as 1–3
          sub-agents, with an optional cheap <strong>utility</strong> model for tiny lookups
          and renames. Selectable next to the model picker in the composer.
        </p>
      </div>
      <button v-if="!isEditing" class="add-btn" @click="handleAdd">Add preset</button>
    </div>

    <!-- Editor -->
    <div v-if="isEditing" class="preset-editor">
      <div class="form-row">
        <label>Id</label>
        <input v-model="formId" placeholder="opusplan" :disabled="!!editingOriginalId" />
      </div>
      <div class="form-row">
        <label>Display name</label>
        <input v-model="formDisplayName" placeholder="Opus Plan" />
      </div>
      <div class="form-row">
        <label>Architect model</label>
        <select v-model="formArchitect">
          <option v-for="o in modelOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </div>
      <div class="form-row">
        <label>Coder model</label>
        <select v-model="formCoder">
          <option v-for="o in modelOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </div>
      <div class="form-row">
        <label>Utility model <span class="form-hint">(optional — cheap lookups & renames)</span></label>
        <select v-model="formUtility">
          <option value="">None</option>
          <option v-for="o in modelOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </div>
      <div class="form-row">
        <label>Max sub-agents</label>
        <select v-model.number="formMaxSubAgents">
          <option :value="1">1</option>
          <option :value="2">2</option>
          <option :value="3">3</option>
        </select>
      </div>
      <label class="form-toggle">
        <input type="checkbox" v-model="formFallback" />
        <span>
          Fallback to architect
          <span class="form-hint">
            — if a delegated task fails on the utility/coder model, escalate
            (utility → coder → architect) and let the architect finish it directly.
          </span>
        </span>
      </label>
      <div class="editor-actions">
        <button class="ghost-btn" @click="cancelEdit">Cancel</button>
        <button class="add-btn" @click="handleSave">Save preset</button>
      </div>
    </div>

    <!-- List -->
    <div v-else>
      <p v-if="presets.length === 0" class="settings-empty">No agent presets yet.</p>
      <div v-for="preset in presets" :key="preset.id" class="preset-row">
        <div class="preset-info">
          <span class="preset-name">{{ preset.displayName }}</span>
          <span class="preset-flow">
            {{ preset.architect.model }} → {{ preset.coder.model }}<template v-if="preset.utility"> · utility: {{ preset.utility.model }}</template> · up to {{ preset.maxSubAgents }} sub-agent{{ preset.maxSubAgents === 1 ? '' : 's' }}<template v-if="preset.fallback"> · fallback on</template>
          </span>
        </div>
        <div class="preset-actions">
          <button class="ghost-btn" @click="handleEdit(preset)">Edit</button>
          <button class="ghost-btn danger" @click="handleDelete(preset)">Delete</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.add-btn {
  flex: 0 0 auto;
  background: var(--text);
  color: var(--bg);
  border: 0;
  border-radius: 8px;
  padding: 8px 14px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
}

.ghost-btn {
  background: transparent;
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 6px 12px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.ghost-btn:hover {
  color: var(--text);
  border-color: var(--muted);
}

.ghost-btn.danger:hover {
  color: var(--danger);
  border-color: var(--danger);
}

.preset-editor {
  display: flex;
  flex-direction: column;
  gap: 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px;
  background: var(--surface);
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-row label {
  font-size: 0.78rem;
  color: var(--muted);
}

.form-hint {
  color: var(--faint);
  font-weight: 400;
}

.form-toggle {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  font-size: 0.82rem;
  color: var(--text);
  cursor: pointer;
}

.form-toggle input {
  margin-top: 2px;
  flex: 0 0 auto;
}

.form-row input,
.form-row select {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 9px 11px;
  color: var(--text);
  font-size: 0.85rem;
}

.form-row input:disabled {
  opacity: 0.6;
}

.editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 4px;
}

.preset-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  margin-bottom: 10px;
}

.preset-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.preset-name {
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--text);
}

.preset-flow {
  font-size: 0.76rem;
  color: var(--faint);
  font-family: monospace;
}

.preset-actions {
  display: flex;
  gap: 8px;
  flex: 0 0 auto;
}
</style>
