<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { UserQuestion } from '@agent-bridge/shared';

const props = defineProps<{
  // The pending question request ({ questions: UserQuestion[] }) or null.
  request: { questions: UserQuestion[] } | null;
}>();

const emit = defineEmits<{
  (e: 'submit', payload: { selections: string[][]; notes: string[] }): void;
}>();

const questions = computed<UserQuestion[]>(() => props.request?.questions ?? []);

// Local selection state: one array of chosen labels per question (by index).
const selections = ref<string[][]>([]);
// Free-text comment per question (the user's own input), by index.
const notes = ref<string[]>([]);
// Step through questions one at a time (previous / next).
const currentIndex = ref(0);

// Reset state + step whenever a new request arrives.
watch(
  () => props.request,
  () => {
    selections.value = questions.value.map(() => []);
    notes.value = questions.value.map(() => '');
    currentIndex.value = 0;
  },
  { immediate: true }
);

const currentQuestion = computed<UserQuestion | null>(() => questions.value[currentIndex.value] ?? null);
const isFirst = computed(() => currentIndex.value === 0);
const isLast = computed(() => currentIndex.value === questions.value.length - 1);

// A question counts as answered if the user picked an option OR wrote a note.
function answered(i: number): boolean {
  return (selections.value[i]?.length ?? 0) > 0 || (notes.value[i]?.trim().length ?? 0) > 0;
}
const currentAnswered = computed(() => answered(currentIndex.value));

function goPrev() {
  if (!isFirst.value) currentIndex.value--;
}

function goNext() {
  if (!isLast.value && currentAnswered.value) currentIndex.value++;
}

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

// Every question must be answered (option or note) before submitting.
const canSubmit = computed(() =>
  questions.value.length > 0 && questions.value.every((_, i) => answered(i))
);

function submit() {
  if (!canSubmit.value) return;
  emit('submit', {
    selections: selections.value.map(s => [...s]),
    notes: notes.value.map(n => n.trim())
  });
}
</script>

<template>
  <transition name="slide-up">
    <div v-if="request && currentQuestion" class="composer-question-card">
      <div class="question-card-header">
        <strong>The assistant needs your input</strong>
        <span v-if="questions.length > 1" class="question-step">{{ currentIndex + 1 }} / {{ questions.length }}</span>
      </div>

      <div class="question-block">
        <div class="question-head">
          <span v-if="currentQuestion.header" class="question-chip">{{ currentQuestion.header }}</span>
          <span class="question-text">{{ currentQuestion.question }}</span>
          <span v-if="currentQuestion.multiSelect" class="question-multi">choose any</span>
        </div>
        <div class="question-options">
          <button
            v-for="opt in currentQuestion.options"
            :key="opt.label"
            type="button"
            class="question-option"
            :class="{ selected: isSelected(currentIndex, opt.label) }"
            @click="toggle(currentIndex, opt.label)"
          >
            <span class="option-label">{{ opt.label }}</span>
            <span v-if="opt.description" class="option-desc">{{ opt.description }}</span>
          </button>
        </div>

        <textarea
          v-model="notes[currentIndex]"
          class="question-note"
          rows="2"
          placeholder="Your own comment (optional)…"
        ></textarea>
      </div>

      <div class="question-card-footer">
        <button
          v-if="!isFirst"
          type="button"
          class="question-nav"
          @click="goPrev"
        >Previous</button>
        <button
          v-if="!isLast"
          type="button"
          class="question-nav primary"
          :disabled="!currentAnswered"
          @click="goNext"
        >Next</button>
        <button
          v-else
          type="button"
          class="question-submit"
          :disabled="!canSubmit"
          @click="submit"
        >Submit</button>
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 0.9rem;
  color: var(--text);
}

.question-step {
  flex: 0 0 auto;
  font-size: 0.72rem;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
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

.question-note {
  width: 100%;
  box-sizing: border-box;
  margin-top: 2px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 8px 11px;
  color: var(--text);
  font-size: 0.82rem;
  font-family: inherit;
  resize: vertical;
}

.question-note::placeholder {
  color: var(--faint);
}

.question-note:focus {
  outline: none;
  border-color: var(--muted);
}

.question-card-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.question-nav {
  background: transparent;
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.question-nav:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--muted);
}

.question-nav.primary {
  background: var(--text);
  color: var(--bg);
  border-color: var(--text);
}

.question-nav:disabled {
  opacity: 0.45;
  cursor: not-allowed;
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
