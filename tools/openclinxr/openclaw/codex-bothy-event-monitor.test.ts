import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { BothyFetch } from "./board-bothy-dequeue.js";
import {
  acquireLock,
  buildWakePrompt,
  DEFAULT_SELF_MARKER,
  loadMonitorState,
  lockIsStale,
  monitorMain,
  parseMonitorArgs,
  releaseLock,
  runMonitorCycle,
  type MonitorConfig,
} from "./codex-bothy-event-monitor.js";

const SESSION = "11111111-2222-3333-4444-555555555555";
const PAT = "bb_pat_test";

class FakeChild extends EventEmitter {
  pid: number;

  constructor(pid: number) {
    super();
    this.pid = pid;
  }
}

function makeRoot(name: string): string {
  const root = join(
    tmpdir(),
    `ocxr-bothy-monitor-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  );
  mkdirSync(join(root, "tools/openclinxr/openclaw"), { recursive: true });
  mkdirSync(join(root, ".openclinxr/openclaw"), { recursive: true });
  writeFileSync(
    join(root, "tools/openclinxr/openclaw/mailbox-watch.json"),
    JSON.stringify({ taskIds: ["tsk_watch"] }),
  );
  return root;
}

function configFor(root: string, overrides: Partial<MonitorConfig> = {}): MonitorConfig {
  return {
    pat: PAT,
    repoRoot: root,
    sessionId: SESSION,
    selfMarker: DEFAULT_SELF_MARKER,
    fetch: async () => ({ structuredContent: {}, httpStatus: 200 }),
    spawnResume: () => new FakeChild(424242),
    ...overrides,
  };
}

function recordingFetch(handler: (tool: string, args: Record<string, unknown>) => unknown) {
  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  const fetch: BothyFetch = async ({ tool, arguments: args }) => {
    calls.push({ tool, args });
    return { structuredContent: handler(tool, args), httpStatus: 200 };
  };
  return { calls, fetch };
}

function stateFile(root: string): string {
  return join(root, ".openclinxr/openclaw/codex-bothy-event-monitor-state.json");
}

describe("codex-bothy-event-monitor", () => {
  it("idle cycle emits no stdout and spawns no resume", async () => {
    const root = makeRoot("idle");
    const spawned: string[][] = [];
    const { fetch } = recordingFetch((tool) => {
      if (tool === "bothy-board.mailbox.poll") return { comments: [] };
      return { task: null, cacheToken: "tok1" };
    });
    const result = await runMonitorCycle(
      configFor(root, {
        fetch,
        spawnResume: (session, prompt) => {
          spawned.push([session, prompt]);
          return new FakeChild(1);
        },
      }),
    );
    expect(result.meaningful).toBe(false);
    expect(result.stdoutLines).toEqual([]);
    expect(spawned).toEqual([]);
  });

  it("a self-authored comment produces no wake", async () => {
    const root = makeRoot("selfecho");
    const spawned: string[][] = [];
    const { fetch } = recordingFetch((tool) => {
      if (tool === "bothy-board.mailbox.poll") {
        return {
          comments: [
            { id: "cmt_self", authorName: "member", body: `mine ${DEFAULT_SELF_MARKER}` },
          ],
        };
      }
      return { task: null, cacheToken: "tok1" };
    });
    const result = await runMonitorCycle(
      configFor(root, {
        fetch,
        spawnResume: (session, prompt) => {
          spawned.push([session, prompt]);
          return new FakeChild(1);
        },
      }),
    );
    expect(result.meaningful).toBe(false);
    expect(result.resumeSpawned).toBe(false);
    expect(spawned).toEqual([]);
    expect(loadMonitorState(stateFile(root)).seenCommentIds).toEqual([]);
  });

  it("a foreign comment wakes the configured session once, with coalesced ids", async () => {
    const root = makeRoot("wake");
    const spawned: string[][] = [];
    const { fetch } = recordingFetch((tool) => {
      if (tool === "bothy-board.mailbox.poll") {
        return { comments: [{ id: "cmt_new", authorName: "member", body: "please look" }] };
      }
      return { task: null, cacheToken: "tok1" };
    });
    const result = await runMonitorCycle(
      configFor(root, {
        fetch,
        spawnResume: (session, prompt) => {
          spawned.push([session, prompt]);
          return new FakeChild(424242);
        },
      }),
    );
    expect(result.meaningful).toBe(true);
    expect(result.resumeSpawned).toBe(true);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.[0]).toBe(SESSION);
    expect(spawned[0]?.[1]).toContain("cmt_new");
    expect(result.stdoutLines.join("\n")).toContain("WAKE resume=");
    expect(loadMonitorState(stateFile(root)).seenCommentIds).toEqual(["cmt_new"]);
  });

  it("already-seen comment ids do not re-wake", async () => {
    const root = makeRoot("seen");
    const spawned: string[][] = [];
    const { fetch } = recordingFetch((tool) => {
      if (tool === "bothy-board.mailbox.poll") {
        return { comments: [{ id: "cmt_new", authorName: "member", body: "please look" }] };
      }
      return { task: null, cacheToken: "tok1" };
    });
    const spawnResume = (session: string, prompt: string) => {
      spawned.push([session, prompt]);
      return new FakeChild(1);
    };
    await runMonitorCycle(configFor(root, { fetch, spawnResume }));
    await runMonitorCycle(configFor(root, { fetch, spawnResume }));
    expect(spawned).toHaveLength(1);
  });

  it("a new ready card wakes; unchanged replay does not", async () => {
    const root = makeRoot("ready");
    const spawned: string[][] = [];
    const children: FakeChild[] = [];
    // Key on tasks.next only: selectNextBothyCard also calls tasks.get when a
    // task body is empty, which would otherwise consume the call counter.
    let nextCalls = 0;
    const { fetch } = recordingFetch((tool, args) => {
      if (tool === "bothy-board.mailbox.poll") return { comments: [] };
      if (tool === "bothy-board.tasks.get") {
        return { task: { id: String(args.taskId), body: "b" }, cacheToken: "tokX" };
      }
      nextCalls += 1;
      if (nextCalls === 1) return { task: { id: "tsk_a", body: "a" }, cacheToken: "tokA" };
      if (nextCalls === 2) return { unchanged: true, cacheToken: "tokA" };
      return { task: { id: "tsk_b", body: "b" }, cacheToken: "tokB" };
    });
    const spawnResume = (session: string, prompt: string) => {
      spawned.push([session, prompt]);
      const child = new FakeChild(1);
      children.push(child);
      return child;
    };
    await runMonitorCycle(configFor(root, { fetch, spawnResume }));
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.[1]).toContain("ready:tsk_a");
    children[0]?.emit("exit", 0); // release the single-flight lock
    await runMonitorCycle(configFor(root, { fetch, spawnResume }));
    expect(spawned).toHaveLength(1); // unchanged replay of the same card → no wake
    await runMonitorCycle(configFor(root, { fetch, spawnResume }));
    expect(spawned).toHaveLength(2);
    expect(spawned[1]?.[1]).toContain("ready:tsk_b");
  });

  it("refuses a second resume while the lock is held", async () => {
    const root = makeRoot("singleflight");
    const spawned: string[][] = [];
    const { fetch } = recordingFetch((tool) => {
      if (tool === "bothy-board.mailbox.poll") {
        return { comments: [{ id: "cmt_a", authorName: "member", body: "one" }] };
      }
      return { task: null, cacheToken: "tok1" };
    });
    const lockFile = join(root, ".openclinxr/openclaw/codex-bothy-event-monitor.lock");
    expect(acquireLock(lockFile)).toBe(true); // held by this (alive) process
    const result = await runMonitorCycle(
      configFor(root, {
        fetch,
        lockFile,
        spawnResume: (session, prompt) => {
          spawned.push([session, prompt]);
          return new FakeChild(1);
        },
      }),
    );
    expect(result.resumeRefused).toBe(true);
    expect(result.resumeSpawned).toBe(false);
    expect(spawned).toEqual([]);
    expect(result.stdoutLines.join("\n")).toContain("RESUME_REFUSED");
    // Events stay unseen so the wake retries once the lock frees.
    expect(loadMonitorState(stateFile(root)).seenCommentIds).toEqual([]);
    releaseLock(lockFile);
  });

  it("reports DEGRADED after 3 consecutive failed cycles and STOPs after 10", async () => {
    const root = makeRoot("degraded");
    const failingFetch: BothyFetch = async () => {
      throw new Error("network down");
    };
    const cfg = configFor(root, { fetch: failingFetch, spawnResume: () => new FakeChild(1) });
    const r1 = await runMonitorCycle(cfg);
    expect(r1.stdoutLines).toEqual([]);
    const r2 = await runMonitorCycle(cfg);
    expect(r2.stdoutLines).toEqual([]);
    const r3 = await runMonitorCycle(cfg);
    expect(r3.degraded).toBe(true);
    expect(r3.stopped).toBe(false);
    expect(r3.stdoutLines.join("\n")).toContain("DEGRADED");
    let last: Awaited<ReturnType<typeof runMonitorCycle>> | null = null;
    for (let i = 0; i < 7; i += 1) last = await runMonitorCycle(cfg);
    expect(last?.stopped).toBe(true);
    expect(last?.stdoutLines.join("\n")).toContain("STOP");
  });

  it("resets the failure counter after a healthy cycle", async () => {
    const root = makeRoot("recover");
    let failing = true;
    const fetch: BothyFetch = async ({ tool }) => {
      if (failing) throw new Error("down");
      if (tool === "bothy-board.mailbox.poll") {
        return { structuredContent: { comments: [] }, httpStatus: 200 };
      }
      return { structuredContent: { task: null, cacheToken: "tok1" }, httpStatus: 200 };
    };
    const cfg = configFor(root, { fetch, spawnResume: () => new FakeChild(1) });
    await runMonitorCycle(cfg);
    await runMonitorCycle(cfg);
    failing = false;
    await runMonitorCycle(cfg);
    expect(loadMonitorState(stateFile(root)).consecutiveFailures).toBe(0);
  });

  it("releases the single-flight lock when the resume child exits", async () => {
    const root = makeRoot("release");
    const spawned: FakeChild[] = [];
    let commentSeq = 0;
    const { fetch } = recordingFetch((tool) => {
      if (tool === "bothy-board.mailbox.poll") {
        commentSeq += 1;
        return {
          comments: [{ id: `cmt_${commentSeq}`, authorName: "member", body: "wake" }],
        };
      }
      return { task: null, cacheToken: "tok1" };
    });
    const lockFile = join(root, ".openclinxr/openclaw/codex-bothy-event-monitor.lock");
    const spawnResume = (session: string, prompt: string) => {
      const child = new FakeChild(9000);
      spawned.push(child);
      return child;
    };
    const cfg = configFor(root, { fetch, spawnResume, lockFile });
    const r1 = await runMonitorCycle(cfg);
    expect(r1.resumeSpawned).toBe(true);
    expect(lockIsStale(lockFile)).toBe(false); // held while the resume child runs
    spawned[0]?.emit("exit", 0);
    const r2 = await runMonitorCycle(cfg);
    expect(r2.resumeSpawned).toBe(true);
    expect(spawned).toHaveLength(2);
    releaseLock(lockFile);
  });

  it("counts a ready-set failure but still wakes on a foreign comment", async () => {
    const root = makeRoot("partial");
    const spawned: string[][] = [];
    const fetch: BothyFetch = async ({ tool }) => {
      if (tool === "bothy-board.tasks.next") throw new Error("next down");
      return {
        structuredContent: { comments: [{ id: "cmt_x", authorName: "member", body: "wake" }] },
        httpStatus: 200,
      };
    };
    const cfg = configFor(root, {
      fetch,
      spawnResume: (session, prompt) => {
        spawned.push([session, prompt]);
        return new FakeChild(1);
      },
    });
    const result = await runMonitorCycle(cfg);
    expect(result.resumeSpawned).toBe(true);
    expect(loadMonitorState(stateFile(root)).consecutiveFailures).toBe(1);
  });

  it("steals a stale lock whose owner pid is dead", () => {
    const root = makeRoot("stale");
    const lockFile = join(root, ".openclinxr/openclaw/codex-bothy-event-monitor.lock");
    writeFileSync(lockFile, JSON.stringify({ pid: 2147483647, createdAt: Date.now() }));
    expect(lockIsStale(lockFile)).toBe(true);
    expect(acquireLock(lockFile)).toBe(true);
    releaseLock(lockFile);
  });

  it("coalesces event ids into one wake prompt", () => {
    const prompt = buildWakePrompt(["cmt_1", "ready:tsk_a"]);
    expect(prompt).toContain("cmt_1");
    expect(prompt).toContain("ready:tsk_a");
  });

  it("parseMonitorArgs requires a session id and a bb_pat_ token", () => {
    expect("error" in parseMonitorArgs([], {})).toBe(true);
    expect(
      "error" in parseMonitorArgs(["--session", SESSION], { BOTHY_BOARD_PAT: PAT }),
    ).toBe(false);
    expect("error" in parseMonitorArgs(["--session", SESSION, "--pat", "not-a-pat"])).toBe(true);
    expect(
      "error" in
        parseMonitorArgs(
          ["--session", SESSION, "--pat", PAT, "--interval-ms", "100"],
          {},
        ),
    ).toBe(true);
    const ok = parseMonitorArgs(["--session", SESSION, "--pat", PAT], {});
    expect(ok).toHaveProperty("args.sessionId", SESSION);
  });

  it("monitorMain exits 2 on usage errors without touching the network", async () => {
    expect(await monitorMain([])).toBe(2);
    expect(await monitorMain(["--session", SESSION, "--pat", "bad"])).toBe(2);
  });
});
