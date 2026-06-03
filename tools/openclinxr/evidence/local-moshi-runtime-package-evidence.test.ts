import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildLocalMoshiRuntimePackageEvidenceReport,
  main,
  validateLocalMoshiRuntimePackageEvidenceReport,
} from "./local-moshi-runtime-package-evidence.js";

describe("local Moshi runtime package evidence", () => {
  it("exposes generation and validation scripts", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts["local:voice:moshi-package"]).toBe(
      "tsx tools/openclinxr/local-moshi-runtime-package-evidence.ts",
    );
    expect(rootPackage.scripts["local:voice:moshi-package:validate"]).toBe(
      "tsx tools/openclinxr/local-moshi-runtime-package-evidence.ts --validate-latest",
    );
    expect(rootPackage.scripts["agent:verify"]).toContain("pnpm local:voice:moshi-package:validate");
  });

  it("records an isolated Moshi MLX venv without claiming real inference", () => {
    const report = buildLocalMoshiRuntimePackageEvidenceReport({
      generatedAt: "2026-05-06T15:00:00.000Z",
      venvPath: "/Users/patrick/.cache/openclinxr/realtime-voice/moshi-mlx-venv",
      modelCacheEvidencePath: "docs/openclinxr/local-realtime-voice-model-cache-evidence-2026-05-06.json",
      commandHelp: "usage: moshi-local [-h] [--tokenizer TOKENIZER] [--moshi-weight MOSHI_WEIGHT]",
      packageVersions: {
        moshi_mlx: "0.3.0",
        mlx: "0.26.5",
        "mlx-metal": "0.26.5",
        rustymimi: "0.4.1",
        sentencepiece: "0.2.0",
        sphn: "0.2.1",
        sounddevice: "0.5.0",
        "huggingface-hub": "0.28.1",
      },
      importResults: {
        moshi_mlx: { ok: true },
        "mlx.core": { ok: true },
        rustymimi: { ok: true },
        sentencepiece: { ok: true },
        sphn: { ok: true },
        sounddevice: { ok: true },
      },
      entrypoints: ["moshi-local", "moshi-local-web"],
      venvBytes: 215000000,
    });

    expect(report).toMatchObject({
      kind: "local_moshi_runtime_package_evidence",
      claim_scope: "runtime_package_import_only",
      generatedAt: "2026-05-06T15:00:00.000Z",
      status: "passed_with_caveats",
      policy: {
        cloudApisUsed: false,
        paidApisUsed: false,
        productionUseAllowed: false,
        generatedAudioCommitted: false,
        runtimeInferenceObserved: false,
        microphonePlaybackObserved: false,
        downloadAttemptedByThisTool: false,
        networkAccessObservedByThisTool: false,
      },
      runtime: {
        modelId: "kyutai/moshiko-mlx-q4",
        modelLicense: "CC-BY-4.0",
        sourceRecordIds: ["src-moshiko-mlx-q4-2026"],
        venvPath: "/Users/patrick/.cache/openclinxr/realtime-voice/moshi-mlx-venv",
        packageVersions: {
          moshi_mlx: "0.3.0",
          mlx: "0.26.5",
        },
        entrypoints: ["moshi-local", "moshi-local-web"],
      },
      modelCache: {
        evidenceFile: "docs/openclinxr/local-realtime-voice-model-cache-evidence-2026-05-06.json",
      },
      verdict: {
        passed: true,
        readyForLiveDialog: false,
        blockers: [],
      },
    });
    expect(report.verdict.caveats).toContain("Moshi package imports and CLI entrypoints are evidence of isolated runtime availability only; no model inference, microphone capture, or playback loop ran.");
  });

  it("blocks the report when a required import fails", () => {
    const report = buildLocalMoshiRuntimePackageEvidenceReport({
      venvPath: "/Users/patrick/.cache/openclinxr/realtime-voice/moshi-mlx-venv",
      packageVersions: {
        moshi_mlx: "0.3.0",
        mlx: "0.26.5",
      },
      importResults: {
        moshi_mlx: { ok: true },
        "mlx.core": { ok: false, error: "ImportError: MLX unavailable" },
      },
      entrypoints: ["moshi-local"],
      venvBytes: 100,
    });

    expect(report.status).toBe("blocked");
    expect(report.verdict.blockers).toEqual(["import:mlx.core:ImportError: MLX unavailable"]);
  });

  it("validates package-only policy boundaries without allowing live dialogue claims", () => {
    const report = buildLocalMoshiRuntimePackageEvidenceReport({
      generatedAt: "2026-05-06T15:00:00.000Z",
      venvPath: "/Users/patrick/.cache/openclinxr/realtime-voice/moshi-mlx-venv",
      modelCacheEvidencePath: "docs/openclinxr/local-realtime-voice-model-cache-evidence-2026-05-06.json",
      commandHelp: "usage: moshi-local [-h] [--tokenizer TOKENIZER] [--moshi-weight MOSHI_WEIGHT]",
      packageVersions: {
        moshi_mlx: "0.3.0",
        mlx: "0.26.5",
      },
      importResults: {
        moshi_mlx: { ok: true },
        "mlx.core": { ok: true },
      },
      entrypoints: ["moshi-local", "moshi-local-web"],
      venvBytes: 215000000,
    });

    expect(validateLocalMoshiRuntimePackageEvidenceReport(report)).toEqual({ ok: true });

    const invalid = structuredClone(report) as unknown as {
      policy: Partial<typeof report.policy>;
      verdict: { readyForLiveDialog: boolean };
    };
    delete invalid.policy.productionUseAllowed;
    invalid.verdict.readyForLiveDialog = true;

    expect(validateLocalMoshiRuntimePackageEvidenceReport(invalid)).toEqual({
      ok: false,
      errors: [
        "/policy/productionUseAllowed must be false",
        "/verdict/readyForLiveDialog must be false",
      ],
    });
  });

  it("requires status and verdict blockers to match package evidence", () => {
    const report = buildLocalMoshiRuntimePackageEvidenceReport({
      venvPath: "/Users/patrick/.cache/openclinxr/realtime-voice/moshi-mlx-venv",
      packageVersions: {
        moshi_mlx: "0.3.0",
      },
      importResults: {
        moshi_mlx: { ok: true },
        "mlx.core": { ok: false, error: "ImportError: MLX unavailable" },
      },
      entrypoints: [],
      venvBytes: 100,
    });

    expect(validateLocalMoshiRuntimePackageEvidenceReport(report)).toEqual({ ok: true });

    const invalid = structuredClone(report);
    invalid.status = "passed_with_caveats";
    invalid.verdict.passed = true;
    invalid.verdict.blockers = [];

    expect(validateLocalMoshiRuntimePackageEvidenceReport(invalid)).toEqual({
      ok: false,
      errors: [
        "/status must be blocked when blockers are present",
        "/verdict/passed must be false when blockers are present",
        "/verdict/blockers missing expected blocker package:mlx:missing",
        "/verdict/blockers missing expected blocker entrypoint:moshi-local:missing",
        "/verdict/blockers missing expected blocker import:mlx.core:ImportError: MLX unavailable",
      ],
    });
  });

  it("writes a CLI report to the requested output path", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openclinxr-moshi-package-"));
    const packages = path.join(dir, "packages.json");
    const imports = path.join(dir, "imports.json");
    const entrypoints = path.join(dir, "entrypoints.txt");
    const help = path.join(dir, "moshi-help.txt");
    const output = path.join(dir, "report.json");
    await mkdir(path.join(dir, "venv"), { recursive: true });
    await writeFile(path.join(dir, "venv", "pyvenv.cfg"), "home = /usr/bin");
    await writeFile(packages, JSON.stringify({
      moshi_mlx: "0.3.0",
      mlx: "0.26.5",
      "mlx-metal": "0.26.5",
    }));
    await writeFile(imports, JSON.stringify({
      moshi_mlx: { ok: true },
      "mlx.core": { ok: true },
    }));
    await writeFile(entrypoints, "moshi-local\nmoshi-local-web\n");
    await writeFile(help, "usage: moshi-local [-h]");

    await main([
      "--venv",
      path.join(dir, "venv"),
      "--packages",
      packages,
      "--imports",
      imports,
      "--entrypoints",
      entrypoints,
      "--help",
      help,
      "--generated-at",
      "2026-05-06T15:00:00.000Z",
      "--output",
      output,
    ]);

    const report = JSON.parse(await readFile(output, "utf8")) as Awaited<ReturnType<typeof buildLocalMoshiRuntimePackageEvidenceReport>>;
    expect(report).toMatchObject({
      generatedAt: "2026-05-06T15:00:00.000Z",
      runtime: {
        venvPath: path.join(dir, "venv"),
        entrypoints: ["moshi-local", "moshi-local-web"],
        venvBytes: 15,
      },
      verdict: {
        passed: true,
      },
    });
  });

  it("validates CLI reports by explicit path and latest evidence path", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openclinxr-moshi-package-validate-"));
    try {
      const output = path.join(dir, "report.json");
      const report = buildLocalMoshiRuntimePackageEvidenceReport({
        generatedAt: "2026-05-06T15:00:00.000Z",
        venvPath: "/Users/patrick/.cache/openclinxr/realtime-voice/moshi-mlx-venv",
        modelCacheEvidencePath: "docs/openclinxr/local-realtime-voice-model-cache-evidence-2026-05-06.json",
        commandHelp: "usage: moshi-local [-h]",
        packageVersions: {
          moshi_mlx: "0.3.0",
          mlx: "0.26.5",
        },
        importResults: {
          moshi_mlx: { ok: true },
          "mlx.core": { ok: true },
        },
        entrypoints: ["moshi-local", "moshi-local-web"],
        venvBytes: 215000000,
      });
      await writeFile(output, JSON.stringify(report, null, 2));

      await expect(main(["--validate", output])).resolves.toBeUndefined();
      await expect(main(["--validate-latest"])).resolves.toBeUndefined();

      const invalid = structuredClone(report) as unknown as {
        runtime: { sourceRecordIds: string[] };
      };
      invalid.runtime.sourceRecordIds = [];
      const invalidOutput = path.join(dir, "invalid-report.json");
      await writeFile(invalidOutput, JSON.stringify(invalid, null, 2));
      process.exitCode = undefined;

      await expect(main(["--validate", invalidOutput])).resolves.toBeUndefined();

      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = undefined;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
