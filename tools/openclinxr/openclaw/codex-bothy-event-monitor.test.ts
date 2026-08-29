import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { BothyFetch } from "./board-bothy-dequeue.js";
import {
  acquireLock,
  buildCodexExecArgv,
  buildWakePrompt,
  DEFAULT_CODEX_COORDINATOR_MODEL,
  DEFAULT_CODEX_SANDBOX,
  DEFAULT_SELF_MARKER,
  emptyMonitorState,
  loadMonitorState,
  lockIsStale,
  monitorMain,
  monitorPollDelay,
  OPENCLINXR_PROJECT_ID,
  parseMonitorArgs,
  pollOpenClinXrSync,
  releaseLock,
  runMonitorCycle,
  saveMonitorState,
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
    spawnCodex: () => new FakeChild(424242),
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
  it("first-run bootstrap seeds foreign comments and the ready snapshot silently", async () => {
    const root = makeRoot("bootstrap");
    const spawned: string[][] = [];
    const { fetch } = recordingFetch((tool) => {
      if (tool === "bothy-board.mailbox.poll") {
        return {
          comments: [
            {
              id: "cmt_h1",
              authorName: "member",
              body: "historical one",
              createdAt: "2026-08-29T20:01:00.000Z",
            },
            {
              id: "cmt_h2",
              authorName: "member",
              body: "historical two",
              createdAt: "2026-08-29T20:02:00.000Z",
            },
          ],
        };
      }
      return {
        tasks: [{ id: "tsk_a", projectId: OPENCLINXR_PROJECT_ID }],
        readyIds: ["tsk_a"],
        cacheToken: "tokA",
      };
    });
    const result = await runMonitorCycle(
      configFor(root, {
        fetch,
        spawnCodex: (prompt, repoRoot) => {
          spawned.push([prompt, repoRoot]);
          return new FakeChild(1);
        },
      }),
    );
    expect(result.meaningful).toBe(false);
    expect(result.codexSpawned).toBe(false);
    expect(result.stdoutLines).toEqual([]);
    expect(spawned).toEqual([]);
    const state = loadMonitorState(stateFile(root));
    expect(state.seeded).toBe(true);
    expect(state.seenCommentIds).toEqual(["cmt_h1", "cmt_h2"]);
    expect(state.mailboxSinceByTaskId).toEqual({
      tsk_watch: "2026-08-29T20:02:00.000Z",
    });
    expect(state.lastReadyTaskId).toBe("tsk_a");
    expect(state.cacheToken).toBe("tokA");
  });

  it("bootstrap stays unseeded while polls fail and emits nothing", async () => {
    const root = makeRoot("bootstrap-fail");
    const failingFetch: BothyFetch = async () => {
      throw new Error("network down");
    };
    const result = await runMonitorCycle(configFor(root, { fetch: failingFetch }));
    expect(result.meaningful).toBe(false);
    expect(result.codexSpawned).toBe(false);
    expect(result.stdoutLines).toEqual([]);
    const state = loadMonitorState(stateFile(root));
    expect(state.seeded).toBe(false);
    expect(state.consecutiveFailures).toBe(1);
  });

  it("wakes on a later run only for a new foreign comment", async () => {
    const root = makeRoot("delta");
    const spawned: string[][] = [];
    let commentSeq = 0;
    const { fetch } = recordingFetch((tool) => {
      if (tool === "bothy-board.mailbox.poll") {
        commentSeq += 1;
        if (commentSeq === 1) {
          return { comments: [{ id: "cmt_old", authorName: "member", body: "history" }] };
        }
        return { comments: [{ id: "cmt_new", authorName: "member", body: "delta" }] };
      }
      return { task: null, cacheToken: "tok1" };
    });
    const spawnCodex = (prompt: string, repoRoot: string) => {
      spawned.push([prompt, repoRoot]);
      return new FakeChild(1);
    };
    const r1 = await runMonitorCycle(configFor(root, { fetch, spawnCodex }));
    expect(r1.meaningful).toBe(false);
    expect(r1.codexSpawned).toBe(false);
    expect(spawned).toEqual([]);
    const r2 = await runMonitorCycle(configFor(root, { fetch, spawnCodex }));
    expect(r2.meaningful).toBe(true);
    expect(r2.codexSpawned).toBe(true);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.[0]).toContain("cmt_new");
    expect(spawned[0]?.[0]).not.toContain("cmt_old");
    expect(loadMonitorState(stateFile(root)).seenCommentIds).toEqual(["cmt_old", "cmt_new"]);
  });

  it("idle cycles after seeding emit no stdout and spawn no codex", async () => {
    const root = makeRoot("idle");
    const spawned: string[][] = [];
    const { fetch } = recordingFetch((tool) => {
      if (tool === "bothy-board.mailbox.poll") return { comments: [] };
      return { task: null, cacheToken: "tok1" };
    });
    const spawnCodex = (prompt: string, repoRoot: string) => {
      spawned.push([prompt, repoRoot]);
      return new FakeChild(1);
    };
    const r1 = await runMonitorCycle(configFor(root, { fetch, spawnCodex }));
    const r2 = await runMonitorCycle(configFor(root, { fetch, spawnCodex }));
    expect(r1.stdoutLines).toEqual([]);
    expect(r2.meaningful).toBe(false);
    expect(r2.stdoutLines).toEqual([]);
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
        spawnCodex: (prompt, repoRoot) => {
          spawned.push([prompt, repoRoot]);
          return new FakeChild(1);
        },
      }),
    );
    expect(result.meaningful).toBe(false);
    expect(result.codexSpawned).toBe(false);
    expect(spawned).toEqual([]);
    expect(loadMonitorState(stateFile(root)).seenCommentIds).toEqual([]);
  });

  it("already-seen comment ids do not re-wake", async () => {
    const root = makeRoot("seen");
    const spawned: string[][] = [];
    const { fetch } = recordingFetch((tool) => {
      if (tool === "bothy-board.mailbox.poll") {
        return { comments: [{ id: "cmt_seed", authorName: "member", body: "b" }] };
      }
      return { task: null, cacheToken: "tok1" };
    });
    const spawnCodex = (prompt: string, repoRoot: string) => {
      spawned.push([prompt, repoRoot]);
      return new FakeChild(1);
    };
    await runMonitorCycle(configFor(root, { fetch, spawnCodex }));
    await runMonitorCycle(configFor(root, { fetch, spawnCodex }));
    await runMonitorCycle(configFor(root, { fetch, spawnCodex }));
    expect(spawned).toHaveLength(0);
  });

  it("a new ready card wakes after seeding; unchanged replay does not", async () => {
    const root = makeRoot("ready");
    const spawned: string[][] = [];
    const children: FakeChild[] = [];
    let syncCalls = 0;
    const { fetch } = recordingFetch((tool) => {
      if (tool === "bothy-board.mailbox.poll") return { comments: [] };
      syncCalls += 1;
      if (syncCalls === 1) {
        return {
          tasks: [{ id: "tsk_a", projectId: OPENCLINXR_PROJECT_ID }],
          readyIds: ["tsk_a"],
          cacheToken: "tokA",
        };
      }
      if (syncCalls === 2) return { unchanged: true, cacheToken: "tokA" };
      return {
        tasks: [
          { id: "tsk_a", projectId: OPENCLINXR_PROJECT_ID },
          { id: "tsk_b", projectId: OPENCLINXR_PROJECT_ID },
        ],
        readyIds: ["tsk_a", "tsk_b"],
        cacheToken: "tokB",
      };
    });
    const spawnCodex = (prompt: string, repoRoot: string) => {
      spawned.push([prompt, repoRoot]);
      const child = new FakeChild(1);
      children.push(child);
      return child;
    };
    await runMonitorCycle(configFor(root, { fetch, spawnCodex }));
    expect(spawned).toHaveLength(0); // bootstrap: ready snapshot baselined, no wake
    await runMonitorCycle(configFor(root, { fetch, spawnCodex }));
    expect(spawned).toHaveLength(0); // unchanged replay of the same card → no wake
    await runMonitorCycle(configFor(root, { fetch, spawnCodex }));
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.[0]).toContain("ready:tsk_b");
    children[0]?.emit("exit", 0); // release the single-flight lock
  });

  it("refuses a second wake while the lock is held, leaving events unseen", async () => {
    const root = makeRoot("singleflight");
    const spawned: string[][] = [];
    let commentSeq = 0;
    const { fetch } = recordingFetch((tool) => {
      if (tool === "bothy-board.mailbox.poll") {
        commentSeq += 1;
        return { comments: [{ id: `cmt_${commentSeq}`, authorName: "member", body: "wake" }] };
      }
      return { task: null, cacheToken: "tok1" };
    });
    const lockFile = join(root, ".openclinxr/openclaw/codex-bothy-event-monitor.lock");
    const spawnCodex = (prompt: string, repoRoot: string) => {
      spawned.push([prompt, repoRoot]);
      return new FakeChild(1);
    };
    await runMonitorCycle(configFor(root, { fetch, spawnCodex, lockFile })); // seeds cmt_1
    expect(acquireLock(lockFile)).toBe(true); // held by this (alive) process
    const result = await runMonitorCycle(configFor(root, { fetch, spawnCodex, lockFile }));
    expect(result.codexRefused).toBe(true);
    expect(result.codexSpawned).toBe(false);
    expect(spawned).toEqual([]);
    expect(result.stdoutLines.join("\n")).toContain("CODEX_REFUSED");
    // The new event stays unseen so the wake retries once the lock frees.
    expect(loadMonitorState(stateFile(root)).seenCommentIds).toEqual(["cmt_1"]);
    releaseLock(lockFile);
  });

  it("reports DEGRADED but never permanently stops for transient failures", async () => {
    const root = makeRoot("degraded");
    const failingFetch: BothyFetch = async () => {
      throw new Error("network down");
    };
    const cfg = configFor(root, { fetch: failingFetch, spawnCodex: () => new FakeChild(1) });
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
    expect(last?.stopped).toBe(false);
    expect(last?.stdoutLines.join("\n")).toContain("STILL_DEGRADED");
  });

  it("stops immediately for a permanent authentication failure", async () => {
    const root = makeRoot("auth-stop");
    const result = await runMonitorCycle(
      configFor(root, {
        fetch: async () => ({ structuredContent: {}, httpStatus: 403 }),
      }),
    );
    expect(result.permanentFailure).toBe(true);
    expect(result.stopped).toBe(true);
    expect(result.stdoutLines.join("\n")).toContain("authentication failure");
  });

  it("backs off transient failures to a bounded eight times interval", () => {
    expect(monitorPollDelay(45_000, 0)).toBe(45_000);
    expect(monitorPollDelay(45_000, 1)).toBe(90_000);
    expect(monitorPollDelay(45_000, 3)).toBe(360_000);
    expect(monitorPollDelay(45_000, 30)).toBe(360_000);
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
    const cfg = configFor(root, { fetch, spawnCodex: () => new FakeChild(1) });
    await runMonitorCycle(cfg);
    await runMonitorCycle(cfg);
    failing = false;
    await runMonitorCycle(cfg);
    expect(loadMonitorState(stateFile(root)).consecutiveFailures).toBe(0);
  });

  it("releases the single-flight lock when the spawned codex exits", async () => {
    const root = makeRoot("release");
    const children: FakeChild[] = [];
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
    const spawnCodex = (prompt: string, repoRoot: string) => {
      const child = new FakeChild(9000);
      children.push(child);
      return child;
    };
    const cfg = configFor(root, { fetch, spawnCodex, lockFile });
    const r1 = await runMonitorCycle(cfg); // bootstrap seeds cmt_1, no spawn
    expect(r1.codexSpawned).toBe(false);
    const r2 = await runMonitorCycle(cfg); // cmt_2 → spawn
    expect(r2.codexSpawned).toBe(true);
    expect(children).toHaveLength(1);
    expect(lockIsStale(lockFile)).toBe(false); // held while the codex child runs
    children[0]?.emit("exit", 0);
    const r3 = await runMonitorCycle(cfg); // cmt_3 → spawn again
    expect(r3.codexSpawned).toBe(true);
    expect(children).toHaveLength(2);
    releaseLock(lockFile);
  });

  it("counts a sync failure but still wakes on a foreign comment after seeding", async () => {
    const root = makeRoot("partial");
    const spawned: string[][] = [];
    let syncDown = false;
    let commentSeq = 0;
    const fetch: BothyFetch = async ({ tool }) => {
      if (tool === "bothy-board.mailbox.poll") {
        commentSeq += 1;
        return {
          structuredContent: {
            comments: [{ id: `cmt_${commentSeq}`, authorName: "member", body: "wake" }],
          },
          httpStatus: 200,
        };
      }
      if (tool === "bothy-board.sync") {
        if (syncDown) throw new Error("sync down");
        return { structuredContent: { tasks: [], readyIds: [], cacheToken: "tok1" }, httpStatus: 200 };
      }
      return { structuredContent: { task: null }, httpStatus: 200 };
    };
    const spawnCodex = (prompt: string, repoRoot: string) => {
      spawned.push([prompt, repoRoot]);
      return new FakeChild(1);
    };
    await runMonitorCycle(configFor(root, { fetch, spawnCodex })); // seeds cmt_1 cleanly
    syncDown = true;
    const result = await runMonitorCycle(configFor(root, { fetch, spawnCodex })); // cmt_2 → wake
    expect(result.codexSpawned).toBe(true);
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

  it("creates the state directory when missing", () => {
    const root = join(
      tmpdir(),
      `ocxr-bothy-monitor-mkdir-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    );
    const file = join(root, ".openclinxr/openclaw/codex-bothy-event-monitor-state.json");
    saveMonitorState(file, emptyMonitorState());
    expect(loadMonitorState(file).seeded).toBe(false);
  });

  it("coalesces event ids into one wake prompt carrying the self marker", () => {
    const prompt = buildWakePrompt(["cmt_1", "ready:tsk_a"]);
    expect(prompt).toContain("cmt_1");
    expect(prompt).toContain("ready:tsk_a");
    expect(prompt).toContain(DEFAULT_SELF_MARKER);
    expect(prompt).toContain("fail-closed");
    expect(prompt).toContain("canonical");
    expect(prompt).toContain("bothy-board skill");
    expect(prompt).toContain("at most 3");
    expect(prompt).toContain("deepseek-v4-flash");
    expect(prompt).toContain('modelDowngradeReason "budget constraints"');
    expect(prompt).toContain("deepseek-v4-flash-vision-exp only");
    expect(prompt).toContain("Owner-only operations are create, plant, cancel");
    expect(prompt).toContain("Independently verify");
    expect(prompt).toContain("never infer absence from sync");
    expect(prompt).toContain("Never use a Stop-hook");
  });

  it("sync is passive, passes cache/project hints, and fail-closes foreign ready ids", async () => {
    const { calls, fetch } = recordingFetch(() => ({
      project: { id: "prj_00cce0fc9b89992e" },
      tasks: [
        { id: "tsk_foreign", projectId: "prj_00cce0fc9b89992e" },
        { id: "tsk_ours", projectId: OPENCLINXR_PROJECT_ID },
      ],
      readyIds: ["tsk_foreign", "tsk_ours", "tsk_missing"],
      cacheToken: "tok-new",
    }));
    const snapshot = await pollOpenClinXrSync({ pat: PAT, cacheToken: "tok-old", fetch });
    expect(calls).toEqual([
      {
        tool: "bothy-board.sync",
        args: { projectId: OPENCLINXR_PROJECT_ID, cacheToken: "tok-old" },
      },
    ]);
    expect(snapshot.scopedReadyIds).toEqual(["tsk_ours"]);
    expect(snapshot.cacheToken).toBe("tok-new");
  });

  it("does not treat an empty mixed sync as proof that prior OpenClinXR readiness vanished", async () => {
    const root = makeRoot("sync-absence-unknown");
    saveMonitorState(stateFile(root), {
      ...emptyMonitorState(),
      seeded: true,
      lastReadyTaskId: "tsk_ours",
      lastReadyTaskIds: ["tsk_ours"],
      cacheToken: "tok-old",
    });
    const { fetch } = recordingFetch((tool) =>
      tool === "bothy-board.mailbox.poll"
        ? { comments: [] }
        : { project: { id: "prj_00cce0fc9b89992e" }, tasks: [], readyIds: [], cacheToken: "tok-new" },
    );
    const result = await runMonitorCycle(configFor(root, { fetch }));
    expect(result.meaningful).toBe(false);
    expect(loadMonitorState(stateFile(root)).lastReadyTaskIds).toEqual(["tsk_ours"]);
  });

  it("safe default delivery is a fresh bounded exec in the repo, never resume", () => {
    const root = "/repo";
    const prompt = buildWakePrompt(["cmt_1"], DEFAULT_SELF_MARKER);
    const argv = buildCodexExecArgv(root, prompt);
    expect(argv[0]).toBe("exec");
    expect(argv).toContain("--cd");
    expect(argv[argv.indexOf("--cd") + 1]).toBe(root);
    expect(argv).toContain("-s");
    expect(argv[argv.indexOf("-s") + 1]).toBe(DEFAULT_CODEX_SANDBOX);
    expect(argv.slice(0, -1).join(" ")).not.toContain("resume");
    expect(argv.join(" ")).not.toContain(SESSION);
    expect(argv).toContain("--model");
    expect(argv[argv.indexOf("--model") + 1]).toBe(DEFAULT_CODEX_COORDINATOR_MODEL);
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
