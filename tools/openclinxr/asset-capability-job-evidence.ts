import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  type AssetGenerationArtifactKind,
  AssetGenerationCapabilityFacade,
  type AssetGenerationCapabilityId,
  type AssetGenerationJobRecord,
} from "../../packages/openclinxr/capability-gateway/src/index.js";
import { globFiles, readJson, writeJson } from "../agent-factory/lib.js";

type CliOptions = {
  validatePath?: string;
  validateLatest: boolean;
  outputPath?: string;
};

type AssetCapabilityJobEvidence = {
  capabilityId: AssetGenerationCapabilityId;
  jobId: string;
  status: AssetGenerationJobRecord["status"];
  worker: AssetGenerationJobRecord["worker"];
  artifactKinds: AssetGenerationArtifactKind[];
  artifactPaths: string[];
  allArtifactFilesMaterialized: boolean;
  missingArtifactPaths: string[];
  manifestObserved: boolean;
  licenseProvenanceObserved: boolean;
  zeroSpendObserved: boolean;
  noExternalNetworkObserved: boolean;
  passed: boolean;
  blockers: string[];
};

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

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
    allArtifactFilesMaterialized: boolean;
    missingArtifactPathCount: number;
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
  await runAssetCapabilityJobEvidenceCli(process.argv.slice(2));
}

export async function runAssetCapabilityJobEvidenceCli(args: string[]): Promise<void> {
  const options = parseArgs(args);
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestPath("docs/openclinxr/asset-capability-job-evidence-*.json");
    if (!validatePath) {
      throw new Error("Missing asset capability job evidence report to validate.");
    }
    const validation = validateAssetCapabilityJobEvidenceReport(await readJson<unknown>(validatePath));
    if (validation.ok) {
      console.log(`Validated ${validatePath}`);
      return;
    }

    for (const error of validation.errors) {
      console.error(error);
    }
    process.exitCode = 1;
    return;
  }

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
  const options: CliOptions = {
    validateLatest: false,
  };

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--validate") {
      options.validatePath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--validate-latest") {
      options.validateLatest = true;
      continue;
    }
    if (arg === "--output") {
      options.outputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }

  return options;
}

async function latestPath(pattern: string): Promise<string | undefined> {
  const files = await globFiles(pattern);
  return files.sort().at(-1);
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
  const allArtifactFilesMaterialized = jobs.every((job) => job.allArtifactFilesMaterialized);
  const missingArtifactPathCount = jobs.reduce((total, job) => total + job.missingArtifactPaths.length, 0);
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
      allArtifactFilesMaterialized,
      missingArtifactPathCount,
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
        allArtifactFilesMaterialized
          ? "Declared deterministic artifact paths are materialized in the local workspace; they remain fixture artifacts, not production assets."
          : "Declared deterministic artifact paths are not materialized in the committed workspace and remain contract-only output locations.",
        "No cloud APIs, paid APIs, external network calls, or production artifact claims are made by this report.",
      ],
    },
  };
}

