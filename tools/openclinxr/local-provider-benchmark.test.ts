import { describe, expect, it } from "vitest";
import {
  buildLocalProviderBenchmarkReport,
  parseLocalProviderEnvFileContent,
  type BenchmarkResult,
} from "./local-provider-benchmark.js";

describe("local provider benchmark report", () => {
  it("marks configured local model and voice runtimes as ready to benchmark without executing them", () => {
    const report = buildLocalProviderBenchmarkReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
      availableCommands: ["ollama", "vibevoice"],
      env: {
        OPENCLINXR_LOCAL_MODEL_RUNTIME: "ollama",
        OPENCLINXR_LOCAL_MODEL_ID: "qwen-local-smoke",
        OPENCLINXR_LOCAL_VOICE_RUNTIME: "vibevoice",
        OPENCLINXR_LOCAL_VOICE_ID: "vibevoice-local-smoke",
      },
      mockModel: passedBenchmark("model"),
      mockVoice: passedBenchmark("voice"),
    });

    expect(report.localModel).toMatchObject({
      status: "passed",
      blockers: [],
      metrics: {
        availableRuntimeCommands: "ollama",
        configuredRuntime: "ollama",
        configuredModel: "qwen-local-smoke",
        executionAttempted: false,
      },
    });
    expect(report.localVoice).toMatchObject({
      status: "passed",
      blockers: [],
      metrics: {
        availableRuntimeCommands: "vibevoice",
        configuredRuntime: "vibevoice",
        configuredVoice: "vibevoice-local-smoke",
        executionAttempted: false,
      },
    });
    expect(report.verdict).toEqual({
      deterministicMocksPassed: true,
      localModelReadyToBenchmark: true,
      localVoiceReadyToBenchmark: true,
      blockers: [],
    });
  });

  it("keeps local readiness blockers explicit while deterministic mocks pass", () => {
    const report = buildLocalProviderBenchmarkReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
      availableCommands: [],
      env: {},
      mockModel: passedBenchmark("model"),
      mockVoice: passedBenchmark("voice"),
    });

    expect(report.verdict.deterministicMocksPassed).toBe(true);
    expect(report.localModel.blockers).toEqual([
      "no_ollama_llama_cpp_or_mlx_runtime_detected",
      "OPENCLINXR_LOCAL_MODEL_RUNTIME_not_set",
      "OPENCLINXR_LOCAL_MODEL_ID_not_set",
    ]);
    expect(report.localVoice.blockers).toEqual([
      "no_vibevoice_runtime_detected",
      "OPENCLINXR_LOCAL_VOICE_RUNTIME_not_set",
      "OPENCLINXR_LOCAL_VOICE_ID_not_set",
    ]);
    expect(report.verdict.blockers).toEqual([
      "local_model:no_ollama_llama_cpp_or_mlx_runtime_detected",
      "local_model:OPENCLINXR_LOCAL_MODEL_RUNTIME_not_set",
      "local_model:OPENCLINXR_LOCAL_MODEL_ID_not_set",
      "local_voice:no_vibevoice_runtime_detected",
      "local_voice:OPENCLINXR_LOCAL_VOICE_RUNTIME_not_set",
      "local_voice:OPENCLINXR_LOCAL_VOICE_ID_not_set",
    ]);
  });
});

describe("local provider env parsing", () => {
  it("only accepts the explicit local provider allowlist", () => {
    expect(
      parseLocalProviderEnvFileContent(
        [
          "OPENCLINXR_LOCAL_MODEL_RUNTIME=ollama",
          "export OPENCLINXR_LOCAL_MODEL_ID='qwen-local-smoke'",
          'OPENCLINXR_LOCAL_VOICE_RUNTIME="vibevoice"',
          "OPENCLINXR_LOCAL_VOICE_ID=vibevoice-local-smoke",
          "GROK_API_KEY=must-not-load",
          "",
        ].join("\n"),
      ),
    ).toEqual({
      OPENCLINXR_LOCAL_MODEL_RUNTIME: "ollama",
      OPENCLINXR_LOCAL_MODEL_ID: "qwen-local-smoke",
      OPENCLINXR_LOCAL_VOICE_RUNTIME: "vibevoice",
      OPENCLINXR_LOCAL_VOICE_ID: "vibevoice-local-smoke",
    });
  });
});

function passedBenchmark(kind: string): BenchmarkResult {
  return {
    status: "passed",
    latencyMs: 1,
    blockers: [],
    metrics: {
      kind,
    },
  };
}
