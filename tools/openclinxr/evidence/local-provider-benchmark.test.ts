import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type BenchmarkResult,
  buildLocalProviderBenchmarkReport,
  buildUserLocalCommandCandidatePath,
  buildUserLocalCommandCandidatePaths,
  parseLocalProviderEnvFileContent,
  runLocalProviderBenchmarkCli,
  validateLocalProviderBenchmarkReport,
} from "./local-provider-benchmark.js";

describe("local provider benchmark report", () => {
  it("uses the same approved user-local wrapper fallback convention as the runtime probe", () => {
    expect(buildUserLocalCommandCandidatePath("/Users/patrick", "vibevoice")).toBe("/Users/patrick/.local/bin/vibevoice");
    expect(buildUserLocalCommandCandidatePaths("/Users/patrick", "portless")).toEqual([
      "/Users/patrick/.local/bin/portless",
      "/Users/patrick/Library/pnpm/portless",
    ]);
  });

  it("marks configured local model and voice runtimes as ready to benchmark without executing them", () => {
    const report = buildLocalProviderBenchmarkReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
      availableCommands: ["ollama", "vibevoice"],
      env: {
        OPENCLINXR_LOCAL_MODEL_RUNTIME: "ollama",
        OPENCLINXR_LOCAL_MODEL_ID: "Qwen/Qwen3-4B-GGUF",
        OPENCLINXR_LOCAL_MODEL_DOWNLOAD_APPROVED: "true",
        OPENCLINXR_LOCAL_VOICE_RUNTIME: "vibevoice",
        OPENCLINXR_LOCAL_VOICE_ID: "microsoft/VibeVoice-Realtime-0.5B",
        OPENCLINXR_LOCAL_VOICE_INSTALL_APPROVED: "true",
        OPENCLINXR_LOCAL_VOICE_SAFETY_REVIEW_APPROVED: "true",
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
        configuredModel: "Qwen/Qwen3-4B-GGUF",
        sourceRecordIds: "src-qwen3-4b-gguf-2026",
        downloadApproved: true,
        executionAttempted: false,
      },
    });
    expect(report.localVoice).toMatchObject({
      status: "passed",
      blockers: [],
      metrics: {
        availableRuntimeCommands: "vibevoice",
        configuredRuntime: "vibevoice",
        configuredVoice: "microsoft/VibeVoice-Realtime-0.5B",
        sourceRecordIds: "src-vibevoice-github-2026",
        installApproved: true,
        safetyReviewApproved: true,
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

  it("blocks local model and voice candidates without source records or operator approvals", () => {
    const report = buildLocalProviderBenchmarkReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
      availableCommands: ["llama-cli", "vibevoice"],
      env: {
        OPENCLINXR_LOCAL_MODEL_RUNTIME: "llama-cli",
        OPENCLINXR_LOCAL_MODEL_ID: "unknown/model-without-source-record",
        OPENCLINXR_LOCAL_VOICE_RUNTIME: "vibevoice",
        OPENCLINXR_LOCAL_VOICE_ID: "unknown/voice-without-source-record",
      },
      mockModel: passedBenchmark("model"),
      mockVoice: passedBenchmark("voice"),
    });

    expect(report.localModel.blockers).toEqual([
      "local_model_source_record_not_found",
      "OPENCLINXR_LOCAL_MODEL_DOWNLOAD_APPROVED_not_true",
    ]);
    expect(report.localVoice.blockers).toEqual([
      "local_voice_source_record_not_found",
      "OPENCLINXR_LOCAL_VOICE_INSTALL_APPROVED_not_true",
      "OPENCLINXR_LOCAL_VOICE_SAFETY_REVIEW_APPROVED_not_true",
    ]);
    expect(report.verdict.blockers).toEqual([
      "local_model:local_model_source_record_not_found",
      "local_model:OPENCLINXR_LOCAL_MODEL_DOWNLOAD_APPROVED_not_true",
      "local_voice:local_voice_source_record_not_found",
      "local_voice:OPENCLINXR_LOCAL_VOICE_INSTALL_APPROVED_not_true",
      "local_voice:OPENCLINXR_LOCAL_VOICE_SAFETY_REVIEW_APPROVED_not_true",
    ]);
  });

  it("validates local provider benchmark reports without allowing runtime execution claims", () => {
    const report = buildLocalProviderBenchmarkReport({
      generatedAt: "2026-05-06T10:00:00.000Z",
      availableCommands: ["llama-cli", "vibevoice"],
      env: {
        OPENCLINXR_LOCAL_MODEL_RUNTIME: "llama-cli",
        OPENCLINXR_LOCAL_MODEL_ID: "Qwen/Qwen3-4B-GGUF",
        OPENCLINXR_LOCAL_MODEL_DOWNLOAD_APPROVED: "true",
        OPENCLINXR_LOCAL_VOICE_RUNTIME: "vibevoice",
        OPENCLINXR_LOCAL_VOICE_ID: "microsoft/VibeVoice-Realtime-0.5B",
        OPENCLINXR_LOCAL_VOICE_INSTALL_APPROVED: "true",
        OPENCLINXR_LOCAL_VOICE_SAFETY_REVIEW_APPROVED: "true",
      },
      mockModel: passedBenchmark("model"),
      mockVoice: passedBenchmark("voice"),
    });

    expect(validateLocalProviderBenchmarkReport(report)).toEqual({ ok: true });

    const unsafeReport = {
      ...report,
      policy: {
        ...report.policy,
        cloudCallsAllowed: true,
        modelDownloadsAllowed: true,
        localRuntimeExecutionAllowed: true,
      },
    };

    expect(validateLocalProviderBenchmarkReport(unsafeReport)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        "/policy/cloudCallsAllowed must be false",
        "/policy/modelDownloadsAllowed must be false",
        "/policy/localRuntimeExecutionAllowed must be false",
      ]),
    });
  });

  it("keeps latest local provider benchmark validation wired into agent verification", async () => {
    const rootPackage = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(rootPackage.scripts?.["local:provider:benchmark:validate"]).toBe(
      "tsx tools/openclinxr/evidence/local-provider-benchmark.ts --validate-latest",
    );
    expect(rootPackage.scripts?.["agent:verify"]).toContain("pnpm local:provider:benchmark:validate");
    await expect(runLocalProviderBenchmarkCli(["--validate-latest"])).resolves.toBeUndefined();
  });
});

