import fs from "fs";
import os from "node:os";
import path from "path";
import type { ProviderMetadata, AgentPreset } from "@agent-bridge/shared";
import type { ModelProvider } from "./ModelProvider.js";
import { ProviderFactory } from "./ProviderFactory.js";
import { MacOSKeychainProviderSecretStore, type ProviderSecretStore } from "./ProviderSecretStore.js";

interface ProviderConfigBlock {
  type: "openai-compatible" | "anthropic";
  displayName: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
}

interface PersistedProviderConfigBlock extends Omit<ProviderConfigBlock, "apiKey"> {
  apiKey?: string;
  apiKeyRef?: string;
}

export const PRESERVE_API_KEY_VALUE = "__LOCAGENS_PRESERVE_API_KEY__";

export interface EditableProviderConfigBlock extends Omit<ProviderConfigBlock, "apiKey"> {
  apiKey: typeof PRESERVE_API_KEY_VALUE | "";
  hasApiKey: boolean;
}

interface AgentPresetBlock {
  displayName: string;
  architect: { providerId: string; model: string };
  coder: { providerId: string; model: string };
  maxSubAgents?: number;
  utility?: { providerId: string; model: string };
  fallback?: boolean;
}

interface ConfigSchema {
  providers: Record<string, PersistedProviderConfigBlock>;
  agentPresets?: Record<string, AgentPresetBlock>;
}

export class ProviderRegistry {
  private configs: Record<string, ProviderConfigBlock> = {};
  private agentPresets: Record<string, AgentPresetBlock> = {};
  private providers: Map<string, ModelProvider> = new Map();
  private configPathOverride?: string;
  private persistPath = "";
  private secretStore: ProviderSecretStore;

  constructor(configPathOverride?: string, secretStore: ProviderSecretStore = new MacOSKeychainProviderSecretStore()) {
    this.configPathOverride = configPathOverride;
    this.secretStore = secretStore;
    this.loadConfiguration(configPathOverride);
  }

  private findWorkspaceRoot(): string {
    let currentDir = process.cwd();
    // Prevent infinite loop on root
    const rootDir = path.parse(currentDir).root;
    while (currentDir !== rootDir) {
      if (fs.existsSync(path.join(currentDir, "pnpm-workspace.yaml"))) {
        return currentDir;
      }
      currentDir = path.dirname(currentDir);
    }
    return process.cwd(); // Fallback to current working directory
  }

