import type { CompletionRequest, CompletionResponse } from "@agent-bridge/shared";

export interface ModelProvider {
  complete(
    request: CompletionRequest,
    onChunk?: (chunk: { content?: string; reasoningContent?: string }) => void
  ): Promise<CompletionResponse>;
}
