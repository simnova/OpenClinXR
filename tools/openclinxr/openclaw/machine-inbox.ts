/**
 * Machine-to-machine messaging over the BothyBoard mailbox.
 *
 * Each machine owns one inbox card; one broadcast card reaches every machine.
 * The cards are channels, never work: they stay Idle and are never planted.
 * A watcher holds one `mailbox.message` subscription on its own inbox plus the
 * broadcast card and long-polls it (`waitMs` up to 20 s), so a message lands in
 * about a second and an idle machine costs one held request per 20 s.
 *
 * Received messages append to a local log; `read` prints the unread ones.
 * The event payload carries no author name, so the sender is a `from::<machine>`
 * header line in the body, which is also how a watcher drops its own broadcast.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";

import { BOTHY_MCP_URL } from "./board-bothy-dequeue.js";

export const INBOX_REGISTRY_REL = "tools/openclinxr/openclaw/machine-inboxes.json";
export const INBOX_STATE_REL = ".openclinxr/openclaw/machine-inbox-state.json";
export const INBOX_LOG_REL = ".openclinxr/openclaw/machine-inbox.jsonl";
export const INBOX_READ_REL = ".openclinxr/openclaw/machine-inbox-read.json";
export const MAX_WAIT_MS = 20_000;
export const MAX_BACKOFF_MS = 30_000;
/**
 * The server's poll cursor is inclusive: it re-returns the event at the cursor, at once, with the
 * same cursor (measured 2026-11-10). A page of only already-seen events waits this long before the
 * next poll instead of spinning.
 */
export const SEEN_ONLY_REPOLL_MS = 5_000;
const SEEN_CAP = 50;

export type InboxRegistry = {
  projectId: string;
  broadcastTaskId: string;
  machines: Record<string, string>;
};

export type InboxState = {
  subscriptionId: string | null;
  subscribedTaskIds: string[];
  cursor: string | null;
  /** Event ids already delivered at `cursor`, dropped when the inclusive cursor re-returns them. */
  seenEventIds?: string[];
};

export type InboxMessage = {
  receivedAt: string;
  eventId: string;
  taskId: string;
  channel: "inbox" | "broadcast";
  from: string | null;
  body: string;
};

export type RpcReply = {
  httpStatus: number;
  result?: unknown;
  error?: { code?: number; message?: string } | undefined;
};
export type InboxRpc = (method: string, params: Record<string, unknown>, timeoutMs?: number) => Promise<RpcReply>;

export function machineNameFrom(env: NodeJS.ProcessEnv = process.env, host: string = hostname()): string {
  const raw = env["BOTHY_MACHINE_NAME"]?.trim() || host;
  return raw.replace(/\.local$/i, "");
}

export function httpInboxRpc(pat: string, url: string = BOTHY_MCP_URL): InboxRpc {
  return async (method, params, timeoutMs = 30_000) => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pat}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json: { result?: unknown; error?: RpcReply["error"] } = {};
    try {
      json = JSON.parse(text);
    } catch {
      // Non-JSON bodies (gateway 5xx pages) are classified by status alone.
    }
    return { httpStatus: res.status, result: json.result, error: json.error };
  };
}

async function callTool(rpc: InboxRpc, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const reply = await rpc("tools/call", { name, arguments: args });
  if (reply.httpStatus !== 200 || reply.error) {
    throw new Error(`${name}: http_${reply.httpStatus} ${reply.error?.message ?? ""}`.trim());
  }
  const sc = (reply.result as { structuredContent?: unknown; isError?: boolean } | undefined) ?? {};
  if (sc.isError) throw new Error(`${name}: ${JSON.stringify(sc.structuredContent ?? sc).slice(0, 300)}`);
  return (sc.structuredContent ?? {}) as Record<string, unknown>;
}

export function readRegistry(repoRoot: string): InboxRegistry {
  return JSON.parse(readFileSync(join(repoRoot, INBOX_REGISTRY_REL), "utf8")) as InboxRegistry;
}

