import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("local provider benchmark CLI", () => {
  it("loads explicit local-only model and voice env files without executing runtimes", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-local-ai-env-"));
    const envFile = path.join(dir, "local.env");
    await writeFile(
      envFile,
        [
          "OPENCLINXR_LOCAL_MODEL_RUNTIME=ollama",
          "OPENCLINXR_LOCAL_MODEL_ID=Qwen/Qwen3-4B-GGUF",
          "OPENCLINXR_LOCAL_MODEL_DOWNLOAD_APPROVED=true",
          "OPENCLINXR_LOCAL_VOICE_RUNTIME=vibevoice",
          "OPENCLINXR_LOCAL_VOICE_ID=microsoft/VibeVoice-Realtime-0.5B",
          "OPENCLINXR_LOCAL_VOICE_SAFETY_REVIEW_APPROVED=true",
          "",
        ].join("\n"),
      "utf8",
    );

    const { stdout } = await execFileAsync(
      path.resolve("node_modules/.bin/tsx"),
      ["tools/openclinxr/local-provider-benchmark.ts", "--env-file", envFile],
      {
        encoding: "utf8",
        timeout: 15000,
        env: {
          ...process.env,
          OPENCLINXR_LOCAL_MODEL_RUNTIME: "",
          OPENCLINXR_LOCAL_MODEL_ID: "",
          OPENCLINXR_LOCAL_MODEL_DOWNLOAD_APPROVED: "",
          OPENCLINXR_LOCAL_VOICE_RUNTIME: "",
          OPENCLINXR_LOCAL_VOICE_ID: "",
          OPENCLINXR_LOCAL_VOICE_SAFETY_REVIEW_APPROVED: "",
        },
      },
    );
    const report = JSON.parse(stdout) as {
      policy: { localRuntimeExecutionAllowed: boolean };
      localModel: { metrics: Record<string, unknown> };
      localVoice: { metrics: Record<string, unknown> };
    };

    expect(report.policy.localRuntimeExecutionAllowed).toBe(false);
    expect(report.localModel.metrics.configuredRuntime).toBe("ollama");
    expect(report.localModel.metrics.configuredModel).toBe("Qwen/Qwen3-4B-GGUF");
    expect(report.localModel.metrics.sourceRecordIds).toBe("src-qwen3-4b-gguf-2026");
    expect(report.localModel.metrics.downloadApproved).toBe(true);
    expect(report.localVoice.metrics.configuredRuntime).toBe("vibevoice");
    expect(report.localVoice.metrics.configuredVoice).toBe("microsoft/VibeVoice-Realtime-0.5B");
    expect(report.localVoice.metrics.sourceRecordIds).toBe("src-vibevoice-github-2026");
    expect(report.localVoice.metrics.safetyReviewApproved).toBe(true);
  });
});
