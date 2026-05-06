import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAssetCapabilityJobEvidenceReport,
  runAssetCapabilityJobEvidenceCli,
  validateAssetCapabilityJobEvidenceReport,
} from "./asset-capability-job-evidence.js";

describe("asset capability job evidence report", () => {
  it("exposes generation and validation scripts", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts["asset:capability:evidence"]).toBe(
      "tsx tools/openclinxr/asset-capability-job-evidence.ts",
    );
    expect(rootPackage.scripts["asset:capability:evidence:validate"]).toBe(
      "tsx tools/openclinxr/asset-capability-job-evidence.ts --validate docs/openclinxr/asset-capability-job-evidence-2026-05-05.json",
    );
    expect(rootPackage.scripts["agent:verify"]).toContain("pnpm asset:capability:evidence:validate");
  });

  it("proves deterministic asset generation job contracts without spend or network", async () => {
    const report = await buildAssetCapabilityJobEvidenceReport({
      generatedAt: "2026-05-04T21:30:00.000Z",
    });

    expect(report.policy).toEqual({
      cloudApisUsed: false,
      paidApisUsed: false,
      externalNetworkAllowed: false,
      spendLimitCents: 0,
      productionArtifactClaimed: false,
    });
    expect(report.summary).toEqual({
      requiredCapabilityIds: [
        "character-generation",
        "medical-equipment-generation",
        "voice-asset-generation",
        "animation-generation",
        "asset-bake",
      ],
      observedCapabilityIds: [
        "character-generation",
        "medical-equipment-generation",
        "voice-asset-generation",
        "animation-generation",
        "asset-bake",
      ],
      allCapabilitiesObserved: true,
      allJobsSucceeded: true,
      allManifestsObserved: true,
      allLicenseProvenanceObserved: true,
      zeroSpendObserved: true,
      noExternalNetworkObserved: true,
      blockers: [],
    });
    expect(report.jobs).toHaveLength(5);
    expect(report.jobs.every((job) => job.passed)).toBe(true);
    expect(report.jobs.map((job) => job.jobId)).toEqual([
      "asset-capability-job-001",
      "asset-capability-job-002",
      "asset-capability-job-003",
      "asset-capability-job-004",
      "asset-capability-job-005",
    ]);
    expect(report.jobs[0]).toMatchObject({
      capabilityId: "character-generation",
      status: "succeeded",
      artifactKinds: ["manifest", "source"],
      manifestObserved: true,
      licenseProvenanceObserved: true,
      zeroSpendObserved: true,
      noExternalNetworkObserved: true,
      passed: true,
      blockers: [],
    });
    expect(report.verdict).toEqual({
      passed: true,
      readyForProductionAssets: false,
      blockers: [],
      caveats: [
        "Deterministic asset capability jobs prove routing, policy, provenance, and artifact-manifest contracts only; they are not production clinical assets.",
        "No cloud APIs, paid APIs, external network calls, or production artifact claims are made by this report.",
      ],
    });
  });

  it("validates generated capability evidence before aggregate reuse", async () => {
    const report = await buildAssetCapabilityJobEvidenceReport({
      generatedAt: "2026-05-04T21:30:00.000Z",
    });
    expect(validateAssetCapabilityJobEvidenceReport(report)).toEqual({ ok: true });

    const invalid = structuredClone(report);
    invalid.summary.requiredCapabilityIds = [
      "character-generation",
      "character-generation",
      "voice-asset-generation",
      "animation-generation",
      "asset-bake",
    ];
    invalid.jobs[1] = structuredClone(invalid.jobs[0]);

    expect(validateAssetCapabilityJobEvidenceReport(invalid)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/summary/requiredCapabilityIds must not repeat capability id character-generation",
        "/summary/requiredCapabilityIds must include capability id medical-equipment-generation",
        "/jobs must not repeat capability id character-generation",
        "/jobs must include capability id medical-equipment-generation",
      ]),
    });
  });

  it("validates capability evidence reports from the CLI", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-asset-capability-evidence-"));
    const outputPath = path.join(tempDir, "asset-capability-job-evidence.json");
    const invalidPath = path.join(tempDir, "asset-capability-job-evidence-invalid.json");
    const previousExitCode = process.exitCode;

    try {
      await runAssetCapabilityJobEvidenceCli([
        "--output",
        outputPath,
      ]);

      await expect(runAssetCapabilityJobEvidenceCli(["--validate", outputPath])).resolves.toBeUndefined();

      const invalidReport = JSON.parse(await readFile(outputPath, "utf8"));
      delete invalidReport.policy.externalNetworkAllowed;
      await writeFile(invalidPath, `${JSON.stringify(invalidReport, null, 2)}\n`, "utf8");

      process.exitCode = undefined;
      await runAssetCapabilityJobEvidenceCli(["--validate", invalidPath]);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode;
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
