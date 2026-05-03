import { globFiles, readJson } from "./lib.js";

type PackageJson = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

type Finding = {
  file: string;
  field: string;
  dependency: string;
  specifier: string;
};

const dependencyFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

async function main(): Promise<void> {
  const files = await globFiles(["package.json", "apps/**/package.json", "packages/**/package.json"]);
  const findings: Finding[] = [];

  for (const file of files.sort()) {
    const packageJson = await readJson<PackageJson>(file);
    for (const field of dependencyFields) {
      for (const [dependency, specifier] of Object.entries(packageJson[field] ?? {})) {
        if (!isPinnedSpecifier(specifier)) {
          findings.push({ file, field, dependency, specifier });
        }
      }
    }
  }

  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`${finding.file}: ${finding.field}.${finding.dependency} uses unpinned specifier ${JSON.stringify(finding.specifier)}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Checked pinned dependency specifiers in ${files.length} package manifest${files.length === 1 ? "" : "s"}.`);
}

function isPinnedSpecifier(specifier: string): boolean {
  if (specifier.startsWith("workspace:") || specifier.startsWith("file:") || specifier.startsWith("link:") || specifier.startsWith("portal:")) {
    return true;
  }
  if (specifier.startsWith("npm:")) {
    return isPinnedSpecifier(specifier.replace(/^npm:[^@]+@/, ""));
  }

  return exactVersionPattern.test(specifier);
}

const exactVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

await main();
