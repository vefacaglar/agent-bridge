<script setup lang="ts">
import type { PermissionDecision } from '../api/client';
import { getPermissionPath, getPermissionArguments } from '../lib/confirmation';

defineProps<{
  request: any;
  projectPath?: string;
}>();

const emit = defineEmits<{
  (e: 'decide', decision: PermissionDecision): void;
}>();
</script>

<template>
  <transition name="slide-up">
    <div v-if="request" class="inline-permission-card">
      <div class="permission-card-header">
        <div class="permission-card-title">
          <span class="yellow-dot">●</span>
          <strong>Allow BridgeMind to run {{ request.toolCall?.function?.name }}?</strong>
        </div>
        <span class="permission-scope-badge">Ask permissions</span>
      </div>

      <div class="permission-card-body">
        <div class="permission-details-path">{{ getPermissionPath(request.toolCall) }}</div>
        <div class="permission-arguments-box">
          <code>{{ getPermissionArguments(request.toolCall, projectPath) }}</code>
        </div>
      </div>

      <div class="permission-card-footer">
        <button class="perm-btn-deny" @click="emit('decide', 'deny')">Deny</button>
        <div class="perm-btn-allow-group">
          <button class="perm-btn-secondary" @click="emit('decide', 'allow_always')">Always allow (Global)</button>
          <button class="perm-btn-secondary" @click="emit('decide', 'allow_project')">Always allow in this project</button>
          <button class="perm-btn-primary" @click="emit('decide', 'allow_once')">Allow once ↵</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.inline-permission-card {
  position: absolute;
  bottom: calc(100% - 6px);
  left: 12px;
  right: 12px;
  background: #1c1c1e;
  border: 1px solid #2c2c2e;
  border-radius: 12px;
  padding: 16px;
  z-index: 1;
  pointer-events: auto;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.permission-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.permission-card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
  color: #ffffff;
}

.permission-scope-badge {
  font-size: 0.75rem;
  color: #8e8e93;
  background: #2c2c2e;
  padding: 2px 8px;
  border-radius: 20px;
}

.permission-card-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.permission-details-path {
  font-size: 0.85rem;
  color: #e5e5ea;
  font-weight: 500;
}

.permission-arguments-box {
  background: #141416;
  border: 1px solid #2c2c2e;
  border-radius: 6px;
  padding: 8px 12px;
  overflow-x: auto;
}

.permission-arguments-box code {
  font-family: monospace;
  font-size: 0.8rem;
  color: #8e8e93;
  white-space: pre-wrap;
  word-break: break-all;
}

.permission-card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 4px;
}

.perm-btn-deny {
  background: rgba(255, 69, 58, 0.1);
  color: #ff453a;
  border: 1px solid rgba(255, 69, 58, 0.2);
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.perm-btn-deny:hover {
  background: rgba(255, 69, 58, 0.2);
  border-color: rgba(255, 69, 58, 0.3);
}

.perm-btn-allow-group {
  display: flex;
  gap: 8px;
}

.perm-btn-secondary {
  background: rgba(255, 255, 255, 0.05);
  color: #e5e5ea;
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.perm-btn-secondary:hover {
  background: rgba(255, 255, 255, 0.1);
}

.perm-btn-primary {
  background: #ffffff;
  color: #000000;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 6px rgba(255, 255, 255, 0.15);
}

.perm-btn-primary:hover {
  background: #f2f2f7;
  transform: translateY(-1px);
}
</style>
