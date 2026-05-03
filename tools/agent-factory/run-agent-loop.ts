import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createAgentLoopPlan,
  normalizeLegacyScorecard,
  type AgentMemoryEntry,
  type AgentLoopPlan,
  type LegacyScorecard,
} from "../../packages/agent-loop/src/index.js";
import { globFiles, iterationScorecardPaths, readJson, requireArgs } from "./lib.js";

type MemoryIndexFile = {
  entries: Array<{
    id: string;
    agent_id: string;
    team: AgentMemoryEntry["team"];
    topic: string;
    summary: string;
    confidence: number;
    iteration: number;
    status: AgentMemoryEntry["status"];
    source_ids?: string[];
    supersedes?: string[];
  }>;
};

type CliOptions = {
  iterationDir: string;
  previousDir?: string;
  dryRun: boolean;
  outputPath?: string;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const scorecardPath = await selectScorecardPath(options.iterationDir);
  const scorecard = normalizeLegacyScorecard(await readJson<LegacyScorecard>(scorecardPath));
  const previousScorecard = options.previousDir ? normalizeLegacyScorecard(await readJson<LegacyScorecard>(await selectScorecardPath(options.previousDir))) : undefined;
  const memoryEntries = await loadMemoryEntries();

  const plan = createAgentLoopPlan({
    iterationId: scorecard.iterationId,
    candidatePlanTitle: await titleFor(options.iterationDir),
    scorecard,
    previousScorecard,
    memoryEntries,
  });

  if (options.dryRun) {
    console.log(JSON.stringify(toJsonPlan(plan), null, 2));
    return;
  }

  const outputPath = options.outputPath ?? path.join(options.iterationDir, "09-agent-loop-plan.json");
  await writeFile(outputPath, `${JSON.stringify(toJsonPlan(plan), null, 2)}\n`, "utf8");
  console.log(`Wrote ${outputPath}`);
}

function parseArgs(args: string[]): CliOptions {
  requireArgs(args, "npm run agent:loop -- <iteration-dir> [--previous <iteration-dir>] [--output <path>] [--dry-run]");
  const [iterationDir, ...rest] = args;
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

async function selectScorecardPath(iterationDir: string): Promise<string> {
  const scorecards = await iterationScorecardPaths(iterationDir);
  if (scorecards.length === 0) {
    throw new Error(`No scorecards found in ${iterationDir}`);
  }

  const preferredNames = ["06-leadership-scorecard.json", "04-adversarial-scorecard.json", "02-core-scorecard.json"];
  for (const fileName of preferredNames) {
    const found = scorecards.find((file) => path.basename(file) === fileName);
    if (found) {
      return found;
    }
  }

  return scorecards.sort().at(-1) ?? scorecards[0];
}

async function loadMemoryEntries(): Promise<AgentMemoryEntry[]> {
  const memoryIndex = await readJson<MemoryIndexFile>(".agent-factory/memory-index.json");
  return memoryIndex.entries.map((entry) => {
    const mapped: AgentMemoryEntry = {
      id: entry.id,
      agentId: entry.agent_id,
      team: entry.team,
      topic: entry.topic,
      summary: entry.summary,
      confidence: entry.confidence,
      iteration: entry.iteration,
      status: entry.status,
    };
    if (entry.source_ids) {
      mapped.sourceIds = entry.source_ids;
    }
    if (entry.supersedes) {
      mapped.supersedes = entry.supersedes;
    }
    return mapped;
  });
}

async function titleFor(iterationDir: string): Promise<string> {
  const briefPath = path.join(iterationDir, "00-brief.md");
  try {
    const brief = await readFile(briefPath, "utf8");
    return brief.split("\n").find((line) => line.startsWith("# "))?.replace(/^#\s+/, "").trim() || path.basename(iterationDir);
  } catch {
    return path.basename(iterationDir);
  }
}

function toJsonPlan(plan: AgentLoopPlan): unknown {
  return {
    iterationId: plan.iterationId,
    candidatePlanTitle: plan.candidatePlanTitle,
    rosterVersion: plan.rosterVersion,
    maturityDelta: plan.maturityDelta,
    leadershipGate: plan.leadershipGate,
    nextActions: plan.nextActions,
    workOrders: plan.workOrders,
    memoryRetrieval: {
      activeEntryCount: plan.memoryIndex.activeEntries.length,
      topics: [...plan.memoryIndex.byTopic.keys()].sort(),
    },
  };
}

await main();
