import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChatMessage } from "@locagens/shared";
import { estimateTokens, compactHistory } from "./contextWindow.js";

function toolCallMsg(id: string, name: string, args: Record<string, any>, content = ""): ChatMessage {
  return {
    role: "assistant",
    content,
    toolCalls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } } as any]
  };
}

function toolResult(id: string, content: string): ChatMessage {
  return { role: "tool", content, tool_call_id: id, name: "read_file" };
}

/** A long history: task + many tool-call/result pairs + trailing turns. */
function buildHistory(pairs: number, contentSize = 400): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "user", content: "Original task: build the thing" }];
  for (let i = 0; i < pairs; i++) {
    messages.push(toolCallMsg(`call-${i}`, "read_file", { path: `src/file-${i}.ts` }));
    messages.push(toolResult(`call-${i}`, "x".repeat(contentSize)));
  }
  messages.push({ role: "assistant", content: "done reading" });
  return messages;
}

test("estimateTokens counts content and tool call args", () => {
  const messages: ChatMessage[] = [
    { role: "user", content: "a".repeat(400) },
    toolCallMsg("c1", "read_file", { path: "src/a.ts" })
  ];
  const tokens = estimateTokens(messages, "s".repeat(400));
  // 400 + 400 chars alone are 200 tokens; args add more.
  assert.ok(tokens > 200);
});

test("compactHistory returns null when below eviction floor", () => {
  const messages = buildHistory(3);
  // 1 task + 3 pairs + 1 trailing = 5 units; tail pin (6) covers everything.
  assert.equal(compactHistory(messages, 10), null);
});

test("compactHistory never splits a tool-call/result pair", () => {
  const messages = buildHistory(20);
  const result = compactHistory(messages, 500);
  assert.ok(result);
  const kept = result.messages;
  for (let i = 0; i < kept.length; i++) {
    const m = kept[i];
    if (m.role === "assistant" && m.toolCalls?.length) {
      // Every tool call must be followed by its results.
      for (let k = 0; k < m.toolCalls.length; k++) {
        const next = kept[i + 1 + k];
        assert.equal(next?.role, "tool");
        assert.equal(next?.tool_call_id, m.toolCalls[k].id);
      }
    }
    if (m.role === "tool") {
      // Every kept result must be preceded by an assistant message carrying its call.
      let j = i - 1;
      while (j >= 0 && kept[j].role === "tool") j--;
      const caller = kept[j];
      assert.equal(caller?.role, "assistant");
      assert.ok(caller?.toolCalls?.some(tc => tc.id === m.tool_call_id));
    }
  }
});

test("compactHistory pins the task message and the tail", () => {
  const messages = buildHistory(20);
  const result = compactHistory(messages, 500);
  assert.ok(result);
  const kept = result.messages;
  assert.equal(kept[0].content, "Original task: build the thing");
  // Trailing message survives.
  assert.equal(kept[kept.length - 1].content, "done reading");
});

test("compactHistory inserts exactly one marker with tool names and paths", () => {
  const messages = buildHistory(20);
  const result = compactHistory(messages, 500);
  assert.ok(result);
  const markers = result.messages.filter(m => m.content.startsWith("[CONTEXT COMPACTED]"));
  assert.equal(markers.length, 1);
  assert.equal(markers[0].role, "user");
  assert.match(markers[0].content, /read_file/);
  assert.match(markers[0].content, /src\/file-0\.ts/);
  assert.ok(result.evictedCount > 0);
  // Marker sits right after the pinned task message.
  assert.equal(result.messages[1], markers[0]);
});

test("compactHistory marker restates the original task", () => {
  const messages = buildHistory(20);
  const result = compactHistory(messages, 500);
  assert.ok(result);
  const marker = result.messages[1];
  assert.match(marker.content, /Your task is still: "Original task: build the thing"/);
});

test("compactHistory clips oversized tool results when eviction alone falls short", () => {
  // 4 huge pairs + trailing = 6 units; everything is inside the pinned tail, so
  // eviction can remove nothing — clipping must kick in instead.
  const messages = buildHistory(4, 40_000);
  const before = estimateTokens(messages, "");
  const result = compactHistory(messages, Math.floor(before * 0.3));
  assert.ok(result);
  assert.equal(result.evictedCount, 0);
  assert.ok(result.clippedCount > 0);
  // Clipped results are stubs; pairing is preserved.
  const stubs = result.messages.filter(m => m.role === "tool" && m.content.startsWith("[STALE TOOL RESULT REMOVED"));
  assert.equal(stubs.length, result.clippedCount);
  for (const stub of stubs) assert.ok(stub.tool_call_id);
  // The most recent tool result keeps its full payload.
  const lastToolMsg = [...result.messages].reverse().find(m => m.role === "tool");
  assert.ok(lastToolMsg && lastToolMsg.content.length >= 40_000);
  assert.ok(estimateTokens(result.messages, "") < before);
});

test("compactHistory shrinks the estimate below the original", () => {
  const messages = buildHistory(30, 1000);
  const before = estimateTokens(messages, "");
  const result = compactHistory(messages, Math.floor(before * 0.3));
  assert.ok(result);
  const after = estimateTokens(result.messages, "");
  assert.ok(after < before);
});
