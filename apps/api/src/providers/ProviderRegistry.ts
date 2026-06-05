import fs from "fs";
import path from "path";
import type { ProviderMetadata } from "@bridgemind/shared";
import type { ModelProvider } from "./ModelProvider.js";
import { ProviderFactory } from "./ProviderFactory.js";

interface ProviderConfigBlock {
  type: "openai-compatible" | "anthropic";
  displayName: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
}

interface ConfigSchema {
  providers: Record<string, ProviderConfigBlock>;
}

export class ProviderRegistry {
  private configs: Record<string, ProviderConfigBlock> = {};
  private providers: Map<string, ModelProvider> = new Map();

  constructor(configPathOverride?: string) {
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

  private loadConfiguration(configPathOverride?: string) {
    const wsRoot = this.findWorkspaceRoot();
    const localPath = configPathOverride || path.join(wsRoot, "providers.local.json");
    const examplePath = path.join(wsRoot, "providers.example.json");

    let configPath = "";
    if (fs.existsSync(localPath)) {
      configPath = localPath;
      console.log(`[ProviderRegistry] Loading config from: ${localPath}`);
    } else if (fs.existsSync(examplePath)) {
      configPath = examplePath;
      console.warn(`[ProviderRegistry] WARNING: providers.local.json not found! Falling back to template: ${examplePath}`);
    } else {
      console.error(`[ProviderRegistry] ERROR: No provider configuration found at ${localPath} or ${examplePath}`);
      return;
    }

    try {
      const rawData = fs.readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(rawData) as ConfigSchema;
      if (parsed && parsed.providers) {
        this.configs = parsed.providers;
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

  saveConfigs(configs: Record<string, ProviderConfigBlock>) {
    const wsRoot = this.findWorkspaceRoot();
    const localPath = path.join(wsRoot, "providers.local.json");
    fs.writeFileSync(localPath, JSON.stringify({ providers: configs }, null, 2), "utf-8");
    this.configs = configs;
    this.providers.clear();
  }

  // Reload config for testing purposes
  reload() {
    this.providers.clear();
    this.loadConfiguration();
  }
}
