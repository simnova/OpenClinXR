import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  buildIwsdkMetadataDriftEvidenceReport,
  type IwsdkMetadataDriftEvidenceReport,
} from "./iwsdk-metadata-drift-evidence-check.js";

const execFileAsync = promisify(execFile);

describe("IWSDK metadata drift evidence checker", () => {
  it("marks unattended reference warmup blocked when docs and npm metadata versions drift", () => {
    const report = buildIwsdkMetadataDriftEvidenceReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
      evidence: {
        packageName: "@iwsdk/reference",
        docsVersion: "0.3.1",
        npmLatestVersion: "0.3.2",
      },
    });

    expect(report.policies).toEqual([
      expect.objectContaining({
        packageName: "@iwsdk/reference",
        blockedActions: ["npx iwsdk reference warmup"],
      }),
    ]);
    expect(report.verdict).toEqual({
      readyForUnattendedUse: false,
      blockers: ["package_metadata_drift:@iwsdk/reference:docs_0.3.1_npm_0.3.2"],
    });
  });

  it("exposes a CLI that exits nonzero when metadata drift evidence is not ready", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(rootPackage.scripts["iwsdk:metadata-drift:evidence"]).toBe(
      "tsx tools/openclinxr/iwsdk-metadata-drift-evidence-check.ts",
    );

    const dir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-iwsdk-metadata-drift-evidence-"));
    const inputPath = path.join(dir, "metadata-drift-evidence.json");
    await writeFile(
      inputPath,
      `${JSON.stringify({
        packageName: "@iwsdk/reference",
        docsVersion: "0.3.1",
        npmLatestVersion: "0.3.2",
      })}\n`,
      "utf8",
    );

    try {
      await execFileAsync(
        path.resolve("node_modules/.bin/tsx"),
        ["tools/openclinxr/iwsdk-metadata-drift-evidence-check.ts", "--input", inputPath],
        { encoding: "utf8", timeout: 15000 },
      );
      throw new Error("Expected IWSDK metadata drift checker to reject drift evidence");
    } catch (error) {
      const failedRun = error as { code: number; stdout: string };
      const report = JSON.parse(failedRun.stdout) as IwsdkMetadataDriftEvidenceReport;

      expect(failedRun.code).toBe(1);
      expect(report.verdict.blockers).toEqual([
        "package_metadata_drift:@iwsdk/reference:docs_0.3.1_npm_0.3.2",
      ]);
    }
  });
});
