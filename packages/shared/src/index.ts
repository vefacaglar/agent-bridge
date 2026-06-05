export type RunStatus =
  | "created"
  | "generating"
  | "awaiting_permission"
  | "done"
  | "failed"
  | "cancelled";

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  name?: string;
  toolCalls?: ToolCall[];
}

export interface CompletionRequest {
  model: string;
  systemPrompt?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: any[];
}

export interface CompletionResponse {
  content: string;
  toolCalls?: ToolCall[];
  raw?: unknown;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export interface RunModelSnapshot {
  providerId: string;
  providerDisplayName: string;
  model: string;
}

export interface RunMessage {
  id: string;
  runId: string;
  role: "system" | "user" | "assistant" | "tool";
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
  providerId: string;
  providerDisplayName: string;
  model: string;
  mode?: string;
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
    }
  | {
      type: "permission_requested";
      runId: string;
      toolCall: any;
      preview?: PermissionPreview | null;
    };

// Context attached to a permission request so the UI can render a preview
// (e.g. a red/green diff for file edits) instead of just raw arguments.
export interface PermissionPreview {
  tool: string;
  action: "create" | "edit" | "delete" | "read" | "list";
  path: string;
  absolutePath: string;
  oldContent: string | null;
  newContent: string | null;
}

// Safe Provider Metadata structure returned by GET /api/providers
export interface ProviderMetadata {
  id: string;
  displayName: string;
  type: "openai-compatible" | "anthropic";
  models: string[];
}

export interface Project {
  path: string;
  name: string;
  createdAt: string;
}

