import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildModelVettingReportFromAnnyPreflight,
  validateModelVettingReport,
  type AnnyLikePreflightReport,
} from "../../../packages/openclinxr/arena/model-vetting/src/index.js";
import { globFiles, readJson } from "../../agent-factory/lib.js";

const defaultOutputPath = `docs/openclinxr/model-vetting-report-peds-asthma-parent-anxiety-${new Date().toISOString().slice(0, 10)}.json`;

type CliOptions = {
  outputPath?: string;
  sourceReportPath?: string;
  validateLatest: boolean;
  validatePath?: string;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestPath("docs/openclinxr/model-vetting-report-*.json");
    if (!validatePath) throw new Error("Missing model-vetting report to validate.");
    const validation = validateModelVettingReport(await readJson<unknown>(validatePath));
    if (validation.ok) {
      console.log(`Validated ${validatePath}`);
      return;
    }
    for (const error of validation.errors) console.error(error);
    process.exitCode = 1;
    return;
  }

  const sourceReportPath = options.sourceReportPath
    ?? await latestPath("docs/openclinxr/anny-candidate-preflight-*.json");
  if (!sourceReportPath) throw new Error("Missing Anny candidate preflight report source.");
  const sourceReport = await readJson<AnnyLikePreflightReport>(sourceReportPath);
  const report = buildModelVettingReportFromAnnyPreflight({ sourceReport });
  const outputPath = options.outputPath ?? defaultOutputPath;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outputPath}`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { validateLatest: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--output") options.outputPath = requireNext(args, ++index, arg);
    else if (arg === "--source-report") options.sourceReportPath = requireNext(args, ++index, arg);
    else if (arg === "--validate") options.validatePath = requireNext(args, ++index, arg);
    else if (arg === "--validate-latest") options.validateLatest = true;
  }
  return options;
}

function requireNext(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

async function latestPath(pattern: string): Promise<string | undefined> {
  const paths = await globFiles(pattern);
  return paths.sort().at(-1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
