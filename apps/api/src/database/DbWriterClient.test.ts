import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { DbWriterClient } from "./DbWriterClient.js";

test("DbWriterClient Unit Tests", async (t) => {
  const tempDbPath = path.join(process.cwd(), "db-writer-test-temp.db");
  const tempPendingWritesPath = tempDbPath + ".pending-writes.json";

  t.afterEach(() => {
    if (fs.existsSync(tempDbPath)) {
      try { fs.unlinkSync(tempDbPath); } catch {}
    }
    if (fs.existsSync(tempPendingWritesPath)) {
      try { fs.unlinkSync(tempPendingWritesPath); } catch {}
    }
  });

  await t.test("DbWriterClient - saves and recovers pending writes correctly", async () => {
    const client = new DbWriterClient(tempDbPath);

    // Mock active pending requests
    const mockRequest1 = { op: "run.create", args: { run: { id: "run-1", title: "Test 1", task: "Task 1", status: "created", providerId: "p1", providerDisplayName: "P1", model: "m1", createdAt: "2026-06-08T00:00:00Z", updatedAt: "2026-06-08T00:00:00Z" } } };
    const mockRequest2 = { op: "message.create", args: { message: { id: "msg-1", runId: "run-1", role: "user", content: "Hello", createdAt: "2026-06-08T00:00:01Z" } } };

    // Inject mock pending writes into the client's map
    (client as any).pending.set("1", {
      resolve: () => {},
      reject: () => {},
      timer: setTimeout(() => {}, 1000),
      request: mockRequest1
    });
    (client as any).pending.set("2", {
      resolve: () => {},
      reject: () => {},
      timer: setTimeout(() => {}, 1000),
      request: mockRequest2
    });

    // Call private savePendingWrites method
    (client as any).savePendingWrites();

    // Verify backup file was created
    assert.ok(fs.existsSync(tempPendingWritesPath), "Backup file should be created");
    const backupContent = JSON.parse(fs.readFileSync(tempPendingWritesPath, "utf-8"));
    assert.strictEqual(backupContent.length, 2, "Backup should contain 2 requests");
    assert.strictEqual(backupContent[0].op, "run.create");
    assert.strictEqual(backupContent[1].op, "message.create");

    // Clean up timers
    for (const pending of (client as any).pending.values()) {
      clearTimeout(pending.timer);
    }
    (client as any).pending.clear();

    // Now test recovery
    // Mock write method to intercept recovered writes
    const recoveredWrites: any[] = [];
    client.write = async (req) => {
      recoveredWrites.push(req);
      return { success: true } as any;
    };

    // Trigger recovery
    await (client as any).recoverPendingWrites();

    // Verify recovery played both requests and deleted the backup file
    assert.strictEqual(recoveredWrites.length, 2, "Should have recovered 2 requests");
    assert.strictEqual(recoveredWrites[0].op, "run.create");
    assert.strictEqual(recoveredWrites[1].op, "message.create");
    assert.ok(!fs.existsSync(tempPendingWritesPath), "Backup file should be deleted after recovery");
  });

  await t.test("DbWriterClient - recovers and ignores UNIQUE constraint errors", async () => {
    const client = new DbWriterClient(tempDbPath);

    // Mock active pending request
    const mockRequest = { op: "run.create", args: { run: { id: "run-1" } } };

    // Save to backup file
    fs.writeFileSync(tempPendingWritesPath, JSON.stringify([mockRequest], null, 2), "utf8");

    // Mock write method to simulate SQLite unique constraint error
    client.write = async () => {
      throw new Error("UNIQUE constraint failed: runs.id");
    };

    // Trigger recovery
    await assert.doesNotReject(async () => {
      await (client as any).recoverPendingWrites();
    }, "Should not throw when recovering duplicate/unique constraint failed write");

    assert.ok(!fs.existsSync(tempPendingWritesPath), "Backup file should still be deleted even on duplicate failure");
  });

  await t.test("DbWriterClient - rejects new writes when closing", async () => {
    const client = new DbWriterClient(tempDbPath);
    (client as any).closing = true;

    await assert.rejects(
      client.write({ op: "run.create" }),
      /DB writer is closing, cannot accept new writes/
    );
  });
});
