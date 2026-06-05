import type { ProviderMetadata, Run, RunMessage, Project, PermissionRule } from '@agent-bridge/shared';

export const API_BASE = 'http://localhost:3000';

export type PermissionDecision = 'allow_once' | 'allow_project' | 'allow_always' | 'deny';

export interface CreateRunPayload {
  task: string;
  projectPath?: string;
  projectName?: string;
  providerId: string;
  model: string;
  mode: string;
  bypassPermissions: boolean;
}

export interface ContinueRunPayload {
  task: string;
  providerId: string;
  model: string;
  mode: string;
  bypassPermissions: boolean;
}

/** Reads `{ error }` from a failed response, falling back to a default message. */
async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => ({}));
  return body?.error || fallback;
}

async function getJson<T>(path: string): Promise<T | null> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) return null;
  return response.json() as Promise<T>;
}

export const api = {
  getProviders: () => getJson<ProviderMetadata[]>('/api/providers'),
  getProvidersConfig: () => getJson<Record<string, any>>('/api/providers/config'),
  async saveProvidersConfig(configs: Record<string, any>): Promise<void> {
    const response = await fetch(`${API_BASE}/api/providers/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(configs)
    });
    if (!response.ok) throw new Error(await errorMessage(response, 'Failed to save provider settings.'));
  },
  getRuns: () => getJson<Run[]>('/api/runs'),
  getMessages: (runId: string) => getJson<RunMessage[]>(`/api/runs/${runId}/messages`),
  getProjects: () => getJson<Project[]>('/api/projects'),
  getPermissions: () => getJson<PermissionRule[]>('/api/permissions'),

  eventsUrl: (runId: string) => `${API_BASE}/api/runs/${runId}/events`,

  async revokePermission(id: number): Promise<void> {
    await fetch(`${API_BASE}/api/permissions/${id}`, { method: 'DELETE' });
  },

  async clearPermissions(): Promise<void> {
    await fetch(`${API_BASE}/api/permissions`, { method: 'DELETE' });
  },

  async createRun(payload: CreateRunPayload): Promise<Run> {
    const response = await fetch(`${API_BASE}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(await errorMessage(response, 'Failed to start chat.'));
    return response.json() as Promise<Run>;
  },

  async continueRun(runId: string, payload: ContinueRunPayload): Promise<void> {
    const response = await fetch(`${API_BASE}/api/runs/${runId}/continue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(await errorMessage(response, 'Failed to send message.'));
  },

  async cancelRun(runId: string): Promise<Response> {
    return fetch(`${API_BASE}/api/runs/${runId}/cancel`, { method: 'POST' });
  },

  async sendPermissionDecision(runId: string, decision: PermissionDecision): Promise<void> {
    const response = await fetch(`${API_BASE}/api/runs/${runId}/permission`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision })
    });
    if (!response.ok) throw new Error(await errorMessage(response, 'Permission decision could not be processed.'));
  },

  async createProject(path: string, name: string): Promise<Project> {
    const response = await fetch(`${API_BASE}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, name })
    });
    if (!response.ok) throw new Error(await errorMessage(response, 'Failed to add project.'));
    return response.json() as Promise<Project>;
  },

  async deleteProject(path: string): Promise<void> {
    await fetch(`${API_BASE}/api/projects?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
  },

  async browseFolder(): Promise<{ path: string; name: string }> {
    const response = await fetch(`${API_BASE}/api/projects/select-dir`, { method: 'POST' });
    if (!response.ok) throw new Error(await errorMessage(response, 'Failed to select folder.'));
    return response.json() as Promise<{ path: string; name: string }>;
  },

  async fetchModels(payload: { type: string; baseUrl: string; apiKey?: string; providerId?: string }): Promise<{ success: boolean; models?: string[]; error?: string }> {
    const response = await fetch(`${API_BASE}/api/providers/fetch-models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const err = await errorMessage(response, 'Failed to fetch models.');
      return { success: false, error: err };
    }
    return response.json() as Promise<{ success: boolean; models?: string[]; error?: string }>;
  }
};

