import type { CompletionRequest, CompletionResponse } from "@bridgemind/shared";
import type { ModelProvider } from "./ModelProvider.js";

export class AnthropicProvider implements ModelProvider {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ""); // Strip trailing slash
    this.apiKey = apiKey;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const url = `${this.baseUrl}/v1/messages`;

    // Filter and map messages to conform to Anthropic Messages API
    // Anthropic only allows "user" and "assistant" roles in messages.
    const messages = request.messages
      .filter(msg => msg.role === "user" || msg.role === "assistant")
      .map(msg => ({
        role: msg.role as "user" | "assistant",
        content: msg.content
      }));

    const body: any = {
      model: request.model,
      messages,
      max_tokens: request.maxTokens ?? 4096, // Anthropic requires max_tokens
      temperature: request.temperature ?? 0.7
    };

    // Anthropic accepts system prompt as a top-level field
    if (request.systemPrompt) {
      body.system = request.systemPrompt;
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "Unknown error");
        throw new Error(`Anthropic API returned status ${response.status}: ${errText}`);
      }

      const data = await response.json() as any;

      if (!data.content || !Array.isArray(data.content)) {
        throw new Error("Anthropic API returned invalid response shape");
      }

      // Join all text blocks in the content array
      const content = data.content
        .filter((block: any) => block.type === "text")
        .map((block: any) => block.text)
        .join("\n");

      const usage = data.usage;

      return {
        content,
        raw: data,
        usage: usage ? {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          totalTokens: usage.input_tokens + usage.output_tokens
        } : undefined
      };
    } catch (error: any) {
      throw new Error(`Failed to query Anthropic provider: ${error.message}`);
    }
  }
}
