import { execFileSync } from "node:child_process";

const KEYCHAIN_SERVICE = "Locagens Provider API Key";
const KEYCHAIN_REF_PREFIX = "macos-keychain:";

export interface ProviderSecretStore {
  readonly supportsSecurePersistence: boolean;
  get(ref: string): string;
  set(providerId: string, apiKey: string): string;
}

export class MacOSKeychainProviderSecretStore implements ProviderSecretStore {
  readonly supportsSecurePersistence = process.platform === "darwin";

  get(ref: string): string {
    if (!this.supportsSecurePersistence || !ref.startsWith(KEYCHAIN_REF_PREFIX)) return "";
    const providerId = ref.slice(KEYCHAIN_REF_PREFIX.length);
    try {
      return execFileSync("security", ["find-generic-password", "-w", "-a", providerId, "-s", KEYCHAIN_SERVICE], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();
    } catch {
      return "";
    }
  }

  set(providerId: string, apiKey: string): string {
    if (!this.supportsSecurePersistence) {
      throw new Error("Secure provider secret storage is only available on macOS Keychain.");
    }
    execFileSync("security", ["add-generic-password", "-U", "-a", providerId, "-s", KEYCHAIN_SERVICE, "-w", apiKey], {
      stdio: ["ignore", "ignore", "pipe"]
    });
    return `${KEYCHAIN_REF_PREFIX}${providerId}`;
  }
}

export class InMemoryProviderSecretStore implements ProviderSecretStore {
  readonly supportsSecurePersistence = true;
  private secrets = new Map<string, string>();

  get(ref: string): string {
    return this.secrets.get(ref) || "";
  }

  set(providerId: string, apiKey: string): string {
    const ref = `memory:${providerId}`;
    this.secrets.set(ref, apiKey);
    return ref;
  }
}
