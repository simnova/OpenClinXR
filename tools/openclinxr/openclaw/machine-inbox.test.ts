import { describe, expect, it } from "vitest";

import {
  type InboxMessage,
  type InboxRegistry,
  type InboxRpc,
  type InboxState,
  machineNameFrom,
  type RpcReply,
  registerMachine,
  runWatch,
  type StateStore,
  sendMessage,
} from "./machine-inbox.js";

const REGISTRY: InboxRegistry = {
  projectId: "prj_p",
  broadcastTaskId: "tsk_bc",
  machines: { alpha: "tsk_alpha", beta: "tsk_beta" },
};

type Call = { method: string; params: Record<string, unknown> };

// A watcher that outlives its script stops instead of spinning, so a broken exit path fails fast.
let scriptLeft = () => 1;

function scriptedRpc(replies: Array<RpcReply | Error>): { rpc: InboxRpc; calls: Call[] } {
  scriptLeft = () => replies.length;
  const calls: Call[] = [];
  const rpc: InboxRpc = async (method, params) => {
    calls.push({ method, params });
    const next = replies.shift();
    if (!next) throw new Error("script exhausted");
    if (next instanceof Error) throw next;
    return next;
  };
  return { rpc, calls };
}

function memoryState(initial?: Partial<InboxState>): StateStore & { current: () => InboxState } {
  let s: InboxState = { subscriptionId: null, subscribedTaskIds: [], cursor: null, ...initial };
  return { read: () => s, write: (n) => (s = n), current: () => s };
}

const sub = (id = "sub_1", cursor = "c0"): RpcReply => ({ httpStatus: 200, result: { id, cursor } });
const page = (events: Array<{ taskId: string; body: string; id?: string }>, cursor: string, hasMore = false): RpcReply => ({
  httpStatus: 200,
  result: {
    events: events.map((e, i) => ({ eventId: e.id ?? `cmt_${i}`, data: { taskId: e.taskId, body: e.body } })),
    cursor,
    hasMore,
  },
});

function watchOpts(rpc: InboxRpc, state: StateStore, extra: Partial<Parameters<typeof runWatch>[0]> = {}) {
  const logged: InboxMessage[] = [];
  const emitted: string[] = [];
  const sleeps: number[] = [];
  return {
    logged,
    emitted,
    sleeps,
    opts: {
      rpc,
      registry: REGISTRY,
      machine: "alpha",
      state,
      log: (m: InboxMessage) => logged.push(m),
      emit: (l: string) => emitted.push(l),
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
      now: () => new Date("2026-11-10T00:00:00Z"),
      once: true,
      shouldStop: () => scriptLeft() === 0,
      ...extra,
    },
  };
}

