import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
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
};

type LicensePolicyReport = {
  generatedAt: string;
  allowedLicenses: string[];
  reviewLicenses: string[];
  blockedLicensePatterns: string[];
  packageCount: number;
  blockedFindings: LicenseFinding[];
  reviewFindings: LicenseFinding[];
  verdict: {
    passed: boolean;
    blockerCount: number;
    reviewCount: number;
  };
};

const allowedLicenses = new Set([
  "0BSD",
  "Apache-2.0",
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
  const blockedFindings: LicenseFinding[] = [];
  const reviewFindings: LicenseFinding[] = [];
  let packageCount = 0;

  for (const [rawLicense, packages] of Object.entries(inventory)) {
    const license = normalizeLicense(rawLicense);
    for (const dependency of packages) {
      packageCount += 1;
      const finding = {
        license,
        name: dependency.name,
        versions: dependency.versions,
        paths: dependency.paths ?? [],
      };
      if (isBlockedLicense(license)) {
        blockedFindings.push(finding);
      } else if (reviewLicenses.has(license) || !allowedLicenses.has(license)) {
        reviewFindings.push(finding);
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    allowedLicenses: [...allowedLicenses].sort(),
    reviewLicenses: [...reviewLicenses].sort(),
    blockedLicensePatterns,
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

function sortFinding(left: LicenseFinding, right: LicenseFinding): number {
  return `${left.license}:${left.name}`.localeCompare(`${right.license}:${right.name}`);
}

await main();
