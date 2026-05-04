import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import fg from "fast-glob";
import {
  buildIwsdkCoreRequiredTransitivePackageNames,
  buildIwsdkCoreTransitivePackageLicenseEvidence,
  buildIwsdkPreInstallPackagePolicy,
  buildIwsdkSidecarReadinessContract,
  buildIwsdkViteAiDevConfigContract,
  evaluateIwsdkAgentToolingEvidence,
  evaluateIwsdkPreInstallPackageSelection,
  evaluateIwsdkSpikeMetrics,
  type IwsdkAgentToolingEvidenceReadiness,
  type IwsdkPreInstallPackagePolicy,
  type IwsdkPreInstallPackageSelectionResult,
  type IwsdkSidecarReadinessContract,
  type IwsdkSpikeMetricReadiness,
  type IwsdkViteAiDevConfigContract,
} from "../../packages/openclinxr/iwsdk-spike/src/index.js";

type CliOptions = {
  outputPath?: string;
  validateLatestPattern?: string;
};

export type IwsdkEvidenceContractReport = {
  generatedAt: string;
  status: "contract_only";
  sidecar: IwsdkSidecarReadinessContract;
  preinstall: {
    policy: IwsdkPreInstallPackagePolicy;
    defaultFirstSliceReady: boolean;
    result: IwsdkPreInstallPackageSelectionResult;
  };
  viteAiDevConfig: IwsdkViteAiDevConfigContract;
  agentTooling: IwsdkAgentToolingEvidenceReadiness;
  productionRuntime: IwsdkSpikeMetricReadiness;
  verdict: {
    readyForInstallBackedSidecar: boolean;
    readyForAgentTooling: boolean;
    readyForProductionRuntime: boolean;
    blockers: string[];
  };
};

export type IwsdkEvidenceContractValidationResult = { ok: true } | { ok: false; errors: string[] };

const defaultValidateLatestPattern = "docs/openclinxr/iwsdk-evidence-contract-*.json";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.validateLatestPattern) {
    await validateLatestReportFile(options.validateLatestPattern);
    return;
  }

  const report = buildIwsdkEvidenceContractReport();
  const payload = `${JSON.stringify(report, null, 2)}\n`;

  if (options.outputPath) {
    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, payload, "utf8");
    console.log(`Wrote ${options.outputPath}`);
  } else {
    console.log(payload.trimEnd());
  }

  if (report.verdict.blockers.length > 0) {
    process.exitCode = 1;
  }
}