export function writeRegistry(repoRoot: string, registry: InboxRegistry): void {
  const sorted = Object.fromEntries(Object.entries(registry.machines).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(join(repoRoot, INBOX_REGISTRY_REL), `${JSON.stringify({ ...registry, machines: sorted }, null, 2)}\n`);
}

export function formatBody(from: string, text: string): string {
  return `from::${from}\n${text}`;
}

export function senderOf(body: string): string | null {
  const m = /^from::(\S+)/.exec(body);
  return m?.[1] ?? null;
}

export function resolveTarget(registry: InboxRegistry, to: string): string {
  if (to === "all") return registry.broadcastTaskId;
  const id = registry.machines[to];
  if (!id) {
    const known = Object.keys(registry.machines).join(", ") || "none";
    throw new Error(`no inbox for machine "${to}"; known: ${known}, or "all"`);
  }
  return id;
}

export async function sendMessage(opts: {
  rpc: InboxRpc;
  registry: InboxRegistry;
  from: string;
  to: string;
  text: string;
  harness?: string | undefined;
}): Promise<{ taskId: string; commentId: string | null }> {
  const taskId = resolveTarget(opts.registry, opts.to);
  const out = await callTool(opts.rpc, "bothy-board_mailbox_post", {
    taskId,
    body: formatBody(opts.from, opts.text),
    authorName: `${opts.harness ?? "agent"}@${opts.from}`,
  });
  return { taskId, commentId: typeof out["id"] === "string" ? out["id"] : null };
}

/** Create this machine's inbox card, read it back, and return the updated registry. */
export async function registerMachine(opts: {
  rpc: InboxRpc;
  registry: InboxRegistry;
  machine: string;
}): Promise<{ registry: InboxRegistry; taskId: string; created: boolean }> {
  const existing = opts.registry.machines[opts.machine];
  if (existing) return { registry: opts.registry, taskId: existing, created: false };
  const title = `inbox: ${opts.machine}`;
  const objective = `Machine inbox for ${opts.machine}: agents on other machines post here to reach agents on this machine.`;
  const created = await callTool(opts.rpc, "bothy-board_tasks_create", {
    title,
    objective,
    projectId: opts.registry.projectId,
    kind: "channel",
    priority: 2,
    body: `${objective}\n\nThis card is a mailbox channel, not work. Never plant it, claim it, or dequeue it. Send with \`pnpm openclaw:inbox send\`; receive with \`pnpm openclaw:inbox watch\`.`,
    fields: { factory_step: "instrument", unblocks: "instrument", lane: "A" },
  });
  const taskId = (created["task"] as { id?: string } | undefined)?.id ?? (created["id"] as string | undefined);
  if (!taskId) throw new Error(`tasks.create returned no id: ${JSON.stringify(created).slice(0, 300)}`);
  // A create response is not evidence the card exists as asked; read it back.
  const back = (await callTool(opts.rpc, "bothy-board_tasks_get", { taskId }))["task"] as
    | { title?: string; projectId?: string }
    | undefined;
  if (back?.title !== title || back?.projectId !== opts.registry.projectId) {
    throw new Error(`read-back of ${taskId} does not match: ${JSON.stringify(back).slice(0, 300)}`);
  }
  return {
    registry: { ...opts.registry, machines: { ...opts.registry.machines, [opts.machine]: taskId } },
    taskId,
    created: true,
  };
}

export type StateStore = { read: () => InboxState; write: (s: InboxState) => void };

export function fileStateStore(repoRoot: string): StateStore {
  const file = join(repoRoot, INBOX_STATE_REL);
  return {
    read: () => {
      try {
        return JSON.parse(readFileSync(file, "utf8")) as InboxState;
      } catch {
        return { subscriptionId: null, subscribedTaskIds: [], cursor: null };
      }
    },
    write: (s) => {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(s)}\n`);
    },
  };
}

export function fileMessageLog(repoRoot: string): (m: InboxMessage) => void {
  const file = join(repoRoot, INBOX_LOG_REL);
  return (m) => {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(m)}\n`);
  };
}

/** Return messages not yet read and advance the read marker. */
export function readUnread(repoRoot: string, opts: { all?: boolean } = {}): InboxMessage[] {
  const logFile = join(repoRoot, INBOX_LOG_REL);
  const markFile = join(repoRoot, INBOX_READ_REL);
  if (!existsSync(logFile)) return [];
  const lines = readFileSync(logFile, "utf8").split("\n").filter(Boolean);
  let readCount = 0;
  try {
    readCount = (JSON.parse(readFileSync(markFile, "utf8")) as { readCount?: number }).readCount ?? 0;
  } catch {
    readCount = 0;
  }
  const out = lines.slice(opts.all ? 0 : readCount).map((l) => JSON.parse(l) as InboxMessage);
  writeFileSync(markFile, `${JSON.stringify({ readCount: lines.length })}\n`);
  return out;
}

export type WatchEmit = (line: string) => void;
export type WatchMode = "lines" | "monitor";

export type FailureClass = "permanent" | "transient" | "resubscribe";

export function classifyReply(reply: RpcReply): FailureClass | null {
  if (reply.httpStatus === 401 || reply.httpStatus === 403) return "permanent";
  if (reply.httpStatus !== 200) return "transient";
  if (reply.error) {
    return /subscription/i.test(reply.error.message ?? "") ? "resubscribe" : "transient";
  }
  return null;
}

type PollResult = {
  events?: Array<{ eventId?: string; cursor?: string; data?: { taskId?: string; body?: string } }>;
  cursor?: string;
  hasMore?: boolean;
};

/**
 * Long-poll the machine's inbox and the broadcast card until stopped.
 * Returns 0 when stopped or after the first delivered batch with `once`,
 * and 2 on a permanent auth failure (after emitting FAILED in monitor mode).
 */
