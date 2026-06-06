import type { RunStatus } from '@agent-bridge/shared';

/** Run statuses that mean a run is still actively processing. */
export const ACTIVE_STATUSES: RunStatus[] = ['created', 'generating', 'awaiting_permission', 'awaiting_input'];

/** Default workspace path used when a run has no explicit project path. */
export const DEFAULT_PROJECT_PATH = '/Users/vefa/Projects/agent-bridge';

export function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const STATUS_LABELS: Record<RunStatus, string> = {
  created: 'queued',
  generating: 'generating',
  awaiting_permission: 'waiting permission',
  awaiting_input: 'waiting for you',
  done: 'completed',
  failed: 'failed',
  cancelled: 'cancelled'
};

export function statusLabel(status?: RunStatus): string {
  if (!status) return 'idle';
  return STATUS_LABELS[status];
}

export function statusClass(status?: RunStatus): string {
  if (!status) return 'idle';
  if (status === 'done') return 'success';
  if (status === 'failed' || status === 'cancelled') return 'danger';
  if (status === 'awaiting_permission' || status === 'awaiting_input') return 'warning';
  if (ACTIVE_STATUSES.includes(status)) return 'active';
  return 'idle';
}

/** Pretty-prints a JSON string; returns the original text if it is not JSON. */
export function formatJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch (e) {
    return content;
  }
}

/** Splits a "providerId:model" combined value into its parts. */
export function splitCombined(value: string): { providerId: string; model: string } {
  const [providerId, ...modelParts] = value.split(':');
  return { providerId, model: modelParts.join(':') };
}
