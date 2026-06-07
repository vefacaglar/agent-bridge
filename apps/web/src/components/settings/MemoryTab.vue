<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Memory, MemoryCategory, MemoryScope } from '@agent-bridge/shared';
import ThemedSelect from './ThemedSelect.vue';

const props = defineProps<{
  memories: Memory[];
  isLoading: boolean;
  activeProjectPath: string;
  activeProjectName: string;
}>();

const emit = defineEmits<{
  (e: 'add', payload: { scope: MemoryScope; category: MemoryCategory; content: string; projectPath?: string }): void;
  (e: 'update', payload: { id: number; content: string }): void;
  (e: 'delete', id: number): void;
  (e: 'clear-all'): void;
}>();

const CATEGORIES: MemoryCategory[] = ['user', 'feedback', 'project', 'reference'];

function basename(path: string): string {
  const parts = path.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || path;
}

const globalMemories = computed(() => props.memories.filter(m => m.scope === 'global'));

// Project memories grouped by their project path, so multiple projects stay
// visually separated. Each group carries a readable label (the folder name).
const projectGroups = computed(() => {
  const byPath = new Map<string, Memory[]>();
  for (const m of props.memories) {
    if (m.scope !== 'project') continue;
    const list = byPath.get(m.projectPath) ?? [];
    list.push(m);
    byPath.set(m.projectPath, list);
  }
  return [...byPath.entries()].map(([path, items]) => ({ path, label: basename(path) || path, items }));
});

// --- Inline edit ---
const editingId = ref<number | null>(null);
const editDraft = ref('');

function startEdit(memory: Memory) {
  editingId.value = memory.id;
  editDraft.value = memory.content;
}
function cancelEdit() {
  editingId.value = null;
  editDraft.value = '';
}
function saveEdit(id: number) {
  const content = editDraft.value.trim();
  if (content) emit('update', { id, content });
  cancelEdit();
}

// --- Add form ---
const showAdd = ref(false);
const newScope = ref<MemoryScope>('global');
const newCategory = ref<MemoryCategory>('user');
const newContent = ref('');

const canAddProject = computed(() => !!props.activeProjectPath);
const scopeOptions = computed(() => [
  { value: 'global', label: 'Global (all projects)' },
  {
    value: 'project',
    label: `Project${canAddProject.value ? ` - ${props.activeProjectName}` : ' (select a project first)'}`,
    disabled: !canAddProject.value
  }
]);
const categoryOptions = computed(() => CATEGORIES.map(category => ({ value: category, label: category })));

function submitAdd() {
  const content = newContent.value.trim();
  if (!content) return;
  const scope = newScope.value === 'project' && canAddProject.value ? 'project' : 'global';
  emit('add', {
    scope,
    category: newCategory.value,
    content,
    projectPath: scope === 'project' ? props.activeProjectPath : undefined
  });
  newContent.value = '';
  showAdd.value = false;
}
</script>

