import type { CompletionRequest, CompletionResponse } from "@bridgemind/shared";
import type { ModelProvider } from "./ModelProvider.js";

function parseOpenAIMessageContent(content: string): any {
  if (!content) return "";
  const regex = /!\[([^\]]*)\]\((data:image\/[a-zA-Z+.-]+;base64,[^)]+)\)/g;
  const matches = [...content.matchAll(regex)];
  if (matches.length === 0) {
    return content;
  }

  const parts: any[] = [];
  let lastIndex = 0;

  for (const match of matches) {
    const textPart = content.slice(lastIndex, match.index).trim();
    if (textPart) {
      parts.push({ type: "text", text: textPart });
    }
    const dataUrl = match[2];
    parts.push({
      type: "image_url",
      image_url: { url: dataUrl }
    });
    lastIndex = (match.index ?? 0) + match[0].length;
  }

  const remainingText = content.slice(lastIndex).trim();
  if (remainingText) {
    parts.push({ type: "text", text: remainingText });
  }

  return parts;
}

export class OpenAICompatibleProvider implements ModelProvider {
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
    const url = `${this.baseUrl}/chat/completions`;

    // Map system prompt and history into messages list
    const messages = [];
    if (request.systemPrompt) {
      messages.push({ role: "system", content: request.systemPrompt });
    }
    messages.push(...request.messages.map(msg => {
      const formatted: any = {
        role: msg.role,
        content: msg.role === "user" ? parseOpenAIMessageContent(msg.content) : msg.content
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

    if (onChunk) {
      body.stream = true;
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

      if (onChunk && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        let accumulatedContent = "";
        let accumulatedReasoning = "";
        const toolCallsAccumulator: any[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            const rawJson = trimmed.slice(6).trim();
            if (rawJson === "[DONE]") continue;

            try {
              const parsed = JSON.parse(rawJson);
              const choice = parsed.choices?.[0];
              if (!choice) continue;

              const delta = choice.delta;
              if (!delta) continue;

              const deltaContent = delta.content || "";
              const deltaReasoning = delta.reasoning_content || delta.reasoning || "";

              if (deltaContent) {
                accumulatedContent += deltaContent;
              }
              if (deltaReasoning) {
                accumulatedReasoning += deltaReasoning;
              }

              if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index;
                  if (!toolCallsAccumulator[idx]) {
                    toolCallsAccumulator[idx] = {
                      id: tc.id || "",
                      type: tc.type || "function",
                      function: { name: "", arguments: "" }
                    };
                  }
                  if (tc.id) toolCallsAccumulator[idx].id = tc.id;
                  if (tc.function?.name) toolCallsAccumulator[idx].function.name += tc.function.name;
                  if (tc.function?.arguments) toolCallsAccumulator[idx].function.arguments += tc.function.arguments;
                }
              }

              if (deltaContent || deltaReasoning) {
                onChunk({
                  content: deltaContent || undefined,
                  reasoningContent: deltaReasoning || undefined
                });
              }
            } catch (err) {
              // Ignore invalid lines
            }
          }
        }

        const finalToolCalls = toolCallsAccumulator.filter(Boolean);

        return {
          content: accumulatedContent,
          reasoningContent: accumulatedReasoning || undefined,
          toolCalls: finalToolCalls.length > 0 ? finalToolCalls.map((tc: any) => ({
            id: tc.id,
            type: tc.type,
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments
            }
          })) : undefined,
          raw: null
        };
      }

      const data = await response.json() as any;

      if (!data.choices || data.choices.length === 0) {
        throw new Error("OpenAI API returned empty choices list");
      }

      const choice = data.choices[0];
      const content = choice.message?.content || "";
      const reasoningContent = choice.message?.reasoning_content || choice.message?.reasoning || undefined;
      const toolCalls = choice.message?.tool_calls;

      if ((!content || !content.trim()) && (!reasoningContent || !reasoningContent.trim()) && (!toolCalls || toolCalls.length === 0)) {
        throw new Error("Provider returned an empty response");
      }

      const usage = data.usage;

      return {
        content,
        reasoningContent,
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
