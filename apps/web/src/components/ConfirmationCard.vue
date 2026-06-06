<script setup lang="ts">
import { computed } from 'vue';
import type { MessageGroup } from '../lib/messageGroups';
import { getConfirmationOptions } from '../lib/confirmation';

const props = defineProps<{
  group: MessageGroup | null;
}>();

const emit = defineEmits<{
  (e: 'reply', option: string): void;
}>();

const options = computed(() => getConfirmationOptions(props.group?.message?.content || '') || []);
const noLabel = computed(() => (options.value.includes('Hayır') ? 'Hayır' : 'No'));
const yesLabel = computed(() => (options.value.includes('Evet') ? 'Evet' : 'Yes'));
</script>

<template>
  <transition name="slide-up">
    <div v-if="group" class="composer-confirmation-card">
      <div class="confirm-card-header">
        <strong>Confirm prompt action?</strong>
      </div>
      <div class="confirm-card-footer">
        <button class="composer-confirm-btn no" @click="emit('reply', noLabel)">{{ noLabel }}</button>
        <button class="composer-confirm-btn yes" @click="emit('reply', yesLabel)">{{ yesLabel }}</button>
      </div>
    </div>
  </transition>
</template>

<style scoped>
/* In normal flow at the top of the composer container so the pinned task list
   above it stays visible (the card no longer overlaps it). When the card closes
   the task list returns to sitting right above the composer. */
.composer-confirmation-card {
  position: relative;
  margin: 0 0 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 16px;
  z-index: 1;
  pointer-events: auto;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.confirm-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
  color: var(--text);
}

.confirm-card-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  align-items: center;
}

.composer-confirm-btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.composer-confirm-btn.no {
  background: rgba(255, 138, 128, 0.1);
  color: var(--danger);
  border: 1px solid rgba(255, 138, 128, 0.2);
}

.composer-confirm-btn.no:hover {
  background: rgba(255, 138, 128, 0.2);
  border-color: rgba(255, 138, 128, 0.3);
}

.composer-confirm-btn.yes {
  background: var(--text);
  color: var(--bg);
  border: none;
  font-weight: 600;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
}

.composer-confirm-btn.yes:hover {
  background: #ffffff;
  transform: translateY(-1px);
}
</style>
