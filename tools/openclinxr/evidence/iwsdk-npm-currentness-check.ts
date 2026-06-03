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

const expectedPackages: ExpectedIwsdkPackage[] = [
  { name: "@iwsdk/core", latestVersion: "0.4.1", license: "MIT" },
  { name: "@iwsdk/xr-input", latestVersion: "0.4.1", license: "MIT" },
  { name: "@iwsdk/locomotor", latestVersion: "0.4.1", license: "MIT" },
  { name: "@iwsdk/glxf", latestVersion: "0.4.1", license: "MIT" },
  {
    name: "@iwsdk/vite-plugin-dev",
    latestVersion: "0.4.1",
    license: "MIT",
    expectedPeerDependencies: { vite: "^7.0.0" },
  },
  {
    name: "@iwsdk/vite-plugin-gltf-optimizer",
    latestVersion: "0.4.1",
    license: "MIT",
    expectedPeerDependencies: { vite: "^7.0.0" },
  },
  {
    name: "@iwsdk/vite-plugin-uikitml",
    latestVersion: "0.4.1",
    license: "MIT",
    expectedPeerDependencies: { vite: "^7.0.0" },
  },
  {
    name: "@iwsdk/vite-plugin-metaspatial",
    latestVersion: "0.4.1",
    license: "MIT",
    expectedPeerDependencies: { vite: "^7.0.0" },
  },
  { name: "@iwsdk/reference", latestVersion: "0.4.1", license: "MIT" },
  { name: "@meta-quest/hzdb", latestVersion: "1.2.1", license: "UNLICENSED" },
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

  const report = buildIwsdkNpmCurrentnessReport({
    generatedAt: options.generatedAt,
    metadataFile: metadataPath,
    metadata: await readJson<IwsdkNpmMetadataSnapshot>(metadataPath),
    repoViteVersion: options.repoViteVersion ?? await readRepoViteVersion(),
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
  const currentnessBlockers = unique(packages.flatMap((entry) => entry.blockers));

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
    packageName === "@meta-quest/hzdb" && sourceLicense === "UNLICENSED"
      ? "package_license_requires_legal_procurement_approval:@meta-quest/hzdb:UNLICENSED"
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
  const manifest = JSON.parse(await readFile("apps/ui-xr-iwsdk-spike/package.json", "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const version = manifest.devDependencies?.vite ?? manifest.dependencies?.vite;
  if (!version) {
    throw new Error("Could not resolve repo Vite version from apps/ui-xr-iwsdk-spike/package.json");
  }
  return version;
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
