import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { globFiles, readJson, writeJson } from "../../agent-factory/lib.js";

type CliOptions = {
  metadataInput?: string;
  outputPath?: string;
  generatedAt?: string;
  repoViteVersion?: string;
  validatePath?: string;
  validateLatest: boolean;
};

type ExpectedIwsdkPackage = {
  name: string;
  latestVersion: string;
  license: string;
  expectedPeerDependencies?: Record<string, string>;
};

export type IwsdkNpmMetadataSnapshot = {
  kind: "iwsdk_npm_metadata_snapshot";
  capturedAt: string;
  source: {
    command: string;
    registry: string;
  };
  packages: Array<{
    name: string;
    latestVersion: string;
    license: string;
    peerDependencies: Record<string, string>;
    dependencies: Record<string, string>;
    bin: Record<string, string>;
  }>;
};

export type IwsdkNpmCurrentnessReport = {
  kind: "iwsdk_npm_currentness_check";
  generatedAt: string;
  ready: boolean;
  metadata_file: string;
  repo: {
    viteVersion: string;
  };
  packages: Array<{
    name: string;
    latest_version: string | null;
    expected_latest_version: string;
    license: {
      source: string | null;
      expected: string;
      accepted: boolean;
    };
    peer_dependencies: Record<string, string>;
    current: boolean;
    blockers: string[];
    adoption_blockers: string[];
  }>;
  currentness: {
    passed: boolean;
    blockers: string[];
  };
  adoption: {
    ready_for_runtime_adoption: false;
    blockers: string[];
  };
};

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

/**
 * A captured snapshot older than this is stale even when its versions still match live npm.
 *
 * The bound is derived from @iwsdk/core's real npm release history, last 10 releases, measured
 * 2026-08-19: gaps 0, 33, 27, 8, 10, 63, 0, 10, 0 days -> median 10, mean 16.8. A bound inside
 * that band expires roughly one release cycle after capture. 14 sits in [10, 17]; values outside
 * the band are refused by the-iwsdk-sidecar-runs-the-current-release.test.ts clause (5).
 */
export const SNAPSHOT_MAX_AGE_DAYS = 14;
const SNAPSHOT_MAX_AGE_MS = SNAPSHOT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

export type IwsdkSnapshotFreshness = {
  stale: boolean;
  blockers: string[];
};

/**
 * Pure staleness surface: compares a captured snapshot against live npm versions supplied by the
 * caller, plus an age bound so a snapshot expires even when no release happened. No network here.
 */
export function evaluateSnapshotFreshness(input: {
  snapshot: { capturedAt: string; packages: Array<{ name: string; latestVersion: string }> };
  liveLatestVersions: Record<string, string>;
  now: string;
}): IwsdkSnapshotFreshness {
  const blockers: string[] = [];
  for (const entry of input.snapshot.packages) {
    const liveVersion = input.liveLatestVersions[entry.name];
    if (liveVersion === undefined) {
      continue; // no live data for this package — the caller could not judge it
    }
    if (liveVersion !== entry.latestVersion) {
      blockers.push(
        `npm_latest_version_moved:${entry.name}:snapshot_${entry.latestVersion}_live_${liveVersion}`,
      );
    }
  }
  const ageMs = new Date(input.now).getTime() - new Date(input.snapshot.capturedAt).getTime();
  if (Number.isFinite(ageMs) && ageMs > SNAPSHOT_MAX_AGE_MS) {
    const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
    blockers.push(
      `npm_metadata_snapshot_too_old:captured_${input.snapshot.capturedAt}_age_days_${ageDays}_max_days_14`,
    );
  }
  return { stale: blockers.length > 0, blockers };
}

/** pnpm-workspace.yaml default catalog — what a bare `catalog:` reference resolves to. */
function readCatalogViteVersion(): string {
  const yaml = readFileSync("pnpm-workspace.yaml", "utf8");
  const version = /^\s+vite:\s*"([^"]+)"/mu.exec(yaml)?.[1];
  if (!version) {
    throw new Error("pnpm-workspace.yaml has no catalog vite version to resolve `catalog:` against");
  }
  return version;
}