describe("machine inbox", () => {
  it("names the machine from BOTHY_MACHINE_NAME, else the hostname without .local", () => {
    expect(machineNameFrom({}, "Box.local")).toBe("Box");
    expect(machineNameFrom({ BOTHY_MACHINE_NAME: "ci-1" }, "Box.local")).toBe("ci-1");
  });

  it("sends to the target machine's inbox with a from header, and 'all' to the broadcast card", async () => {
    const ok: RpcReply = { httpStatus: 200, result: { structuredContent: { id: "cmt_9" } } };
    const { rpc, calls } = scriptedRpc([ok, ok]);
    await sendMessage({ rpc, registry: REGISTRY, from: "alpha", to: "beta", text: "hi", harness: "claude" });
    await sendMessage({ rpc, registry: REGISTRY, from: "alpha", to: "all", text: "everyone" });
    const args = calls.map((c) => c.params.arguments as Record<string, unknown>);
    expect(args[0]).toMatchObject({ taskId: "tsk_beta", body: "from::alpha\nhi", authorName: "claude@alpha" });
    expect(args[1]).toMatchObject({ taskId: "tsk_bc", body: "from::alpha\neveryone" });
  });

  it("refuses an unknown machine and names the known ones", async () => {
    const { rpc, calls } = scriptedRpc([]);
    await expect(sendMessage({ rpc, registry: REGISTRY, from: "alpha", to: "gamma", text: "x" })).rejects.toThrow(
      /known: alpha, beta/,
    );
    expect(calls).toHaveLength(0);
  });

  it("long-polls inbox and broadcast, logs foreign mail, drops its own broadcast echo, and saves the cursor", async () => {
    const { rpc, calls } = scriptedRpc([
      sub(),
      page([], "c0"),
      page(
        [
          { taskId: "tsk_bc", body: "from::alpha\nmy own broadcast" },
          { taskId: "tsk_alpha", body: "from::beta\nping" },
        ],
        "c2",
      ),
    ]);
    const state = memoryState();
    const w = watchOpts(rpc, state);
    expect(await runWatch(w.opts)).toBe(0);
    expect(calls[0]?.params.arguments).toEqual({ taskIds: ["tsk_alpha", "tsk_bc"] });
    expect(calls[1]?.params).toMatchObject({ subscriptionId: "sub_1", cursor: "c0", waitMs: 20_000 });
    expect(w.logged.map((m) => [m.from, m.channel, m.body])).toEqual([["beta", "inbox", "from::beta\nping"]]);
    expect(state.current().cursor).toBe("c2");
    expect(JSON.parse(w.emitted[0] ?? "{}").from).toBe("beta");
  });

  it("resumes from a saved cursor instead of the fresh subscription's cursor", async () => {
    const { rpc, calls } = scriptedRpc([sub("sub_2", "fresh"), page([{ taskId: "tsk_alpha", body: "from::beta\nx" }], "c9")]);
    const state = memoryState({ cursor: "saved", subscribedTaskIds: ["tsk_alpha", "tsk_bc"] });
    await runWatch(watchOpts(rpc, state).opts);
    expect(calls[1]?.params.cursor).toBe("saved");
  });

  it("drains hasMore pages without waitMs", async () => {
    const { rpc, calls } = scriptedRpc([
      sub(),
      page([{ taskId: "tsk_alpha", body: "from::beta\n1" }], "c1", true),
      page([{ taskId: "tsk_alpha", body: "from::beta\n2" }], "c2"),
    ]);
    const w = watchOpts(rpc, memoryState());
    await runWatch(w.opts);
    expect(calls[2]?.params.waitMs).toBeUndefined();
    expect(w.logged).toHaveLength(2);
  });

  it("stops on 401 with FAILED in monitor mode and does not retry", async () => {
    const { rpc, calls } = scriptedRpc([{ httpStatus: 401 }]);
    const w = watchOpts(rpc, memoryState(), { mode: "monitor" });
    expect(await runWatch(w.opts)).toBe(2);
    expect(w.emitted).toEqual(["FAILED"]);
    expect(calls).toHaveLength(1);
  });

  it("backs off and stays up on 5xx and network errors", async () => {
    const { rpc } = scriptedRpc([
      sub(),
      { httpStatus: 503 },
      new Error("ECONNRESET"),
      page([{ taskId: "tsk_alpha", body: "from::beta\nok" }], "c1"),
    ]);
    const w = watchOpts(rpc, memoryState(), { mode: "monitor" });
    expect(await runWatch(w.opts)).toBe(0);
    expect(w.sleeps).toEqual([1000, 2000]);
    expect(w.emitted).toEqual(["DONE"]);
  });

  it("resubscribes with the same cursor when the subscription is gone", async () => {
    const { rpc, calls } = scriptedRpc([
      sub("sub_old", "c0"),
      { httpStatus: 200, error: { code: -32602, message: "Unknown subscription" } },
      sub("sub_new", "ignored"),
      page([{ taskId: "tsk_alpha", body: "from::beta\nx" }], "c1"),
    ]);
    await runWatch(watchOpts(rpc, memoryState()).opts);
    expect(calls.map((c) => c.method)).toEqual(["events/subscribe", "events/poll", "events/subscribe", "events/poll"]);
    expect(calls[3]?.params).toMatchObject({ subscriptionId: "sub_new", cursor: "c0" });
  });

  it("registers a machine only after the created card reads back with the asked title and project", async () => {
    const created: RpcReply = { httpStatus: 200, result: { structuredContent: { id: "tsk_gamma" } } };
    const back: RpcReply = {
      httpStatus: 200,
      result: { structuredContent: { task: { id: "tsk_gamma", title: "inbox: gamma", projectId: "prj_p" } } },
    };
    const { rpc, calls } = scriptedRpc([created, back]);
    const out = await registerMachine({ rpc, registry: REGISTRY, machine: "gamma" });
    expect(out.registry.machines.gamma).toBe("tsk_gamma");
    expect((calls[0]?.params.arguments as Record<string, unknown>).fields).toMatchObject({ factory_step: "instrument" });

    const wrong: RpcReply = { httpStatus: 200, result: { structuredContent: { task: { title: "other", projectId: "prj_p" } } } };
    const again = scriptedRpc([created, wrong]);
    await expect(registerMachine({ rpc: again.rpc, registry: REGISTRY, machine: "gamma" })).rejects.toThrow(/read-back/);
  });
});
