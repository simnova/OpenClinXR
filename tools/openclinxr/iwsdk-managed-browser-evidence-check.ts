import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildIwsdkManagedBrowserEvidenceContract,
  evaluateIwsdkManagedBrowserEvidence,
  type IwsdkManagedBrowserEvidence,
  type IwsdkManagedBrowserEvidenceContract,
} from "../../packages/openclinxr/iwsdk-spike/src/index.js";

type CliOptions = {
  inputPath: string;
  outputPath?: string;
};

export type IwsdkManagedBrowserEvidenceReport = {
  generatedAt: string;
  evidence: IwsdkManagedBrowserEvidence;
  contract: IwsdkManagedBrowserEvidenceContract;
  verdict: {
    ready: boolean;
    blockers: string[];
  };
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const evidence = JSON.parse(await readFile(options.inputPath, "utf8")) as IwsdkManagedBrowserEvidence;
  const report = buildIwsdkManagedBrowserEvidenceReport({ evidence });
  const payload = `${JSON.stringify(report, null, 2)}\n`;

  if (options.outputPath) {
    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, payload, "utf8");
    console.log(`Wrote ${options.outputPath}`);
  } else {
    console.log(payload.trimEnd());
  }

  if (!report.verdict.ready) {
    process.exitCode = 1;
  }
}

export function buildIwsdkManagedBrowserEvidenceReport(input: {
  generatedAt?: string;
  evidence: IwsdkManagedBrowserEvidence;
  contract?: IwsdkManagedBrowserEvidenceContract;
}): IwsdkManagedBrowserEvidenceReport {
  const contract = input.contract ?? buildIwsdkManagedBrowserEvidenceContract();
  const verdict = evaluateIwsdkManagedBrowserEvidence(input.evidence);

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    evidence: input.evidence,
    contract,
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
