<script setup lang="ts">
import { ref } from 'vue';
import type { PermissionRule } from '@agent-bridge/shared';

defineProps<{
  permissions: PermissionRule[];
  isLoading: boolean;
}>();

const emit = defineEmits<{
  (e: 'revoke', id: number): void;
  (e: 'clear-all'): void;
}>();

const expandedIds = ref<Record<number, boolean>>({});

function toggleExpand(id: number) {
  expandedIds.value[id] = !expandedIds.value[id];
}

function basename(path: string): string {
  const parts = path.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || path;
}

function ruleTitle(rule: PermissionRule): string {
  const tool = rule.tool || 'tool';
  return rule.command ? `${tool}: ${rule.command}` : tool;
}

function ruleScopeText(rule: PermissionRule): string {
  return rule.scope === 'global'
    ? 'Allowed in all projects'
    : `Allowed in ${basename(rule.projectPath)}`;
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
      <li
        v-for="rule in permissions"
        :key="rule.id"
        class="perm-rule-item"
        :class="{ expanded: expandedIds[rule.id] }"
      >
        <span class="perm-rule-scope">{{ rule.scope }}</span>
        <div class="perm-rule-content" @click="toggleExpand(rule.id)">
          <div class="perm-rule-text">
            <span class="perm-rule-title">{{ ruleTitle(rule) }}</span>
            <span class="perm-rule-sub">
              {{ rule.scope === 'global' ? ruleScopeText(rule) : rule.projectPath }}
            </span>
          </div>
          <!-- Clickable Shadow overlay to expand -->
          <div v-if="!expandedIds[rule.id]" class="shadow-fade-overlay"></div>
        </div>
        <button class="perm-rule-revoke" title="Revoke" @click.stop="emit('revoke', rule.id)">Revoke</button>
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
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border);
  border-radius: 8px;
  height: 84px; /* default collapsed height */
  box-sizing: border-box;
  overflow: hidden;
  position: relative;
  transition: height 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.perm-rule-item.expanded {
  height: auto;
  min-height: 84px;
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

.perm-rule-content {
  flex: 1 1 auto;
  min-width: 0;
  cursor: pointer;
  position: relative;
  align-self: stretch;
  overflow: hidden;
}

.perm-rule-item.expanded .perm-rule-content {
  overflow: visible;
  height: auto;
}

.perm-rule-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.perm-rule-title {
  font-size: 0.9rem;
  color: var(--text);
  font-weight: 500;
  word-break: break-all;
}

.perm-rule-sub {
  font-size: 0.75rem;
  color: var(--faint);
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shadow-fade-overlay {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 28px;
  background: linear-gradient(to bottom, rgba(25, 25, 25, 0), rgba(25, 25, 25, 1));
  pointer-events: none; /* allows clicks to pass through to the content container */
}

.perm-rule-revoke {
  flex: 0 0 auto;
  align-self: flex-start;
  background: var(--danger-soft);
  color: var(--danger);
  border: 1px solid var(--danger-border);
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.perm-rule-revoke:hover {
  background: var(--danger-soft-strong);
  border-color: var(--danger);
}

.danger-text {
  color: var(--danger);
}
</style>
