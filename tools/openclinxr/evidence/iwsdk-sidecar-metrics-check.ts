import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  evaluateIwsdkSpikeMetrics,
  type IwsdkSpikeMetricReadiness,
  type IwsdkSpikeMetrics,
} from "../../../packages/openclinxr/iwsdk-spike/src/index.js";

type CliOptions = {
  inputPath?: string;
  outputPath?: string;
};

export type IwsdkSidecarMetricsReport = {
  generatedAt: string;
  inputFile?: string;
  metrics: IwsdkSpikeMetrics;
  result: IwsdkSpikeMetricReadiness;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.inputPath) {
    throw new Error("--input is required");
  }

  const metrics = JSON.parse(await readFile(options.inputPath, "utf8")) as IwsdkSpikeMetrics;
  const report = buildIwsdkSidecarMetricsReport({
    inputFile: options.inputPath,
    metrics,
  });
  const payload = `${JSON.stringify(report, null, 2)}\n`;

  if (options.outputPath) {
    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, payload, "utf8");
    console.log(`Wrote ${options.outputPath}`);
  } else {
    console.log(payload.trimEnd());
  }

  if (!report.result.readyForProductionRuntime) {
    process.exitCode = 1;
  }
}

export function buildIwsdkSidecarMetricsReport(input: {
  generatedAt?: string;
  inputFile?: string;
  metrics: IwsdkSpikeMetrics;
}): IwsdkSidecarMetricsReport {
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    inputFile: input.inputFile,
    metrics: input.metrics,
    result: evaluateIwsdkSpikeMetrics(input.metrics),
  };
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = {};

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

  return options;
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
