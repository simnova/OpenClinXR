import { pathToFileURL } from "node:url";
import {
  AssetGenerationCapabilityFacade,
  type AssetGenerationArtifactKind,
  type AssetGenerationCapabilityId,
  type AssetGenerationJobRecord,
} from "../../packages/openclinxr/capability-gateway/src/index.js";
import { writeJson } from "../agent-factory/lib.js";

type CliOptions = {
  outputPath?: string;
};

type AssetCapabilityJobEvidence = {
  capabilityId: AssetGenerationCapabilityId;
  jobId: string;
  status: AssetGenerationJobRecord["status"];
  worker: AssetGenerationJobRecord["worker"];
  artifactKinds: AssetGenerationArtifactKind[];
  artifactPaths: string[];
  manifestObserved: boolean;
  licenseProvenanceObserved: boolean;
  zeroSpendObserved: boolean;
  noExternalNetworkObserved: boolean;
  passed: boolean;
  blockers: string[];
};

export type AssetCapabilityJobEvidenceReport = {
  generatedAt: string;
  status: "passed" | "blocked";
  policy: {
    cloudApisUsed: false;
    paidApisUsed: false;
    externalNetworkAllowed: false;
    spendLimitCents: 0;
    productionArtifactClaimed: false;
  };
  summary: {
    requiredCapabilityIds: AssetGenerationCapabilityId[];
    observedCapabilityIds: AssetGenerationCapabilityId[];
    allCapabilitiesObserved: boolean;
    allJobsSucceeded: boolean;
    allManifestsObserved: boolean;
    allLicenseProvenanceObserved: boolean;
    zeroSpendObserved: boolean;
    noExternalNetworkObserved: boolean;
    blockers: string[];
  };
  jobs: AssetCapabilityJobEvidence[];
  verdict: {
    passed: boolean;
    readyForProductionAssets: false;
    blockers: string[];
    caveats: string[];
  };
};

const requiredCapabilityIds: AssetGenerationCapabilityId[] = [
  "character-generation",
  "medical-equipment-generation",
  "voice-asset-generation",
  "animation-generation",
  "asset-bake",
];

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const report = await buildAssetCapabilityJobEvidenceReport();

  if (options.outputPath) {
    await writeJson(options.outputPath, report);
    console.log(`Wrote ${options.outputPath}`);
    return;
  }

  console.log(JSON.stringify(report, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = {};

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--output") {
      options.outputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }

  return options;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export async function buildAssetCapabilityJobEvidenceReport(input: {
  generatedAt?: string;
} = {}): Promise<AssetCapabilityJobEvidenceReport> {
  let idCounter = 0;
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const facade = new AssetGenerationCapabilityFacade({
    idFactory: () => `asset-capability-job-${String(++idCounter).padStart(3, "0")}`,
    now: () => generatedAt,
  });
  const records = await Promise.all(requiredCapabilityIds.map((capabilityId) => facade.submit({
    profile: "local-development",
    capabilityId,
    payload: {
      evidenceRun: "asset-capability-job-evidence",
      generatedAt,
    },
  })));
  const jobs = records.map(toJobEvidence);
  const observedCapabilityIds = jobs
    .filter((job) => job.passed)
    .map((job) => job.capabilityId);
  const allCapabilitiesObserved = requiredCapabilityIds.every((capabilityId) => observedCapabilityIds.includes(capabilityId));
  const allJobsSucceeded = jobs.every((job) => job.status === "succeeded");
  const allManifestsObserved = jobs.every((job) => job.manifestObserved);
  const allLicenseProvenanceObserved = jobs.every((job) => job.licenseProvenanceObserved);
  const zeroSpendObserved = jobs.every((job) => job.zeroSpendObserved);
  const noExternalNetworkObserved = jobs.every((job) => job.noExternalNetworkObserved);
  const summaryBlockers = [
    allCapabilitiesObserved ? undefined : "asset_capability_job_capabilities_missing",
    allJobsSucceeded ? undefined : "asset_capability_job_failed",
    allManifestsObserved ? undefined : "asset_capability_job_manifest_missing",
    allLicenseProvenanceObserved ? undefined : "asset_capability_job_license_provenance_missing",
    zeroSpendObserved ? undefined : "asset_capability_job_nonzero_spend",
    noExternalNetworkObserved ? undefined : "asset_capability_job_external_network_used",
  ].filter((blocker): blocker is string => typeof blocker === "string");
  const blockers = [
    ...summaryBlockers,
    ...jobs.flatMap((job) => job.blockers.map((blocker) => `${job.capabilityId}:${blocker}`)),
  ];
  const passed = blockers.length === 0;

  return {
    generatedAt,
    status: passed ? "passed" : "blocked",
    policy: {
      cloudApisUsed: false,
      paidApisUsed: false,
      externalNetworkAllowed: false,
      spendLimitCents: 0,
      productionArtifactClaimed: false,
    },
    summary: {
      requiredCapabilityIds: [...requiredCapabilityIds],
      observedCapabilityIds,
      allCapabilitiesObserved,
      allJobsSucceeded,
      allManifestsObserved,
      allLicenseProvenanceObserved,
      zeroSpendObserved,
      noExternalNetworkObserved,
      blockers: summaryBlockers,
    },
    jobs,
    verdict: {
      passed,
      readyForProductionAssets: false,
      blockers,
      caveats: [
        "Deterministic asset capability jobs prove routing, policy, provenance, and artifact-manifest contracts only; they are not production clinical assets.",
        "No cloud APIs, paid APIs, external network calls, or production artifact claims are made by this report.",
      ],
    },
  };
}

function toJobEvidence(record: AssetGenerationJobRecord): AssetCapabilityJobEvidence {
  const manifestObserved = record.manifest?.schemaVersion === "asset-generation-manifest.v1"
    && record.manifest.capabilityId === record.request.capabilityId;
  const licenseProvenanceObserved = Boolean(record.provenance?.license);
  const zeroSpendObserved = record.provenance?.spendCents === 0;
  const noExternalNetworkObserved = record.provenance?.externalNetworkUsed === false;
  const blockers = [
    record.status === "succeeded" ? undefined : "job_not_succeeded",
    manifestObserved ? undefined : "manifest_missing",
    licenseProvenanceObserved ? undefined : "license_provenance_missing",
    zeroSpendObserved ? undefined : "nonzero_spend",
    noExternalNetworkObserved ? undefined : "external_network_used",
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    capabilityId: record.request.capabilityId,
    jobId: record.id,
    status: record.status,
    worker: record.worker,
    artifactKinds: record.artifacts.map((artifact) => artifact.kind),
    artifactPaths: record.artifacts.map((artifact) => artifact.path),
    manifestObserved,
    licenseProvenanceObserved,
    zeroSpendObserved,
    noExternalNetworkObserved,
    passed: blockers.length === 0,
    blockers,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
