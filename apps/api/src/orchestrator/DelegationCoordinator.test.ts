import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFilesChanged } from "./DelegationCoordinator.js";

test("parseFilesChanged reads a valid JSON array line", () => {
  const summary = `Implemented the feature using node.js conventions.
FILES_CHANGED: ["src/a.ts","src/components/B.vue"]
DID: Added the new endpoint.
ISSUES: none`;
  assert.deepEqual(parseFilesChanged(summary), ["src/a.ts", "src/components/B.vue"]);
});

test("parseFilesChanged returns empty array for []", () => {
  assert.deepEqual(parseFilesChanged("FILES_CHANGED: []\nDID: nothing\nISSUES: none"), []);
});

test("parseFilesChanged uses the LAST FILES_CHANGED line", () => {
  const summary = `FILES_CHANGED: ["old.ts"]
Some intermediate text.
FILES_CHANGED: ["final.ts"]`;
  assert.deepEqual(parseFilesChanged(summary), ["final.ts"]);
});

test("parseFilesChanged returns null on malformed JSON (fallback to regex scan)", () => {
  assert.equal(parseFilesChanged("FILES_CHANGED: [src/a.ts, src/b.ts]"), null);
});

test("parseFilesChanged returns null when the line is absent", () => {
  assert.equal(parseFilesChanged("CHANGED: src/a.ts\nDID: stuff\nISSUES: none"), null);
});

test("parseFilesChanged drops non-string and empty entries", () => {
  assert.deepEqual(parseFilesChanged('FILES_CHANGED: ["a.ts", 42, "", "  b.ts "]'), ["a.ts", "b.ts"]);
});
