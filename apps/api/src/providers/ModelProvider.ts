import type { CompletionRequest, CompletionResponse } from "@locagens/shared";

/**
 * Output-token ceiling sent on every completion when the caller doesn't specify
 * one. We always send an explicit max_tokens so a provider's (sometimes low)
 * default can't silently truncate a long response — e.g. a reasoning model
 * spending its budget on thinking and then cutting off a tool call's JSON
 * arguments mid-way, which surfaces as "Unexpected end of JSON input".
 */
export const DEFAULT_MAX_TOKENS = 32000;

export interface ModelProvider {
  complete(
    request: CompletionRequest,
    onChunk?: (chunk: { content?: string; reasoningContent?: string }) => void
  ): Promise<CompletionResponse>;
}
