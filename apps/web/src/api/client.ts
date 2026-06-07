import type { ProviderMetadata, Run, RunMessage, Project, PermissionRule, Plan, AgentPreset, Memory, MemoryCategory, MemoryScope, AppSettings } from '@agent-bridge/shared';

/**
 * Resolves the backend base URL. The config file (settings.json) is the single
 * source of truth for the port; this picks it up in two ways:
 *  1. Electron: the main process reads settings.json, starts the backend, and
 *     injects `window.__AGENT_BRIDGE_API_BASE__` for the renderer.
 *  2. Dev (Vite): vite.config reads the same file and injects VITE_API_BASE.
 * The hardcoded localhost default is only a last resort.
 */
function resolveApiBase(): string {
  const injected = (globalThis as any).__AGENT_BRIDGE_API_BASE__;
  if (typeof injected === 'string' && injected) return injected;
  const fromEnv = import.meta.env.VITE_API_BASE;
  if (typeof fromEnv === 'string' && fromEnv) return fromEnv;
  return 'http://localhost:4321';
}

export const API_BASE = resolveApiBase();

export type PermissionDecision = 'allow_once' | 'allow_project' | 'allow_always' | 'deny';

// Optional dual-model fields: when an agent preset is active the architect uses
// providerId/model and delegates code-writing to the coder model below.
export interface AgentRunFields {
  coderProviderId?: string;
  coderModel?: string;
  coderReasoningEffort?: string;
  utilityProviderId?: string;
  utilityModel?: string;
  utilityReasoningEffort?: string;
  agentPreset?: string;
}

export interface CreateRunPayload extends AgentRunFields {
  task: string;
  projectPath?: string;
  projectName?: string;
  providerId: string;
  model: string;
  reasoningEffort?: string;
  mode: string;
  bypassPermissions: boolean;
}

export interface ContinueRunPayload extends AgentRunFields {
  task: string;
  providerId: string;
  model: string;
  reasoningEffort?: string;
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
  getSettings: () => getJson<AppSettings>('/api/settings'),
  async saveSettings(settings: AppSettings): Promise<AppSettings & { restartRequired?: boolean }> {
    const response = await fetch(`${API_BASE}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    if (!response.ok) throw new Error(await errorMessage(response, 'Failed to save settings.'));
    return response.json() as Promise<AppSettings & { restartRequired?: boolean }>;
  },
  getProviders: () => getJson<ProviderMetadata[]>('/api/providers'),
  getAgentPresets: () => getJson<AgentPreset[]>('/api/agent-presets'),
  async saveAgentPresets(presets: Record<string, any>): Promise<void> {
    const response = await fetch(`${API_BASE}/api/agent-presets`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(presets)
    });
    if (!response.ok) throw new Error(await errorMessage(response, 'Failed to save agent presets.'));
  },
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
  getRunPlan: (runId: string) => getJson<Plan | null>(`/api/runs/${runId}/plan`),
  getProjects: () => getJson<Project[]>('/api/projects'),
  getPermissions: () => getJson<PermissionRule[]>('/api/permissions'),

  eventsUrl: (runId: string) => `${API_BASE}/api/runs/${runId}/events`,

  async revokePermission(id: number): Promise<void> {
    await fetch(`${API_BASE}/api/permissions/${id}`, { method: 'DELETE' });
  },

  async clearPermissions(): Promise<void> {
    await fetch(`${API_BASE}/api/permissions`, { method: 'DELETE' });
  },

  getMemories: () => getJson<Memory[]>('/api/memories'),

  async createMemory(payload: { scope: MemoryScope; category: MemoryCategory; content: string; projectPath?: string }): Promise<Memory> {
    const response = await fetch(`${API_BASE}/api/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(await errorMessage(response, 'Failed to save memory.'));
    return response.json() as Promise<Memory>;
  },

  async updateMemory(id: number, content: string): Promise<Memory> {
    const response = await fetch(`${API_BASE}/api/memories/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    if (!response.ok) throw new Error(await errorMessage(response, 'Failed to update memory.'));
    return response.json() as Promise<Memory>;
  },

  async deleteMemory(id: number): Promise<void> {
    await fetch(`${API_BASE}/api/memories/${id}`, { method: 'DELETE' });
  },

  async clearMemories(): Promise<void> {
    await fetch(`${API_BASE}/api/memories`, { method: 'DELETE' });
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

  async answerQuestion(runId: string, selections: string[][], notes: string[]): Promise<void> {
    const response = await fetch(`${API_BASE}/api/runs/${runId}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selections, notes })
    });
    if (!response.ok) throw new Error(await errorMessage(response, 'Answer could not be submitted.'));
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
