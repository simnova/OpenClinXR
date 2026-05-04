import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildIwsdkPreInstallPackagePolicy,
  evaluateIwsdkWorkspacePosture,
  type IwsdkWorkspaceDependency,
  type IwsdkWorkspaceDependencyField,
  type IwsdkWorkspacePackageManagerControls,
  type IwsdkWorkspacePostureReadiness,
  type IwsdkWorkspaceScriptReference,
  type IwsdkWorkspaceSourceReference,
} from "../../packages/openclinxr/iwsdk-spike/src/index.js";

type CliOptions = {
  workspaceRoot?: string;
  outputPath?: string;
  sidecarInstallApproved: boolean;
};

type PackageJson = {
  scripts?: Record<string, string>;
  pnpm?: {
    overrides?: Record<string, string>;
  };
} & Partial<Record<IwsdkWorkspaceDependencyField, Record<string, string>>>;

export type IwsdkWorkspacePostureReport = {
  generatedAt: string;
  workspaceRoot: string;
  sidecarInstallApproved: boolean;
  detected: {
    sidecarAppExists: boolean;
    dependencies: IwsdkWorkspaceDependency[];
    sourceReferences: IwsdkWorkspaceSourceReference[];
    scriptReferences: IwsdkWorkspaceScriptReference[];
    lockfilePackageNames: string[];
    packageManagerControls: IwsdkWorkspacePackageManagerControls;
  };
  result: IwsdkWorkspacePostureReadiness;
};

const dependencyFields: IwsdkWorkspaceDependencyField[] = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const report = await buildIwsdkWorkspacePostureReport({
    workspaceRoot: options.workspaceRoot ?? findWorkspaceRoot(process.cwd()),
    sidecarInstallApproved: options.sidecarInstallApproved,
  });
  const payload = `${JSON.stringify(report, null, 2)}\n`;

  if (options.outputPath) {
    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, payload, "utf8");
    console.log(`Wrote ${options.outputPath}`);
  } else {
    console.log(payload.trimEnd());
  }

  if (!report.result.ready) {
    process.exitCode = 1;
  }
}

export async function buildIwsdkWorkspacePostureReport(input: {
  generatedAt?: string;
  workspaceRoot: string;
  sidecarInstallApproved?: boolean;
}): Promise<IwsdkWorkspacePostureReport> {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const rootPackage = await readPackageJson(path.join(workspaceRoot, "package.json"));
  const sidecarInstallApproved = input.sidecarInstallApproved ?? false;
  const sidecarAppExists = existsSync(path.join(workspaceRoot, "apps/ui-xr-iwsdk-spike"));
  const dependencies = await scanPackageDependencies(workspaceRoot);
  const sourceReferences = await scanSourceReferences(workspaceRoot);
  const scriptReferences = await scanPackageScripts(workspaceRoot);
  const lockfilePackageNames = await scanLockfileBlockedPackages(workspaceRoot);
  const packageManagerControls = buildPackageManagerControls(rootPackage);
  const result = evaluateIwsdkWorkspacePosture({
    sidecarAppExists,
    sidecarInstallApproved,
    dependencies,
    sourceReferences,
    scriptReferences,
    lockfilePackageNames,
    packageManagerControls,
  });

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    workspaceRoot,
    sidecarInstallApproved,
    detected: {
      sidecarAppExists,
      dependencies,
      sourceReferences,
      scriptReferences,
      lockfilePackageNames,
      packageManagerControls,
    },
    result,
  };
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = { sidecarInstallApproved: false };

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--workspace-root") {
      options.workspaceRoot = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--output") {
      options.outputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--approved-sidecar") {
      options.sidecarInstallApproved = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }

  return options;
}

async function scanPackageDependencies(workspaceRoot: string): Promise<IwsdkWorkspaceDependency[]> {
  const manifestPaths = await walk(workspaceRoot, (filePath) => path.basename(filePath) === "package.json");
  const dependencies: IwsdkWorkspaceDependency[] = [];

  for (const manifestPath of manifestPaths) {
    const packageJson = await readPackageJson(manifestPath);
    const relativeManifestPath = toPosixRelative(workspaceRoot, manifestPath);
    for (const field of dependencyFields) {
      for (const [name, version] of Object.entries(packageJson[field] ?? {})) {
        if (isIwsdkPackageName(name)) {
          dependencies.push({ manifestPath: relativeManifestPath, field, name, version });
        }
      }
    }
  }

  return dependencies;
}