export function resolveRepoViteVersion(manifestVersion: string): string {
  if (manifestVersion === "catalog:") {
    return readCatalogViteVersion();
  }
  return manifestVersion;
}

const expectedPackages: ExpectedIwsdkPackage[] = [
  { name: "@iwsdk/core", latestVersion: "0.5.3", license: "MIT" },
  { name: "@iwsdk/xr-input", latestVersion: "0.5.3", license: "MIT" },
  { name: "@iwsdk/scene-composition", latestVersion: "0.5.3", license: "MIT" },
  { name: "@iwsdk/locomotor", latestVersion: "0.5.3", license: "MIT" },
  { name: "@iwsdk/glxf", latestVersion: "0.4.2", license: "MIT" },
  {
    name: "@iwsdk/vite-plugin-dev",
    latestVersion: "0.5.3",
    license: "MIT",
    expectedPeerDependencies: { vite: "^7.0.0" },
  },
  {
    name: "@iwsdk/vite-plugin-gltf-optimizer",
    latestVersion: "0.4.2",
    license: "MIT",
    expectedPeerDependencies: { vite: "^7.0.0" },
  },
  {
    name: "@iwsdk/vite-plugin-uikitml",
    latestVersion: "0.4.2",
    license: "MIT",
    expectedPeerDependencies: { vite: "^7.0.0" },
  },
  {
    name: "@iwsdk/vite-plugin-metaspatial",
    latestVersion: "0.4.2",
    license: "MIT",
    expectedPeerDependencies: { vite: "^7.0.0" },
  },
  { name: "@iwsdk/reference", latestVersion: "0.5.3", license: "MIT" },
  {
    name: "@meta-quest/hzdb",
    latestVersion: "1.3.2",
    license: "Meta Platform Technologies SDK License",
  },
];

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args);

  if (options.validatePath) {
    const validation = validateIwsdkNpmCurrentnessReport(await readJson<unknown>(options.validatePath));
    if (validation.ok) {
      console.log(`Validated ${options.validatePath}`);
      return;
    }
    for (const error of validation.errors) {
      console.error(error);
    }
    process.exitCode = 1;
    return;
  }

  const metadataPath = options.metadataInput ?? await latestPath("docs/openclinxr/iwsdk-npm-metadata-snapshot-*.json");
  if (!metadataPath) {
    throw new Error("Missing --metadata-input or docs/openclinxr/iwsdk-npm-metadata-snapshot-*.json");
  }

  const metadata = await readJson<IwsdkNpmMetadataSnapshot>(metadataPath);
  const report = buildIwsdkNpmCurrentnessReport({
    generatedAt: options.generatedAt,
    metadataFile: metadataPath,
    metadata,
    repoViteVersion: options.repoViteVersion ?? await readRepoViteVersion(),
    // The runner owns the network: when the caller pins --metadata-input the comparison is
    // hermetic; when the runner loads the on-disk snapshot itself it fetches live npm versions,
    // so the gate can actually expire. Failures are loud — a check that cannot verify must not
    // report green.
    ...(options.metadataInput
      ? {}
      : { liveLatestVersions: await fetchLiveLatestVersions(metadata.packages.map((entry) => entry.name)) }),
  });

  if (options.outputPath) {
    await writeJson(options.outputPath, report);
    console.log(`Wrote ${options.outputPath}`);
    return;
  }

  if (options.validateLatest) {
    if (report.ready) {
      console.log(`Validated ${metadataPath}`);
      return;
    }
    for (const blocker of report.currentness.blockers) {
      console.error(blocker);
    }
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify(report, null, 2));
}

