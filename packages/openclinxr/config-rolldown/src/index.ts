import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import type { LogLevel, LogOrStringHandler, RollupLog } from "rolldown";
import type { RolldownOptions } from "rolldown";

type AliasMap = Record<string, string>;
type WorkspacePackageMap = Map<string, string>;
type ExternalDependency = {
  pkg: string;
  fromDir: string;
};

export type OpenClinXrRolldownConfig = {
  input: string;
  platform: "node";
  treeshake: true;
  external: Array<string | RegExp>;
  resolve: {
    alias: Record<string, string>;
  };
  transform: {
    define: {
      __dirname: "import.meta.dirname";
    };
  };
  output: {
    dir: string;
    format: "esm";
    sourcemap: true;
    banner: string;
  };
} & RolldownOptions;

export type OpenClinXrRolldownConfigOptions = {
  repoRoot: string;
  appPackageName: string;
  input?: string;
  outputDir?: string;
  applicationNamespaces?: string[];
  additionalExternal?: Array<string | RegExp>;
  suppressEvalWarningsFor?: string[];
};

export type PrepareOpenClinXrAzureFunctionsDeployOptions = {
  appDir?: string;
  deployDirName?: string;
  bundleEntryRelativePath?: string;
  hostJsonFilename?: string;
  funcIgnoreFilename?: string;
};

const nodeRequire = createRequire(import.meta.url);
const azureFunctionsRequireBanner = `import { createRequire as __createRequire } from 'node:module';
globalThis.require = __createRequire(import.meta.url);`;

export async function createOpenClinXrAzureFunctionsRolldownConfig(
  options: OpenClinXrRolldownConfigOptions,
): Promise<OpenClinXrRolldownConfig> {
  const {
    repoRoot,
    appPackageName,
    input = "./dist/index.js",
    outputDir = "deploy/dist",
    applicationNamespaces = ["@openclinxr/"],
    additionalExternal = [],
    suppressEvalWarningsFor = ["@protobufjs/inquire/index.js"],
  } = options;

  return {
    input,
    platform: "node",
    treeshake: true,
    external: [/^node:/, "@azure/functions-core", ...additionalExternal],
    resolve: {
      alias: await buildOpenClinXrCjsAliasMap({
        repoRoot,
        appPackageName,
        workspaceNamespaces: applicationNamespaces,
      }),
    },
    transform: {
      define: {
        __dirname: "import.meta.dirname",
      },
    },
    output: {
      dir: outputDir,
      format: "esm",
      sourcemap: true,
      banner: azureFunctionsRequireBanner,
    },
    onLog(level: LogLevel, log: RollupLog, defaultHandler: LogOrStringHandler) {
      if (
        level === "warn" &&
        log.code === "EVAL" &&
        typeof log.message === "string" &&
        suppressEvalWarningsFor.some((warning) => log.message.includes(warning))
      ) {
        return;
      }

      defaultHandler(level, log);
    },
  };
}

export async function buildOpenClinXrCjsAliasMap(options: {
  repoRoot: string;
  appPackageName: string;
  workspaceNamespaces?: string[];
}): Promise<AliasMap> {
  const { repoRoot, appPackageName, workspaceNamespaces = ["@openclinxr/"] } = options;
  const workspacePackages = await collectWorkspacePackages(repoRoot);
  const externalDeps = await collectExternalDeps(appPackageName, workspacePackages, workspaceNamespaces);
  const alias: AliasMap = {};

  for (const { pkg, fromDir } of externalDeps) {
    if (alias[pkg]) {
      continue;
    }

    const resolved = resolveDependency(pkg, fromDir, repoRoot);
    if (resolved) {
      alias[pkg] = resolved;
    }
  }

  return alias;
}