  private defaultConfigPath(): string {
    if (process.env.LOCAGENS_PROVIDER_CONFIG_PATH) {
      return process.env.LOCAGENS_PROVIDER_CONFIG_PATH;
    }
    if (process.env.AGENT_BRIDGE_PROVIDER_CONFIG_PATH) {
      return process.env.AGENT_BRIDGE_PROVIDER_CONFIG_PATH;
    }

    const appDirName = "Locagens";
    if (process.platform === "darwin") {
      return path.join(os.homedir(), "Library", "Application Support", appDirName, "providers.local.json");
    }
    if (process.platform === "win32") {
      return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), appDirName, "providers.local.json");
    }
    return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "locagens", "providers.local.json");
  }

  private loadConfiguration(configPathOverride?: string) {
    const wsRoot = this.findWorkspaceRoot();
    const localPath = configPathOverride || this.defaultConfigPath();
    const legacyProjectPath = path.join(wsRoot, "providers.local.json");
    const examplePath = path.join(wsRoot, "providers.example.json");
    this.persistPath = localPath;

    let configPath = "";
    if (fs.existsSync(localPath)) {
      configPath = localPath;
      console.log(`[ProviderRegistry] Loading config from: ${localPath}`);
    } else if (!configPathOverride && fs.existsSync(legacyProjectPath)) {
      configPath = legacyProjectPath;
      console.warn(`[ProviderRegistry] WARNING: Loading legacy project config from ${legacyProjectPath}. Save provider settings once to migrate secrets to ${localPath}.`);
    } else if (fs.existsSync(examplePath)) {
      configPath = examplePath;
      console.warn(`[ProviderRegistry] WARNING: provider config not found at ${localPath}. Falling back to template: ${examplePath}`);
    } else {
      console.error(`[ProviderRegistry] ERROR: No provider configuration found at ${localPath} or ${examplePath}`);
      return;
    }

    try {
      const rawData = fs.readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(rawData) as ConfigSchema;
      if (parsed && parsed.providers) {
        this.configs = this.hydrateConfigs(parsed.providers);
      }
      this.agentPresets = (parsed && parsed.agentPresets) || this.loadExampleAgentPresets(wsRoot);
      if (parsed?.providers && this.shouldMigrateInlineApiKeys(parsed.providers)) {
        this.persist();
      }
    } catch (err: any) {
      console.error(`[ProviderRegistry] Failed to parse configuration file at ${configPath}:`, err.message);
    }
  }

  getSafeMetadata(): ProviderMetadata[] {
    return Object.entries(this.configs).map(([id, block]) => ({
      id,
      displayName: block.displayName,
      type: block.type,
      models: block.models
    }));
  }

  private loadExampleAgentPresets(wsRoot: string): Record<string, AgentPresetBlock> {
    const examplePath = path.join(wsRoot, "providers.example.json");
    if (!fs.existsSync(examplePath)) return {};
    try {
      const parsed = JSON.parse(fs.readFileSync(examplePath, "utf-8")) as ConfigSchema;
      return parsed.agentPresets || {};
    } catch {
      return {};
    }
  }

  /**
   * Safe metadata for the configured dual-model agent presets. Presets only
   * reference provider ids + model names (already public), so no secrets leak.
   * maxSubAgents is clamped to 1..3.
   */
  getAgentPresets(): AgentPreset[] {
    return Object.entries(this.agentPresets).map(([id, block]) => ({
      id,
      displayName: block.displayName || id,
      architect: { providerId: block.architect.providerId, model: block.architect.model },
      coder: { providerId: block.coder.providerId, model: block.coder.model },
      maxSubAgents: Math.min(3, Math.max(1, block.maxSubAgents ?? 3)),
      utility: block.utility
        ? { providerId: block.utility.providerId, model: block.utility.model }
        : undefined,
      fallback: !!block.fallback
    }));
  }

  getAgentPreset(id: string): AgentPreset | undefined {
    return this.getAgentPresets().find(p => p.id === id);
  }

  /** Persists the full agent-preset set to providers.local.json (keeps providers intact). */
  saveAgentPresets(presets: Record<string, AgentPresetBlock>) {
    this.agentPresets = presets;
    this.persist();
  }

  getProvider(id: string): ModelProvider {
    // Check cache first
    let provider = this.providers.get(id);
    if (provider) return provider;

    const block = this.configs[id];
    if (!block) {
      throw new Error(`Provider config with id "${id}" not found`);
    }

    provider = ProviderFactory.create(block.type, block.baseUrl, block.apiKey);
    this.providers.set(id, provider);
    return provider;
  }

  getFullConfigs(): Record<string, ProviderConfigBlock> {
    return this.configs;
  }

  getEditableConfigs(): Record<string, EditableProviderConfigBlock> {
    return Object.fromEntries(
      Object.entries(this.configs).map(([id, block]) => [
        id,
        {
          type: block.type,
          displayName: block.displayName,
          baseUrl: block.baseUrl,
          apiKey: block.apiKey ? PRESERVE_API_KEY_VALUE : "",
          hasApiKey: !!block.apiKey,
          models: block.models
        }
      ])
    );
  }

  saveConfigs(configs: Record<string, ProviderConfigBlock>) {
    this.configs = this.mergePreservedApiKeys(configs);
    this.providers.clear();
    this.persist();
  }

  private hydrateConfigs(configs: Record<string, PersistedProviderConfigBlock>): Record<string, ProviderConfigBlock> {
    return Object.fromEntries(
      Object.entries(configs).map(([id, block]) => [
        id,
        {
          type: block.type,
          displayName: block.displayName,
          baseUrl: block.baseUrl,
          apiKey: block.apiKeyRef ? this.secretStore.get(block.apiKeyRef) : block.apiKey || "",
          models: block.models
        }
      ])
    );
  }

  private shouldMigrateInlineApiKeys(configs: Record<string, PersistedProviderConfigBlock>): boolean {
    return !this.configPathOverride && this.secretStore.supportsSecurePersistence && Object.values(configs).some(block => !!block.apiKey);
  }

  private mergePreservedApiKeys(configs: Record<string, ProviderConfigBlock>): Record<string, ProviderConfigBlock> {
    return Object.fromEntries(
      Object.entries(configs).map(([id, block]) => {
        const current = this.configs[id];
        const nextApiKey = block.apiKey === PRESERVE_API_KEY_VALUE ? current?.apiKey || "" : block.apiKey || "";
        return [
          id,
          {
            type: block.type,
            displayName: block.displayName,
            baseUrl: block.baseUrl,
            apiKey: nextApiKey,
            models: block.models
          }
        ];
      })
    );
  }

  /** Writes the current providers + agentPresets back to providers.local.json. */
  private persist() {
    const payload: ConfigSchema = {
      providers: this.toPersistedConfigs(),
      // Persist an explicit empty object so deleting all presets does not fall
      // back to the template presets on the next reload.
      agentPresets: this.agentPresets
    };
    fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
    fs.writeFileSync(this.persistPath, JSON.stringify(payload, null, 2), "utf-8");
  }

  private toPersistedConfigs(): Record<string, PersistedProviderConfigBlock> {
    return Object.fromEntries(
      Object.entries(this.configs).map(([id, block]) => {
        const persisted: PersistedProviderConfigBlock = {
          type: block.type,
          displayName: block.displayName,
          baseUrl: block.baseUrl,
          models: block.models
        };
        if (block.apiKey && this.secretStore.supportsSecurePersistence) {
          persisted.apiKeyRef = this.secretStore.set(id, block.apiKey);
        } else if (block.apiKey) {
          persisted.apiKey = block.apiKey;
        }
        return [id, persisted];
      })
    );
  }

  // Reload config for testing purposes
  reload() {
    this.providers.clear();
    this.loadConfiguration(this.configPathOverride);
  }
}
