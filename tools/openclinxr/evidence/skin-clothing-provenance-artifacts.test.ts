import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSkinClothingProvenanceReport,
  runSkinClothingProvenanceCli,
  validateSkinClothingProvenanceReport,
  writeSkinClothingProvenanceArtifacts,
} from "./skin-clothing-provenance-artifacts.js";

describe("skin/clothing provenance artifacts", () => {
  it("exposes generation and validation scripts", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts["asset:skin-clothing:generate"]).toBe(
      "tsx tools/openclinxr/skin-clothing-provenance-artifacts.ts",
    );
    expect(rootPackage.scripts["asset:skin-clothing:validate"]).toBe(
      "tsx tools/openclinxr/skin-clothing-provenance-artifacts.ts --validate-latest",
    );
  });

  it("writes local-only skin and clothing provenance artifacts", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-skin-clothing-"));
    const reportPath = path.join(tempDir, "skin-clothing-provenance-artifacts.json");

    try {
      const report = await writeSkinClothingProvenanceArtifacts({
        outputRoot: tempDir,
        reportPath,
        generatedAt: "2026-05-21T00:00:00.000Z",
      });

      expect(report.policy).toMatchObject({
        localOnly: true,
        installsIntroduced: false,
        cloudApisUsed: false,
        paidApisUsed: false,
        externalAssetsUsed: false,
        productionAssetReadinessClaimed: false,
      });
      expect(report.summary.artifactFilesMaterialized).toBe(true);
      expect(report.verdict).toEqual({
        passed: true,
        readyForProductionAssets: false,
        blockers: [],
      });
      await expect(readFile(report.artifacts.skinTextureProvenancePath, "utf8")).resolves.toContain(
        "skin_texture_provenance",
      );
      await expect(readFile(report.artifacts.clothingMeshProvenancePath, "utf8")).resolves.toContain(
        "fixture_scrub_top",
      );
      await expect(readFile(report.artifacts.runtimeSafeMaterialsPath, "utf8")).resolves.toContain(
        "runtime_safe_materials",
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("blocks when provenance artifacts are not materialized", () => {
    const report = buildSkinClothingProvenanceReport({
      generatedAt: "2026-05-21T00:00:00.000Z",
      outputRoot: path.join(os.tmpdir(), "openclinxr-missing-skin-clothing-artifacts"),
    });

    expect(report.summary.artifactFilesMaterialized).toBe(false);
    expect(report.verdict.passed).toBe(false);
    expect(report.verdict.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("artifact_file_missing:"),
    ]));
    expect(validateSkinClothingProvenanceReport(report)).toEqual({ ok: true, errors: [] });
  });

  it("validates report safety posture", () => {
    const report = buildSkinClothingProvenanceReport({
      generatedAt: "2026-05-21T00:00:00.000Z",
      outputRoot: path.join(os.tmpdir(), "openclinxr-missing-skin-clothing-artifacts"),
    });
    const invalid = structuredClone(report) as unknown as {
      policy: { externalAssetsUsed: boolean };
      verdict: { blockers: string[] };
    };
    invalid.policy.externalAssetsUsed = true;
    invalid.verdict.blockers = [];

    expect(validateSkinClothingProvenanceReport(invalid)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/policy/externalAssetsUsed must be false",
        expect.stringContaining("/verdict/blockers must include artifact_file_missing:"),
      ]),
    });
  });

  it("validates skin/clothing reports from the CLI without generating artifacts", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-skin-clothing-cli-"));
    const reportPath = path.join(tempDir, "skin-clothing-provenance-artifacts.json");
    const invalidPath = path.join(tempDir, "skin-clothing-provenance-artifacts-invalid.json");
    const previousExitCode = process.exitCode;

    try {
      const report = buildSkinClothingProvenanceReport({
        generatedAt: "2026-05-21T00:00:00.000Z",
        outputRoot: path.join(tempDir, "missing-artifacts"),
      });
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      await expect(runSkinClothingProvenanceCli(["--validate", reportPath])).resolves.toBeUndefined();

      const invalidReport = structuredClone(report) as Record<string, unknown>;
      delete invalidReport.schemaVersion;
      await writeFile(invalidPath, `${JSON.stringify(invalidReport, null, 2)}\n`, "utf8");

      process.exitCode = undefined;
      await runSkinClothingProvenanceCli(["--validate", invalidPath]);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode;
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