export function validateAssetCapabilityJobEvidenceReport(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { ok: false, errors: ["/ must be object"] };
  }

  requireString(value.generatedAt, "/generatedAt", errors);
  requireOneOf(value.status, ["passed", "blocked"], "/status", errors);
  requireRecord(value.policy, "/policy", errors);
  if (isRecord(value.policy)) {
    requireLiteral(value.policy.cloudApisUsed, false, "/policy/cloudApisUsed", errors);
    requireLiteral(value.policy.paidApisUsed, false, "/policy/paidApisUsed", errors);
    requireLiteral(value.policy.externalNetworkAllowed, false, "/policy/externalNetworkAllowed", errors);
    requireLiteral(value.policy.spendLimitCents, 0, "/policy/spendLimitCents", errors);
    requireLiteral(value.policy.productionArtifactClaimed, false, "/policy/productionArtifactClaimed", errors);
  }
  requireRecord(value.summary, "/summary", errors);
  if (isRecord(value.summary)) {
    requireCapabilityIdArray(value.summary.requiredCapabilityIds, "/summary/requiredCapabilityIds", errors);
    requireCapabilityIdArray(value.summary.observedCapabilityIds, "/summary/observedCapabilityIds", errors);
    requireBoolean(value.summary.allCapabilitiesObserved, "/summary/allCapabilitiesObserved", errors);
    requireBoolean(value.summary.allJobsSucceeded, "/summary/allJobsSucceeded", errors);
    requireBoolean(value.summary.allManifestsObserved, "/summary/allManifestsObserved", errors);
    requireBoolean(value.summary.allArtifactFilesMaterialized, "/summary/allArtifactFilesMaterialized", errors);
    requireNumber(value.summary.missingArtifactPathCount, "/summary/missingArtifactPathCount", errors);
    requireBoolean(value.summary.allLicenseProvenanceObserved, "/summary/allLicenseProvenanceObserved", errors);
    requireBoolean(value.summary.zeroSpendObserved, "/summary/zeroSpendObserved", errors);
    requireBoolean(value.summary.noExternalNetworkObserved, "/summary/noExternalNetworkObserved", errors);
    requireStringArray(value.summary.blockers, "/summary/blockers", errors);
  }
  requireArray(value.jobs, "/jobs", errors);
  if (Array.isArray(value.jobs)) {
    value.jobs.forEach((job, index) => {
      validateJobEvidence(job, `/jobs/${index}`, errors);
    });
  }
  requireRecord(value.verdict, "/verdict", errors);
  if (isRecord(value.verdict)) {
    requireBoolean(value.verdict.passed, "/verdict/passed", errors);
    requireLiteral(value.verdict.readyForProductionAssets, false, "/verdict/readyForProductionAssets", errors);
    requireStringArray(value.verdict.blockers, "/verdict/blockers", errors);
    requireStringArray(value.verdict.caveats, "/verdict/caveats", errors);
  }
  validateConsistency(value, errors);

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function toJobEvidence(record: AssetGenerationJobRecord): AssetCapabilityJobEvidence {
  const manifestObserved = record.manifest?.schemaVersion === "asset-generation-manifest.v1"
    && record.manifest.capabilityId === record.request.capabilityId;
  const licenseProvenanceObserved = Boolean(record.provenance?.license);
  const zeroSpendObserved = record.provenance?.spendCents === 0;
  const noExternalNetworkObserved = record.provenance?.externalNetworkUsed === false;
  const artifactPaths = record.artifacts.map((artifact) => artifact.path);
  const missingArtifactPaths = artifactPaths.filter((artifactPath) => !existsSync(artifactPath));
  const allArtifactFilesMaterialized = missingArtifactPaths.length === 0;
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
    artifactPaths,
    allArtifactFilesMaterialized,
    missingArtifactPaths,
    manifestObserved,
    licenseProvenanceObserved,
    zeroSpendObserved,
    noExternalNetworkObserved,
    passed: blockers.length === 0,
    blockers,
  };
}