describe("local provider env parsing", () => {
  it("only accepts the explicit local provider allowlist", () => {
    expect(
      parseLocalProviderEnvFileContent(
        [
          "OPENCLINXR_LOCAL_MODEL_RUNTIME=ollama",
          "export OPENCLINXR_LOCAL_MODEL_ID='Qwen/Qwen3-4B-GGUF'",
          "OPENCLINXR_LOCAL_MODEL_DOWNLOAD_APPROVED=true",
          'OPENCLINXR_LOCAL_VOICE_RUNTIME="vibevoice"',
          "OPENCLINXR_LOCAL_VOICE_ID=microsoft/VibeVoice-Realtime-0.5B",
          "OPENCLINXR_LOCAL_VOICE_INSTALL_APPROVED=true",
          "OPENCLINXR_LOCAL_VOICE_SAFETY_REVIEW_APPROVED=true",
          "GROK_API_KEY=must-not-load",
          "",
        ].join("\n"),
      ),
    ).toEqual({
      OPENCLINXR_LOCAL_MODEL_RUNTIME: "ollama",
      OPENCLINXR_LOCAL_MODEL_ID: "Qwen/Qwen3-4B-GGUF",
      OPENCLINXR_LOCAL_MODEL_DOWNLOAD_APPROVED: "true",
      OPENCLINXR_LOCAL_VOICE_RUNTIME: "vibevoice",
      OPENCLINXR_LOCAL_VOICE_ID: "microsoft/VibeVoice-Realtime-0.5B",
      OPENCLINXR_LOCAL_VOICE_INSTALL_APPROVED: "true",
      OPENCLINXR_LOCAL_VOICE_SAFETY_REVIEW_APPROVED: "true",
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
