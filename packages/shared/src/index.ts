export type RunStatus =
  | "created"
  | "planning"
  | "implementing"
  | "reviewing"
  | "fixing"
  | "done"
  | "failed"
  | "cancelled"
  | "max_rounds_reached";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  model: string;
  systemPrompt?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface CompletionResponse {
  content: string;
  raw?: unknown;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export interface RunModelSnapshot {
  plannerProviderId: string;
  plannerProviderDisplayName: string;
  plannerModel: string;
  coderProviderId: string;
  coderProviderDisplayName: string;
  coderModel: string;
  maxRounds: number;
}

export interface RunMessage {
  id: string;
  runId: string;
  role: "system" | "user" | "assistant";
  agentRole?: "planner" | "coder" | "reviewer" | "user";
  providerId?: string;
  providerDisplayName?: string;
  model?: string;
  content: string;
  rawResponse?: string;
  createdAt: string;
}

export interface Run {
  id: string;
  title: string;
  task: string;
  projectPath?: string;
  projectName?: string;
  status: RunStatus;
  plannerProviderId: string;
  plannerProviderDisplayName: string;
  plannerModel: string;
  coderProviderId: string;
  coderProviderDisplayName: string;
  coderModel: string;
  maxRounds: number;
  currentRound: number;
  sourceRunId?: string;
  retryType?: string;
  finalOutput?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export type RunEvent =
  | {
      type: "run_started";
      runId: string;
    }
  | {
      type: "status_changed";
      status: RunStatus;
    }
  | {
      type: "round_started";
      round: number;
    }
  | {
      type: "message_created";
      message: RunMessage;
    }
  | {
      type: "model_snapshot_locked";
      snapshot: RunModelSnapshot;
    }
  | {
      type: "run_completed";
      finalOutput: string;
    }
  | {
      type: "run_failed";
      errorMessage: string;
    };

// Safe Provider Metadata structure returned by GET /api/providers
export interface ProviderMetadata {
  id: string;
  displayName: string;
  type: "openai-compatible" | "anthropic";
  models: string[];
}
