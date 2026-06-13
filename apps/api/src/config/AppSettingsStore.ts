import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppSettings, SearchSettings } from "@locagens/shared";
import { normalizeSearchSettings, SEARCH_ENGINE_OPTIONS, type PersistedSearchSettings, type ResolvedSearchSettings } from "../search/SearchConfig.js";
import { MacOSKeychainProviderSecretStore, type ProviderSecretStore } from "../providers/ProviderSecretStore.js";

export const DEFAULT_PORT = 4321;
export const SEARCH_PRESERVE_API_KEY_VALUE = "__LOCAGENS_PRESERVE_API_KEY__";
const MIN_PORT = 1;
const MAX_PORT = 65535;

const SEARCH_KEYCHAIN_SERVICE = "Locagens Search API Key";

function createSearchSecretStore(): ProviderSecretStore {
  return process.platform === "darwin" ? new MacOSKeychainProviderSecretStore() : {
    supportsSecurePersistence: false,
    get: () => "",
    set: () => { throw new Error("Secure search secret storage is only available on macOS Keychain."); }
  };
}

/**
 * Reads and writes local application settings (backend port + search config)
 * from a small JSON file living next to the provider config in the platform's
 * app-support directory. Provider/search secrets never touch this file — only
 * non-sensitive settings and keychain references are persisted.
 */
export class AppSettingsStore {
  private readonly filePath: string;
  private readonly secretStore: ProviderSecretStore;

  constructor(filePathOverride?: string, secretStore?: ProviderSecretStore) {
    this.filePath = filePathOverride || AppSettingsStore.defaultPath();
    this.secretStore = secretStore || createSearchSecretStore();
  }

