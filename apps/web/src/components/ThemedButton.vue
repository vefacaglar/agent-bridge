<script setup lang="ts">
import { computed } from 'vue';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'chip';
type ButtonSize = 'sm' | 'md' | 'lg';

const props = withDefaults(
  defineProps<{
    variant?: ButtonVariant;
    size?: ButtonSize;
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
    active?: boolean;
  }>(),
  {
    variant: 'secondary',
    size: 'md',
    disabled: false,
    type: 'button',
    active: false,
  }
);

const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void;
}>();

const buttonClasses = computed(() => {
  return [
    'themed-btn',
    `btn-${props.variant}`,
    `btn-${props.size}`,
    { 'btn-active': props.active, 'btn-disabled': props.disabled }
  ];
});

function handleClick(event: MouseEvent) {
  if (props.disabled) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  emit('click', event);
}
</script>

<template>
  <button
    :type="type"
    :class="buttonClasses"
    :disabled="disabled"
    @click="handleClick"
  >
    <span class="btn-content">
      <slot></slot>
    </span>
  </button>
</template>

<style scoped>
.themed-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
  font-weight: 550;
  border-radius: 8px !important;
  border: none;
  cursor: pointer;
  outline: none;
  white-space: nowrap;
  user-select: none;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
}

/* SIZES */
.btn-sm {
  min-height: 28px;
  padding: 4px 10px;
  font-size: 0.76rem;
  border-radius: 6px !important;
}

.btn-md {
  min-height: 36px;
  padding: 6px 14px;
  font-size: 0.86rem;
}

.btn-lg {
  min-height: 44px;
  padding: 10px 20px;
  font-size: 0.94rem;
}

/* VARIANTS - All filled, no transparent/outlined buttons */

/* Primary: Solid White High Contrast */
.btn-primary {
  background: #ffffff;
  color: #000000;
  box-shadow: 0 4px 12px rgba(255, 255, 255, 0.08);
}

.btn-primary:hover:not(:disabled) {
  background: #f0f0f0;
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(255, 255, 255, 0.12);
}

.btn-primary:active:not(:disabled) {
  background: #d8d8d8;
  transform: translateY(0);
}

/* Secondary: Premium Sleek Dark Gray */
.btn-secondary {
  background: #2a2a2e;
  color: #e0e0e0;
  border: 1px solid rgba(255, 255, 255, 0.04) !important;
}

.btn-secondary:hover:not(:disabled) {
  background: #35353a;
  color: #ffffff;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  border-color: rgba(255, 255, 255, 0.08) !important;
}

.btn-secondary:active:not(:disabled) {
  background: #202024;
  transform: translateY(0);
}

/* Danger: Soft Red Glow */
.btn-danger {
  background: rgba(255, 107, 107, 0.16);
  color: #ff8a80;
  border: 1px solid rgba(255, 107, 107, 0.1) !important;
}

.btn-danger:hover:not(:disabled) {
  background: rgba(255, 107, 107, 0.24);
  color: #ff6b6b;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(255, 107, 107, 0.1);
  border-color: rgba(255, 107, 107, 0.2) !important;
}

.btn-danger:active:not(:disabled) {
  background: rgba(255, 107, 107, 0.12);
  transform: translateY(0);
}

/* Chip: Small Rounded Option Pill */
.btn-chip {
  background: #202024;
  color: #a0a0a5;
  border-radius: 999px !important;
  border: 1px solid rgba(255, 255, 255, 0.02) !important;
}

.btn-chip:hover:not(:disabled) {
  background: #2a2a2e;
  color: #d0d0d5;
  border-color: rgba(255, 255, 255, 0.08) !important;
}

.btn-chip.btn-active {
  background: #ffffff;
  color: #000000;
  font-weight: 600;
  border-color: #ffffff !important;
  box-shadow: 0 4px 12px rgba(255, 255, 255, 0.08);
}

.btn-chip.btn-active:hover:not(:disabled) {
  background: #f0f0f0;
  color: #000000;
  border-color: #f0f0f0 !important;
}

/* DISABLED STATE */
.themed-btn:disabled,
.themed-btn.btn-disabled {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none !important;
  box-shadow: none !important;
}

.btn-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
}
</style>
