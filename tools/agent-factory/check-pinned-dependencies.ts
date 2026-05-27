import { pathToFileURL } from "node:url";
import { globFiles, readJson } from "./lib.js";

type PackageJson = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

export type PinnedDependencyFinding = {
  file: string;
  field: string;
  dependency: string;
  specifier: string;
};

export type PinnedDependencyCheckInput = {
  files?: string[];
};

export type PinnedDependencyCheckResult = {
  checkedCount: number;
  findings: PinnedDependencyFinding[];
};

const dependencyFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

async function main(): Promise<void> {
  const result = await checkPinnedDependencySpecifiers();

  if (result.findings.length > 0) {
    for (const finding of result.findings) {
      console.error(`${finding.file}: ${finding.field}.${finding.dependency} uses unpinned specifier ${JSON.stringify(finding.specifier)}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Checked pinned dependency specifiers in ${result.checkedCount} package manifest${result.checkedCount === 1 ? "" : "s"}.`);
}

export async function checkPinnedDependencySpecifiers(input: PinnedDependencyCheckInput = {}): Promise<PinnedDependencyCheckResult> {
  const files = (input.files ?? await globFiles(["package.json", "apps/**/package.json", "packages/**/package.json"])).sort();
  const findings: PinnedDependencyFinding[] = [];

  for (const file of files) {
    const packageJson = await readJson<PackageJson>(file);
    for (const field of dependencyFields) {
      for (const [dependency, specifier] of Object.entries(packageJson[field] ?? {})) {
        if (!isPinnedDependencySpecifier(specifier)) {
          findings.push({ file, field, dependency, specifier });
        }
      }
    }
  }

  return { checkedCount: files.length, findings };
}

export function isPinnedDependencySpecifier(specifier: string): boolean {
  if (specifier.startsWith("workspace:") || specifier.startsWith("file:") || specifier.startsWith("link:") || specifier.startsWith("portal:")) {
    return true;
  }
  if (specifier.startsWith("npm:")) {
    return isPinnedDependencySpecifier(specifier.replace(/^npm:(?:@[^/]+\/)?[^@]+@/, ""));
  }

  return exactVersionPattern.test(specifier);
}

const exactVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
