import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildIwsdkCoreRequiredTransitivePackageNames,
  buildIwsdkCoreTransitivePackageLicenseEvidence,
  buildIwsdkPreInstallPackagePolicy,
  evaluateIwsdkPreInstallPackageSelection,
  type IwsdkPackageSelection,
  type IwsdkPreInstallPackagePolicy,
} from "../../../packages/openclinxr/iwsdk-spike/src/index.js";

type CliOptions = {
  proposalPath?: string;
  outputPath?: string;
  phase2DevtoolsApproved: boolean;
};

export type IwsdkPreInstallProposal = {
  selectedPackages: IwsdkPackageSelection[];
  packageManagerControls: string[];
};

export type IwsdkPreInstallProposalReport = {
  generatedAt: string;
  policy: IwsdkPreInstallPackagePolicy;
  proposal: IwsdkPreInstallProposal;
  verdict: {
    readyToInstallInSidecar: boolean;
    blockers: string[];
    reviewWarnings: string[];
    missingPackageManagerControls: string[];
  };
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const proposal = options.proposalPath
    ? await readProposalFile(options.proposalPath)
    : defaultIwsdkFirstSlicePreInstallProposal();
  const report = buildIwsdkPreInstallProposalReport({
    proposal,
    phase2DevtoolsApproved: options.phase2DevtoolsApproved,
  });
  const payload = `${JSON.stringify(report, null, 2)}\n`;

  if (options.outputPath) {
    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, payload, "utf8");
    console.log(`Wrote ${options.outputPath}`);
  } else {
    console.log(payload.trimEnd());
  }

  if (!report.verdict.readyToInstallInSidecar) {
    process.exitCode = 1;
  }
}

export function defaultIwsdkFirstSlicePreInstallProposal(
  policy: IwsdkPreInstallPackagePolicy = buildIwsdkPreInstallPackagePolicy(),
): IwsdkPreInstallProposal {
  return {
    selectedPackages: [
      {
        name: "@iwsdk/core",
        version: "0.3.1",
        license: "MIT",
        transitivePackages: buildIwsdkCoreRequiredTransitivePackageNames(),
        transitivePackageLicenses: buildIwsdkCoreTransitivePackageLicenseEvidence(),
      },
      { name: "@iwsdk/xr-input", version: "0.3.1", license: "MIT", transitivePackages: [] },
    ],
    packageManagerControls: [...policy.requiredPackageManagerControls],
  };
}

export function buildIwsdkPreInstallProposalReport(input: {
  generatedAt?: string;
  proposal: IwsdkPreInstallProposal;
  policy?: IwsdkPreInstallPackagePolicy;
  phase2DevtoolsApproved?: boolean;
}): IwsdkPreInstallProposalReport {
  const policy = input.policy ?? buildIwsdkPreInstallPackagePolicy();
  const effectivePolicy = input.phase2DevtoolsApproved ? phase2DevtoolsPolicy(policy) : policy;
  const selectionResult = evaluateIwsdkPreInstallPackageSelection(input.proposal.selectedPackages, effectivePolicy);
  const missingPackageManagerControls = effectivePolicy.requiredPackageManagerControls.filter(
    (control) => !input.proposal.packageManagerControls.includes(control),
  );
  const blockers = [
    ...selectionResult.blockers,
    ...missingPackageManagerControls.map((control) => `missing_package_manager_control_${control}`),
  ];

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    policy: effectivePolicy,
    proposal: input.proposal,
    verdict: {
      readyToInstallInSidecar: blockers.length === 0 && selectionResult.reviewWarnings.length === 0,
      blockers,
      reviewWarnings: selectionResult.reviewWarnings,
      missingPackageManagerControls,
    },
  };
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = { phase2DevtoolsApproved: false };

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--proposal") {
      options.proposalPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--output") {
      options.outputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--approved-phase2-devtools") {
      options.phase2DevtoolsApproved = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }

  return options;
}

function phase2DevtoolsPolicy(policy: IwsdkPreInstallPackagePolicy): IwsdkPreInstallPackagePolicy {
  return {
    ...policy,
    allowedFirstSlicePackages: [...new Set([...policy.allowedFirstSlicePackages, "@iwsdk/vite-plugin-dev"])],
    reviewRequiredPackages: policy.reviewRequiredPackages.filter((packageName) =>
      packageName !== "@iwsdk/vite-plugin-dev"
    ),
  };
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

async function readProposalFile(filePath: string): Promise<IwsdkPreInstallProposal> {
  return JSON.parse(await readFile(filePath, "utf8")) as IwsdkPreInstallProposal;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
