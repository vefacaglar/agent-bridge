import type { SearchEngine, SearchSettings } from "@locagens/shared";

export const SEARCH_ENGINE_OPTIONS: SearchEngine[] = ["duckduckgo", "brave", "google", "disabled"];

export function normalizeSearchEngine(value: unknown): SearchEngine {
  if (typeof value === "string" && SEARCH_ENGINE_OPTIONS.includes(value as SearchEngine)) {
    return value as SearchEngine;
  }
  return "duckduckgo";
}

export interface PersistedSearchSettings {
  engine: SearchEngine;
  braveApiKeyRef?: string;
  googleApiKeyRef?: string;
  googleSearchEngineId?: string;
}

export interface ResolvedSearchSettings extends SearchSettings {
  braveApiKeyRef?: string;
  googleApiKeyRef?: string;
  /** Override: resolved settings never exposes raw keys. */
  braveApiKey?: never;
  googleApiKey?: never;
  hasBraveApiKey?: never;
  hasGoogleApiKey?: never;
}

export interface RawSearchSettingsInput {
  engine?: unknown;
  braveApiKey?: string;
  googleApiKey?: string;
  googleSearchEngineId?: string;
}

export function normalizeSearchSettings(settings: unknown): RawSearchSettingsInput & { engine: SearchEngine } {
  const raw = (settings ?? {}) as Record<string, unknown>;
  return {
    engine: normalizeSearchEngine(raw.engine),
    braveApiKey: typeof raw.braveApiKey === "string" ? raw.braveApiKey : "",
    googleApiKey: typeof raw.googleApiKey === "string" ? raw.googleApiKey : "",
    googleSearchEngineId: typeof raw.googleSearchEngineId === "string" ? raw.googleSearchEngineId : ""
  };
}
