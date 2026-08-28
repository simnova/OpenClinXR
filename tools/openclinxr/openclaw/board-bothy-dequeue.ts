/**
 * BothyBoard HOT dequeue (live contract 0.5.0 / 54c918c).
 *
 *   tasks.next { machineName, cacheToken }
 *     → { task, spawnCommand, grokSessionId, cacheToken, unchanged }
 *
 * Dual-dequeue refused when BOTHY_BOARD_DEQUEUE=1. Missing PAT is incomplete-read.
 * `{task:null}` and `{unchanged:true}` are success. Unchanged replays the last snapshot
 * (no payload); do not rank GitHub.
 *
 * claimScope: next card identity + spawnCommand from BothyBoard MCP.
 * notEvidenceFor: contract soundness (caller still runs briefFromIssue on body).
 */

import { hostname } from "node:os";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const BOTHY_MCP_URL = "https://bothyboard.com/api/mcp";
export const BOTHY_CACHE_REL = ".openclinxr/openclaw/bothy-next-cache.json";

export type BothyTask = {
  id?: string;
  title?: string;
  body?: string;
  factory?: string;
  status?: string;
  priority?: number | string;
};

export type BothyNextSnapshot = {
  task?: BothyTask | null;
  spawnCommand?: string | null;
  grokSessionId?: string | null;
  cacheToken?: string | null;
  unchanged?: boolean;
};

export type BothyFetch = (args: {
  tool: string;
  arguments: Record<string, unknown>;
}) => Promise<{ structuredContent: unknown; httpStatus: number }>;

export type BothyTokenStore = {
  read: () => BothyNextSnapshot | null;
  write: (snap: BothyNextSnapshot) => void;
};

export type BothyNextOk = {
  ok: true;
  number: number;
  priority: string;
  title: string;
  fetched: number;
  totalCount: number;
  taskId: string;
  body: string;
  source: "bothy-board";
  spawnCommand?: string;
  grokSessionId?: string;
  cacheToken?: string;
};

export type BothyNextFail = {
  ok: false;
  reason: "incomplete-read" | "no-candidate";
  detail: string;
  fetched: number;
  totalCount: number;
};

function asTask(value: unknown): BothyTask | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  const inner = rec.task;
  if (inner === null) return null;
  if (inner && typeof inner === "object") return inner as BothyTask;
  if (typeof rec.id === "string") return rec as BothyTask;
  return null;
}

function asSnapshot(value: unknown): BothyNextSnapshot | null {
  if (!value || typeof value !== "object") return null;
  return value as BothyNextSnapshot;
}

function priorityLabel(raw: number | string | undefined): string {
  if (raw === 0 || raw === "0" || raw === "P0") return "P0";
  if (raw === 1 || raw === "1" || raw === "P1") return "P1";
  if (raw === 2 || raw === "2" || raw === "P2") return "P2";
  if (typeof raw === "string" && /^P\d$/.test(raw)) return raw;
  return "P0";
}

