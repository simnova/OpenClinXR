import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { globFiles, readJson } from "../../agent-factory/lib.js";
import {
  buildEncounterRuntimeHandoffAdapterReport,
  type EncounterRuntimeHandoffAdapterReport,
  type EncounterRuntimeHandoffEvidence,
} from "./encounter-runtime-handoff-adapter.js";

/**
 * Production caller for `buildEncounterRuntimeHandoffAdapterReport`.
 *
 * The adapter's launch chain previously ended in a function nobody called
 * (the #612 class). This module is the first non-test caller: it reads the
 * factory's durable local launch-selection report and runs it through the
 * adapter, writing the evidence-gated handoff report under the gitignored
 * `.openclinxr/encounter-publication/` tree where apps/api consumes it via
 * `readRepoGeneratedJsonIfExists` (repo-native JSON seam, no app-side import
 * of tools code).
 *
 * Usage:
 *   pnpm tsx tools/openclinxr/factory/encounter-runtime-handoff-consumer.ts
 *   pnpm tsx tools/openclinxr/factory/encounter-runtime-handoff-consumer.ts --launch-selection docs/openclinxr/encounter-local-launch-selection-peds-asthma-parent-anxiety-2026-05-28.json --output .openclinxr/encounter-publication/encounter-runtime-handoff-peds-asthma-parent-anxiety-2026-08-28.json
 */

const DEFAULT_LAUNCH_SELECTION_GLOB = "docs/openclinxr/encounter-local-launch-selection-*.json";
const DEFAULT_OUTPUT_DIR = ".openclinxr/encounter-publication";
const DEFAULT_OUTPUT_PATH = path.join(
  DEFAULT_OUTPUT_DIR,
  "encounter-runtime-handoff-peds-asthma-parent-anxiety-2026-08-28.json",
);

export function buildEncounterRuntimeHandoffFromLaunchSelectionJson(
  launchSelectionJson: unknown,
  evidence: EncounterRuntimeHandoffEvidence = {},
): EncounterRuntimeHandoffAdapterReport | null {
  if (typeof launchSelectionJson !== "object" || launchSelectionJson === null || Array.isArray(launchSelectionJson)) {
    return null;
  }
  if ((launchSelectionJson as { schemaVersion?: unknown }).schemaVersion !== "openclinxr.encounter-local-launch-selection.v1") {
    return null;
  }
  return buildEncounterRuntimeHandoffAdapterReport(
    launchSelectionJson as Parameters<typeof buildEncounterRuntimeHandoffAdapterReport>[0],
    evidence,
  );
}

async function latestPath(glob: string): Promise<string | null> {
  const matches = await globFiles(glob);
  return matches.sort().at(-1) ?? null;
}

export async function runEncounterRuntimeHandoffConsumerCli(args = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args);
  const launchSelectionPath = options.launchSelectionPath ?? await latestPath(DEFAULT_LAUNCH_SELECTION_GLOB);
  if (!launchSelectionPath) {
    throw new Error("Missing encounter local launch selection report; run `pnpm asset:encounter-launch-selection` first.");
  }
  const launchSelection = await readJson<unknown>(launchSelectionPath);
  const report = buildEncounterRuntimeHandoffFromLaunchSelectionJson(launchSelection);
  if (!report) {
    throw new Error(`${launchSelectionPath} is not an openclinxr.encounter-local-launch-selection.v1 report.`);
  }
  const outputPath = path.resolve(options.outputPath ?? DEFAULT_OUTPUT_PATH);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        ok: true,
        outputPath,
        schemaVersion: report.schemaVersion,
        selectedScenarioId: report.selectedScenarioId,
        status: report.status,
        learnerLaunchAllowed: report.learnerLaunchAllowed,
        localRuntimeHandoffAllowed: report.localRuntimeHandoffAllowed,
        actorRuntimeHandoffCount: report.actorRuntimeHandoffs.length,
        claimBoundary: report.claimBoundary,
      },
      null,
      2,
    ),
  );
}

type CliOptions = { launchSelectionPath?: string; outputPath?: string };

function parseArgs(args: string[]): CliOptions {
  const normalized = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = {};
  for (let index = 0; index < normalized.length; index += 1) {
    const arg = normalized[index];
    const next = normalized[index + 1];
    if ((arg === "--launch-selection" || arg === "--input") && next) {
      options.launchSelectionPath = next;
      index += 1;
    } else if ((arg === "--output" || arg === "-o") && next) {
      options.outputPath = next;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg ?? ""}`);
    }
  }
  return options;
}

const isDirectRun =
  process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isDirectRun) {
  runEncounterRuntimeHandoffConsumerCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
