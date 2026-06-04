import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildIwsdkPackageMetadataDriftPolicies,
  evaluateIwsdkPackageMetadataDriftEvidence,
  type IwsdkPackageMetadataDriftEvidence,
  type IwsdkPackageMetadataDriftPolicy,
  type IwsdkPackageMetadataDriftReadiness,
} from "../../../packages/openclinxr/arena/iwsdk-spike/src/index.js";

type CliOptions = {
  inputPath: string;
  outputPath?: string;
};

export type IwsdkMetadataDriftEvidenceReport = {
  generatedAt: string;
  evidence: IwsdkPackageMetadataDriftEvidence;
  policies: IwsdkPackageMetadataDriftPolicy[];
  verdict: IwsdkPackageMetadataDriftReadiness;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const evidence = JSON.parse(await readFile(options.inputPath, "utf8")) as IwsdkPackageMetadataDriftEvidence;
  const report = buildIwsdkMetadataDriftEvidenceReport({ evidence });
  const payload = `${JSON.stringify(report, null, 2)}\n`;

  if (options.outputPath) {
    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, payload, "utf8");
    console.log(`Wrote ${options.outputPath}`);
  } else {
    console.log(payload.trimEnd());
  }

  if (!report.verdict.readyForUnattendedUse) {
    process.exitCode = 1;
  }
}

export function buildIwsdkMetadataDriftEvidenceReport(input: {
  generatedAt?: string;
  evidence: IwsdkPackageMetadataDriftEvidence;
  policies?: IwsdkPackageMetadataDriftPolicy[];
}): IwsdkMetadataDriftEvidenceReport {
  const policies = input.policies ?? buildIwsdkPackageMetadataDriftPolicies();
  const verdict = evaluateIwsdkPackageMetadataDriftEvidence(input.evidence);

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    evidence: input.evidence,
    policies,
    verdict,
  };
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: Partial<CliOptions> = {};

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--input") {
      options.inputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--output") {
      options.outputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }

  if (!options.inputPath) {
    throw new Error("--input requires a value");
  }

  return options as CliOptions;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
