<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { UserQuestion } from '@agent-bridge/shared';

const props = defineProps<{
  // The pending question request ({ questions: UserQuestion[] }) or null.
  request: { questions: UserQuestion[] } | null;
}>();

const emit = defineEmits<{
  (e: 'submit', selections: string[][]): void;
}>();

const questions = computed<UserQuestion[]>(() => props.request?.questions ?? []);

// Local selection state: one array of chosen labels per question (by index).
const selections = ref<string[][]>([]);

// Reset selections whenever a new request arrives.
watch(
  () => props.request,
  () => {
    selections.value = questions.value.map(() => []);
  },
  { immediate: true }
);

function isSelected(qIdx: number, label: string): boolean {
  return selections.value[qIdx]?.includes(label) ?? false;
}

function toggle(qIdx: number, label: string) {
  const q = questions.value[qIdx];
  const current = selections.value[qIdx] ?? [];
  if (q.multiSelect) {
    selections.value[qIdx] = current.includes(label)
      ? current.filter(l => l !== label)
      : [...current, label];
  } else {
    // Single-select: replace (allow toggling off by clicking the chosen one).
    selections.value[qIdx] = current.includes(label) ? [] : [label];
  }
}

// Every question must have at least one selection before submitting.
const canSubmit = computed(() =>
  questions.value.length > 0 && selections.value.every(s => s.length > 0)
);

function submit() {
  if (!canSubmit.value) return;
  emit('submit', selections.value.map(s => [...s]));
}
</script>

<template>
  <transition name="slide-up">
    <div v-if="request && questions.length" class="composer-question-card">
      <div class="question-card-header">
        <strong>The assistant needs your input</strong>
      </div>

      <div class="question-list">
        <div v-for="(q, qIdx) in questions" :key="qIdx" class="question-block">
          <div class="question-head">
            <span v-if="q.header" class="question-chip">{{ q.header }}</span>
            <span class="question-text">{{ q.question }}</span>
            <span v-if="q.multiSelect" class="question-multi">choose any</span>
          </div>
          <div class="question-options">
            <button
              v-for="opt in q.options"
              :key="opt.label"
              type="button"
              class="question-option"
              :class="{ selected: isSelected(qIdx, opt.label) }"
              @click="toggle(qIdx, opt.label)"
            >
              <span class="option-label">{{ opt.label }}</span>
              <span v-if="opt.description" class="option-desc">{{ opt.description }}</span>
            </button>
          </div>
        </div>
      </div>

      <div class="question-card-footer">
        <button class="question-submit" :disabled="!canSubmit" @click="submit">Submit</button>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.composer-question-card {
  position: absolute;
  bottom: calc(100% - 6px);
  left: 12px;
  right: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
  z-index: 1;
  pointer-events: auto;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: 60vh;
  overflow-y: auto;
}

.question-card-header {
  font-size: 0.9rem;
  color: var(--text);
}

.question-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.question-block {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.question-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
}

.question-chip {
  flex: 0 0 auto;
  font-size: 0.66rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 2px 6px;
}

.question-text {
  font-size: 0.88rem;
  color: var(--text);
}

.question-multi {
  font-size: 0.7rem;
  color: var(--faint);
}

.question-options {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.question-option {
  display: flex;
  flex-direction: column;
  gap: 3px;
  text-align: left;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 9px 12px;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.question-option:hover {
  border-color: var(--muted);
}

.question-option.selected {
  border-color: var(--text);
  background: var(--surface-strong, var(--surface));
}

.option-label {
  font-size: 0.85rem;
  color: var(--text);
  font-weight: 500;
}

.option-desc {
  font-size: 0.76rem;
  color: var(--muted);
}

.question-card-footer {
  display: flex;
  justify-content: flex-end;
}

.question-submit {
  background: var(--text);
  color: var(--bg);
  border: 0;
  border-radius: 8px;
  padding: 8px 18px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
}

.question-submit:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 0.18s ease, opacity 0.18s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(8px);
  opacity: 0;
}
</style>
