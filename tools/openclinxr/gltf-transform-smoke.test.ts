import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  type GltfTransformSmokeReport,
  runGltfTransformSmokeCli,
  validateGltfTransformSmokeReport,
} from "./gltf-transform-smoke.js";

describe("gltf-transform smoke report", () => {
  it("exposes parallel generation and validation scripts", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts["asset:gltf-transform:smoke"]).toBe(
      "tsx tools/openclinxr/gltf-transform-smoke.ts",
    );
    expect(rootPackage.scripts["asset:gltf-transform:smoke:validate"]).toBe(
      "tsx tools/openclinxr/gltf-transform-smoke.ts --validate-latest",
    );
  });

  it("validates committed GLTF Transform conversion smoke reports before reuse", () => {
    const report = validReport();

    expect(validateGltfTransformSmokeReport(report)).toEqual({ ok: true });

    const invalid = structuredClone(report) as Record<string, unknown>;
    const output = invalid.output as Record<string, unknown>;
    output.declaredLength = 12;
    const verdict = invalid.verdict as { blockers: string[] };
    verdict.blockers = [];

    expect(validateGltfTransformSmokeReport(invalid)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/verdict/blockers must include glb_declared_length_mismatch",
      ]),
    });
  });

  it("validates GLTF Transform smoke reports from the CLI without running the converter", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-gltf-transform-smoke-validate-"));
    const reportPath = path.join(tempDir, "gltf-transform-smoke.json");
    const invalidPath = path.join(tempDir, "gltf-transform-smoke-invalid.json");
    const previousExitCode = process.exitCode;

    try {
      const report = validReport();
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

      await expect(runGltfTransformSmokeCli(["--validate", reportPath])).resolves.toBeUndefined();

      const invalidReport = structuredClone(report) as Record<string, unknown>;
      delete invalidReport.tool;
      await writeFile(invalidPath, `${JSON.stringify(invalidReport, null, 2)}\n`, "utf8");

      process.exitCode = undefined;
      await runGltfTransformSmokeCli(["--validate", invalidPath]);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode;
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

function validReport(): GltfTransformSmokeReport {
  return {
    generatedAt: "2026-05-27T00:10:04.220Z",
    tool: {
      command: "gltf-transform-node-api",
      package: "@gltf-transform/core",
      version: "4.3.0",
      license: "MIT",
    },
    input: {
      primitive: "single_triangle",
      vertices: 3,
      triangles: 1,
      gltfBytes: 746,
    },
    output: {
      glbBytes: 848,
      magic: "glTF",
      version: 2,
      declaredLength: 848,
      elapsedMs: 120.5,
    },
    replacementAssessment: {
      candidateFor: "gltf-pipeline_root_dependency_reduction",
      paritySignals: ["node_api_available", "glb_magic_ok", "glb_version_2", "declared_length_matches"],
      remainingGaps: ["asset-production-readiness still consumes gltf-pipeline smoke evidence shape"],
      demoteGltfPipelineRecommended: false,
    },
    verdict: {
      passed: true,
      blockers: [],
    },
  };
}