export function buildIwsdkNpmCurrentnessReport(input: {
  generatedAt?: string;
  metadataFile: string;
  metadata: IwsdkNpmMetadataSnapshot;
  repoViteVersion: string;
  liveLatestVersions?: Record<string, string>;
  now?: string;
}): IwsdkNpmCurrentnessReport {
  const validation = validateIwsdkNpmMetadataSnapshot(input.metadata);
  const packageMetadata = new Map(input.metadata.packages.map((entry) => [entry.name, entry]));
  const metadataBlockers = validation.ok ? [] : validation.errors.map((error) => `metadata_invalid:${error}`);
  const packages = expectedPackages.map((expectedPackage) => {
    const actual = packageMetadata.get(expectedPackage.name);
    const sourceLicense = actual?.license ?? null;
    const peerDependencies = actual?.peerDependencies ?? {};
    const blockers = unique([
      ...metadataBlockers,
      actual ? undefined : `npm_package_missing:${expectedPackage.name}`,
      actual?.latestVersion === expectedPackage.latestVersion
        ? undefined
        : `npm_latest_version_moved:${expectedPackage.name}:expected_${expectedPackage.latestVersion}_actual_${actual?.latestVersion ?? "missing"}`,
      sourceLicense === expectedPackage.license
        ? undefined
        : `npm_license_changed:${expectedPackage.name}:expected_${expectedPackage.license}_actual_${sourceLicense ?? "missing"}`,
      ...peerDependencyBlockers(expectedPackage, peerDependencies),
    ]);
    const adoptionBlockers = adoptionBlockersForPackage(expectedPackage.name, peerDependencies, input.repoViteVersion, sourceLicense);

    return {
      name: expectedPackage.name,
      latest_version: actual?.latestVersion ?? null,
      expected_latest_version: expectedPackage.latestVersion,
      license: {
        source: sourceLicense,
        expected: expectedPackage.license,
        accepted: sourceLicense === expectedPackage.license,
      },
      peer_dependencies: peerDependencies,
      current: blockers.length === 0,
      blockers,
      adoption_blockers: adoptionBlockers,
    };
  });
  const freshness = input.liveLatestVersions
    ? evaluateSnapshotFreshness({
        snapshot: input.metadata,
        liveLatestVersions: input.liveLatestVersions,
        now: input.now ?? new Date().toISOString(),
      })
    : null;
  const currentnessBlockers = unique([
    ...packages.flatMap((entry) => entry.blockers),
    ...(freshness?.blockers ?? []),
  ]);

  return {
    kind: "iwsdk_npm_currentness_check",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    ready: currentnessBlockers.length === 0,
    metadata_file: input.metadataFile,
    repo: {
      viteVersion: input.repoViteVersion,
    },
    packages,
    currentness: {
      passed: currentnessBlockers.length === 0,
      blockers: currentnessBlockers,
    },
    adoption: {
      ready_for_runtime_adoption: false,
      blockers: unique(packages.flatMap((entry) => entry.adoption_blockers)),
    },
  };
}

