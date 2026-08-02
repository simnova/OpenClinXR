import { spawnSync } from "node:child_process";
import { appendFile, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { readFile as readFileAsync, writeFile as writeFileAsync, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildGrokSliceTokenBaseline,
  parseCcusageDailyPayload,
  type GrokSessionTokenSnapshot,
  type GrokSliceTokenBaseline,
  type GrokSubagentTokenSnapshot,
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

function readSignalsTokens(sessionDir: string): {
  contextTokensUsed: number | null;
  modelsUsed: string[];
  primaryModelId: string | null;
  toolCallCount: number | null;
  turnCount: number | null;
} {
  try {
    const signals = JSON.parse(readFileSync(path.join(sessionDir, "signals.json"), "utf8")) as {
      contextTokensUsed?: number;
      modelsUsed?: string[];
      primaryModelId?: string;
      toolCallCount?: number;
      turnCount?: number;
    };
    return {
      contextTokensUsed:
        typeof signals.contextTokensUsed === "number" ? signals.contextTokensUsed : null,
      modelsUsed: Array.isArray(signals.modelsUsed) ? signals.modelsUsed : [],
      primaryModelId: signals.primaryModelId ?? null,
      toolCallCount: typeof signals.toolCallCount === "number" ? signals.toolCallCount : null,
      turnCount: typeof signals.turnCount === "number" ? signals.turnCount : null,
    };
  } catch {
    return {
      contextTokensUsed: null,
      modelsUsed: [],
      primaryModelId: null,
      toolCallCount: null,
      turnCount: null,
    };
  }
}

function parseSessionDirTokens(
  sessionDir: string,
  kind: "session" | "subagent" = "session",
): GrokSessionTokenSnapshot | null {
  const updatesPath = path.join(sessionDir, "updates.jsonl");
  const summaryPath = path.join(sessionDir, "summary.json");
  let peakTotalTokens = 0;
  let finalTotalTokens = 0;
  const modelIdsSeen = new Set<string>();
  let toolCallCount = 0;
  let turnCount = 0;
  let hasUpdates = false;
  try {
    const lines = readFileSync(updatesPath, "utf8").split("\n").filter(Boolean);
    hasUpdates = lines.length > 0;
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
    // try signals only
  }

  const signals = readSignalsTokens(sessionDir);
  for (const m of signals.modelsUsed) modelIdsSeen.add(m);
  if (signals.primaryModelId) modelIdsSeen.add(signals.primaryModelId);
  if (signals.contextTokensUsed != null) {
    peakTotalTokens = Math.max(peakTotalTokens, signals.contextTokensUsed);
    if (!hasUpdates || finalTotalTokens === 0) finalTotalTokens = signals.contextTokensUsed;
  }
  if (signals.toolCallCount != null && toolCallCount === 0) toolCallCount = signals.toolCallCount;
  if (signals.turnCount != null && turnCount === 0) turnCount = signals.turnCount;

  if (peakTotalTokens === 0 && modelIdsSeen.size === 0) return null;

  let sessionId = path.basename(sessionDir);
  try {
    const summary = JSON.parse(readFileSync(summaryPath, "utf8")) as { info?: { id?: string } };
    sessionId = summary.info?.id ?? sessionId;
  } catch {
    // keep basename
  }

  return {
    sessionId,
    peakTotalTokens,
    finalTotalTokens,
    modelIdsSeen: [...modelIdsSeen],
    toolCallCount,
    turnCount,
    ...(signals.contextTokensUsed != null ? { signalsContextTokens: signals.contextTokensUsed } : {}),
    kind,
  };
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
    .filter((entry) => {
      try {
        return statSync(entry).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    .slice(0, limit);

  for (const sessionDir of sessionDirs) {
    const snap = parseSessionDirTokens(sessionDir, "session");
    if (snap) summaries.push(snap);
  }

  return summaries;
}

/** Native Grok: parent session subagents/meta.json -> child session token peaks. */
export function parseGrokSubagentCompletions(limitParents = 6): GrokSubagentTokenSnapshot[] {
  const root = grokSessionRoot();
  const home = grokHome();
  const sessionsRoot = path.join(home, "sessions");
  let parentDirs: string[] = [];
  try {
    parentDirs = readdirSync(root)
      .map((entry) => path.join(root, entry))
      .filter((entry) => {
        try {
          return statSync(entry).isDirectory();
        } catch {
          return false;
        }
      })
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
      .slice(0, limitParents);
  } catch {
    return [];
  }

  const out: GrokSubagentTokenSnapshot[] = [];

  for (const parentDir of parentDirs) {
    const parentSessionId = path.basename(parentDir);
    const subagentsDir = path.join(parentDir, "subagents");
    let subIds: string[] = [];
    try {
      subIds = readdirSync(subagentsDir);
    } catch {
      continue;
    }
    for (const subId of subIds) {
      const metaPath = path.join(subagentsDir, subId, "meta.json");
      let meta: {
        subagent_id?: string;
        parent_session_id?: string;
        child_session_id?: string;
        subagent_type?: string;
        status?: string;
        duration_ms?: number;
        tool_calls?: number;
        effective_model_id?: string;
        worktree_path?: string;
        started_at?: string;
        completed_at?: string;
      };
      try {
        meta = JSON.parse(readFileSync(metaPath, "utf8")) as typeof meta;
      } catch {
        continue;
      }
      const childId = meta.child_session_id ?? subId;
      const candidates: string[] = [
        path.join(parentDir, "subagents", subId, childId),
        path.join(root, childId),
      ];
      if (meta.worktree_path) {
        // Grok encodes worktree cwd as sessions/<path with slashes as %2F>/<childId>
        const grokEncoded = meta.worktree_path.replaceAll("/", "%2F");
        candidates.push(path.join(sessionsRoot, grokEncoded, childId));
      }
      // Fallback: any sessions dir ending in subagent-<id>
      try {
        for (const name of readdirSync(sessionsRoot)) {
          if (name.includes(`subagent-${subId}`) || name.endsWith(subId)) {
            candidates.push(path.join(sessionsRoot, name, childId));
          }
        }
      } catch {
        // ignore
      }

      let peak = 0;
      let final = 0;
      let signalsContext: number | null = null;
      let source: GrokSubagentTokenSnapshot["source"] = "meta_only";
      for (const cand of candidates) {
        if (!existsSync(cand)) continue;
        const snap = parseSessionDirTokens(cand, "subagent");
        if (!snap) continue;
        peak = Math.max(peak, snap.peakTotalTokens);
        final = snap.finalTotalTokens;
        signalsContext = snap.signalsContextTokens ?? signalsContext;
        source =
          snap.signalsContextTokens != null ? "child_session_signals" : "child_session_updates";
        break;
      }

      out.push({
        subagentId: meta.subagent_id ?? subId,
        parentSessionId: meta.parent_session_id ?? parentSessionId,
        childSessionId: childId,
        subagentType: meta.subagent_type ?? "unknown",
        status: meta.status ?? "unknown",
        durationMs: meta.duration_ms ?? null,
        toolCalls: meta.tool_calls ?? null,
        effectiveModelId: meta.effective_model_id ?? null,
        peakTotalTokens: peak,
        finalTotalTokens: final,
        signalsContextTokens: signalsContext,
        source,
        ...(meta.started_at ? { startedAt: meta.started_at } : {}),
        ...(meta.completed_at ? { completedAt: meta.completed_at } : {}),
      });
    }
  }

  return out;
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
    subagentCompletions: parseGrokSubagentCompletions(),
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