async function scanSourceReferences(workspaceRoot: string): Promise<IwsdkWorkspaceSourceReference[]> {
  const sourceRoots = ["apps", "packages"].map((root) => path.join(workspaceRoot, root)).filter((root) => existsSync(root));
  const sourceFiles = (await Promise.all(sourceRoots.map((root) => walk(root, isSourceFile)))).flat();
  const references: IwsdkWorkspaceSourceReference[] = [];
  const importPattern =
    /(?:from\s*["']|import\s*["']|import\s*\(\s*["']|require\s*\(\s*["'])(@iwsdk\/[^"']+|@meta-quest\/hzdb)/g;

  for (const sourceFile of sourceFiles) {
    const sourceText = await readFile(sourceFile, "utf8");
    for (const match of sourceText.matchAll(importPattern)) {
      const packageName = match[1];
      if (packageName) {
        references.push({
          filePath: toPosixRelative(workspaceRoot, sourceFile),
          packageName,
        });
      }
    }
  }

  return references;
}

async function scanPackageScripts(workspaceRoot: string): Promise<IwsdkWorkspaceScriptReference[]> {
  const manifestPaths = await walk(workspaceRoot, (filePath) => path.basename(filePath) === "package.json");
  const scriptReferences: IwsdkWorkspaceScriptReference[] = [];

  for (const manifestPath of manifestPaths) {
    const packageJson = await readPackageJson(manifestPath);
    const relativeManifestPath = toPosixRelative(workspaceRoot, manifestPath);
    for (const [scriptName, command] of Object.entries(packageJson.scripts ?? {})) {
      if (/(?:iwsdk|@meta-quest\/hzdb)/.test(command)) {
        scriptReferences.push({ manifestPath: relativeManifestPath, scriptName, command });
      }
    }
  }

  return scriptReferences;
}

async function scanLockfileBlockedPackages(workspaceRoot: string): Promise<string[]> {
  const lockfilePath = path.join(workspaceRoot, "pnpm-lock.yaml");
  if (!existsSync(lockfilePath)) {
    return [];
  }

  const lockfileText = await readFile(lockfilePath, "utf8");
  const policy = buildIwsdkPreInstallPackagePolicy();
  const blockedPackages = policy.blockedPackages.filter((packageName) => lockfileContainsPackage(lockfileText, packageName));
  const blockedTransitivePackages = [...lockfileText.matchAll(/\/(@img\/sharp-libvips-[^@\s:]+)@/g)]
    .map((match) => match[1])
    .filter((packageName): packageName is string => Boolean(packageName));

  return [...new Set([...blockedPackages, ...blockedTransitivePackages])];
}

function buildPackageManagerControls(rootPackage: PackageJson): IwsdkWorkspacePackageManagerControls {
  const iwsdkVerify = rootPackage.scripts?.["iwsdk:verify"] ?? "";
  const auditScript = rootPackage.scripts?.["security:audit"] ?? "";
  const licenseScript = rootPackage.scripts?.["security:licenses"] ?? "";
  const threeOverride = rootPackage.pnpm?.overrides?.three;

  return {
    workspacePostureInVerify: iwsdkVerify.includes("pnpm iwsdk:workspace:posture"),
    threeOverrideExact: typeof threeOverride === "string" && isExactVersion(threeOverride),
    auditScriptPresent: /\bpnpm\s+audit\b/.test(auditScript),
    licenseScriptPresent: licenseScript.length > 0,
  };
}

async function readPackageJson(filePath: string): Promise<PackageJson> {
  return JSON.parse(await readFile(filePath, "utf8")) as PackageJson;
}

async function walk(root: string, includeFile: (filePath: string) => boolean): Promise<string[]> {
  if (!existsSync(root)) {
    return [];
  }

  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const childPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if ([".git", "deploy", "dist", "node_modules"].includes(entry.name)) {
        continue;
      }
      files.push(...await walk(childPath, includeFile));
      continue;
    }

    if (entry.isFile() && includeFile(childPath)) {
      files.push(childPath);
    }
  }

  return files;
}

function isSourceFile(filePath: string): boolean {
  return /\.(?:cjs|js|jsx|mjs|ts|tsx)$/.test(filePath);
}

function isIwsdkPackageName(packageName: string): boolean {
  return packageName.startsWith("@iwsdk/") || packageName === "@meta-quest/hzdb";
}

function lockfileContainsPackage(lockfileText: string, packageName: string): boolean {
  const escapedPackageName = packageName.replaceAll("/", "\\/").replaceAll("@", "\\@");
  return new RegExp(`(?:^|\\n)\\s*(?:${escapedPackageName}:|/${escapedPackageName}@)`).test(lockfileText);
}

function isExactVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version);
}

function toPosixRelative(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function findWorkspaceRoot(start: string): string {
  let candidate = path.resolve(start);

  while (true) {
    if (existsSync(path.join(candidate, "pnpm-workspace.yaml"))) {
      return candidate;
    }

    const parent = path.dirname(candidate);
    if (parent === candidate) {
      throw new Error("Could not find workspace root containing pnpm-workspace.yaml");
    }
    candidate = parent;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