export async function prepareOpenClinXrAzureFunctionsDeploy(
  options: PrepareOpenClinXrAzureFunctionsDeployOptions = {},
): Promise<void> {
  const {
    appDir = process.cwd(),
    deployDirName = "deploy",
    bundleEntryRelativePath = "dist/index.js",
    hostJsonFilename = "host.json",
    funcIgnoreFilename = ".funcignore",
  } = options;

  const deployDir = path.join(appDir, deployDirName);
  const bundleEntry = path.join(deployDir, bundleEntryRelativePath);
  const packageJsonPath = path.join(appDir, "package.json");
  const hostJsonPath = path.join(appDir, hostJsonFilename);

  await fs.access(bundleEntry).catch(() => {
    throw new Error(`Bundled entry not found at ${bundleEntry}. Run the app build before prepare:deploy.`);
  });

  await fs.mkdir(deployDir, { recursive: true });

  await Promise.all([
    fs.copyFile(hostJsonPath, path.join(deployDir, hostJsonFilename)),
    copyFileIfPresent(path.join(appDir, funcIgnoreFilename), path.join(deployDir, funcIgnoreFilename)),
    writeDeployPackageJson(packageJsonPath, path.join(deployDir, "package.json")),
  ]);
}

export function summarizeRolldownAdoption() {
  return {
    candidateCellixPackage: "@cellix/config-rolldown",
    localPackage: "@openclinxr/config-rolldown",
    status: "workspace_alias_and_deploy_prep_spike",
    reason:
      "OpenClinXR keeps a project-owned Rolldown wrapper while validating latest Rolldown compatibility, workspace alias resolution, and Azure Functions deploy artifact prep against its own package layout.",
  } as const;
}

async function writeDeployPackageJson(packageJsonPath: string, deployPackageJsonPath: string): Promise<void> {
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8")) as {
    name: string;
    version: string;
  };
  const deployPackageJson = {
    name: packageJson.name,
    version: packageJson.version,
    private: true,
    type: "module",
    main: "dist/index.js",
  };

  await fs.writeFile(deployPackageJsonPath, `${JSON.stringify(deployPackageJson, null, 2)}\n`);
}

async function copyFileIfPresent(fromPath: string, toPath: string): Promise<void> {
  await fs.copyFile(fromPath, toPath).catch((error: unknown) => {
    if (isNodeErrnoException(error) && error.code === "ENOENT") {
      return;
    }

    throw error;
  });
}

async function collectExternalDeps(
  pkgName: string,
  workspacePackages: WorkspacePackageMap,
  workspaceNamespaces: string[],
  visited = new Set<string>(),
): Promise<ExternalDependency[]> {
  if (visited.has(pkgName)) {
    return [];
  }

  visited.add(pkgName);

  const pkgDir = workspacePackages.get(pkgName);
  if (!pkgDir) {
    throw new Error(`Workspace package not found: ${pkgName}`);
  }

  const pkgJson = JSON.parse(await fs.readFile(path.join(pkgDir, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  const deps = Object.keys({
    ...pkgJson.dependencies,
    ...pkgJson.optionalDependencies,
  });
  const results: ExternalDependency[] = [];

  for (const dep of deps) {
    if (isWorkspacePackage(dep, workspaceNamespaces)) {
      results.push(...(await collectExternalDeps(dep, workspacePackages, workspaceNamespaces, visited)));
      continue;
    }

    results.push({ pkg: dep, fromDir: pkgDir });
  }

  return results;
}

async function collectWorkspacePackages(repoRoot: string): Promise<WorkspacePackageMap> {
  const packageMap: WorkspacePackageMap = new Map();

  for (const root of [path.join(repoRoot, "apps"), path.join(repoRoot, "packages")]) {
    const files = await findPackageJsonFiles(root);
    for (const file of files) {
      const { name } = JSON.parse(await fs.readFile(file, "utf8")) as { name?: string };
      if (typeof name === "string") {
        packageMap.set(name, path.dirname(file));
      }
    }
  }

  return packageMap;
}

async function findPackageJsonFiles(rootDir: string): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch((error: unknown) => {
    if (isNodeErrnoException(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  });
  const results: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory() && !skipDir(entry.name)) {
      results.push(...(await findPackageJsonFiles(entryPath)));
    } else if (entry.isFile() && entry.name === "package.json") {
      results.push(entryPath);
    }
  }

  return results;
}

function resolveDependency(pkg: string, fromDir: string, repoRoot: string): string | undefined {
  try {
    return nodeRequire.resolve(pkg, { paths: [fromDir, repoRoot] });
  } catch {
    return undefined;
  }
}

function skipDir(name: string): boolean {
  return ["node_modules", "dist", "build", "deploy", "coverage", ".turbo"].includes(name);
}

function isWorkspacePackage(name: string, workspaceNamespaces: string[]): boolean {
  return workspaceNamespaces.some((namespace) => name.startsWith(namespace));
}

function isNodeErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
