import { LocalModelProviderAdapter } from "./index.js";
import type { LocalModelProviderStubOptions } from "./model-gateway-internal.js";

export function createMlxModelProviderAdapter(options: LocalModelProviderStubOptions = {}): LocalModelProviderAdapter {
  return new LocalModelProviderAdapter({
    providerId: "local-mlx",
    blockers: options.blockers ?? ["mlx_model_runtime_not_configured"],
  });
}

export function createLlamaCppModelProviderAdapter(options: LocalModelProviderStubOptions = {}): LocalModelProviderAdapter {
  return new LocalModelProviderAdapter({
    providerId: "local-llama-cpp",
    blockers: options.blockers ?? ["llama_cpp_model_runtime_not_configured"],
  });
}

export function createOllamaModelProviderAdapter(options: LocalModelProviderStubOptions = {}): LocalModelProviderAdapter {
  return new LocalModelProviderAdapter({
    providerId: "local-ollama",
    blockers: options.blockers ?? ["ollama_model_runtime_not_configured"],
  });
}