export function validateIwsdkNpmMetadataSnapshot(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["/ must be object"] };
  }

  requireLiteral(value.kind, "iwsdk_npm_metadata_snapshot", "/kind", errors);
  requireString(value.capturedAt, "/capturedAt", errors);
  if (!isRecord(value.source)) {
    errors.push("/source must be object");
  } else {
    requireString(value.source.command, "/source/command", errors);
    requireString(value.source.registry, "/source/registry", errors);
  }
  if (!Array.isArray(value.packages)) {
    errors.push("/packages must be array");
  } else {
    value.packages.forEach((entry, index) => {
      validatePackageMetadata(entry, `/packages/${index}`, errors);
    });
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validatePackageMetadata(value: unknown, pathName: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${pathName} must be object`);
    return;
  }

  requireString(value.name, `${pathName}/name`, errors);
  requireString(value.latestVersion, `${pathName}/latestVersion`, errors);
  requireString(value.license, `${pathName}/license`, errors);
  requireStringRecord(value.peerDependencies, `${pathName}/peerDependencies`, errors);
  requireStringRecord(value.dependencies, `${pathName}/dependencies`, errors);
  requireStringRecord(value.bin, `${pathName}/bin`, errors);
}

function validateIwsdkNpmCurrentnessReport(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["/ must be object"] };
  }

  requireLiteral(value.kind, "iwsdk_npm_currentness_check", "/kind", errors);
  requireString(value.generatedAt, "/generatedAt", errors);
  requireBoolean(value.ready, "/ready", errors);
  requireString(value.metadata_file, "/metadata_file", errors);
  if (!isRecord(value.currentness)) {
    errors.push("/currentness must be object");
  } else {
    requireBoolean(value.currentness.passed, "/currentness/passed", errors);
    requireStringArray(value.currentness.blockers, "/currentness/blockers", errors);
  }
  if (value.ready !== true) {
    errors.push("/ready must be true for validation");
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function peerDependencyBlockers(
  expectedPackage: ExpectedIwsdkPackage,
  peerDependencies: Record<string, string>,
): string[] {
  return Object.entries(expectedPackage.expectedPeerDependencies ?? {}).flatMap(([name, expectedRange]) => {
    const actualRange = peerDependencies[name];
    return actualRange === expectedRange
      ? []
      : [`npm_peer_dependency_changed:${expectedPackage.name}:${name}:expected_${expectedRange}_actual_${actualRange ?? "missing"}`];
  });
}

function adoptionBlockersForPackage(
  packageName: string,
  peerDependencies: Record<string, string>,
  repoViteVersion: string,
  sourceLicense: string | null,
): string[] {
  return unique([
    packageName === "@meta-quest/hzdb"
      && (sourceLicense === "UNLICENSED"
        || sourceLicense === "Meta Platform Technologies SDK License")
      ? `package_license_requires_legal_procurement_approval:@meta-quest/hzdb:${sourceLicense}`
      : undefined,
    peerDependencies.vite && !vitePeerRangeAcceptsRepoMajor(peerDependencies.vite, repoViteVersion)
      ? `vite_peer_range_does_not_accept_repo_vite_major:${packageName}:${peerDependencies.vite}_vs_${repoViteVersion}`
      : undefined,
  ]);
}

function vitePeerRangeAcceptsRepoMajor(peerRange: string, repoViteVersion: string): boolean {
  const major = repoViteVersion.split(".")[0];
  return Boolean(major) && (
    peerRange.includes(`^${major}.`)
    || peerRange.includes(`~${major}.`)
    || peerRange.includes(`>=${major}.`)
    || peerRange === major
  );
}

async function readRepoViteVersion(): Promise<string> {
  const manifest = JSON.parse(await readFile("apps/arena/ui-xr-iwsdk-spike/package.json", "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const version = manifest.devDependencies?.vite ?? manifest.dependencies?.vite;
  if (!version) {
    throw new Error("Could not resolve repo Vite version from apps/arena/ui-xr-iwsdk-spike/package.json");
  }
  return resolveRepoViteVersion(version);
}

/** Live `latest` versions straight from the npm registry, one request per package. */
async function fetchLiveLatestVersions(packageNames: string[]): Promise<Record<string, string>> {
  const entries = await Promise.all(
    packageNames.map(async (name) => {
      const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        throw new Error(`npm registry returned ${response.status} for ${name}`);
      }
      const body = (await response.json()) as { version?: string };
      return [name, body.version] as const;
    }),
  );
  const versions: Record<string, string> = {};
  for (const [name, version] of entries) {
    if (version === undefined) {
      throw new Error(`npm registry response for ${name} has no version field`);
    }
    versions[name] = version;
  }
  return versions;
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = { validateLatest: false };

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--metadata-input") {
      options.metadataInput = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--generated-at") {
      options.generatedAt = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--repo-vite-version") {
      options.repoViteVersion = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--output") {
      options.outputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--validate") {
      options.validatePath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--validate-latest") {
      options.validateLatest = true;
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

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((entry): entry is string => typeof entry === "string" && entry.length > 0))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${pathName} must be non-empty string`);
  }
}

function requireBoolean(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "boolean") {
    errors.push(`${pathName} must be boolean`);
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

function requireStringRecord(value: unknown, pathName: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${pathName} must be object`);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string" || entry.length === 0) {
      errors.push(`${pathName}/${key} must be non-empty string`);
    }
  }
}

function requireLiteral<T extends string>(value: unknown, literal: T, pathName: string, errors: string[]): void {
  if (value !== literal) {
    errors.push(`${pathName} must be ${JSON.stringify(literal)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