function validateConsistency(value: Record<string, unknown>, errors: string[]): void {
  const summary = isRecord(value.summary) ? value.summary : undefined;
  const jobs = Array.isArray(value.jobs) ? value.jobs.filter(isRecord) : undefined;
  const verdict = isRecord(value.verdict) ? value.verdict : undefined;

  if (summary) {
    validateCanonicalCapabilityIds(summary.requiredCapabilityIds, "/summary/requiredCapabilityIds", errors);
  }
  if (jobs) {
    validateCanonicalCapabilityIds(jobs.map((job) => job.capabilityId), "/jobs", errors);
  }
  if (!summary || !jobs || !verdict) {
    return;
  }

  const passedJobs = jobs.filter((job) => job.passed === true);
  const observedCapabilityIds = passedJobs
    .map((job) => job.capabilityId)
    .filter((capabilityId): capabilityId is AssetGenerationCapabilityId =>
      typeof capabilityId === "string" && requiredCapabilityIds.includes(capabilityId as AssetGenerationCapabilityId),
    );
  if (!arraysEqual(summary.observedCapabilityIds, observedCapabilityIds)) {
    errors.push("/summary/observedCapabilityIds must match passed job capability ids");
  }
  if (summary.allCapabilitiesObserved !== requiredCapabilityIds.every((capabilityId) => observedCapabilityIds.includes(capabilityId))) {
    errors.push("/summary/allCapabilitiesObserved must match required capability coverage");
  }
  if (summary.allJobsSucceeded !== jobs.every((job) => job.status === "succeeded")) {
    errors.push("/summary/allJobsSucceeded must match succeeded job statuses");
  }
  if (summary.allManifestsObserved !== jobs.every((job) => job.manifestObserved === true)) {
    errors.push("/summary/allManifestsObserved must match job manifest evidence");
  }
  if (summary.allArtifactFilesMaterialized !== jobs.every((job) => job.allArtifactFilesMaterialized === true)) {
    errors.push("/summary/allArtifactFilesMaterialized must match job artifact file evidence");
  }
  const missingArtifactPathCount = jobs.reduce((total, job) => total + stringArray(job.missingArtifactPaths).length, 0);
  const missingArtifactPathCountOnDisk = jobs.reduce(
    (total, job) => total + stringArray(job.artifactPaths).filter((artifactPath) => !existsSync(artifactPath)).length,
    0,
  );
  if (summary.missingArtifactPathCount !== missingArtifactPathCount) {
    errors.push("/summary/missingArtifactPathCount must match job missing artifact paths");
  }
  if (summary.allArtifactFilesMaterialized === true && missingArtifactPathCount > 0) {
    errors.push("/summary/allArtifactFilesMaterialized cannot be true while artifact files are missing");
  }
  if (summary.allArtifactFilesMaterialized === true && missingArtifactPathCountOnDisk > 0) {
    errors.push("/summary/allArtifactFilesMaterialized cannot be true while artifact files are missing");
  }
  if (summary.allLicenseProvenanceObserved !== jobs.every((job) => job.licenseProvenanceObserved === true)) {
    errors.push("/summary/allLicenseProvenanceObserved must match job license provenance evidence");
  }
  if (summary.zeroSpendObserved !== jobs.every((job) => job.zeroSpendObserved === true)) {
    errors.push("/summary/zeroSpendObserved must match job spend evidence");
  }
  if (summary.noExternalNetworkObserved !== jobs.every((job) => job.noExternalNetworkObserved === true)) {
    errors.push("/summary/noExternalNetworkObserved must match job network evidence");
  }

  const expectedVerdictBlockers = [
    ...(Array.isArray(summary.blockers) ? summary.blockers.filter((blocker): blocker is string => typeof blocker === "string") : []),
    ...jobs.flatMap((job) => typeof job.capabilityId === "string" && Array.isArray(job.blockers)
      ? job.blockers
        .filter((blocker): blocker is string => typeof blocker === "string")
        .map((blocker) => `${job.capabilityId}:${blocker}`)
      : []),
  ];
  if (Array.isArray(verdict.blockers)) {
    const verdictBlockers = new Set(verdict.blockers);
    for (const blocker of expectedVerdictBlockers) {
      if (!verdictBlockers.has(blocker)) {
        errors.push(`/verdict/blockers must include ${blocker}`);
      }
    }
  }
}

function validateCanonicalCapabilityIds(value: unknown, pathName: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    return;
  }

  const observedCapabilityIds = new Set<string>();
  for (const capabilityId of value) {
    if (typeof capabilityId !== "string" || !requiredCapabilityIds.includes(capabilityId as AssetGenerationCapabilityId)) {
      continue;
    }
    if (observedCapabilityIds.has(capabilityId)) {
      errors.push(`${pathName} must not repeat capability id ${capabilityId}`);
      continue;
    }
    observedCapabilityIds.add(capabilityId);
  }
  for (const capabilityId of requiredCapabilityIds) {
    if (!observedCapabilityIds.has(capabilityId)) {
      errors.push(`${pathName} must include capability id ${capabilityId}`);
    }
  }
}

