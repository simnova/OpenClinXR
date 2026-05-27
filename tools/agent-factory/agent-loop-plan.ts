import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  type AgentLoopPlan,
  type AgentMemoryEntry,
  createAgentDispatchPackets,
  createAgentLoopPlan,
  type LegacyScorecard,
  normalizeLegacyScorecard,
  serializeAgentLoopPlan,
} from "../../packages/openclinxr/agent-loop/src/index.js";
import { iterationScorecardPaths, readJson } from "./lib.js";

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

export type AgentLoopArtifactOptions = {
  iterationDir: string;
  previousDir?: string;
};

export async function buildAgentLoopArtifact(options: AgentLoopArtifactOptions): Promise<unknown> {
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

  return toJsonPlan(plan);
}

export function canonicalAgentLoopArtifact(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function defaultAgentLoopOutputPath(iterationDir: string): string {
  return path.join(iterationDir, "09-agent-loop-plan.json");
}

export function inferPreviousIterationDir(iterationDir: string): string | undefined {
  const normalized = iterationDir.replace(/\/$/, "");
  const iterationName = path.basename(normalized);
  const match = /^iteration-(\d+)$/.exec(iterationName);
  if (!match) {
    return undefined;
  }

  const iterationNumber = Number.parseInt(match[1], 10);
  if (iterationNumber <= 1) {
    return undefined;
  }

  const previousName = `iteration-${String(iterationNumber - 1).padStart(match[1].length, "0")}`;
  return path.join(path.dirname(normalized), previousName);
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
  const serialized = serializeAgentLoopPlan(plan);

  return {
    ...serialized,
    dispatchPackets: createAgentDispatchPackets(plan),
    memoryRetrieval: {
      activeEntryCount: plan.memoryIndex.activeEntries.length,
      topics: Object.keys(serialized.memoryIndex.byTopic).sort(),
    },
  };
}
