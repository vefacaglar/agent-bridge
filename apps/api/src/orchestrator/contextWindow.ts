import type { ChatMessage } from "@agent-bridge/shared";

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
 */

export const COMPACT_TRIGGER_RATIO = 0.8;
export const COMPACT_TARGET_RATIO = 0.5;

// The original task message (unit 0) and the most recent units always survive,
// no matter how large they are.
const PINNED_TAIL_UNITS = 6;
const MAX_MARKER_PATHS = 40;

/** Rough token estimate for a request: chars/4 over system prompt + messages. */
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
  return Math.ceil(chars / 4);
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
  return Math.ceil(chars / 4);
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
function buildMarker(evictedCount: number, toolNames: Set<string>, paths: Set<string>): ChatMessage {
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
  return { role: "user", content: lines.join("\n") };
}

/**
 * Evicts the oldest non-pinned units until the history fits targetTokens,
 * inserting one synthetic marker after the task message. Returns null when
 * nothing can be evicted (history already minimal).
 */
export function compactHistory(
  messages: ChatMessage[],
  targetTokens: number
): { messages: ChatMessage[]; evictedCount: number } | null {
  const units = groupIntoUnits(messages);
  // Unit 0 (the original task) and the tail are pinned.
  const firstEvictable = 1;
  const lastEvictable = units.length - PINNED_TAIL_UNITS; // exclusive
  if (lastEvictable <= firstEvictable) return null;

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

  if (evictedCount === 0) return null;

  const kept: ChatMessage[] = [];
  for (const m of units.slice(0, firstEvictable)) kept.push(...m.messages);
  kept.push(buildMarker(evictedCount, toolNames, paths));
  for (const u of units.slice(cursor)) kept.push(...u.messages);

  return { messages: kept, evictedCount };
}
