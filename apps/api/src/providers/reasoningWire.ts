import type { ResolvedReasoningConfig } from "@locagens/shared";

/** Model name without any "vendor/" prefix, lowercased. */
function basename(model: string): string {
  return (model.split("/").pop() || model).toLowerCase();
}

/** Collapses an effort value to a coarse low/medium/high bucket. */
function bucket(value: string | undefined): "low" | "medium" | "high" {
  const v = (value || "").toLowerCase();
  if (v === "minimal" || v === "low") return "low";
  if (v === "medium") return "medium";
  return "high"; // high / xhigh / max / anything else
}

/**
 * Translates a resolved reasoning selection into the request-body params a
 * specific OpenAI-compatible model expects. The UI always offers plain effort
 * levels (low/medium/high…); each vendor names and shapes its reasoning control
 * differently, so the adapter converts here instead of always sending
 * `reasoning_effort`. Models not listed fall back to `reasoning_effort`.
 */
export function openAiReasoningParams(model: string, reasoning: ResolvedReasoningConfig): Record<string, unknown> {
  const name = basename(model);

  if (name.startsWith("deepseek-v4")) return { thinking_preference: "enabled" };
  if (name.startsWith("qwen3.7-max") || name.startsWith("qwen3.6-max")) return { thinking_config: { mode: "on" } };
  if (name.startsWith("kimi-k2.6")) return { reasoning_mode: "high_effort" };
  if (name.startsWith("minimax-m3")) return { thinking_control: { enable: true } };
  if (name.startsWith("glm-5.1")) return { thinking_effort: bucket(reasoning.value) === "low" ? "low" : "high" };
  if (name.startsWith("mimo-v2.5")) return { reasoning_scope: bucket(reasoning.value) === "low" ? "standard" : "extensive" };

  // gpt-5.x and any unrecognized model: standard OpenAI reasoning_effort.
  return { reasoning_effort: reasoning.value };
}