async function validateLatestReportFile(pattern: string): Promise<void> {
  const files = (await fg(pattern, { onlyFiles: true })).sort();
  const latestFile = files.at(-1);
  if (!latestFile) {
    throw new Error(`No IWSDK evidence contract snapshots matched ${pattern}`);
  }

  const value = JSON.parse(await readFile(latestFile, "utf8")) as unknown;
  const validation = validateIwsdkEvidenceContractReport(value);
  if (!validation.ok) {
    for (const error of validation.errors) {
      console.error(error);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Validated ${latestFile}`);
}

export function buildIwsdkEvidenceContractReport(input: {
  generatedAt?: string;
} = {}): IwsdkEvidenceContractReport {
  const sidecar = buildIwsdkSidecarReadinessContract();
  const preinstallPolicy = buildIwsdkPreInstallPackagePolicy();
  const preinstallResult = evaluateIwsdkPreInstallPackageSelection([
    {
      name: "@iwsdk/core",
      version: "0.3.1",
      license: "MIT",
      transitivePackages: buildIwsdkCoreRequiredTransitivePackageNames(),
      transitivePackageLicenses: buildIwsdkCoreTransitivePackageLicenseEvidence(),
    },
    { name: "@iwsdk/xr-input", version: "0.3.1", license: "MIT", transitivePackages: [] },
  ], preinstallPolicy);
  const agentTooling = evaluateIwsdkAgentToolingEvidence({
    adapterSyncRecorded: false,
    toolCount: 0,
    coveredCategories: [],
    validatedSmokeTools: [],
    optionalServerActions: [],
  });
  const productionRuntime = evaluateIwsdkSpikeMetrics({});
  const sidecarBlockers = sidecar.createAppOnlyAfter.map((blocker) => `sidecar:${blocker}`);
  const blockers = unique([
    ...sidecarBlockers,
    ...preinstallResult.blockers.map((blocker) => `preinstall:${blocker}`),
    ...preinstallResult.reviewWarnings.map((blocker) => `preinstall_review:${blocker}`),
    ...agentTooling.blockers.map((blocker) => `agent_tooling:${blocker}`),
    ...productionRuntime.blockers.map((blocker) => `production_runtime:${blocker}`),
  ]);

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: "contract_only",
    sidecar,
    preinstall: {
      policy: preinstallPolicy,
      defaultFirstSliceReady: preinstallResult.readyToInstallInSidecar,
      result: preinstallResult,
    },
    viteAiDevConfig: buildIwsdkViteAiDevConfigContract(),
    agentTooling,
    productionRuntime,
    verdict: {
      readyForInstallBackedSidecar: sidecarBlockers.length === 0 && preinstallResult.readyToInstallInSidecar,
      readyForAgentTooling: agentTooling.readyForAgentTooling,
      readyForProductionRuntime: productionRuntime.readyForProductionRuntime,
      blockers,
    },
  };
}

export function validateIwsdkEvidenceContractReport(value: unknown): IwsdkEvidenceContractValidationResult {
  const errors: string[] = [];

  requireObject(value, "", errors);
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  requireString(readAt(value, ["generatedAt"]), "/generatedAt", errors);
  requireLiteral(readAt(value, ["status"]), "contract_only", "/status", errors);
  requireObject(readAt(value, ["sidecar"]), "/sidecar", errors);
  requireObject(readAt(value, ["preinstall"]), "/preinstall", errors);
  requireObject(readAt(value, ["viteAiDevConfig"]), "/viteAiDevConfig", errors);
  requireObject(readAt(value, ["agentTooling"]), "/agentTooling", errors);
  requireObject(readAt(value, ["productionRuntime"]), "/productionRuntime", errors);
  requireObject(readAt(value, ["verdict"]), "/verdict", errors);

  requireObject(readAt(value, ["preinstall", "policy"]), "/preinstall/policy", errors);
  requireBoolean(readAt(value, ["preinstall", "policy", "exactVersionRequired"]), "/preinstall/policy/exactVersionRequired", errors);
  requireStringArray(readAt(value, ["preinstall", "policy", "allowedFirstSlicePackages"]), "/preinstall/policy/allowedFirstSlicePackages", errors);
  requireStringArray(readAt(value, ["preinstall", "policy", "reviewRequiredPackages"]), "/preinstall/policy/reviewRequiredPackages", errors);
  requireStringArray(readAt(value, ["preinstall", "policy", "blockedPackages"]), "/preinstall/policy/blockedPackages", errors);
  requireStringArray(readAt(value, ["preinstall", "policy", "blockedTransitivePackages"]), "/preinstall/policy/blockedTransitivePackages", errors);
  requireStringArray(readAt(value, ["preinstall", "policy", "blockedLicenseExpressions"]), "/preinstall/policy/blockedLicenseExpressions", errors);
  requireStringArray(readAt(value, ["preinstall", "policy", "requiredPackageManagerControls"]), "/preinstall/policy/requiredPackageManagerControls", errors);
  requireBoolean(readAt(value, ["preinstall", "defaultFirstSliceReady"]), "/preinstall/defaultFirstSliceReady", errors);
  requireObject(readAt(value, ["preinstall", "result"]), "/preinstall/result", errors);
  requireBoolean(readAt(value, ["preinstall", "result", "readyToInstallInSidecar"]), "/preinstall/result/readyToInstallInSidecar", errors);
  requireStringArray(readAt(value, ["preinstall", "result", "blockers"]), "/preinstall/result/blockers", errors);
  requireStringArray(readAt(value, ["preinstall", "result", "reviewWarnings"]), "/preinstall/result/reviewWarnings", errors);

  requireLiteral(readAt(value, ["viteAiDevConfig", "status"]), "phase_2_after_sidecar_shell", "/viteAiDevConfig/status", errors);
  requireStringArray(readAt(value, ["viteAiDevConfig", "sourceRecordIds"]), "/viteAiDevConfig/sourceRecordIds", errors);
  requireLiteral(readAt(value, ["viteAiDevConfig", "packageName"]), "@iwsdk/vite-plugin-dev", "/viteAiDevConfig/packageName", errors);
  requireObject(readAt(value, ["viteAiDevConfig", "requiredOptions"]), "/viteAiDevConfig/requiredOptions", errors);
  requireLiteral(readAt(value, ["viteAiDevConfig", "requiredOptions", "emulatorDevice"]), "metaQuest3", "/viteAiDevConfig/requiredOptions/emulatorDevice", errors);
  requireLiteral(readAt(value, ["viteAiDevConfig", "requiredOptions", "aiMode"]), "agent", "/viteAiDevConfig/requiredOptions/aiMode", errors);
  requireStringArray(readAt(value, ["viteAiDevConfig", "requiredOptions", "aiTools"]), "/viteAiDevConfig/requiredOptions/aiTools", errors);
  requireObject(readAt(value, ["viteAiDevConfig", "requiredOptions", "screenshotSize"]), "/viteAiDevConfig/requiredOptions/screenshotSize", errors);
  requireNumber(readAt(value, ["viteAiDevConfig", "requiredOptions", "screenshotSize", "width"]), "/viteAiDevConfig/requiredOptions/screenshotSize/width", errors);
  requireNumber(readAt(value, ["viteAiDevConfig", "requiredOptions", "screenshotSize", "height"]), "/viteAiDevConfig/requiredOptions/screenshotSize/height", errors);
  requireBoolean(readAt(value, ["viteAiDevConfig", "requiredOptions", "verbose"]), "/viteAiDevConfig/requiredOptions/verbose", errors);
  requireString(readAt(value, ["viteAiDevConfig", "viteConfigSnippet"]), "/viteAiDevConfig/viteConfigSnippet", errors);
  requireStringArray(readAt(value, ["viteAiDevConfig", "requiredEvidence"]), "/viteAiDevConfig/requiredEvidence", errors);
  requireStringArray(readAt(value, ["viteAiDevConfig", "blockedUntil"]), "/viteAiDevConfig/blockedUntil", errors);
  requireStringArray(readAt(value, ["viteAiDevConfig", "doNotRunUnattended"]), "/viteAiDevConfig/doNotRunUnattended", errors);

  requireBoolean(readAt(value, ["agentTooling", "readyForAgentTooling"]), "/agentTooling/readyForAgentTooling", errors);
  requireStringArray(readAt(value, ["agentTooling", "blockers"]), "/agentTooling/blockers", errors);
  requireBoolean(readAt(value, ["productionRuntime", "readyForCommittedSpike"]), "/productionRuntime/readyForCommittedSpike", errors);
  requireBoolean(readAt(value, ["productionRuntime", "readyForProductionRuntime"]), "/productionRuntime/readyForProductionRuntime", errors);
  requireStringArray(readAt(value, ["productionRuntime", "blockers"]), "/productionRuntime/blockers", errors);

  requireBoolean(readAt(value, ["verdict", "readyForInstallBackedSidecar"]), "/verdict/readyForInstallBackedSidecar", errors);
  requireBoolean(readAt(value, ["verdict", "readyForAgentTooling"]), "/verdict/readyForAgentTooling", errors);
  requireBoolean(readAt(value, ["verdict", "readyForProductionRuntime"]), "/verdict/readyForProductionRuntime", errors);
  requireStringArray(readAt(value, ["verdict", "blockers"]), "/verdict/blockers", errors);

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
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
    if (arg === "--validate-latest") {
      const possiblePattern = normalizedArgs[index + 1];
      if (possiblePattern && !possiblePattern.startsWith("--")) {
        options.validateLatestPattern = possiblePattern;
        index += 1;
      } else {
        options.validateLatestPattern = defaultValidateLatestPattern;
      }
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

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function readAt(value: unknown, pathParts: string[]): unknown {
  return pathParts.reduce<unknown>((current, pathPart) => {
    if (!isRecord(current)) {
      return undefined;
    }
    return current[pathPart];
  }, value);
}

function requireObject(value: unknown, pathName: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${pathName || "/"} must be object`);
  }
}

function requireLiteral(value: unknown, literal: string, pathName: string, errors: string[]): void {
  if (value !== literal) {
    errors.push(`${pathName} must be ${JSON.stringify(literal)}`);
  }
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

function requireNumber(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${pathName} must be finite number`);
  }
}

function requireStringArray(value: unknown, pathName: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${pathName} must be array`);
    return;
  }

  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.length === 0) {
      errors.push(`${pathName}/${index} must be non-empty string`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
