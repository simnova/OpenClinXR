import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAssetProductionSupportArtifactsReport,
  runAssetProductionSupportArtifactsCli,
  SUPPORT_ARTIFACT_PATHS,
  validateAssetProductionSupportArtifactsReport,
  writeAssetProductionSupportArtifacts,
} from "./asset-production-support-artifacts.js";

describe("asset production support artifacts", () => {
  it("exposes generation and validation scripts", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts["asset:production:support-artifacts"]).toBe(
      "tsx tools/openclinxr/asset-production-support-artifacts.ts",
    );
    expect(rootPackage.scripts["asset:production:support-artifacts:validate"]).toBe(
      "tsx tools/openclinxr/asset-production-support-artifacts.ts --validate-latest",
    );
  });

  it("writes all local support artifacts", async () => {
    await withTemporaryCwd(async () => {
      const report = await writeAssetProductionSupportArtifacts({
        generatedAt: "2026-05-21T00:00:00.000Z",
      });

      expect(report.artifacts.materializedArtifactPaths).toHaveLength(SUPPORT_ARTIFACT_PATHS.length);
      expect(report.artifacts.missingArtifactPaths).toEqual([]);
      expect(report.verdict).toEqual({
        passed: true,
        readyForProductionAssets: false,
        blockers: [],
      });
      await expect(readFile(SUPPORT_ARTIFACT_PATHS[0], "utf8")).resolves.toContain("idle-pain");
      await expect(readFile(SUPPORT_ARTIFACT_PATHS[8], "utf8")).resolves.toContain("requires_worn_headset_capture");
    });
  });

  it("blocks when support artifacts are missing", async () => {
    await withTemporaryCwd(() => {
      const report = buildAssetProductionSupportArtifactsReport({
        generatedAt: "2026-05-21T00:00:00.000Z",
      });

      expect(report.verdict.passed).toBe(false);
      expect(report.verdict.blockers).toEqual(expect.arrayContaining([
        `artifact_file_missing:${SUPPORT_ARTIFACT_PATHS[0]}`,
      ]));
      expect(validateAssetProductionSupportArtifactsReport(report)).toEqual({ ok: true, errors: [] });
    });
  });

  it("validates report posture and blocker consistency", async () => {
    await withTemporaryCwd(() => {
      const report = buildAssetProductionSupportArtifactsReport({
        generatedAt: "2026-05-21T00:00:00.000Z",
      });
      const invalid = structuredClone(report) as unknown as {
        policy: { paidApisUsed: boolean };
        verdict: { blockers: string[] };
      };
      invalid.policy.paidApisUsed = true;
      invalid.verdict.blockers = [];

      expect(validateAssetProductionSupportArtifactsReport(invalid)).toEqual({
        ok: false,
        errors: expect.arrayContaining([
          "/policy/paidApisUsed must be false",
          `/verdict/blockers must include artifact_file_missing:${SUPPORT_ARTIFACT_PATHS[0]}`,
        ]),
      });
    });
  });

  it("validates support-artifact reports from the CLI without generating artifacts", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-support-artifacts-cli-"));
    const reportPath = path.join(tempDir, "asset-production-support-artifacts.json");
    const invalidPath = path.join(tempDir, "asset-production-support-artifacts-invalid.json");
    const previousExitCode = process.exitCode;

    try {
      const report = buildAssetProductionSupportArtifactsReport({
        generatedAt: "2026-05-21T00:00:00.000Z",
      });
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      await expect(runAssetProductionSupportArtifactsCli(["--validate", reportPath])).resolves.toBeUndefined();

      const invalidReport = structuredClone(report) as Record<string, unknown>;
      delete invalidReport.schemaVersion;
      await writeFile(invalidPath, `${JSON.stringify(invalidReport, null, 2)}\n`, "utf8");

      process.exitCode = undefined;
      await runAssetProductionSupportArtifactsCli(["--validate", invalidPath]);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode;
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

async function withTemporaryCwd<T>(callback: () => Promise<T> | T): Promise<T> {
  const previousCwd = process.cwd();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-support-artifacts-cwd-"));
  process.chdir(tempDir);
  try {
    return await callback();
  } finally {
    process.chdir(previousCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
}