export async function runWatch(opts: {
  rpc: InboxRpc;
  registry: InboxRegistry;
  machine: string;
  state: StateStore;
  log: (m: InboxMessage) => void;
  emit: WatchEmit;
  mode?: WatchMode;
  once?: boolean;
  waitMs?: number | undefined;
  sleep?: (ms: number) => Promise<void>;
  shouldStop?: () => boolean;
  now?: () => Date;
}): Promise<number> {
  const inbox = opts.registry.machines[opts.machine];
  if (!inbox) throw new Error(`no inbox for machine "${opts.machine}"; run: pnpm openclaw:inbox register`);
  const taskIds = [inbox, opts.registry.broadcastTaskId];
  const waitMs = Math.min(opts.waitMs ?? MAX_WAIT_MS, MAX_WAIT_MS);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => new Date());
  const mode = opts.mode ?? "lines";
  let state = opts.state.read();
  if (state.subscribedTaskIds.join(",") !== taskIds.join(",")) {
    state = { subscriptionId: null, subscribedTaskIds: taskIds, cursor: state.cursor };
  }
  let failures = 0;
  let drain = false;
  let deliveredTotal = 0;

  const fail = async (cls: FailureClass, detail: string): Promise<number | null> => {
    if (cls === "permanent") {
      if (mode === "monitor") opts.emit("FAILED");
      else opts.emit(JSON.stringify({ failed: detail }));
      return 2;
    }
    if (cls === "resubscribe") {
      state = { ...state, subscriptionId: null };
      return null;
    }
    failures += 1;
    await sleep(Math.min(1000 * 2 ** (failures - 1), MAX_BACKOFF_MS));
    return null;
  };

  while (!opts.shouldStop?.()) {
    let reply: RpcReply;
    try {
      if (!state.subscriptionId) {
        reply = await opts.rpc("events/subscribe", {
          name: "mailbox.message",
          arguments: { taskIds },
          delivery: { mode: "poll" },
        });
        const cls = classifyReply(reply);
        if (cls) {
          const code = await fail(cls === "resubscribe" ? "transient" : cls, `subscribe http_${reply.httpStatus}`);
          if (code !== null) return code;
          continue;
        }
        const sub = reply.result as { id?: string; cursor?: string };
        // A saved cursor wins: a restarted watcher resumes where it stopped.
        state = { subscriptionId: sub.id ?? null, subscribedTaskIds: taskIds, cursor: state.cursor ?? sub.cursor ?? null };
        opts.state.write(state);
      }
      const params: Record<string, unknown> = { subscriptionId: state.subscriptionId, cursor: state.cursor };
      if (!drain) params["waitMs"] = waitMs;
      reply = await opts.rpc("events/poll", params, waitMs + 15_000);
    } catch (err) {
      const code = await fail("transient", String(err));
      if (code !== null) return code;
      continue;
    }
    const cls = classifyReply(reply);
    if (cls) {
      const code = await fail(cls, `poll http_${reply.httpStatus} ${reply.error?.message ?? ""}`);
      if (code !== null) return code;
      continue;
    }
    failures = 0;
    const page = (reply.result ?? {}) as PollResult;
    const delivered: InboxMessage[] = [];
    const seen = new Set(state.seenEventIds ?? []);
    const pageIds: string[] = [];
    let fresh = 0;
    for (const ev of page.events ?? []) {
      const id = ev.eventId ?? "";
      if (id) pageIds.push(id);
      if (id && seen.has(id)) continue;
      fresh += 1;
      const body = ev.data?.body ?? "";
      const from = senderOf(body);
      if (from === opts.machine) continue;
      const taskId = ev.data?.taskId ?? "";
      const msg: InboxMessage = {
        receivedAt: now().toISOString(),
        eventId: ev.eventId ?? "",
        taskId,
        channel: taskId === opts.registry.broadcastTaskId ? "broadcast" : "inbox",
        from,
        body,
      };
      opts.log(msg);
      delivered.push(msg);
    }
    // Persist the cursor only after the batch is logged, so a crash re-delivers rather than drops.
    const cursor = page.cursor ?? state.cursor;
    const carried = cursor === state.cursor ? [...seen] : [];
    const seenEventIds = [...new Set([...carried, ...pageIds])].slice(-SEEN_CAP);
    state = { ...state, cursor, seenEventIds };
    opts.state.write(state);
    if (delivered.length > 0) {
      if (mode === "monitor") opts.emit("DONE");
      else for (const m of delivered) opts.emit(JSON.stringify(m));
    }
    drain = page.hasMore === true;
    deliveredTotal += delivered.length;
    if (opts.once && deliveredTotal > 0 && !drain) return 0;
    if (!drain && fresh === 0 && pageIds.length > 0) await sleep(SEEN_ONLY_REPOLL_MS);
  }
  return 0;
}
