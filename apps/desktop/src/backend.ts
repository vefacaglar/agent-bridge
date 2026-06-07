import { utilityProcess, type UtilityProcess } from "electron";
import { backendScript, dbPath, dbWriterBinary, settingsPath } from "./paths";

let child: UtilityProcess | null = null;

/**
 * Env passed to the forked backend. The settings file is the source of truth
 * for the port; PORT is passed too as a belt-and-suspenders default. DB lives
 * next to settings in the env-specific data dir. Provider config is left to the
 * backend's own default (which already resolves to the same app-support dir).
 */
function backendEnv(port: number): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    PORT: String(port),
    LOCAGENS_SETTINGS_PATH: settingsPath(),
    LOCAGENS_DB_PATH: dbPath(),
    LOCAGENS_DB_WRITER_PATH: dbWriterBinary(),
  };
}

/** Forks the bundled backend as a child process (prod). */
export function startBackend(port: number): void {
  child = utilityProcess.fork(backendScript(), [], {
    env: backendEnv(port),
    stdio: "pipe",
  });
  child.stdout?.on("data", (d) => process.stdout.write(`[backend] ${d}`));
  child.stderr?.on("data", (d) => process.stderr.write(`[backend] ${d}`));
}

/** Stops the running backend child, resolving once it has exited. */
export function stopBackend(): Promise<void> {
  return new Promise((resolve) => {
    if (!child) return resolve();
    const current = child;
    child = null;
    current.once("exit", () => resolve());
    current.kill();
  });
}

/** Polls /ping until the backend answers or the timeout elapses. */
export async function waitForBackend(port: number, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/ping`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Backend did not become ready on port ${port}`);
}
