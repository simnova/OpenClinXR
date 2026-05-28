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
  type IwsdkWorkspacePackageManagerReference,
  type IwsdkWorkspacePostureReadiness,
  type IwsdkWorkspaceScriptReference,
  type IwsdkWorkspaceSidecarProductionUiCoupling,
  type IwsdkWorkspaceSourceReference,
} from "../../packages/openclinxr/iwsdk-spike/src/index.js";

type CliOptions = {
  workspaceRoot?: string;
  outputPath?: string;
  sidecarInstallApproved: boolean;
  phase2DevtoolsApproved: boolean;
  uikitmlSpatialTextApproved: boolean;
  sharpLibvipsExceptionApproved: boolean;
};

type PackageJson = {
  scripts?: Record<string, string>;
  catalog?: unknown;
  catalogs?: unknown;
  pnpm?: {
    overrides?: Record<string, string>;
  } & Record<string, unknown>;
} & Partial<Record<IwsdkWorkspaceDependencyField, Record<string, string>>>;

export type IwsdkWorkspacePostureReport = {
  generatedAt: string;
  workspaceRoot: string;
  sidecarInstallApproved: boolean;
  phase2DevtoolsApproved: boolean;
  uikitmlSpatialTextApproved: boolean;
  sharpLibvipsExceptionApproved: boolean;
  detected: {
    sidecarAppExists: boolean;
    sidecarLockfileImporterPresent: boolean;
    sidecarLockfilePackageNames: string[];
    dependencies: IwsdkWorkspaceDependency[];
    sourceReferences: IwsdkWorkspaceSourceReference[];
    sidecarProductionUiCouplings: IwsdkWorkspaceSidecarProductionUiCoupling[];
    scriptReferences: IwsdkWorkspaceScriptReference[];
    lockfilePackageNames: string[];
    packageManagerReferences: IwsdkWorkspacePackageManagerReference[];
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
    phase2DevtoolsApproved: options.phase2DevtoolsApproved,
    uikitmlSpatialTextApproved: options.uikitmlSpatialTextApproved,
    sharpLibvipsExceptionApproved: options.sharpLibvipsExceptionApproved,
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
  phase2DevtoolsApproved?: boolean;
  uikitmlSpatialTextApproved?: boolean;
  sharpLibvipsExceptionApproved?: boolean;
}): Promise<IwsdkWorkspacePostureReport> {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const rootPackage = await readPackageJson(path.join(workspaceRoot, "package.json"));
  const sidecarInstallApproved = input.sidecarInstallApproved ?? false;
  const phase2DevtoolsApproved = input.phase2DevtoolsApproved ?? false;
  const uikitmlSpatialTextApproved = input.uikitmlSpatialTextApproved ?? false;
  const sharpLibvipsExceptionApproved = input.sharpLibvipsExceptionApproved ?? false;
  const sidecarAppExists = existsSync(path.join(workspaceRoot, "apps/ui-xr-iwsdk-spike"));
  const dependencies = await scanPackageDependencies(workspaceRoot);
  const sourceReferences = await scanSourceReferences(workspaceRoot);
  const sidecarProductionUiCouplings = await scanSidecarProductionUiCouplings(workspaceRoot, dependencies);
  const scriptReferences = await scanPackageScripts(workspaceRoot);
  const lockfilePackageNames = await scanLockfileBlockedPackages(workspaceRoot);
  const sidecarLockfileImporterPresent = await scanSidecarLockfileImporter(workspaceRoot);
  const sidecarLockfilePackageNames = await scanSidecarLockfilePackageNames(workspaceRoot);
  const packageManagerReferences = await scanPackageManagerReferences(workspaceRoot, rootPackage);
  const packageManagerControls = buildPackageManagerControls(rootPackage);
  const result = evaluateIwsdkWorkspacePosture({
    sidecarAppExists,
    sidecarInstallApproved,
    phase2DevtoolsApproved,
    uikitmlSpatialTextApproved,
    sharpLibvipsExceptionApproved,
    sidecarLockfileImporterPresent,
    dependencies,
    sourceReferences,
    sidecarProductionUiCouplings,
    scriptReferences,
    lockfilePackageNames,
    packageManagerReferences,
    packageManagerControls,
    sidecarLockfilePackageNames,
  });

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    workspaceRoot,
    sidecarInstallApproved,
    phase2DevtoolsApproved,
    uikitmlSpatialTextApproved,
    sharpLibvipsExceptionApproved,
    detected: {
      sidecarAppExists,
      sidecarLockfileImporterPresent,
      sidecarLockfilePackageNames,
      dependencies,
      sourceReferences,
      sidecarProductionUiCouplings,
      scriptReferences,
      lockfilePackageNames,
      packageManagerReferences,
      packageManagerControls,
    },
    result,
  };
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = {
    sidecarInstallApproved: false,
    phase2DevtoolsApproved: false,
    uikitmlSpatialTextApproved: false,
    sharpLibvipsExceptionApproved: false,
  };

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
    if (arg === "--approved-phase2-devtools") {
      options.phase2DevtoolsApproved = true;
      continue;
    }
    if (arg === "--approved-uikitml-spatial-text") {
      options.uikitmlSpatialTextApproved = true;
      continue;
    }
    if (arg === "--approved-sharp-libvips-exception") {
      options.sharpLibvipsExceptionApproved = true;
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
        if (isIwsdkPackageName(name) || isIwsdkPackageSpecifier(version)) {
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

async function scanSidecarProductionUiCouplings(
  workspaceRoot: string,
  dependencies: IwsdkWorkspaceDependency[],
): Promise<IwsdkWorkspaceSidecarProductionUiCoupling[]> {
  const sidecarRoot = path.join(workspaceRoot, "apps/ui-xr-iwsdk-spike");
  const sourceFiles = await walk(sidecarRoot, isSourceFile);
  const importPattern =
    /(?:from\s*["']|import\s*["']|import\s*\(\s*["']|require\s*\(\s*["'])([^"']+)/g;
  const manifestCouplings = dependencies
    .filter((dependency) => dependency.manifestPath === "apps/ui-xr-iwsdk-spike/package.json")
    .filter((dependency) => dependency.name === "@openclinxr/ui-xr")
    .map((dependency) => ({
      filePath: dependency.manifestPath,
      specifier: dependency.name,
    }));
  const sidecarManifestCouplings = await scanSidecarProductionUiManifestCouplings(workspaceRoot);
  const sourceCouplings: IwsdkWorkspaceSidecarProductionUiCoupling[] = [];

  for (const sourceFile of sourceFiles) {
    const sourceText = await readFile(sourceFile, "utf8");
    for (const match of sourceText.matchAll(importPattern)) {
      const specifier = match[1];
      if (specifier && sidecarSpecifierTargetsProductionUi(workspaceRoot, sourceFile, specifier)) {
        sourceCouplings.push({
          filePath: toPosixRelative(workspaceRoot, sourceFile),
          specifier,
        });
      }
    }
  }

  return [...manifestCouplings, ...sidecarManifestCouplings, ...sourceCouplings]
    .filter((reference, index, references) =>
      references.findIndex((candidate) =>
        candidate.filePath === reference.filePath && candidate.specifier === reference.specifier
      ) === index
    );
}

async function scanSidecarProductionUiManifestCouplings(
  workspaceRoot: string,
): Promise<IwsdkWorkspaceSidecarProductionUiCoupling[]> {
  const sidecarManifestPath = path.join(workspaceRoot, "apps/ui-xr-iwsdk-spike/package.json");
  if (!existsSync(sidecarManifestPath)) {
    return [];
  }

  const packageJson = await readPackageJson(sidecarManifestPath);
  return dependencyFields
    .filter((field) => packageJson[field]?.["@openclinxr/ui-xr"])
    .map(() => ({
      filePath: "apps/ui-xr-iwsdk-spike/package.json",
      specifier: "@openclinxr/ui-xr",
    }));
}

function sidecarSpecifierTargetsProductionUi(workspaceRoot: string, sourceFile: string, specifier: string): boolean {
  if (specifier === "@openclinxr/ui-xr" || specifier.startsWith("@openclinxr/ui-xr/")) {
    return true;
  }
  if (specifier.includes("apps/ui-xr/src")) {
    return true;
  }
  if (!specifier.startsWith(".")) {
    return false;
  }

  return pathIsInside(path.join(workspaceRoot, "apps/ui-xr/src"), path.resolve(path.dirname(sourceFile), specifier));
}

function pathIsInside(parentPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(parentPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
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
  const iwsdkPackages = [...lockfileText.matchAll(/(?:^|\n)\s*['"]?\/?(@iwsdk\/[^@'"\s:]+|@meta-quest\/hzdb)@/g)]
    .map((match) => match[1])
    .filter((packageName): packageName is string => Boolean(packageName));
  const blockedPackages = policy.blockedPackages.filter((packageName) => lockfileContainsPackage(lockfileText, packageName));
  const blockedTransitivePackages = [...lockfileText.matchAll(
    /(?:^|\n)\s*['"]?\/?(@img\/sharp-libvips-[^@'"\s:]+)@/g,
  )]
    .map((match) => match[1])
    .filter((packageName): packageName is string => Boolean(packageName));

  return [...new Set([...iwsdkPackages, ...blockedPackages, ...blockedTransitivePackages])];
}

async function scanSidecarLockfileImporter(workspaceRoot: string): Promise<boolean> {
  const lockfilePath = path.join(workspaceRoot, "pnpm-lock.yaml");
  if (!existsSync(lockfilePath)) {
    return false;
  }

  const lockfileText = await readFile(lockfilePath, "utf8");
  return sidecarLockfileImporterBlock(lockfileText) !== undefined;
}

async function scanSidecarLockfilePackageNames(workspaceRoot: string): Promise<string[]> {
  const lockfilePath = path.join(workspaceRoot, "pnpm-lock.yaml");
  if (!existsSync(lockfilePath)) {
    return [];
  }

  const sidecarImporterBlock = sidecarLockfileImporterBlock(await readFile(lockfilePath, "utf8"));
  if (sidecarImporterBlock === undefined) {
    return [];
  }

  const directPackageKeys = [...sidecarImporterBlock.matchAll(
    /^\s+['"]?(@iwsdk\/[^'":\s]+|@meta-quest\/hzdb)['"]?:/gm,
  )]
    .map((match) => match[1])
    .filter((packageName): packageName is string => Boolean(packageName));
  const aliasedSpecifiers = [...sidecarImporterBlock.matchAll(
    /\bspecifier:\s*['"]?(?:npm:)?(@iwsdk\/[^@\s'"]+|@meta-quest\/hzdb)@/g,
  )]
    .map((match) => match[1])
    .filter((packageName): packageName is string => Boolean(packageName));

  return [...new Set([...directPackageKeys, ...aliasedSpecifiers])];
}

function sidecarLockfileImporterBlock(lockfileText: string): string | undefined {
  const lines = lockfileText.split(/\r?\n/);
  const blockLines: string[] = [];
  let foundSidecarImporter = false;

  for (const line of lines) {
    if (/^ {2}['"]?apps\/ui-xr-iwsdk-spike['"]?:\s*$/.test(line)) {
      foundSidecarImporter = true;
      continue;
    }
    if (!foundSidecarImporter) {
      continue;
    }
    if (/^ {0,2}\S/.test(line)) {
      break;
    }
    blockLines.push(line);
  }

  return foundSidecarImporter ? blockLines.join("\n") : undefined;
}

async function scanPackageManagerReferences(
  workspaceRoot: string,
  rootPackage: PackageJson,
): Promise<IwsdkWorkspacePackageManagerReference[]> {
  const references: IwsdkWorkspacePackageManagerReference[] = [];
  collectPackageManagerReferences(rootPackage.pnpm, "package.json", "pnpm", references);
  collectPackageManagerReferences(rootPackage.catalog, "package.json", "catalog", references);
  collectPackageManagerReferences(rootPackage.catalogs, "package.json", "catalogs", references);
  references.push(...await scanWorkspacePackageManagerReferences(workspaceRoot));
  return references;
}

function collectPackageManagerReferences(
  value: unknown,
  manifestPath: string,
  location: string,
  references: IwsdkWorkspacePackageManagerReference[],
): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }

  for (const [key, childValue] of Object.entries(value)) {
    const childLocation = `${location}.${key}`;
    const childSpecifier = typeof childValue === "string" ? childValue : "";
    const packageName = iwsdkPackageNameFromReferenceText(key) ?? iwsdkPackageNameFromReferenceText(childSpecifier);
    if (packageName) {
      references.push({
        manifestPath,
        location: childLocation,
        packageName,
        specifier: childSpecifier,
      });
    }
    collectPackageManagerReferences(childValue, manifestPath, childLocation, references);
  }
}

async function scanWorkspacePackageManagerReferences(
  workspaceRoot: string,
): Promise<IwsdkWorkspacePackageManagerReference[]> {
  const workspaceFilePath = path.join(workspaceRoot, "pnpm-workspace.yaml");
  if (!existsSync(workspaceFilePath)) {
    return [];
  }

  return scanYamlLikePackageManagerReferences(await readFile(workspaceFilePath, "utf8"), "pnpm-workspace.yaml");
}

function scanYamlLikePackageManagerReferences(
  sourceText: string,
  manifestPath: string,
): IwsdkWorkspacePackageManagerReference[] {
  const references: IwsdkWorkspacePackageManagerReference[] = [];
  const stack: Array<{ indent: number; path: string[] }> = [];

  for (const line of sourceText.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#") || line.trimStart().startsWith("-")) {
      continue;
    }

    const match = line.match(/^(\s*)([^:#][^:]*):(?:\s*(.*))?$/);
    if (!match) {
      continue;
    }

    const indent = match[1]?.length ?? 0;
    const key = stripYamlQuotes((match[2] ?? "").trim());
    const value = stripYamlQuotes((match[3] ?? "").trim());
    while (stack.length > 0 && stack[stack.length - 1]?.indent >= indent) {
      stack.pop();
    }

    const pathSegments = [...(stack.at(-1)?.path ?? []), key];
    const packageName = iwsdkPackageNameFromReferenceText(key) ?? iwsdkPackageNameFromReferenceText(value);
    if (packageName) {
      references.push({
        manifestPath,
        location: pathSegments.join("."),
        packageName,
        specifier: value,
      });
    }
    if (!value) {
      stack.push({ indent, path: pathSegments });
    }
  }

  return references;
}

function stripYamlQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function buildPackageManagerControls(rootPackage: PackageJson): IwsdkWorkspacePackageManagerControls {
  const iwsdkVerify = rootPackage.scripts?.["iwsdk:verify"] ?? "";
  const auditScript = rootPackage.scripts?.["security:audit"] ?? "";
  const licenseScript = rootPackage.scripts?.["security:licenses"] ?? "";
  const threeOverride = rootPackage.pnpm?.overrides?.three;

  return {
    workspacePostureInVerify: iwsdkVerify.includes("pnpm iwsdk:workspace:posture"),
    threeOverrideExact: typeof threeOverride === "string" && isExactVersion(threeOverride),
    auditScriptPresent: scriptRunsPnpmAudit(auditScript),
    licenseScriptPresent: scriptRunsLicensePolicyCheck(licenseScript),
  };
}

function scriptRunsPnpmAudit(command: string): boolean {
  return /^(?:[A-Z][A-Z0-9_]*=[^\s]+\s+)*pnpm\s+audit\b/.test(command.trim());
}

function scriptRunsLicensePolicyCheck(command: string): boolean {
  return /^(?:[A-Z][A-Z0-9_]*=[^\s]+\s+)*tsx\s+tools\/openclinxr\/check-license-policy\.ts\b/.test(
    command.trim(),
  );
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

function isIwsdkPackageSpecifier(specifier: string): boolean {
  return /^npm:(@iwsdk\/[^@]+|@meta-quest\/hzdb)@/.test(specifier);
}

function iwsdkPackageNameFromReferenceText(value: string): string | undefined {
  if (isIwsdkPackageName(value)) {
    return value;
  }
  const aliasMatch = value.match(/^npm:(@iwsdk\/[^@]+|@meta-quest\/hzdb)@/);
  if (aliasMatch?.[1]) {
    return aliasMatch[1];
  }
  const keyedPackageMatch = value.match(/^(@iwsdk\/[^@]+|@meta-quest\/hzdb)@/);
  return keyedPackageMatch?.[1];
}

function lockfileContainsPackage(lockfileText: string, packageName: string): boolean {
  const escapedPackageName = escapeRegExp(packageName);
  return new RegExp(`(?:^|\\n)\\s*['"]?(?:${escapedPackageName}:|/${escapedPackageName}@|${escapedPackageName}@)`).test(
    lockfileText,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
