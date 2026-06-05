import type { CompletionRequest, CompletionResponse } from "@bridgemind/shared";

export interface ModelProvider {
  complete(
    request: CompletionRequest,
    onChunk?: (chunk: { content?: string; reasoningContent?: string }) => void
  ): Promise<CompletionResponse>;
}