export function fileTokenStore(repoRoot: string): BothyTokenStore {
  const file = path.join(repoRoot, BOTHY_CACHE_REL);
  return {
    read: () => {
      try {
        return JSON.parse(readFileSync(file, "utf8")) as BothyNextSnapshot;
      } catch {
        return null;
      }
    },
    write: (snap) => {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(snap)}\n`, "utf8");
    },
  };
}

export async function bothyMcpCall(
  pat: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<{ structuredContent: unknown; httpStatus: number }> {
  const res = await fetch(BOTHY_MCP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${pat}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: tool, arguments: args },
    }),
  });
  const json = (await res.json()) as {
    result?: { structuredContent?: unknown; isError?: boolean };
  };
  return { structuredContent: json.result?.structuredContent, httpStatus: res.status };
}

function mapTask(
  task: BothyTask,
  snap: BothyNextSnapshot,
  body: string,
): BothyNextOk {
  return {
    ok: true,
    number: 0,
    priority: priorityLabel(task.priority),
    title: task.title ?? task.id ?? "",
    fetched: 1,
    totalCount: 1,
    taskId: task.id ?? "",
    body,
    source: "bothy-board",
    spawnCommand: snap.spawnCommand ?? undefined,
    grokSessionId: snap.grokSessionId ?? undefined,
    cacheToken: snap.cacheToken ?? undefined,
  };
}

/**
 * `tasks.next` is Planted+ready+deps-done+not-parent+non-overlapping-roots.
 */
export async function selectNextBothyCard(opts: {
  pat?: string | undefined;
  fetch?: BothyFetch | undefined;
  env?: Record<string, string | undefined>;
  machineName?: string | undefined;
  store?: BothyTokenStore | undefined;
  repoRoot?: string | undefined;
}): Promise<BothyNextOk | BothyNextFail> {
  const env = opts.env ?? (typeof process === "undefined" ? {} : process.env);
  const pat = opts.pat ?? env.BOTHY_BOARD_PAT ?? "";
  if (!pat.startsWith("bb_pat_")) {
    return {
      ok: false,
      reason: "incomplete-read",
      fetched: 0,
      totalCount: -1,
      detail:
        "BothyBoard is the dequeue SSOT and BOTHY_BOARD_PAT is missing — refusing rather than ranking GitHub project 7 (dual-dequeue is refused)",
    };
  }
  const machineName = opts.machineName ?? env.BOTHY_MACHINE_NAME ?? hostname();
  const store =
    opts.store ?? (opts.repoRoot ? fileTokenStore(opts.repoRoot) : undefined);
  const prior = store?.read() ?? null;
  const fetchFn = opts.fetch ?? ((a) => bothyMcpCall(pat, a.tool, a.arguments));
  let nextRaw: unknown;
  try {
    const args: Record<string, unknown> = { machineName };
    if (prior?.cacheToken) args.cacheToken = prior.cacheToken;
    const next = await fetchFn({ tool: "bothy-board.tasks.next", arguments: args });
    if (next.httpStatus !== 200) {
      return {
        ok: false,
        reason: "incomplete-read",
        fetched: 0,
        totalCount: -1,
        detail: `bothy-board.tasks.next HTTP ${next.httpStatus}`,
      };
    }
    nextRaw = next.structuredContent;
  } catch (cause) {
    return {
      ok: false,
      reason: "incomplete-read",
      fetched: 0,
      totalCount: -1,
      detail: `bothy-board.tasks.next failed: ${String(cause).slice(0, 160)}`,
    };
  }
  const rec = asSnapshot(nextRaw) ?? {};
  if ((nextRaw as Record<string, unknown> | null)?.code === "rate_limited") {
    const rl = nextRaw as Record<string, unknown>;
    return {
      ok: false,
      reason: "incomplete-read",
      fetched: 0,
      totalCount: -1,
      detail: `bothy-board rate_limited retryAfterSec=${String(rl.retryAfterSec ?? "?")}`,
    };
  }

  if (rec.unchanged) {
    const replay = prior ?? rec;
    store?.write({ ...replay, cacheToken: rec.cacheToken ?? prior?.cacheToken ?? null });
    const task = asTask(replay);
    if (!task?.id) {
      return {
        ok: false,
        reason: "no-candidate",
        fetched: 0,
        totalCount: 0,
        detail: "BothyBoard ready set unchanged and empty — success, not a failure",
      };
    }
    const body = typeof task.body === "string" ? task.body : "";
    return mapTask(task, { ...replay, ...rec }, body);
  }

  store?.write(rec);
  const task = asTask(rec);
  if (!task?.id) {
    return {
      ok: false,
      reason: "no-candidate",
      fetched: 0,
      totalCount: 0,
      detail: "BothyBoard ready set is empty — {task:null} is success, not a failure",
    };
  }
  let body = typeof task.body === "string" ? task.body : "";
  if (!body) {
    try {
      const got = await fetchFn({
        tool: "bothy-board.tasks.get",
        arguments: { taskId: task.id },
      });
      const gotTask = asTask(got.structuredContent);
      body = typeof gotTask?.body === "string" ? gotTask.body : "";
    } catch {
      body = "";
    }
  }
  return mapTask(task, rec, body);
}

export function bothyDequeueEnabled(env: Record<string, string | undefined> = process.env): boolean {
  // BothyBoard is the dequeue SSOT. GitHub project 7 is opt-in retire (`BOTHY_BOARD_DEQUEUE=0`).
  return env.BOTHY_BOARD_DEQUEUE !== "0";
}

/**
 * BothyBoard slice ids the selector produces are `bothy-<taskId>`, e.g. `bothy-tsk_<id>`.
 * Strip the `bothy-` prefix ONLY — the `tsk_` prefix is part of the taskId that `tasks.get`
 * expects, so a `bothy-tsk_…` strip would return a task id missing its own prefix.
 */
export function bothyTaskIdFromSliceId(sliceId: string): string | null {
  const prefix = "bothy-";
  if (!sliceId.startsWith(prefix)) return null;
  const taskId = sliceId.slice(prefix.length);
  return taskId.length > 0 ? taskId : null;
}

/**
 * Dispatch hop for a `bothy-tsk_*` slice: resolve the Planted body WITHOUT GitHub.
 *
 * Prefers the body the selection already carried (`tasks.next` or its unchanged replay);
 * falls back to the matching `tasks.next` snapshot, then `bothy-board.tasks.get { taskId }`.
 * Returns the `{ number: 0, title, body }` shape `briefFromIssue` consumes. Never shells gh.
 */
export async function bothyBriefFromSlice(opts: {
  sliceId: string;
  selectionTitle?: string;
  selectionBody?: string;
  pat?: string;
  fetch?: BothyFetch;
  env?: Record<string, string | undefined>;
  store?: BothyTokenStore;
  repoRoot?: string;
}): Promise<{ number: 0; title: string; body: string; taskId: string }> {
  const taskId = bothyTaskIdFromSliceId(opts.sliceId);
  if (!taskId) {
    throw new Error(`bothyBriefFromSlice: not a bothy-tsk_* slice id: '${opts.sliceId}'`);
  }
  if (typeof opts.selectionBody === "string" && opts.selectionBody.length > 0) {
    return {
      number: 0,
      title: opts.selectionTitle ?? taskId,
      body: opts.selectionBody,
      taskId,
    };
  }

  const env = opts.env ?? (typeof process === "undefined" ? {} : process.env);
  const pat = opts.pat ?? env.BOTHY_BOARD_PAT ?? "";
  const store = opts.store ?? (opts.repoRoot ? fileTokenStore(opts.repoRoot) : undefined);
  const fetchFn = opts.fetch ?? ((a) => bothyMcpCall(pat, a.tool, a.arguments));

  // The last `tasks.next` snapshot may still carry the card body (unchanged replay path).
  const prior = store?.read() ?? null;
  if (
    prior?.task?.id === taskId
    && typeof prior.task.body === "string"
    && prior.task.body.length > 0
  ) {
    return { number: 0, title: prior.task.title ?? taskId, body: prior.task.body, taskId };
  }

  // Same hop `selectNextBothyCard` uses when `tasks.next` carries no body.
  const got = await fetchFn({ tool: "bothy-board.tasks.get", arguments: { taskId } });
  const gotTask = asTask(got.structuredContent);
  const body = typeof gotTask?.body === "string" ? gotTask.body : "";
  return { number: 0, title: gotTask?.title ?? taskId, body, taskId };
}
