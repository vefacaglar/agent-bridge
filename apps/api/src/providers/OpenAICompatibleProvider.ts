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
    messages.push(...request.messages.map(msg => {
      const formatted: any = {
        role: msg.role,
        content: msg.content
      };
      if (msg.role === "tool") {
        formatted.tool_call_id = msg.tool_call_id;
        formatted.name = msg.name;
      }
      if (msg.toolCalls) {
        formatted.tool_calls = msg.toolCalls;
      }
      return formatted;
    }));

    const body: any = {
      model: request.model,
      messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens
    };

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 60000); // 60s timeout

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
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
      const toolCalls = choice.message?.tool_calls;

      if ((!content || !content.trim()) && (!toolCalls || toolCalls.length === 0)) {
        throw new Error("Provider returned an empty response");
      }

      const usage = data.usage;

      return {
        content,
        toolCalls: toolCalls ? toolCalls.map((tc: any) => ({
          id: tc.id,
          type: tc.type,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments
          }
        })) : undefined,
        raw: data,
        usage: usage ? {
          inputTokens: usage.prompt_tokens,
          outputTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens
        } : undefined
      };
    } catch (error: any) {
      if (error.name === "AbortError" || error.message?.includes("aborted")) {
        throw new Error("Request to provider timed out after 60000ms");
      }
      throw new Error(`Failed to query OpenAI-compatible provider: ${error.message}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
