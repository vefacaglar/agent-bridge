import type { ModelProvider } from "./ModelProvider.js";
import { OpenAICompatibleProvider } from "./OpenAICompatibleProvider.js";
import { AnthropicProvider } from "./AnthropicProvider.js";

export class ProviderFactory {
  static create(type: string, baseUrl: string, apiKey: string): ModelProvider {
    switch (type) {
      case "openai-compatible":
        return new OpenAICompatibleProvider(baseUrl, apiKey);
      case "anthropic":
        return new AnthropicProvider(baseUrl, apiKey);
      default:
        throw new Error(`Unsupported provider type: ${type}`);
    }
  }
}
