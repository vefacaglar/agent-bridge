import type { CompletionRequest, CompletionResponse, ChatMessage } from "@bridgemind/shared";
import type { ModelProvider } from "./ModelProvider.js";

/**
 * Converts OpenAI-style tool definitions into Anthropic's tool schema.
 * (function.parameters -> input_schema)
 */
function toAnthropicTools(tools?: any[]) {
  if (!tools || tools.length === 0) return undefined;
  return tools.map(tool => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters
  }));
}

/**
 * Maps the internal (OpenAI-shaped) message list to the Anthropic Messages
 * format. Plain text turns use string content; tool calls become `tool_use`
 * blocks on the assistant turn and `tool_result` blocks on a following user
 * turn. Consecutive tool results are merged into a single user message so the
 * conversation keeps alternating user/assistant turns.
 */
function toAnthropicMessages(messages: ChatMessage[]): any[] {
  const out: any[] = [];
  let i = 0;

  while (i < messages.length) {
    const m = messages[i];

    if (m.role === "system") {
      // System content is sent via the top-level `system` field instead.
      i++;
    } else if (m.role === "user") {
      out.push({ role: "user", content: m.content });
      i++;
    } else if (m.role === "assistant") {
      if (m.toolCalls && m.toolCalls.length > 0) {
        const blocks: any[] = [];
        if (m.content && m.content.trim()) {
          blocks.push({ type: "text", text: m.content });
        }
        for (const tc of m.toolCalls) {
          let input: unknown = {};
          try {
            input = JSON.parse(tc.function.arguments || "{}");
          } catch {
            input = {};
          }
          blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
        }
        out.push({ role: "assistant", content: blocks });
      } else {
        out.push({ role: "assistant", content: m.content });
      }
      i++;
    } else if (m.role === "tool") {
      const blocks: any[] = [];
      while (i < messages.length && messages[i].role === "tool") {
        const t = messages[i];
        blocks.push({ type: "tool_result", tool_use_id: t.tool_call_id, content: t.content });
        i++;
      }
      out.push({ role: "user", content: blocks });
    } else {
      i++;
    }
  }

  return out;
}

export class AnthropicProvider implements ModelProvider {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ""); // Strip trailing slash
    this.apiKey = apiKey;
  }

  async complete(
    request: CompletionRequest,
    onChunk?: (chunk: { content?: string; reasoningContent?: string }) => void
  ): Promise<CompletionResponse> {
    const url = `${this.baseUrl}/v1/messages`;

    const body: any = {
      model: request.model,
      messages: toAnthropicMessages(request.messages),
      max_tokens: request.maxTokens ?? 4096, // Anthropic requires max_tokens
      temperature: request.temperature ?? 0.7
    };

    if (request.systemPrompt) {
      body.system = request.systemPrompt;
    }

    const tools = toAnthropicTools(request.tools);
    if (tools) {
      body.tools = tools;
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
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "Unknown error");
        throw new Error(`Anthropic API returned status ${response.status}: ${errText}`);
      }

      const data = await response.json() as any;

      if (!data.content || !Array.isArray(data.content)) {
        throw new Error("Anthropic API returned invalid response shape");
      }

      // Join all text blocks; collect tool_use blocks as tool calls.
      const content = data.content
        .filter((block: any) => block.type === "text")
        .map((block: any) => block.text)
        .join("\n");

      const reasoningContent = data.content
        .filter((block: any) => block.type === "thinking")
        .map((block: any) => block.thinking)
        .join("\n") || undefined;

      const toolUseBlocks = data.content.filter((block: any) => block.type === "tool_use");
      const toolCalls = toolUseBlocks.length > 0
        ? toolUseBlocks.map((block: any) => ({
            id: block.id,
            type: "function" as const,
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input ?? {})
            }
          }))
        : undefined;

      if ((!content || !content.trim()) && (!reasoningContent || !reasoningContent.trim()) && (!toolCalls || toolCalls.length === 0)) {
        throw new Error("Provider returned an empty response");
      }

      const usage = data.usage;

      return {
        content,
        reasoningContent,
        toolCalls,
        raw: data,
        usage: usage ? {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          totalTokens: usage.input_tokens + usage.output_tokens
        } : undefined
      };
    } catch (error: any) {
      if (error.name === "AbortError" || error.message?.includes("aborted")) {
        throw new Error("Request to provider timed out after 60000ms");
      }
      throw new Error(`Failed to query Anthropic provider: ${error.message}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
