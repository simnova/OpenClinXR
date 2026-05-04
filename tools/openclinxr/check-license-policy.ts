import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type CliOptions = {
  outputPath?: string;
};

type PnpmLicensePackage = {
  name: string;
  versions: string[];
  license?: string;
  paths?: string[];
  homepage?: string;
  description?: string;
};

type LicenseFinding = {
  license: string;
  name: string;
  versions: string[];
  paths: string[];
  reportedLicense?: string;
  overrideReason?: string;
};

type LicensePolicyReport = {
  generatedAt: string;
  allowedLicenses: string[];
  reviewLicenses: string[];
  blockedLicensePatterns: string[];
  licenseOverrides: LicenseOverride[];
  licenseOverridesApplied: LicenseFinding[];
  packageCount: number;
  blockedFindings: LicenseFinding[];
  reviewFindings: LicenseFinding[];
  verdict: {
    passed: boolean;
    blockerCount: number;
    reviewCount: number;
  };
};

type LicensePolicyContext = {
  iwsdkSharpLibvipsExceptionAllowed?: boolean;
};

type PackageJsonDependencyFields = {
  devDependencies?: Record<string, string>;
};

type LicenseOverride = {
  name: string;
  versions: string[];
  reportedLicense: string;
  effectiveLicense: string;
  reason: string;
  evidence: string[];
};

const allowedLicenses = new Set([
  "0BSD",
  "Apache-2.0",
  "APPROVED-SIDECAR-EXCEPTION",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "ISC",
  "MIT",
  "(MIT OR CC0-1.0)",
]);

const reviewLicenses = new Set([
  "MPL-2.0",
]);

const blockedLicensePatterns = [
  "AGPL",
  "GPL",
  "LGPL",
  "SSPL",
  "NON-COMMERCIAL",
  "NONCOMMERCIAL",
  "PROPRIETARY",
  "UNKNOWN",
  "UNLICENSED",
];