<template>
  <div class="settings-tab-panel">
    <header class="settings-section-head">
      <div>
        <h3 class="settings-section-title">Memory</h3>
        <p class="settings-section-desc">
          Durable facts the assistant remembers across sessions. It saves these
          itself as it learns your preferences; global memories apply everywhere,
          project memories only to that project.
        </p>
      </div>
      <div class="mem-head-actions">
        <button class="ghost-button" @click="showAdd = !showAdd">{{ showAdd ? 'Cancel' : 'Add' }}</button>
        <button v-if="memories.length > 0" class="ghost-button danger-text" @click="emit('clear-all')">Clear all</button>
      </div>
    </header>

    <div v-if="showAdd" class="mem-add-form">
      <div class="mem-add-row">
        <label class="mem-field">
          <span class="mem-field-label">Scope</span>
          <ThemedSelect v-model="newScope" :options="scopeOptions" />
        </label>
        <label class="mem-field">
          <span class="mem-field-label">Category</span>
          <ThemedSelect v-model="newCategory" :options="categoryOptions" />
        </label>
      </div>
      <textarea
        v-model="newContent"
        class="mem-textarea"
        rows="3"
        placeholder="A durable fact to remember (1–3 sentences)…"
      ></textarea>
      <div class="mem-add-actions">
        <button class="ghost-button" :disabled="!newContent.trim()" @click="submitAdd">Save memory</button>
      </div>
    </div>

    <div v-if="isLoading" class="settings-empty">Loading…</div>

    <div v-else-if="memories.length === 0" class="settings-empty">
      No saved memories yet. The assistant will add them as it learns what you prefer.
    </div>

    <template v-else>
      <section v-if="globalMemories.length > 0" class="mem-group">
        <h4 class="mem-group-title">Global</h4>
        <ul class="mem-list">
          <li v-for="m in globalMemories" :key="m.id" class="mem-item">
            <span class="mem-category">{{ m.category }}</span>
            <div class="mem-body">
              <template v-if="editingId === m.id">
                <textarea v-model="editDraft" class="mem-textarea" rows="3"></textarea>
                <div class="mem-edit-actions">
                  <button class="ghost-button" :disabled="!editDraft.trim()" @click="saveEdit(m.id)">Save</button>
                  <button class="ghost-button muted" @click="cancelEdit">Cancel</button>
                </div>
              </template>
              <span v-else class="mem-content">{{ m.content }}</span>
            </div>
            <div v-if="editingId !== m.id" class="mem-actions">
              <button class="mem-btn" title="Edit" @click="startEdit(m)">Edit</button>
              <button class="mem-btn danger" title="Delete" @click="emit('delete', m.id)">Delete</button>
            </div>
          </li>
        </ul>
      </section>

      <section v-for="group in projectGroups" :key="group.path" class="mem-group">
        <h4 class="mem-group-title">
          Project · <span class="mem-group-path">{{ group.label }}</span>
        </h4>
        <ul class="mem-list">
          <li v-for="m in group.items" :key="m.id" class="mem-item">
            <span class="mem-category">{{ m.category }}</span>
            <div class="mem-body">
              <template v-if="editingId === m.id">
                <textarea v-model="editDraft" class="mem-textarea" rows="3"></textarea>
                <div class="mem-edit-actions">
                  <button class="ghost-button" :disabled="!editDraft.trim()" @click="saveEdit(m.id)">Save</button>
                  <button class="ghost-button muted" @click="cancelEdit">Cancel</button>
                </div>
              </template>
              <span v-else class="mem-content">{{ m.content }}</span>
            </div>
            <div v-if="editingId !== m.id" class="mem-actions">
              <button class="mem-btn" title="Edit" @click="startEdit(m)">Edit</button>
              <button class="mem-btn danger" title="Delete" @click="emit('delete', m.id)">Delete</button>
            </div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.mem-head-actions {
  display: flex;
  gap: 8px;
  flex: 0 0 auto;
}

.mem-add-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  margin-bottom: 18px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.mem-add-row {
  display: flex;
  gap: 12px;
}

.mem-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 0;
}

.mem-field-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}

.mem-textarea {
  width: 100%;
  box-sizing: border-box;
  background: var(--control-bg);
  border: 1px solid var(--control-border);
  border-radius: 6px;
  color: var(--text);
  padding: 8px 10px;
  font-size: 0.88rem;
  font-family: inherit;
  line-height: 1.5;
  resize: vertical;
}

.mem-textarea:focus {
  border-color: var(--control-border-focus);
  outline: none;
}

.mem-add-actions,
.mem-edit-actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}

.mem-group {
  margin-bottom: 20px;
}

.mem-group-title {
  margin: 0 0 8px;
  font-size: 0.74rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
  font-weight: 600;
}

.mem-group-path {
  font-family: monospace;
  text-transform: none;
  letter-spacing: 0;
  color: var(--faint);
}

.mem-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mem-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.mem-category {
  flex: 0 0 auto;
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  background: var(--surface-strong);
  border: 1px solid var(--border);
  padding: 3px 7px;
  border-radius: 5px;
}

.mem-body {
  flex: 1 1 auto;
  min-width: 0;
}

.mem-content {
  font-size: 0.9rem;
  color: var(--text);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.mem-actions {
  flex: 0 0 auto;
  display: flex;
  gap: 6px;
}

.mem-btn {
  background: var(--surface-strong);
  color: var(--muted);
  border: 1px solid var(--border);
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.mem-btn:hover {
  color: var(--text);
  border-color: var(--muted);
}

.mem-btn.danger {
  background: var(--danger-soft);
  color: var(--danger);
  border-color: var(--danger-border);
}

.mem-btn.danger:hover {
  background: var(--danger-soft-strong);
  border-color: var(--danger);
}

.danger-text {
  color: var(--danger);
}
</style>
