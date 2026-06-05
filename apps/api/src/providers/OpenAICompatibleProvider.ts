import type { CompletionRequest, CompletionResponse } from "@bridgemind/shared";
import type { ModelProvider } from "./ModelProvider.js";

export class OpenAICompatibleProvider implements ModelProvider {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ""); // Strip trailing slash
    this.apiKey = apiKey;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const url = `${this.baseUrl}/chat/completions`;

    // Map system prompt and history into messages list
    const messages = [];
    if (request.systemPrompt) {
      messages.push({ role: "system", content: request.systemPrompt });
    }
    messages.push(...request.messages.map(msg => ({
      role: msg.role,
      content: msg.content
    })));

    const body = {
      model: request.model,
      messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "Unknown error");
        throw new Error(`OpenAI API returned status ${response.status}: ${errText}`);
      }

      const data = await response.json() as any;

      if (!data.choices || data.choices.length === 0) {
        throw new Error("OpenAI API returned empty choices list");
      }

      const choice = data.choices[0];
      const content = choice.message?.content || "";
      const usage = data.usage;

      return {
        content,
        raw: data,
        usage: usage ? {
          inputTokens: usage.prompt_tokens,
          outputTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens
        } : undefined
      };
    } catch (error: any) {
      throw new Error(`Failed to query OpenAI-compatible provider: ${error.message}`);
    }
  }
}