function validateJobEvidence(value: unknown, pathName: string, errors: string[]): void {
  requireRecord(value, pathName, errors);
  if (!isRecord(value)) {
    return;
  }

  requireOneOf(value.capabilityId, requiredCapabilityIds, `${pathName}/capabilityId`, errors);
  requireString(value.jobId, `${pathName}/jobId`, errors);
  requireOneOf(value.status, ["queued", "running", "succeeded", "failed", "canceled"], `${pathName}/status`, errors);
  requireRecord(value.worker, `${pathName}/worker`, errors);
  if (isRecord(value.worker)) {
    requireString(value.worker.providerId, `${pathName}/worker/providerId`, errors);
    requireString(value.worker.providerKind, `${pathName}/worker/providerKind`, errors);
    requireString(value.worker.implementationLanguage, `${pathName}/worker/implementationLanguage`, errors);
    requireString(value.worker.transport, `${pathName}/worker/transport`, errors);
  }
  requireStringArray(value.artifactKinds, `${pathName}/artifactKinds`, errors);
  requireStringArray(value.artifactPaths, `${pathName}/artifactPaths`, errors);
  requireBoolean(value.allArtifactFilesMaterialized, `${pathName}/allArtifactFilesMaterialized`, errors);
  requireStringArray(value.missingArtifactPaths, `${pathName}/missingArtifactPaths`, errors);
  validateArtifactFileEvidence(value, pathName, errors);
  requireBoolean(value.manifestObserved, `${pathName}/manifestObserved`, errors);
  requireBoolean(value.licenseProvenanceObserved, `${pathName}/licenseProvenanceObserved`, errors);
  requireBoolean(value.zeroSpendObserved, `${pathName}/zeroSpendObserved`, errors);
  requireBoolean(value.noExternalNetworkObserved, `${pathName}/noExternalNetworkObserved`, errors);
  requireBoolean(value.passed, `${pathName}/passed`, errors);
  requireStringArray(value.blockers, `${pathName}/blockers`, errors);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, pathName: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${pathName} must be object`);
  }
}

function requireArray(value: unknown, pathName: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${pathName} must be array`);
  }
}

function requireString(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${pathName} must be non-empty string`);
  }
}

function requireStringArray(value: unknown, pathName: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${pathName} must be array`);
    return;
  }

  value.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) {
      errors.push(`${pathName}/${index} must be non-empty string`);
    }
  });
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function validateArtifactFileEvidence(value: Record<string, unknown>, pathName: string, errors: string[]): void {
  const artifactPaths = stringArray(value.artifactPaths);
  const missingArtifactPaths = stringArray(value.missingArtifactPaths);

  for (const missingPath of missingArtifactPaths) {
    if (!artifactPaths.includes(missingPath)) {
      errors.push(`${pathName}/missingArtifactPaths must only include declared artifact paths`);
    }
  }
  if (value.allArtifactFilesMaterialized === true && missingArtifactPaths.length > 0) {
    errors.push(`${pathName}/allArtifactFilesMaterialized cannot be true while missingArtifactPaths is non-empty`);
  }
  if (value.allArtifactFilesMaterialized === false && missingArtifactPaths.length === 0) {
    errors.push(`${pathName}/allArtifactFilesMaterialized cannot be false without missingArtifactPaths`);
  }
  if (value.allArtifactFilesMaterialized === true) {
    for (const artifactPath of artifactPaths) {
      if (!existsSync(artifactPath)) {
        errors.push(`${pathName}/allArtifactFilesMaterialized cannot be true while artifact path is missing: ${artifactPath}`);
      }
    }
  }
}

function requireCapabilityIdArray(value: unknown, pathName: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${pathName} must be array`);
    return;
  }

  value.forEach((entry, index) => {
    requireOneOf(entry, requiredCapabilityIds, `${pathName}/${index}`, errors);
  });
}

function requireBoolean(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "boolean") {
    errors.push(`${pathName} must be boolean`);
  }
}

function requireNumber(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${pathName} must be finite number`);
  }
}

function requireLiteral<T extends string | boolean | number>(
  value: unknown,
  literal: T,
  pathName: string,
  errors: string[],
): void {
  if (value !== literal) {
    errors.push(`${pathName} must be ${JSON.stringify(literal)}`);
  }
}

function requireOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  pathName: string,
  errors: string[],
): void {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    errors.push(`${pathName} must be one of ${allowed.map((entry) => JSON.stringify(entry)).join(", ")}`);
  }
}

function arraysEqual(left: unknown, right: string[]): boolean {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((entry, index) => entry === right[index]);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
