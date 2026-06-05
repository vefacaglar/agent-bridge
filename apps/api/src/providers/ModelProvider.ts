import type { CompletionRequest, CompletionResponse } from "@bridgemind/shared";

export interface ModelProvider {
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}
