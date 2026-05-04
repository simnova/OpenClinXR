import { describe, expect, it } from "vitest";
import { buildAssetCapabilityJobEvidenceReport } from "./asset-capability-job-evidence.js";

describe("asset capability job evidence report", () => {
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
});
