import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildIwsdkPreInstallPackagePolicy,
  buildIwsdkSidecarReadinessContract,
  evaluateIwsdkAgentToolingEvidence,
  evaluateIwsdkPreInstallPackageSelection,
  evaluateIwsdkSpikeMetrics,
  type IwsdkAgentToolingEvidenceReadiness,
  type IwsdkPreInstallPackageSelectionResult,
  type IwsdkSidecarReadinessContract,
  type IwsdkSpikeMetricReadiness,
} from "../../packages/openclinxr/iwsdk-spike/src/index.js";

type CliOptions = {
  outputPath?: string;
};

export type IwsdkEvidenceContractReport = {
  generatedAt: string;
  status: "contract_only";
  sidecar: IwsdkSidecarReadinessContract;
  preinstall: {
    defaultFirstSliceReady: boolean;
    result: IwsdkPreInstallPackageSelectionResult;
  };
  agentTooling: IwsdkAgentToolingEvidenceReadiness;
  productionRuntime: IwsdkSpikeMetricReadiness;
  verdict: {
    readyForInstallBackedSidecar: boolean;
    readyForAgentTooling: boolean;
    readyForProductionRuntime: boolean;
    blockers: string[];
  };
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
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

export function buildIwsdkEvidenceContractReport(input: {
  generatedAt?: string;
} = {}): IwsdkEvidenceContractReport {
  const sidecar = buildIwsdkSidecarReadinessContract();
  const preinstallResult = evaluateIwsdkPreInstallPackageSelection([
    { name: "@iwsdk/core", version: "0.3.1", license: "MIT", transitivePackages: ["three"] },
    { name: "@iwsdk/xr-input", version: "0.3.1", license: "MIT", transitivePackages: [] },
  ], buildIwsdkPreInstallPackagePolicy());
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
      defaultFirstSliceReady: preinstallResult.readyToInstallInSidecar,
      result: preinstallResult,
    },
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

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
