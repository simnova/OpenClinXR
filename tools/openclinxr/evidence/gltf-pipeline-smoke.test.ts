import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  type GltfPipelineSmokeReport,
  runGltfPipelineSmokeCli,
  validateGltfPipelineSmokeReport,
} from "./gltf-pipeline-smoke.js";

describe("gltf-pipeline smoke report", () => {
  it("exposes generation and validation scripts", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts["asset:gltf:smoke"]).toBe(
      "tsx tools/openclinxr/evidence/gltf-pipeline-smoke.ts",
    );
    expect(rootPackage.scripts["asset:gltf:smoke:validate"]).toBe(
      "tsx tools/openclinxr/evidence/gltf-pipeline-smoke.ts --validate-latest",
    );
    expect(rootPackage.scripts["agent:verify"]).toContain("pnpm asset:gltf:smoke:validate");
  });

  it("validates committed GLTF conversion smoke reports before reuse", () => {
    const report = validReport();

    expect(validateGltfPipelineSmokeReport(report)).toEqual({ ok: true });

    const invalid = structuredClone(report) as Record<string, unknown>;
    const output = invalid.output as Record<string, unknown>;
    output.declaredLength = 12;
    const verdict = invalid.verdict as { blockers: string[] };
    verdict.blockers = [];

    expect(validateGltfPipelineSmokeReport(invalid)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/verdict/blockers must include glb_declared_length_mismatch",
      ]),
    });
  });

  it("validates GLTF conversion smoke reports from the CLI without running gltf-pipeline", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-gltf-smoke-validate-"));
    const reportPath = path.join(tempDir, "gltf-pipeline-smoke.json");
    const invalidPath = path.join(tempDir, "gltf-pipeline-smoke-invalid.json");
    const previousExitCode = process.exitCode;

    try {
      const report = validReport();
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

      await expect(runGltfPipelineSmokeCli(["--validate", reportPath])).resolves.toBeUndefined();
      await expect(runGltfPipelineSmokeCli(["--validate-latest"])).resolves.toBeUndefined();

      const invalidReport = structuredClone(report) as Record<string, unknown>;
      delete invalidReport.tool;
      await writeFile(invalidPath, `${JSON.stringify(invalidReport, null, 2)}\n`, "utf8");

      process.exitCode = undefined;
      await runGltfPipelineSmokeCli(["--validate", invalidPath]);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode;
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

function validReport(): GltfPipelineSmokeReport {
  return {
    generatedAt: "2026-05-06T00:10:04.220Z",
    tool: {
      command: "gltf-pipeline",
      package: "gltf-pipeline",
      version: "4.3.1",
      license: "Apache-2.0",
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
      elapsedMs: 431.5,
    },
    verdict: {
      passed: true,
      blockers: [],
    },
  };
}
