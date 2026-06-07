<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { MessageGroup } from '../lib/messageGroups';
import { getConfirmations } from '../lib/confirmation';
import ThemedButton from './ThemedButton.vue';

const props = defineProps<{
  group: MessageGroup | null;
}>();

const emit = defineEmits<{
  (e: 'reply', option: string): void;
}>();

const confirmations = computed(() => getConfirmations(props.group?.message?.content || ''));
const currentQuestion = computed(() => confirmations.value[currentIndex.value] || null);

const currentIndex = ref(0);
const selections = ref<string[]>([]);
const notes = ref<string[]>([]);

const isFirst = computed(() => currentIndex.value === 0);
const isLast = computed(() => currentIndex.value === confirmations.value.length - 1);

watch(
  () => props.group,
  () => {
    currentIndex.value = 0;
    selections.value = [];
    notes.value = [];
  },
  { immediate: true }
);

const commentPlaceholder = computed(() => {
  const opts = currentQuestion.value?.options || [];
  const isTurkish = opts.includes('Hayır') || opts.includes('Evet') || /[\u011e\u011f\u0130\u0131\u015e\u015f\u00c7\u00e7\u00d6\u00f6\u00dc\u00fc]/i.test(currentQuestion.value?.question || '');
  return isTurkish ? 'Özel notunuz (isteğe bağlı)...' : 'Your own comment (optional)...';
});


function handleOptionSelect(opt: string) {
  selections.value[currentIndex.value] = opt;
  if (confirmations.value.length === 1) {
    submit();
  }
}

function goPrev() {
  if (!isFirst.value) currentIndex.value--;
}

function goNext() {
  if (!isLast.value && selections.value[currentIndex.value]) currentIndex.value++;
}

function submit() {
  let reply = '';
  confirmations.value.forEach((q, idx) => {
    const sel = selections.value[idx];
    const note = notes.value[idx]?.trim();
    if (idx > 0) reply += '\n\n';
    
    reply += `${q.question ? q.question + ': ' : ''}${sel}`;
    if (note) {
      const isTurkish = q.options.includes('Hayır') || q.options.includes('Evet') || /[\u011e\u011f\u0130\u0131\u015e\u015f\u00c7\u00e7\u00d6\u00f6\u00dc\u00fc]/i.test(props.group?.message?.content || '');
      reply += isTurkish ? ` (Not: ${note})` : ` (Note: ${note})`;
    }
  });
  
  emit('reply', reply);
  currentIndex.value = 0;
  selections.value = [];
  notes.value = [];
}
</script>

<template>
  <transition name="slide-up">
    <div v-if="group && currentQuestion" class="composer-confirmation-card">
      <div class="confirm-card-header">
        <strong>{{ currentQuestion.question || 'Confirm prompt action?' }}</strong>
        <span v-if="confirmations.length > 1" class="confirm-step">{{ currentIndex + 1 }} / {{ confirmations.length }}</span>
      </div>
      <div class="confirm-options">
        <ThemedButton
          v-for="opt in currentQuestion.options"
          :key="opt"
          :variant="selections[currentIndex] === opt ? 'primary' : 'secondary'"
          class="confirm-option-btn"
          @click="handleOptionSelect(opt)"
        >
          {{ opt }}
        </ThemedButton>
      </div>
      <textarea
        v-model="notes[currentIndex]"
        class="confirm-note"
        rows="2"
        :placeholder="commentPlaceholder"
      ></textarea>
      
      <div v-if="confirmations.length > 1" class="confirm-card-footer">
        <ThemedButton
          v-if="!isFirst"
          variant="secondary"
          @click="goPrev"
        >
          Previous
        </ThemedButton>
        <ThemedButton
          v-if="!isLast"
          variant="primary"
          :disabled="!selections[currentIndex]"
          @click="goNext"
        >
          Next
        </ThemedButton>
        <ThemedButton
          v-else
          variant="primary"
          :disabled="!selections[currentIndex]"
          @click="submit"
        >
          Submit
        </ThemedButton>
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

.confirm-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.composer-confirm-btn {
  width: 100%;
  text-align: left;
  padding: 10px 14px;
  border-radius: 9px;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
}

.composer-confirm-btn:hover {
  border-color: var(--muted);
}

.composer-confirm-btn.no,
.composer-confirm-btn.yes {
  background: var(--surface-strong);
  color: var(--text);
  border-color: transparent;
  font-weight: 600;
}

.composer-confirm-btn.no:hover,
.composer-confirm-btn.yes:hover {
  border-color: transparent;
  filter: brightness(1.05);
}

.confirm-note {
  width: 100%;
  box-sizing: border-box;
  margin-top: 4px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  color: var(--text);
  font-size: 0.82rem;
  font-family: inherit;
  resize: none;
}

.confirm-note::placeholder {
  color: var(--faint);
}

.confirm-note:focus {
  outline: none;
  border-color: var(--muted);
}

.composer-confirm-btn.selected {
  border-color: transparent;
  background: var(--surface-strong);
  font-weight: 600;
}

.confirm-step {
  margin-left: auto;
  font-size: 0.75rem;
  color: var(--muted);
}

.confirm-card-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  align-items: center;
  margin-top: 8px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
  width: 100%;
}

.confirm-nav-btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.confirm-nav-btn.primary {
  background: var(--text);
  color: var(--bg);
  border: 1px solid var(--text);
  font-weight: 600;
}

.confirm-nav-btn.primary:hover:not(:disabled) {
  opacity: 0.85;
}

.confirm-nav-btn.secondary {
  background: transparent;
  color: var(--muted);
  border: 1px solid var(--border);
}

.confirm-nav-btn.secondary:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--muted);
}

.confirm-nav-btn:disabled {
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
