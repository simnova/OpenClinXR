import { writeFile } from "node:fs/promises";
import { buildAgentLoopArtifact, canonicalAgentLoopArtifact, defaultAgentLoopOutputPath } from "./agent-loop-plan.js";
import { requireArgs } from "./lib.js";

type CliOptions = {
  iterationDir: string;
  previousDir?: string;
  dryRun: boolean;
  outputPath?: string;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const plan = await buildAgentLoopArtifact(options);

  if (options.dryRun) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  const outputPath = options.outputPath ?? defaultAgentLoopOutputPath(options.iterationDir);
  await writeFile(outputPath, canonicalAgentLoopArtifact(plan), "utf8");
  console.log(`Wrote ${outputPath}`);
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  requireArgs(normalizedArgs, "pnpm agent:loop -- <iteration-dir> [--previous <iteration-dir>] [--output <path>] [--dry-run]");
  const [iterationDir, ...rest] = normalizedArgs;
  const options: CliOptions = {
    iterationDir,
    dryRun: false,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--previous") {
      const previousDir = rest[index + 1];
      if (!previousDir) {
        throw new Error("--previous requires an iteration directory");
      }
      options.previousDir = previousDir;
      index += 1;
      continue;
    }
    if (arg === "--output") {
      const outputPath = rest[index + 1];
      if (!outputPath) {
        throw new Error("--output requires a file path");
      }
      options.outputPath = outputPath;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }

  return options;
}

await main();