const licenseOverrides: LicenseOverride[] = [
  {
    name: "@pmndrs/handle",
    versions: ["6.6.29"],
    reportedLicense: "Unknown",
    effectiveLicense: "MIT",
    reason: "pnpm reports Unknown because package.json uses SEE LICENSE IN LICENSE; the installed LICENSE and upstream pmndrs/xr LICENSE are MIT text.",
    evidence: [
      "node_modules/.pnpm/@pmndrs+handle@6.6.29_@types+react@19.2.14_react@19.2.5/node_modules/@pmndrs/handle/LICENSE",
      "https://github.com/pmndrs/xr/blob/main/LICENSE",
    ],
  },
  {
    name: "@pmndrs/pointer-events",
    versions: ["6.6.29"],
    reportedLicense: "Unknown",
    effectiveLicense: "MIT",
    reason: "pnpm reports Unknown because package.json uses SEE LICENSE IN LICENSE; the installed LICENSE and upstream pmndrs/xr LICENSE are MIT text.",
    evidence: [
      "node_modules/.pnpm/@pmndrs+pointer-events@6.6.29/node_modules/@pmndrs/pointer-events/LICENSE",
      "https://github.com/pmndrs/xr/blob/main/LICENSE",
    ],
  },
  {
    name: "@pmndrs/uikit",
    versions: ["1.0.64"],
    reportedLicense: "Unknown",
    effectiveLicense: "MIT",
    reason: "pnpm reports Unknown because package.json uses SEE LICENSE IN LICENSE; the installed LICENSE and upstream pmndrs/uikit LICENSE are MIT text.",
    evidence: [
      "node_modules/.pnpm/@pmndrs+uikit@1.0.64_three@0.184.0/node_modules/@pmndrs/uikit/LICENSE",
      "https://github.com/pmndrs/uikit/blob/main/LICENSE",
    ],
  },
  {
    name: "@img/sharp-libvips-*",
    versions: ["1.0.4", "1.0.5"],
    reportedLicense: "LGPL-3.0-or-later",
    effectiveLicense: "APPROVED-SIDECAR-EXCEPTION",
    reason: "Patrick Gidich approved an IWSDK Phase 2 sidecar-only devDependency exception on 2026-05-04 for @img/sharp-libvips-* packages pulled by exact sharp@0.33.5 through @iwsdk/vite-plugin-dev@0.3.1. The exception is never for production use and must stay scoped to apps/ui-xr-iwsdk-spike.",
    evidence: [
      "proposals/approved/proposal-iwsdk-phase2-sharp-libvips-exception.md",
      "apps/ui-xr-iwsdk-spike/package.json",
    ],
  },
];

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const report = await buildReport();
  if (options.outputPath) {
    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`Wrote ${options.outputPath}`);
  }

  if (report.blockedFindings.length > 0) {
    for (const finding of report.blockedFindings) {
      console.error(`${finding.name}@${finding.versions.join(",")} uses blocked or unknown license ${finding.license}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Checked ${report.packageCount} dependency license record${report.packageCount === 1 ? "" : "s"}; ${report.reviewFindings.length} review-only finding${report.reviewFindings.length === 1 ? "" : "s"}.`);
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

async function buildReport(): Promise<LicensePolicyReport> {
  const { stdout } = await execFileAsync("pnpm", ["licenses", "list", "--json"], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  const inventory = JSON.parse(stdout) as Record<string, PnpmLicensePackage[]>;
  return buildLicensePolicyReportFromInventory(inventory, new Date(), await buildLicensePolicyContext(process.cwd()));
}

export function buildLicensePolicyReportFromInventory(
  inventory: Record<string, PnpmLicensePackage[]>,
  now = new Date(),
  context: LicensePolicyContext = {},
): LicensePolicyReport {
  const blockedFindings: LicenseFinding[] = [];
  const reviewFindings: LicenseFinding[] = [];
  const licenseOverridesApplied: LicenseFinding[] = [];
  let packageCount = 0;

  for (const [rawLicense, packages] of Object.entries(inventory)) {
    const reportedLicense = normalizeLicense(rawLicense);
    for (const dependency of packages) {
      packageCount += 1;
      const override = findLicenseOverride(reportedLicense, dependency, context);
      const license = override?.effectiveLicense ?? reportedLicense;
      const finding = {
        license,
        name: dependency.name,
        versions: dependency.versions,
        paths: dependency.paths ?? [],
        ...(override ? { reportedLicense, overrideReason: override.reason } : {}),
      };
      if (override) {
        licenseOverridesApplied.push(finding);
      }
      if (isBlockedLicense(license)) {
        blockedFindings.push(finding);
      } else if (reviewLicenses.has(license) || !allowedLicenses.has(license)) {
        reviewFindings.push(finding);
      }
    }
  }

  return {
    generatedAt: now.toISOString(),
    allowedLicenses: [...allowedLicenses].sort(),
    reviewLicenses: [...reviewLicenses].sort(),
    blockedLicensePatterns,
    licenseOverrides,
    licenseOverridesApplied: licenseOverridesApplied.sort(sortFinding),
    packageCount,
    blockedFindings: blockedFindings.sort(sortFinding),
    reviewFindings: reviewFindings.sort(sortFinding),
    verdict: {
      passed: blockedFindings.length === 0,
      blockerCount: blockedFindings.length,
      reviewCount: reviewFindings.length,
    },
  };
}

function normalizeLicense(license: string): string {
  return license.trim().replace(/\s+/g, " ");
}

function isBlockedLicense(license: string): boolean {
  const upper = license.toUpperCase();
  return blockedLicensePatterns.some((pattern) => upper.includes(pattern));
}

async function buildLicensePolicyContext(workspaceRoot: string): Promise<LicensePolicyContext> {
  const sidecarPackageJson = await readJsonFile(path.join(workspaceRoot, "apps/ui-xr-iwsdk-spike/package.json"));
  const sidecarDevtoolVersion = sidecarPackageJson?.devDependencies?.["@iwsdk/vite-plugin-dev"];

  return {
    iwsdkSharpLibvipsExceptionAllowed: sidecarDevtoolVersion === "0.3.1",
  };
}

async function readJsonFile(filePath: string): Promise<PackageJsonDependencyFields | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as PackageJsonDependencyFields;
  } catch {
    return undefined;
  }
}

function findLicenseOverride(
  reportedLicense: string,
  dependency: PnpmLicensePackage,
  context: LicensePolicyContext,
): LicenseOverride | undefined {
  const approvedIwsdkSharpLibvipsException = findApprovedIwsdkSharpLibvipsException(reportedLicense, dependency, context);
  if (approvedIwsdkSharpLibvipsException) {
    return approvedIwsdkSharpLibvipsException;
  }

  return licenseOverrides.find((override) =>
    override.name === dependency.name
    && override.reportedLicense === reportedLicense
    && arrayEquals(override.versions, dependency.versions)
  );
}

function findApprovedIwsdkSharpLibvipsException(
  reportedLicense: string,
  dependency: PnpmLicensePackage,
  context: LicensePolicyContext,
): LicenseOverride | undefined {
  if (context.iwsdkSharpLibvipsExceptionAllowed !== true) {
    return undefined;
  }
  if (!dependency.name.startsWith("@img/sharp-libvips-")) {
    return undefined;
  }
  if (reportedLicense !== "LGPL-3.0-or-later" || !dependency.versions.every((version) => version === "1.0.4" || version === "1.0.5")) {
    return undefined;
  }

  const template = licenseOverrides.find((override) => override.name === "@img/sharp-libvips-*");
  return template ? { ...template, name: dependency.name } : undefined;
}

function arrayEquals(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sortFinding(left: LicenseFinding, right: LicenseFinding): number {
  return `${left.license}:${left.name}`.localeCompare(`${right.license}:${right.name}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
