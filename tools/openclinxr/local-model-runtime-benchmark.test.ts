import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  buildLocalModelRuntimeBenchmarkReportFromLog,
  extractBalancedJsonCandidate,
  parseLlamaRuntimeLog,
} from "./local-model-runtime-benchmark.js";

const execFileAsync = promisify(execFile);

describe("local model runtime benchmark parser", () => {
  it("parses llama.cpp runtime metadata, structured output, metrics, and caveats from a local log", () => {
    const parsed = parseLlamaRuntimeLog(sampleLlamaLog);

    expect(parsed.generatedAt).toBe("2026-05-05T20:10:11Z");
    expect(parsed.runtime).toMatchObject({
      backend: "llama.cpp b9010-d05fe1d7d",
      device: "MTL0 (Apple M1 Max)",
      ctxSize: 2048,
      predictTokensRequested: 128,
      temperature: 0,
      topP: 1,
      metalModelBufferMiB: 2375.91,
      metalKvBufferMiB: 288,
      metalComputeBufferMiB: 301.75,
    });
    expect(parsed.output.parsedJson).toEqual({
      candidate: "Qwen/Qwen3-4B-GGUF",
      triage_priority: "high",
      safety_flags: ["hypotension", "chest pain"],
    });
    expect(parsed.output.structuredOutputCaveats).toEqual(expect.arrayContaining([
      "The model emitted a leading <think> marker before the JSON object even with reasoning disabled.",
      "The JSON object was parsable, but safety_flags were clinical features rather than the requested guardrail labels.",
    ]));
    expect(parsed.metrics).toMatchObject({
      loadTimeMs: 558.84,
      promptEvalTimeMs: 177.23,
      promptEvalTokens: 124,
      promptEvalTokensPerSecond: 699.66,
      evalTimeMs: 1345.59,
      generatedRuns: 85,
      generationTokensPerSecond: 63.17,
      totalRuntimeMs: 1543.52,
      wallClockMs: 3670,
      approxTimeToFirstGeneratedTokenMs: 751.9,
      maxResidentSetBytes: 2925461504,
      peakMemoryFootprintBytes: 369838768,
    });
  });

  it("builds the production-shaped report without strengthening clinical or target-hardware claims", async () => {
    const report = await buildLocalModelRuntimeBenchmarkReportFromLog({
      generatedAt: "2026-05-05T20:10:11Z",
      logPath: "/Users/patrick/.cache/openclinxr/benchmarks/sample.log",
      logContent: sampleLlamaLog,
      logSha256: "abc123",
      grammarFailureExcerptPath: "/Users/patrick/.cache/openclinxr/benchmarks/grammar-failure.log",
    });

    expect(report).toMatchObject({
      generatedAt: "2026-05-05T20:10:11Z",
      status: "passed_with_caveats",
      policy: {
        cloudApisUsed: false,
        paidApisUsed: false,
        modelDownloadApproved: true,
        localRuntimeExecutionApproved: false,
        localRuntimeExecutionAttemptedByThisTool: false,
        productionUseAllowed: false,
      },
      runtime: {
        command: "llama-completion",
        fallbackCommandUsed: "llama-cli",
        backend: "llama.cpp b9010-d05fe1d7d",
        modelId: "Qwen/Qwen3-4B-GGUF",
        modelFile: "Qwen3-4B-Q4_K_M.gguf",
        sourceRecordIds: [
          "src-qwen3-4b-gguf-2026",
          "src-qwen-local-docs-2026",
          "src-llama-cpp-homebrew-2026",
        ],
      },
      verdict: {
        passed: true,
        blockers: [],
      },
    });
    expect(report.verdict.caveats).toEqual(expect.arrayContaining([
      "Good enough for a local adapter latency smoke; not good enough for clinical actor quality or validated scoring.",
      "Hardware result is for this Apple M1 Max machine, not the target M4 Pro or M4 Max claim.",
    ]));
    expect(report.output.rawLogPath).toBe("/Users/patrick/.cache/openclinxr/benchmarks/sample.log");
    expect(report.output.rawLogSha256).toBe("abc123");
  });

  it("extracts the first balanced JSON object after llama generation markers", () => {
    expect(extractBalancedJsonCandidate("noise {\"a\":{\"b\":2}} [end of text] trailing")).toBe("{\"a\":{\"b\":2}}");
    expect(extractBalancedJsonCandidate("no json here")).toBeNull();
  });
});

describe("local model runtime benchmark CLI", () => {
  it("harvests an existing local log without executing model inference", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-local-model-runtime-"));
    const logPath = path.join(dir, "runtime.log");
    const outputPath = path.join(dir, "report.json");
    await writeFile(logPath, sampleLlamaLog, "utf8");

    await execFileAsync(
      path.resolve("node_modules/.bin/tsx"),
      [
        "tools/openclinxr/local-model-runtime-benchmark.ts",
        "--parse-log",
        logPath,
        "--output",
        outputPath,
      ],
      {
        encoding: "utf8",
        timeout: 15000,
      },
    );

    const report = JSON.parse(await readFile(outputPath, "utf8")) as {
      policy: {
        cloudApisUsed: boolean;
        localRuntimeExecutionAttemptedByThisTool: boolean;
      };
      output: {
        rawLogPath: string;
        rawLogSha256: string;
      };
      runtime: {
        command: string;
      };
      verdict: {
        passed: boolean;
      };
    };

    expect(report.policy.cloudApisUsed).toBe(false);
    expect(report.policy.localRuntimeExecutionAttemptedByThisTool).toBe(false);
    expect(report.runtime.command).toBe("llama-completion");
    expect(report.output.rawLogPath).toBe(logPath);
    expect(report.output.rawLogSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.verdict.passed).toBe(true);
  });
});

const sampleLlamaLog = [
  "version: b9010-d05fe1d7d",
  "load_backend: loaded MTL backend from /opt/homebrew/lib/libggml-metal.so",
  "ggml_metal_device_init: GPU name:   MTL0 (Apple M1 Max)",
  "load_tensors:   CPU_Mapped model buffer size =   304.28 MiB",
  "load_tensors:  MTL0_Mapped model buffer size =  2375.91 MiB",
  "llama_context: n_ctx         = 2048",
  "llama_kv_cache:       MTL0 KV buffer size =   288.00 MiB",
  "sched_reserve:       MTL0 compute buffer size =   301.75 MiB",
  "sampler params:",
  "  top_k = 40, top_p = 1.000, min_p = 0.050, temp = 0.000",
  "generate: n_ctx = 2048, n_batch = 2048, n_predict = 128, n_keep = 0",
  "",
  "<think>",
  "",
  "{\"candidate\":\"Qwen/Qwen3-4B-GGUF\",\"triage_priority\":\"high\",\"safety_flags\":[\"hypotension\",\"chest pain\"]} [end of text]",
  "",
  "common_perf_print:        load time =     558.84 ms",
  "common_perf_print: prompt eval time =     177.23 ms /   124 tokens (    1.43 ms per token,   699.66 tokens per second)",
  "common_perf_print:        eval time =    1345.59 ms /    85 runs   (   15.83 ms per token,    63.17 tokens per second)",
  "common_perf_print:       total time =    1543.52 ms /   209 tokens",
  "          2925461504  maximum resident set size",
  "          369838768  peak memory footprint",
  "real 3.67",
  "ended_at_utc=2026-05-05T20:10:11Z",
  "exit_status=0",
].join("\n");
