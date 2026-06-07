import { app, BrowserWindow, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { dataDir, isDev, resolvePort, webIndex } from "./paths";
import { startBackend, stopBackend, waitForBackend } from "./backend";

const DEV_URL = "http://localhost:5173";

// Force the app name so app.getPath("userData") resolves to
// ~/Library/Application Support/Locagens (matching the backend's own default
// config dir) rather than the scoped package name "@agent-bridge/desktop".
app.setName("Locagens");

let win: BrowserWindow | null = null;

function apiBase(port: number): string {
  return `http://localhost:${port}`;
}

/**
 * Ensures the backend is up for the current environment and returns its port.
 * In prod the main process owns the backend (fork + health-check). In dev the
 * backend runs standalone via `pnpm dev`, so we only resolve the port.
 */
async function ensureBackend(): Promise<number> {
  fs.mkdirSync(dataDir(), { recursive: true });
  const port = resolvePort();
  if (!isDev) {
    startBackend(port);
    await waitForBackend(port);
  }
  return port;
}

function createWindow(port: number): void {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    backgroundColor: "#1a1a1a",
    // Hide the native title bar; keep the macOS traffic lights inset over the
    // app's top-left. The window stays draggable via -webkit-app-region on the
    // app's own header bars (see the .is-desktop styles in the web app).
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--locagens-api-base=${apiBase(port)}`],
    },
  });

  if (isDev) {
    win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(webIndex());
  }

  // In dev the Vite server may not be up yet (or starts after Electron). Retry
  // the load instead of leaving a blank window. Also surfaces real load errors.
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    if (code === -3) return; // aborted (e.g. superseded by a new load)
    console.error(`[window] failed to load ${url}: ${code} ${desc}`);
    if (isDev) {
      setTimeout(() => {
        if (win && !win.isDestroyed()) win.loadURL(DEV_URL);
      }, 1000);
    }
  });

  // Open external links in the user's browser, not inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.on("closed", () => {
    win = null;
  });
}

// Double-clicking the app's draggable header toggles the macOS "zoom" (fill the
// screen's width/height, not native fullscreen). Deterministic regardless of the
// system's title-bar double-click preference.
ipcMain.handle("locagens:toggle-maximize", (event) => {
  const target = BrowserWindow.fromWebContents(event.sender);
  if (!target) return;
  if (target.isMaximized()) target.unmaximize();
  else target.maximize();
});

// Restart after the port changes in Settings. In prod, kill + re-fork the
// backend on the new port and recreate the window (so preload re-injects the
// new API base). In dev the backend is external, so we just recreate the
// window; the user restarts `pnpm dev` for the new port to bind.
ipcMain.handle("locagens:restart-backend", async () => {
  const port = resolvePort();
  if (!isDev) {
    await stopBackend();
    startBackend(port);
    await waitForBackend(port);
  }
  const old = win;
  createWindow(port);
  old?.close();
  return { port };
});

app.whenReady().then(async () => {
  const port = await ensureBackend();
  createWindow(port);

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const port = await ensureBackend();
      createWindow(port);
    }
  });
});

app.on("window-all-closed", async () => {
  await stopBackend();
  if (process.platform !== "darwin") app.quit();
});

let isQuitting = false;

app.on("before-quit", (event) => {
  if (!isQuitting) {
    event.preventDefault();
    isQuitting = true;
    stopBackend().finally(() => {
      app.quit();
    });
  }
});
