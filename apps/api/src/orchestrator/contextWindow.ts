import type { ChatMessage } from "@locagens/shared";

/**
 * Context-window enforcement for the shared generation loop.
 *
 * When a model has a configured contextLimit and the conversation approaches
 * it, the oldest turns are evicted and replaced with one synthetic marker
 * message. Compaction is deliberately chunky (trigger at 80%, cut down to 50%)
 * so the prefix cache is invalidated once per compaction instead of every turn.
 *
 * History is treated as atomic "units" — the same pairing rule rebuildHistory
 * uses: an assistant message with toolCalls plus its immediately following tool
 * results form ONE unit and are never split, otherwise strict providers reject
 * the request ("a tool result must follow its call").
 *
 * Eviction alone can fall short: the pinned tail (or a short history) may exceed
 * the target by itself, e.g. one huge read_file result. A second pass then
 * replaces large tool-result payloads in the kept units with a short stub —
 * keeping the conversational flow (what the model did) while dropping the bulk.
 */

export const COMPACT_TRIGGER_RATIO = 0.8;
export const COMPACT_TARGET_RATIO = 0.5;

/**
 * Fallback context limit used when a model has no configured contextLimit.
 * Without it, an unconfigured model gets NO compaction at all and simply
 * overflows the provider. Conservative enough to protect small models without
 * crippling big ones.
 */
export const DEFAULT_CONTEXT_LIMIT = 256_000;

// chars-per-token divisor. /4 undercounts for code-heavy and non-English
// content (the real count is usually higher), which would fire the compaction
// trigger too late — so we estimate slightly hot.
const CHARS_PER_TOKEN = 3.5;

// The original task message (unit 0) and the most recent units always survive,
// no matter how large they are.
const PINNED_TAIL_UNITS = 6;
const MAX_MARKER_PATHS = 40;
const TASK_REMINDER_MAX_CHARS = 200;

// Phase-2 clipping: tool results bigger than this in kept (non-recent) units
// are replaced with a stub when eviction alone cannot reach the target. The
// last CLIP_KEEP_TAIL_UNITS units always keep their full results — the model
// is likely still acting on them.
const CLIP_THRESHOLD_CHARS = 2_000;
const CLIP_KEEP_TAIL_UNITS = 2;