  static defaultPath(): string {
    if (process.env.LOCAGENS_SETTINGS_PATH) {
      return process.env.LOCAGENS_SETTINGS_PATH;
    }

    const appDirName = "Locagens";
    if (process.platform === "darwin") {
      return path.join(os.homedir(), "Library", "Application Support", appDirName, "settings.json");
    }
    if (process.platform === "win32") {
      return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), appDirName, "settings.json");
    }
    return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "locagens", "settings.json");
  }

  /** Validates a candidate port, returning a clamped integer or undefined. */
  static normalizePort(value: unknown): number | undefined {
    const port = Number(value);
    if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) return undefined;
    return port;
  }

  /**
   * Resolves the effective port. The config file wins (it is what the UI
   * edits); `PORT` env is only a fallback for unconfigured installs, then the
   * built-in default.
   */
  resolvePort(): number {
    return this.readPortFromFile() ?? AppSettingsStore.normalizePort(process.env.PORT) ?? DEFAULT_PORT;
  }

  read(): AppSettings {
    const resolved = this.readSearchSettings();
    return {
      port: this.readPortFromFile() ?? DEFAULT_PORT,
      search: {
        engine: resolved.engine,
        braveApiKey: "",
        googleApiKey: "",
        googleSearchEngineId: resolved.googleSearchEngineId,
        hasBraveApiKey: !!resolved.braveApiKey,
        hasGoogleApiKey: !!resolved.googleApiKey
      }
    };
  }

  readResolvedSearch(): ResolvedSearchSettings {
    const settings = this.readSearchSettings();
    return {
      engine: settings.engine,
      braveApiKeyRef: settings.braveApiKeyRef,
      googleApiKeyRef: settings.googleApiKeyRef,
      googleSearchEngineId: settings.googleSearchEngineId
    } as ResolvedSearchSettings;
  }

  /** Whether a search API key exists in secure storage. */
  hasSearchKey(ref?: string): boolean {
    if (!ref) return false;
    return !!this.secretStore.get(ref);
  }

  /**
   * The search section stored in the config file, with secret values resolved
   * from the keychain when references are present.
   */
  private readSearchSettings(): SearchSettings & { braveApiKeyRef?: string; googleApiKeyRef?: string } {
    const persisted = this.readSearchFromFile();
    return {
      engine: persisted?.engine ?? "duckduckgo",
      braveApiKey: this.resolveKey(persisted?.braveApiKeyRef),
      googleApiKey: this.resolveKey(persisted?.googleApiKeyRef),
      googleSearchEngineId: persisted?.googleSearchEngineId,
      braveApiKeyRef: persisted?.braveApiKeyRef,
      googleApiKeyRef: persisted?.googleApiKeyRef
    };
  }

  private resolveKey(ref?: string): string | undefined {
    if (!ref) return undefined;
    if (ref.startsWith("macos-keychain:")) {
      return this.secretStore.get(ref) || undefined;
    }
    return undefined;
  }

  /** Persists settings, returning the stored (normalized) values. */
  save(settings: AppSettings): AppSettings {
    const port = AppSettingsStore.normalizePort(settings.port);
    if (!port) throw new Error(`Invalid port: ${settings.port}. Use an integer between ${MIN_PORT} and ${MAX_PORT}.`);

    const next: AppSettings = { port };
    const search = this.persistSearchSettings(settings.search);
    if (search) next.search = search;

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(next, null, 2), "utf-8");
    return next;
  }

  private persistSearchSettings(search?: SearchSettings): SearchSettings | undefined {
    if (!search) return undefined;
    const normalized = normalizeSearchSettings(search);
    const persisted: PersistedSearchSettings = { engine: normalized.engine };

    if (normalized.googleSearchEngineId) {
      persisted.googleSearchEngineId = normalized.googleSearchEngineId;
    }

    if (this.secretStore.supportsSecurePersistence) {
      if (normalized.braveApiKey && normalized.braveApiKey !== SEARCH_PRESERVE_API_KEY_VALUE) {
        persisted.braveApiKeyRef = this.secretStore.set("search:brave", normalized.braveApiKey);
      }
      if (normalized.googleApiKey && normalized.googleApiKey !== SEARCH_PRESERVE_API_KEY_VALUE) {
        persisted.googleApiKeyRef = this.secretStore.set("search:google", normalized.googleApiKey);
      }
    }

    // Preserve existing keychain references when the UI sends the preserve
    // marker and no new value was provided.
    if (normalized.braveApiKey === SEARCH_PRESERVE_API_KEY_VALUE) {
      persisted.braveApiKeyRef = this.readSearchFromFile()?.braveApiKeyRef;
    }
    if (normalized.googleApiKey === SEARCH_PRESERVE_API_KEY_VALUE) {
      persisted.googleApiKeyRef = this.readSearchFromFile()?.googleApiKeyRef;
    }

    // We intentionally do NOT preserve plain API keys in the JSON file. On
    // non-macOS platforms the keys are simply not persisted.
    return {
      engine: persisted.engine,
      googleSearchEngineId: persisted.googleSearchEngineId
    };
  }

  /** The port stored in the config file, or undefined when absent/invalid. */
  private readPortFromFile(): number | undefined {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf-8")) as Partial<AppSettings>;
      return AppSettingsStore.normalizePort(parsed?.port);
    } catch {
      return undefined;
    }
  }

  private readSearchFromFile(): PersistedSearchSettings | undefined {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf-8")) as Partial<AppSettings>;
      if (!parsed?.search) return undefined;
      const engine = SEARCH_ENGINE_OPTIONS.includes(parsed.search.engine as any) ? (parsed.search.engine as any) : "duckduckgo";
      return {
        engine,
        braveApiKeyRef: typeof (parsed.search as any).braveApiKeyRef === "string" ? (parsed.search as any).braveApiKeyRef : undefined,
        googleApiKeyRef: typeof (parsed.search as any).googleApiKeyRef === "string" ? (parsed.search as any).googleApiKeyRef : undefined,
        googleSearchEngineId: typeof parsed.search.googleSearchEngineId === "string" ? parsed.search.googleSearchEngineId : undefined
      };
    } catch {
      return undefined;
    }
  }
}
