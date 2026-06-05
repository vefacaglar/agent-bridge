<script setup lang="ts">
import type { PermissionRule } from '@bridgemind/shared';

defineProps<{
  permissions: PermissionRule[];
  isLoading: boolean;
}>();

const emit = defineEmits<{
  (e: 'revoke', id: number): void;
  (e: 'clear-all'): void;
}>();

function basename(path: string): string {
  const parts = path.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || path;
}
</script>

<template>
  <div class="settings-tab-panel">
    <header class="settings-section-head">
      <div>
        <h3 class="settings-section-title">Permissions</h3>
        <p class="settings-section-desc">
          Saved approvals let tool calls run without asking. Remove one to be
          prompted again next time.
        </p>
      </div>
      <button
        v-if="permissions.length > 0"
        class="ghost-button danger-text"
        @click="emit('clear-all')"
      >
        Clear all
      </button>
    </header>

    <div v-if="isLoading" class="settings-empty">Loading…</div>

    <div v-else-if="permissions.length === 0" class="settings-empty">
      No saved permissions. Every tool call will ask for approval.
    </div>

    <ul v-else class="perm-rule-list">
      <li v-for="rule in permissions" :key="rule.id" class="perm-rule-item">
        <span class="perm-rule-scope">{{ rule.scope }}</span>
        <div class="perm-rule-text">
          <span class="perm-rule-title">
            {{ rule.scope === 'global' ? 'All projects (global)' : basename(rule.projectPath) }}
          </span>
          <span class="perm-rule-sub">
            {{ rule.scope === 'global' ? 'Tool calls run everywhere without asking' : rule.projectPath }}
          </span>
        </div>
        <button class="perm-rule-revoke" title="Revoke" @click="emit('revoke', rule.id)">Revoke</button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.perm-rule-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.perm-rule-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.perm-rule-scope {
  flex: 0 0 auto;
  align-self: flex-start;
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  background: var(--surface-strong);
  border: 1px solid var(--border);
  padding: 3px 7px;
  border-radius: 5px;
}

.perm-rule-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
}

.perm-rule-title {
  font-size: 0.9rem;
  color: var(--text);
  font-weight: 500;
}

.perm-rule-sub {
  font-size: 0.75rem;
  color: var(--faint);
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.perm-rule-revoke {
  flex: 0 0 auto;
  background: rgba(255, 138, 128, 0.1);
  color: var(--danger);
  border: 1px solid rgba(255, 138, 128, 0.2);
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.perm-rule-revoke:hover {
  background: rgba(255, 138, 128, 0.2);
  border-color: rgba(255, 138, 128, 0.3);
}

.danger-text {
  color: var(--danger);
}
</style>
