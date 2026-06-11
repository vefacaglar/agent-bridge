import type { RunStatus } from '@locagens/shared';

/** Run statuses that mean a run is still actively processing. */
export const ACTIVE_STATUSES: RunStatus[] = ['created', 'generating', 'awaiting_permission', 'awaiting_input'];

/** Default workspace path used when a run has no explicit project path. */
export const DEFAULT_PROJECT_PATH = '/Users/vefa/Projects/agent-bridge';

export function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatRelativeTime(value: string | Date | number, nowInput?: number): string {
  const date = new Date(value);
  const now = nowInput ? new Date(nowInput) : new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 0) return 'now';
  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    const s = diffSec % 60;
    return s > 0 ? `${diffMin}m ${s}s ago` : `${diffMin}m ago`;
  }

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {
    const m = diffMin % 60;
    return m > 0 ? `${diffHr}h ${m}m ago` : `${diffHr}h ago`;
  }

  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  const diffWeeks = Math.floor(diffDays / 7);
  if (diffDays < 30) {
    return `${diffWeeks}w ago`;
  }

  const diffMonths = Math.floor(diffDays / 30.436);
  if (diffDays < 365) {
    return `${diffMonths}m ago`;
  }

  const diffYears = Math.floor(diffDays / 365.25);
  return `${diffYears}y ago`;
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
