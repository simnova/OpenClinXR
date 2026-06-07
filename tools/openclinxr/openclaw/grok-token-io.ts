import { spawnSync } from "node:child_process";
import { appendFile, readdirSync, readFileSync, statSync } from "node:fs";
import { readFile as readFileAsync, writeFile as writeFileAsync, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildGrokSliceTokenBaseline,
  parseCcusageDailyPayload,
  type GrokSessionTokenSnapshot,
  type GrokSliceTokenBaseline,
} from "../../../packages/openclinxr/agent-loop/src/grok-token-introspection.js";
import type { GrokTierId } from "../../../packages/openclinxr/agent-loop/src/grok-tier-routing.js";

export const DEFAULT_SLICE_BASELINE_PATH = ".openclinxr/openclaw/grok-tier-slice-baseline-latest.json";
export const DEFAULT_SLICE_TOKEN_REPORT_PATH = ".openclinxr/openclaw/grok-tier-slice-token-latest.json";
export const DEFAULT_SLICE_TOKEN_HISTORY_PATH = ".openclinxr/openclaw/grok-tier-slice-token-history.jsonl";

function grokHome(): string {
  return process.env.GROK_HOME || path.join(os.homedir(), ".grok");
}

function grokSessionRoot(): string {
  return path.join(grokHome(), "sessions", "%2FVolumes%2Ffiles%2Fsrc%2Fopenclinxr");
}

export function runCcusageJson(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const global = spawnSync("ccusage", args, {
    encoding: "utf8",
    timeout: 90_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (global.status === 0) {
    return { ok: true, stdout: global.stdout, stderr: global.stderr };
  }
  const fallback = spawnSync("pnpm", ["dlx", "ccusage", ...args], {
    encoding: "utf8",
    timeout: 90_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    ok: fallback.status === 0,
    stdout: fallback.stdout,
    stderr: fallback.stderr || global.stderr,
  };
}

export function todayPeriod(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function fetchCcusageDailySnapshot(period = todayPeriod()) {
  const result = runCcusageJson(["daily", "--json", "--since", period, "--until", period]);
  if (!result.ok) {
    return parseCcusageDailyPayload(null, period);
  }
  try {
    return parseCcusageDailyPayload(JSON.parse(result.stdout), period);
  } catch {
    return parseCcusageDailyPayload(null, period);
  }
}

export function parseGrokSessionTokens(limit = 8): GrokSessionTokenSnapshot[] {
  const root = grokSessionRoot();
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }

  const summaries: GrokSessionTokenSnapshot[] = [];
  const sessionDirs = entries
    .map((entry) => path.join(root, entry))
    .filter((entry) => statSync(entry).isDirectory())
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    .slice(0, limit);

  for (const sessionDir of sessionDirs) {
    const updatesPath = path.join(sessionDir, "updates.jsonl");
    const summaryPath = path.join(sessionDir, "summary.json");
    let peakTotalTokens = 0;
    let finalTotalTokens = 0;
    const modelIdsSeen = new Set<string>();
    let toolCallCount = 0;
    let turnCount = 0;
    try {
      const lines = readFileSync(updatesPath, "utf8").split("\n").filter(Boolean);
      for (const line of lines) {
        const row = JSON.parse(line) as {
          params?: {
            update?: { sessionUpdate?: string; _meta?: { modelId?: string } };
            _meta?: { totalTokens?: number; modelId?: string };
          };
          _meta?: { totalTokens?: number; modelId?: string };
        };
        const meta = row.params?._meta ?? row._meta;
        const total = meta?.totalTokens ?? 0;
        finalTotalTokens = total;
        peakTotalTokens = Math.max(peakTotalTokens, total);
        const modelId = row.params?.update?._meta?.modelId ?? meta?.modelId;
        if (modelId) modelIdsSeen.add(modelId);
        const updateType = row.params?.update?.sessionUpdate;
        if (updateType === "tool_call") toolCallCount += 1;
        if (updateType === "agent_message_chunk" || updateType === "agent_thought_chunk") turnCount += 1;
      }
    } catch {
      continue;
    }

    let sessionId = path.basename(sessionDir);
    try {
      const summary = JSON.parse(readFileSync(summaryPath, "utf8")) as { info?: { id?: string } };
      sessionId = summary.info?.id ?? sessionId;
    } catch {
      // keep basename
    }

    summaries.push({
      sessionId,
      peakTotalTokens,
      finalTotalTokens,
      modelIdsSeen: [...modelIdsSeen],
      toolCallCount,
      turnCount,
    });
  }

  return summaries;
}

export async function captureSliceTokenBaseline(input: {
  repoRoot: string;
  sliceId: string;
  declaredTier: GrokTierId;
  outputPath?: string;
}): Promise<GrokSliceTokenBaseline> {
  const baseline = buildGrokSliceTokenBaseline({
    sliceId: input.sliceId,
    declaredTier: input.declaredTier,
    ccusageDaily: await fetchCcusageDailySnapshot(),
    grokSessions: parseGrokSessionTokens(),
  });
  const outputPath = path.join(input.repoRoot, input.outputPath ?? DEFAULT_SLICE_BASELINE_PATH);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFileAsync(outputPath, `${JSON.stringify(baseline, null, 2)}\n`);
  return baseline;
}

export async function readSliceTokenBaseline(repoRoot: string, relativePath = DEFAULT_SLICE_BASELINE_PATH): Promise<GrokSliceTokenBaseline | null> {
  try {
    const raw = await readFileAsync(path.join(repoRoot, relativePath), "utf8");
    return JSON.parse(raw) as GrokSliceTokenBaseline;
  } catch {
    return null;
  }
}

export async function appendSliceTokenHistory(repoRoot: string, line: string, relativePath = DEFAULT_SLICE_TOKEN_HISTORY_PATH): Promise<void> {
  const target = path.join(repoRoot, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    appendFile(target, `${line}\n`, (error) => (error ? reject(error) : resolve()));
  });
}