import type { CompletionRequest, CompletionResponse } from "@locagens/shared";
import type { ModelProvider } from "./ModelProvider.js";
import { DEFAULT_MAX_TOKENS } from "./ModelProvider.js";
import { openAiReasoningParams } from "./reasoningWire.js";

// Max time to wait with no response data before aborting. Reset on every chunk,
// so a model that keeps streaming (e.g. long reasoning) is never cut off.
const IDLE_TIMEOUT_MS = 300_000; // 5 minutes

// Transient upstream failures (provider overloaded / temporarily unavailable /
// rate limited) are retried a couple of times with a short exponential backoff
// before giving up — kept brief on purpose so a sustained outage falls through
// quickly to the orchestrator's sub-agent fallback chain instead of stalling.
// We only retry BEFORE any stream data has been emitted, so the UI never sees
// duplicated content.
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 400;

const isTransientStatus = (status: number): boolean =>
  status === 429 || status === 500 || status === 502 || status === 503 || status === 504;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// Exponential backoff with jitter: ~0.4s, ~0.8s (+ up to 150ms random).
const backoffDelay = (attempt: number): number =>
  RETRY_BASE_DELAY_MS * 2 ** attempt + Math.floor(Math.random() * 150);

/**
 * Maps an OpenAI-shaped usage object to our common usage shape. OpenAI counts
 * cached prompt tokens INSIDE prompt_tokens, so we subtract them to report the
 * fresh (full-rate) input and surface the cached portion separately. There is no
 * cache-write premium on this API.
 */
function mapOpenAIUsage(usage: any): CompletionResponse["usage"] {
  if (!usage) return undefined;
  const cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    inputTokens: usage.prompt_tokens != null ? usage.prompt_tokens - cachedTokens : undefined,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    cacheReadInputTokens: usage.prompt_tokens_details?.cached_tokens ?? undefined
  };
}

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

    // Map system prompt and history into messages list. Prompt caching here is
    // AUTOMATIC: OpenAI and most compatible backends cache on a stable leading
    // prefix with no explicit markers (and there is no portable cache_control
    // field to set without risking rejection by stricter compatible servers).
    // Keeping the system prompt first and the prompt prefix stable across loop
    // turns — which it is — is what lets that automatic caching kick in.
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
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS
    };

    if (request.reasoning?.style === "openai-chat" && request.reasoning.value) {
      // Each model names/shapes its reasoning control differently; the adapter
      // converts the chosen effort to that model's official parameter.
      Object.assign(body, openAiReasoningParams(request.model, request.reasoning));
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools;
    }

    if (onChunk) {
      body.stream = true;
      // NOTE: we deliberately do NOT set stream_options.include_usage here.
      // Some OpenAI-compatible gateways (e.g. commandcode/MiniMax) stop emitting
      // tool_calls entirely once that field is present, which silently breaks
      // every workspace tool. If a provider includes a usage chunk on its own we
      // still capture it below, but we never request one.
    }

    // Idle (inactivity) timeout: the timer resets whenever data arrives, so a
    // long-running model is never cut off mid-stream — only a genuine stall
    // (no bytes for IDLE_TIMEOUT_MS) aborts the request. The controller/timer
    // are reassigned per attempt and kept alive for the successful attempt's
    // body read.
    let controller!: AbortController;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const armTimeout = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
    };

    try {
      // Retry loop around the request + initial response check. Transient
      // upstream failures (overloaded / 5xx / rate limit) and pre-stream network
      // errors are retried with backoff; once we have a good response we fall
      // through and read it (no retry past this point, to avoid dup chunks).
      let response!: Response;
      for (let attempt = 0; ; attempt++) {
        controller = new AbortController();
        armTimeout();

        try {
          response = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${this.apiKey}`
            },
            body: JSON.stringify(body),
            signal: controller.signal
          });
          armTimeout();
        } catch (fetchError: any) {
          // A genuine idle timeout abort is not retryable — surface it as-is.
          if (fetchError.name === "AbortError" || fetchError.message?.includes("aborted")) {
            throw fetchError;
          }
          // Pre-stream network error: retry if attempts remain.
          if (attempt < MAX_RETRIES) {
            clearTimeout(timeoutId);
            await sleep(backoffDelay(attempt));
            continue;
          }
          throw fetchError;
        }

        if (!response.ok) {
          const errText = await response.text().catch(() => "Unknown error");
          if (isTransientStatus(response.status) && attempt < MAX_RETRIES) {
            clearTimeout(timeoutId);
            await sleep(backoffDelay(attempt));
            continue;
          }
          throw new Error(`OpenAI API returned status ${response.status}: ${errText}`);
        }

        break; // got a usable response — stop retrying
      }

      if (onChunk && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        let accumulatedContent = "";
        let accumulatedReasoning = "";
        let streamedUsage: any = undefined;
        const toolCallsAccumulator: any[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          armTimeout(); // data arrived — reset the inactivity timer

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
              // The trailing include_usage chunk carries usage with no choices.
              if (parsed.usage) streamedUsage = parsed.usage;
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
          raw: null,
          usage: streamedUsage ? mapOpenAIUsage(streamedUsage) : undefined
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
        usage: mapOpenAIUsage(data.usage)
      };
    } catch (error: any) {
      if (error.name === "AbortError" || error.message?.includes("aborted")) {
        throw new Error(`Request to provider timed out after ${IDLE_TIMEOUT_MS}ms with no response data`);
      }
      throw new Error(`Failed to query OpenAI-compatible provider: ${error.message}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
