<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { PermissionPreview } from '@bridgemind/shared';
import type { PermissionDecision } from '../api/client';
import {
  PERMISSION_OPTIONS,
  actionLabel,
  actionQuestion,
  previewDiff
} from '../lib/permission';

const props = defineProps<{
  request: any;
}>();

const emit = defineEmits<{
  (e: 'decide', decision: PermissionDecision): void;
}>();

const selected = ref(0);

const preview = computed<PermissionPreview | null>(() => props.request?.preview ?? null);
const toolName = computed<string>(() => props.request?.toolCall?.function?.name ?? 'tool');
const headerPath = computed(() => preview.value?.path || preview.value?.absolutePath || '');
const question = computed(() => actionQuestion(preview.value, toolName.value));
const diffRows = computed(() => previewDiff(preview.value));
const hasDiff = computed(() => diffRows.value.length > 0);

// Raw arguments fallback when there is no structured preview (unknown tools).
const rawArgs = computed(() => {
  const args = props.request?.toolCall?.function?.arguments;
  if (!args) return '';
  try {
    return JSON.stringify(JSON.parse(args), null, 2);
  } catch {
    return args;
  }
});

function decide(decision: PermissionDecision) {
  emit('decide', decision);
}

// Reset the highlighted option whenever a new request appears.
watch(() => props.request, (req) => {
  if (req) selected.value = 0;
});

function onKeyDown(e: KeyboardEvent) {
  if (!props.request) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    decide('deny');
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    selected.value = (selected.value + 1) % PERMISSION_OPTIONS.length;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selected.value = (selected.value - 1 + PERMISSION_OPTIONS.length) % PERMISSION_OPTIONS.length;
  } else if (e.key === 'Enter') {
    e.preventDefault();
    decide(PERMISSION_OPTIONS[selected.value].decision);
  } else if (['1', '2', '3', '4'].includes(e.key)) {
    e.preventDefault();
    const option = PERMISSION_OPTIONS[Number(e.key) - 1];
    if (option) decide(option.decision);
  }
}

onMounted(() => window.addEventListener('keydown', onKeyDown, true));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown, true));
</script>

<template>
  <transition name="slide-up">
    <div v-if="request" class="cc-permission-card">
      <header class="cc-perm-header">
        <span class="cc-perm-action">{{ actionLabel(preview?.action) }}</span>
        <span v-if="headerPath" class="cc-perm-path">{{ headerPath }}</span>
        <span class="cc-perm-tool">{{ toolName }}</span>
      </header>

      <!-- File diff (edit / create / delete) -->
      <div v-if="hasDiff" class="cc-diff">
        <div
          v-for="(row, idx) in diffRows"
          :key="idx"
          class="cc-diff-row"
          :class="row.type"
        >
          <span class="cc-diff-gutter">{{ row.oldNo ?? '' }}</span>
          <span class="cc-diff-gutter">{{ row.newNo ?? '' }}</span>
          <span class="cc-diff-sign">{{ row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' ' }}</span>
          <span class="cc-diff-text">{{ row.text }}</span>
        </div>
      </div>

      <!-- Path-only preview (read / list) -->
      <div v-else-if="preview" class="cc-perm-pathbox">
        <code>{{ preview.absolutePath }}</code>
      </div>

      <!-- Fallback for tools without a structured preview -->
      <div v-else-if="rawArgs" class="cc-perm-pathbox">
        <code>{{ rawArgs }}</code>
      </div>

      <p class="cc-perm-question">{{ question }}</p>

      <ul class="cc-perm-options">
        <li
          v-for="(option, idx) in PERMISSION_OPTIONS"
          :key="option.decision"
          class="cc-perm-option"
          :class="{ active: idx === selected }"
          @mouseenter="selected = idx"
          @click="decide(option.decision)"
        >
          <span class="cc-perm-number">{{ idx + 1 }}.</span>
          <span class="cc-perm-label">{{ option.label }}</span>
          <span v-if="option.hint" class="cc-perm-hint">{{ option.hint }}</span>
        </li>
      </ul>
    </div>
  </transition>
</template>

<style scoped>
.cc-permission-card {
  position: absolute;
  bottom: calc(100% - 6px);
  left: 12px;
  right: 12px;
  background: #161618;
  border: 1px solid #2c2c2e;
  border-radius: 12px;
  padding: 14px;
  z-index: 1;
  pointer-events: auto;
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cc-perm-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.82rem;
}

.cc-perm-action {
  font-weight: 600;
  color: #e5e5ea;
  background: rgba(255, 255, 255, 0.06);
  padding: 2px 8px;
  border-radius: 6px;
}

.cc-perm-path {
  font-family: monospace;
  color: #c7c7cc;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cc-perm-tool {
  margin-left: auto;
  font-family: monospace;
  font-size: 0.72rem;
  color: #8e8e93;
}

/* Diff view */
.cc-diff {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.75rem;
  line-height: 1.5;
  background: #0d0d0f;
  border: 1px solid #232325;
  border-radius: 8px;
  max-height: 280px;
  overflow: auto;
  padding: 4px 0;
}

.cc-diff-row {
  display: flex;
  white-space: pre;
}

.cc-diff-row.add {
  background: rgba(46, 160, 67, 0.16);
}

.cc-diff-row.del {
  background: rgba(248, 81, 73, 0.16);
}

.cc-diff-gutter {
  flex: 0 0 auto;
  width: 3ch;
  padding: 0 6px;
  text-align: right;
  color: #5a5a5f;
  user-select: none;
}

.cc-diff-sign {
  flex: 0 0 auto;
  width: 1.5ch;
  text-align: center;
  user-select: none;
}

.cc-diff-row.add .cc-diff-sign,
.cc-diff-row.add .cc-diff-text {
  color: #7ee787;
}

.cc-diff-row.del .cc-diff-sign,
.cc-diff-row.del .cc-diff-text {
  color: #ffa198;
}

.cc-diff-text {
  flex: 1 1 auto;
  color: #d4d4d8;
  padding-right: 10px;
}

.cc-perm-pathbox {
  background: #0d0d0f;
  border: 1px solid #232325;
  border-radius: 8px;
  padding: 8px 12px;
  overflow-x: auto;
}

.cc-perm-pathbox code {
  font-family: monospace;
  font-size: 0.78rem;
  color: #c7c7cc;
  white-space: pre-wrap;
  word-break: break-all;
}

.cc-perm-question {
  margin: 2px 0 0;
  font-size: 0.88rem;
  color: #ffffff;
}

/* Numbered options */
.cc-perm-options {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cc-perm-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85rem;
  color: #c7c7cc;
  border-left: 2px solid transparent;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}

.cc-perm-option.active {
  background: rgba(255, 255, 255, 0.07);
  color: #ffffff;
  border-left-color: var(--success);
}

.cc-perm-number {
  color: #8e8e93;
  font-variant-numeric: tabular-nums;
}

.cc-perm-option.active .cc-perm-number {
  color: #c7c7cc;
}

.cc-perm-label {
  flex: 1 1 auto;
}

.cc-perm-hint {
  font-family: monospace;
  font-size: 0.72rem;
  color: #8e8e93;
  background: #202022;
  border: 1px solid #2d2d30;
  border-radius: 4px;
  padding: 1px 6px;
}
</style>