/** Rough token estimate for a request: chars/3.5 over system prompt + messages. */
export function estimateTokens(messages: ChatMessage[], systemPrompt: string): number {
  let chars = systemPrompt.length;
  for (const m of messages) {
    chars += (m.content || "").length;
    if (m.toolCalls) {
      for (const tc of m.toolCalls) {
        chars += (tc.function?.name || "").length + (tc.function?.arguments || "").length;
      }
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

interface Unit {
  messages: ChatMessage[];
  tokens: number;
}

function messageTokens(m: ChatMessage): number {
  let chars = (m.content || "").length;
  if (m.toolCalls) {
    for (const tc of m.toolCalls) {
      chars += (tc.function?.name || "").length + (tc.function?.arguments || "").length;
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/** Groups messages into atomic units: assistant+toolCalls swallow their results. */
function groupIntoUnits(messages: ChatMessage[]): Unit[] {
  const units: Unit[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const unit: Unit = { messages: [m], tokens: messageTokens(m) };
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      let j = i + 1;
      while (j < messages.length && messages[j].role === "tool" && unit.messages.length - 1 < m.toolCalls.length) {
        unit.messages.push(messages[j]);
        unit.tokens += messageTokens(messages[j]);
        j++;
      }
      i = j - 1;
    }
    units.push(unit);
  }
  return units;
}

/** Pulls tool names and path-like args out of an evicted unit for the marker. */
function collectEvictionFacts(unit: Unit, toolNames: Set<string>, paths: Set<string>): void {
  for (const m of unit.messages) {
    if (!m.toolCalls) continue;
    for (const tc of m.toolCalls) {
      const name = tc.function?.name;
      if (name) toolNames.add(name);
      try {
        const args = JSON.parse(tc.function?.arguments || "{}");
        for (const key of ["path", "source_path", "destination_path"]) {
          if (typeof args[key] === "string" && args[key].trim()) paths.add(args[key].trim());
        }
      } catch { /* malformed args carry no facts */ }
    }
  }
}

// future: LLM summary — replace this deterministic marker with a cheap-model
// summary of the evicted turns when that proves worth the extra call.
function buildMarker(evictedCount: number, toolNames: Set<string>, paths: Set<string>, taskText?: string): ChatMessage {
  const pathList = [...paths].slice(0, MAX_MARKER_PATHS);
  const lines = [
    `[CONTEXT COMPACTED] ${evictedCount} earlier messages were removed to fit the context window.`
  ];
  if (toolNames.size > 0) lines.push(`Tools previously used: ${[...toolNames].join(", ")}.`);
  if (pathList.length > 0) {
    const more = paths.size > pathList.length ? ` (+${paths.size - pathList.length} more)` : "";
    lines.push(`Files previously read/edited: ${pathList.join(", ")}${more}.`);
  }
  lines.push("Re-read any file before relying on its contents.");
  // Weak models lose track of the rules after long runs (the system prompt is
  // still sent, but attention drifts) — restate the contract at the cut point.
  if (taskText) {
    const trimmed = taskText.trim().slice(0, TASK_REMINDER_MAX_CHARS);
    const ellipsis = taskText.trim().length > TASK_REMINDER_MAX_CHARS ? "…" : "";
    lines.push(`Your task is still: "${trimmed}${ellipsis}". Keep working with your tools and do not end the run before it is complete (or you are blocked on the user).`);
  }
  return { role: "user", content: lines.join("\n") };
}

/** The stub that replaces an oversized, stale tool-result payload. */
function clippedResultStub(toolName?: string): string {
  return `[STALE TOOL RESULT REMOVED to save context] The output of ${toolName ? `"${toolName}"` : "this tool call"} was large and has been dropped. Re-run the tool if you need it again.`;
}

/**
 * Shrinks the history to fit targetTokens in two phases:
 * 1. Evicts the oldest non-pinned units, inserting one synthetic marker after
 *    the task message.
 * 2. If still over target (the pinned tail alone can exceed it), replaces large
 *    tool-result payloads in the kept units — except the most recent ones —
 *    with a short stub, preserving the call/result pairing.
 * Returns null when nothing could be removed or clipped.
 */
export function compactHistory(
  messages: ChatMessage[],
  targetTokens: number
): { messages: ChatMessage[]; evictedCount: number; clippedCount: number } | null {
  const units = groupIntoUnits(messages);
  // Unit 0 (the original task) and the tail are pinned.
  const firstEvictable = 1;
  const lastEvictable = Math.max(units.length - PINNED_TAIL_UNITS, firstEvictable); // exclusive

  let total = units.reduce((sum, u) => sum + u.tokens, 0);
  const toolNames = new Set<string>();
  const paths = new Set<string>();
  let evictedCount = 0;
  let cursor = firstEvictable;

  while (cursor < lastEvictable && total > targetTokens) {
    const unit = units[cursor];
    collectEvictionFacts(unit, toolNames, paths);
    evictedCount += unit.messages.length;
    total -= unit.tokens;
    cursor++;
  }

  // Phase 2: clip oversized tool results in what survives, oldest first.
  const keptUnits = [...units.slice(0, firstEvictable), ...units.slice(cursor)];
  let clippedCount = 0;
  const clipEnd = keptUnits.length - CLIP_KEEP_TAIL_UNITS;
  for (let i = firstEvictable; i < clipEnd && total > targetTokens; i++) {
    const unit = keptUnits[i];
    unit.messages = unit.messages.map(m => {
      const size = (m.content || "").length;
      if (total <= targetTokens || m.role !== "tool" || size <= CLIP_THRESHOLD_CHARS) return m;
      const stub = clippedResultStub(m.name);
      total -= Math.ceil((size - stub.length) / CHARS_PER_TOKEN);
      clippedCount++;
      return { ...m, content: stub };
    });
  }

  if (evictedCount === 0 && clippedCount === 0) return null;

  const taskMessage = keptUnits[0]?.messages[0];
  const taskText = taskMessage?.role === "user" ? taskMessage.content : undefined;

  const kept: ChatMessage[] = [];
  for (const u of keptUnits.slice(0, firstEvictable)) kept.push(...u.messages);
  if (evictedCount > 0) kept.push(buildMarker(evictedCount, toolNames, paths, taskText));
  for (const u of keptUnits.slice(firstEvictable)) kept.push(...u.messages);

  return { messages: kept, evictedCount, clippedCount };
}
