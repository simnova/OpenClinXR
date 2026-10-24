import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  inspectSeatedActorSeatPlacement,
  raceWithSignal,
  SharedCaptureOwnership,
  throwIfAborted,
} from "../seated-actor-seat-placement.js";
import { tryReadStampedArtifact } from "../lib/measurement-tree-stamp.js";

/**
 * GAP-1 rig: the REAL producer module above is exercised with Vitest-mocked
 * portless/slotted-browser dependencies (vi.mock of the two leaf modules the
 * producer awaits on). Everything else — inspect, SharedCaptureOwnership,
 * raceWithSignal, the geometry readers, the real finallies — runs unmodified.
 * No real Chrome, no dev server.
 */
const producerMocks = vi.hoisted(() => {
  const calls = {
    spawns: [] as Array<{ filter: string; readyTimeoutMs: number }>,
    launches: [] as Array<{ signal?: AbortSignal }>,
    stops: [] as Array<unknown>,
    gotos: [] as Array<{ url: string }>,
    closes: [] as Array<string>,
  };
  const behavior = {
    spawnImpl: null as null | (() => Promise<{ port: number; url: string; proc: unknown }>),
    gotoImpl: null as null | (() => Promise<unknown>),
    evaluateQueue: [] as Array<unknown>,
  };
  const defaultServer = () => ({ port: 9, url: "http://127.0.0.1:9/", proc: { pid: 424242 } });
  return { calls, behavior, defaultServer };
});

vi.mock("../lib/portless-server.js", () => ({
  spawnPortlessDevServer: (opts: { filter: string; readyTimeoutMs: number }) => {
    producerMocks.calls.spawns.push({ filter: opts.filter, readyTimeoutMs: opts.readyTimeoutMs });
    return producerMocks.behavior.spawnImpl?.() ?? Promise.resolve(producerMocks.defaultServer());
  },
  stopPortlessDevServer: (proc: unknown) => {
    producerMocks.calls.stops.push(proc);
    return Promise.resolve();
  },
}));

vi.mock("../lib/slotted-playwright.js", () => ({
  chromium: {
    launch: (opts: { headless?: boolean; signal?: AbortSignal } = {}) => {
      producerMocks.calls.launches.push({ signal: opts.signal });
      const page = {
        goto: (url: string) => {
          producerMocks.calls.gotos.push({ url });
          return producerMocks.behavior.gotoImpl?.() ?? Promise.resolve(null);
        },
        waitForFunction: () => Promise.resolve(true),
        waitForTimeout: () => Promise.resolve(),
        evaluate: () => {
          const next = producerMocks.behavior.evaluateQueue.shift();
          if (next === undefined) throw new Error("mock page.evaluate queue exhausted");
          return Promise.resolve(next);
        },
        close: () => {
          producerMocks.calls.closes.push("page");
          return Promise.resolve();
        },
      };
      const browser = {
        newPage: () => Promise.resolve(page),
        close: () => {
          producerMocks.calls.closes.push("browser");
          return Promise.resolve();
        },
      };
      return Promise.resolve(browser);
    },
  },
}));

/**
 * Fake-unit coverage for the shared capture-setup cancellation lifecycle.
 * No browser: exercises SharedCaptureOwnership refcount semantics only.
 */
describe("shared capture cancellation ownership", () => {
  it("aborts the shared signal only when every attached caller aborts", () => {
    const ownership = new SharedCaptureOwnership();
    const first = new AbortController();
    const second = new AbortController();
    const a = ownership.attach(first.signal);
    const b = ownership.attach(second.signal);
    expect(ownership.signal.aborted).toBe(false);
    first.abort(new Error("first abandoned"));
    expect(ownership.signal.aborted).toBe(false);
    second.abort(new Error("second abandoned"));
    expect(ownership.signal.aborted).toBe(true);
    a.release();
    b.release();
  });

  it("releasing one caller while another stays attached keeps the shared run alive", () => {
    const ownership = new SharedCaptureOwnership();
    const a = ownership.attach();
    const b = ownership.attach();
    a.release();
    expect(ownership.signal.aborted).toBe(false);
    b.release();
    expect(ownership.signal.aborted).toBe(true);
  });

  it("rejects an already-aborted caller without taking ownership", () => {
    const ownership = new SharedCaptureOwnership();
    const caller = new AbortController();
    caller.abort(new Error("already gone"));
    expect(() => ownership.attach(caller.signal)).toThrow();
    expect(ownership.signal.aborted).toBe(false);
  });

  it("stale invalidation: a forced re-run takes a fresh ownership, not the settled one", () => {
    const first = new SharedCaptureOwnership();
    const stay = new SharedCaptureOwnership();
    const a = first.attach();
    a.release();
    expect(first.signal.aborted).toBe(true);
    // A fresh ownership for the forced re-run is unaffected by the settled run.
    const b = stay.attach();
    expect(stay.signal.aborted).toBe(false);
    b.release();
    expect(stay.signal.aborted).toBe(true);
  });
});

/**
 * Cancellation-lifecycle falsifiers (fakes only — no browser, no dev server).
 * Each fails if the lifecycle regresses to fire-and-forget setup.
 */
describe("shared capture cancellation lifecycle (fakes)", () => {
  it("F1: one caller aborting detaches only itself; the survivor still gets rows", async () => {
    const ownership = new SharedCaptureOwnership();
    const aborter = new AbortController();
    const survivor = new AbortController();
    const a = ownership.attach(aborter.signal);
    const b = ownership.attach(survivor.signal);
    let resolveRun!: (value: string) => void;
    const run = new Promise<string>((resolve) => {
      resolveRun = resolve;
    });
    const waiterAborter = raceWithSignal(run, aborter.signal);
    const waiterSurvivor = raceWithSignal(run, survivor.signal);
    aborter.abort(new Error("aborter abandoned"));
    await expect(waiterAborter).rejects.toThrow("aborter abandoned");
    // Shared run survives a single detach: the other caller is legitimate.
    expect(ownership.signal.aborted).toBe(false);
    resolveRun("rows");
    await expect(waiterSurvivor).resolves.toBe("rows");
    a.release();
    b.release();
    expect(ownership.signal.aborted).toBe(true);
  });

  it("F2: all callers aborting closes queued slot wait and active browser/page/server promptly", async () => {
    const ownership = new SharedCaptureOwnership();
    const first = new AbortController();
    const second = new AbortController();
    const rel1 = ownership.attach(first.signal);
    const rel2 = ownership.attach(second.signal);
    const closed: string[] = [];
    const fakeRun = (async (): Promise<string> => {
      try {
        // Stands in for the queued slot wait: never resolves on its own.
        await raceWithSignal(new Promise<string>(() => {}), ownership.signal);
        return "never";
      } finally {
        // Mirrors the producer finallies: page, browser (slot release), server.
        closed.push("page", "browser", "server");
      }
    })();
    const waiter1 = raceWithSignal(fakeRun, first.signal);
    const waiter2 = raceWithSignal(fakeRun, second.signal);
    first.abort(new Error("first abandoned"));
    expect(ownership.signal.aborted).toBe(false);
    await expect(waiter1).rejects.toThrow("first abandoned");
    second.abort(new Error("second abandoned"));
    await expect(waiter2).rejects.toThrow("second abandoned");
    await expect(fakeRun).rejects.toThrow();
    expect(closed).toEqual(["page", "browser", "server"]);
    rel1.release();
    rel2.release();
  });

  it("F3: an aborted capture is never cached; retry takes a fresh run, not the settled one", async () => {
    const cached = new Map<string, string>();
    const inFlight = new Map<string, Promise<string>>();
    const firstOwnership = new SharedCaptureOwnership();
    const caller = new AbortController();
    const { release } = firstOwnership.attach(caller.signal);
    const firstRun = (async (): Promise<string> => {
      try {
        await raceWithSignal(new Promise<string>(() => {}), firstOwnership.signal);
        cached.set("peds_asthma_parent_anxiety_v1", "rows");
        return "rows";
      } finally {
        release();
        inFlight.delete("peds_asthma_parent_anxiety_v1");
      }
    })();
    inFlight.set("peds_asthma_parent_anxiety_v1", firstRun);
    const callerWait = raceWithSignal(firstRun, caller.signal);
    caller.abort(new Error("abandoned"));
    await expect(callerWait).rejects.toThrow("abandoned");
    await expect(firstRun).rejects.toThrow();
    expect(cached.has("peds_asthma_parent_anxiety_v1")).toBe(false);
    expect(inFlight.has("peds_asthma_parent_anxiety_v1")).toBe(false);
    // Retry takes a fresh ownership + fresh run, unaffected by the aborted one.
    const retryOwnership = new SharedCaptureOwnership();
    expect(retryOwnership.signal.aborted).toBe(false);
    throwIfAborted(retryOwnership.signal);
    const retry = Promise.resolve("rows").then((rows) => {
      cached.set("peds_asthma_parent_anxiety_v1", rows);
      return rows;
    });
    await expect(retry).resolves.toBe("rows");
    expect(cached.get("peds_asthma_parent_anxiety_v1")).toBe("rows");
    expect(throwIfAborted(undefined)).toBeUndefined();
  });

  it("F4: source/asset stamp change forces regeneration (stale disk artifact refused)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "seated-stamp-"));
    try {
      const file = join(dir, "peds_asthma_parent_anxiety_v1.json");
      const stamp = {
        head: "abc1234",
        fingerprint: "f".repeat(64),
        algorithm: "git-head+status+diff-sha256" as const,
      };
      const extract = (parsed: Record<string, unknown>): { rows: number[] } | null => {
        if ((parsed as { scenarioId?: unknown }).scenarioId !== "peds_asthma_parent_anxiety_v1") return null;
        return parsed as unknown as { rows: number[] };
      };
      writeFileSync(file, JSON.stringify({ treeStamp: stamp, scenarioId: "peds_asthma_parent_anxiety_v1", rows: [1] }));
      // Matching stamp: cache served.
      const fresh = await tryReadStampedArtifact(file, extract, { currentStamp: stamp });
      expect(fresh).not.toBeNull();
      // Source/asset tree moved: same bytes on disk are refused, forcing re-measure.
      const moved = { ...stamp, fingerprint: "0".repeat(64) };
      const stale = await tryReadStampedArtifact(file, extract, { currentStamp: moved });
      expect(stale).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * GAP-1 closure: the REAL inspectSeatedActorSeatPlacement with mocked
 * browser/server leaves. Proves the actual finally chain (page/browser/owned
 * server), the refcount join semantics, the late-boot stop, and the
 * identity-safe in-flight cleanup — not a synthetic mirror of them.
 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const MOCK_ACTOR = "parent_tara_johnson_v1";
const MOCK_SHELL_READY = { ready: true, reason: null, environmentId: "ed_exam_bay_v1" };
const MOCK_LIVE = {
  scenarioId: "mock-seated",
  actors: [
    { actorId: MOCK_ACTOR, declaredPosture: "seated", lowestVertexY: 0.129, framesAdvanced: 24 },
  ],
};
const MOCK_SEAT_FACTS = {
  framesAdvanced: 24,
  environmentId: "ed_exam_bay_v1",
  chair: {
    slotId: "family_chair",
    worldX: -0.55,
    worldZ: -0.75,
    seatTopWorldY: 0.45,
    seatHeightMeters: 0.45,
  },
  actors: [
    {
      actorId: MOCK_ACTOR,
      postureTag: "seated",
      slotWorldX: -0.552,
      slotWorldZ: -0.75,
      slotLocalY: 0,
      slotKind: "family",
      encounterStaging: null,
      dynamicScenePolicy: null,
      floorStandingFrame: null,
      pelvisWorldY: 0.487,
      pelvisBoneName: "pelvis",
      lowestSupportBoneWorldY: 0.269,
    },
  ],
};

function queueSuccessReads(): void {
  producerMocks.behavior.evaluateQueue = [MOCK_SHELL_READY, MOCK_LIVE, MOCK_SEAT_FACTS];
}

describe("real producer cancellation with mocked browser/server (GAP-1)", () => {
  beforeEach(() => {
    producerMocks.calls.spawns.length = 0;
    producerMocks.calls.launches.length = 0;
    producerMocks.calls.stops.length = 0;
    producerMocks.calls.gotos.length = 0;
    producerMocks.calls.closes.length = 0;
    producerMocks.behavior.spawnImpl = null;
    producerMocks.behavior.gotoImpl = null;
    producerMocks.behavior.evaluateQueue = [];
  });

  it("G1: abort during pending page.goto closes REAL page/browser/server, caches nothing, retry works", async () => {
    const gotoGate = deferred<unknown>();
    producerMocks.behavior.gotoImpl = () => gotoGate.promise;
    queueSuccessReads();
    const caller = new AbortController();
    const pending = inspectSeatedActorSeatPlacement({
      scenarioId: "mock-seated-g1",
      force: true,
      signal: caller.signal,
    });
    await vi.waitFor(() => {
      if (producerMocks.calls.gotos.length !== 1) throw new Error("run has not reached goto");
    });
    caller.abort(new Error("abandoned"));
    await expect(pending).rejects.toThrow("abandoned");
    // The REAL slotted launch received the SHARED ownership signal (not the
    // caller signal directly — refcount design): the caller abort detached,
    // live hit 0, the shared controller fired, and the launch observed it.
    expect(producerMocks.calls.launches).toHaveLength(1);
    const launchedSignal = producerMocks.calls.launches[0]?.signal;
    expect(launchedSignal).toBeInstanceOf(AbortSignal);
    expect(launchedSignal).not.toBe(caller.signal);
    expect(launchedSignal?.aborted).toBe(true);
    // The REAL finallies closed what the run owned.
    expect(producerMocks.calls.closes).toContain("page");
    expect(producerMocks.calls.closes).toContain("browser");
    expect(producerMocks.calls.stops).toHaveLength(1);

    // Retry with a fresh signal: the aborted capture was never cached, and a
    // forced re-run measures honestly and caches valid success rows.
    producerMocks.behavior.gotoImpl = null;
    queueSuccessReads();
    const rows = await inspectSeatedActorSeatPlacement({ scenarioId: "mock-seated-g1", force: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorId).toBe(MOCK_ACTOR);
    expect(rows[0]?.pelvisWorldY).toBe(0.487);
    expect(rows[0]?.chairWorldX).toBe(-0.55);
    const spawnsAfterRetry = producerMocks.calls.spawns.length;
    const cached = await inspectSeatedActorSeatPlacement({ scenarioId: "mock-seated-g1" });
    expect(cached).toEqual(rows);
    expect(producerMocks.calls.spawns.length).toBe(spawnsAfterRetry);
  });

  it("G2: one caller aborting does not kill the other legit producer waiter", async () => {
    const gotoGate = deferred<unknown>();
    producerMocks.behavior.gotoImpl = () => gotoGate.promise;
    queueSuccessReads();
    const first = new AbortController();
    const second = new AbortController();
    const pA = inspectSeatedActorSeatPlacement({
      scenarioId: "mock-seated-g2",
      force: true,
      signal: first.signal,
    });
    const pB = inspectSeatedActorSeatPlacement({ scenarioId: "mock-seated-g2", signal: second.signal });
    await vi.waitFor(() => {
      if (producerMocks.calls.gotos.length !== 1) throw new Error("shared run has not reached goto");
    });
    first.abort(new Error("first abandoned"));
    await expect(pA).rejects.toThrow("first abandoned");
    // Shared run survives the single detach: nothing closed yet.
    expect(producerMocks.calls.closes).toEqual([]);
    expect(producerMocks.calls.spawns).toHaveLength(1);
    gotoGate.resolve(null);
    const rows = await pB;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.pelvisWorldY).toBe(0.487);
    expect(producerMocks.calls.closes).toContain("page");
    expect(producerMocks.calls.closes).toContain("browser");
    expect(producerMocks.calls.stops).toHaveLength(1);
    expect(producerMocks.calls.launches).toHaveLength(1);
  });

  it("G3: deferred boot + abort then late ready stops the late owned server without killing retry", async () => {
    const bootGate = deferred<{ port: number; url: string; proc: unknown }>();
    producerMocks.behavior.spawnImpl = () => bootGate.promise;
    const caller = new AbortController();
    const pending = inspectSeatedActorSeatPlacement({
      scenarioId: "mock-seated-g3",
      force: true,
      signal: caller.signal,
    });
    await vi.waitFor(() => {
      if (producerMocks.calls.spawns.length !== 1) throw new Error("boot not started");
    });
    caller.abort(new Error("abandoned"));
    await expect(pending).rejects.toThrow("abandoned");
    // Late ready AFTER abandon: the producer stops the orphaned boot (eventual
    // cleanup). The real helper has no cancellation; this stop-after-resolve is
    // the documented bound, not immediate termination.
    const lateProc = { pid: 777001 };
    bootGate.resolve({ port: 71, url: "http://127.0.0.1:71/", proc: lateProc });
    await vi.waitFor(() => {
      if (!producerMocks.calls.stops.includes(lateProc)) throw new Error("late server not stopped yet");
    });

    // Retry is unaffected: fresh boot, full success, its own normal teardown.
    const retryProc = { pid: 777002 };
    producerMocks.behavior.spawnImpl = () =>
      Promise.resolve({ port: 72, url: "http://127.0.0.1:72/", proc: retryProc });
    producerMocks.behavior.gotoImpl = null;
    queueSuccessReads();
    const rows = await inspectSeatedActorSeatPlacement({ scenarioId: "mock-seated-g3", force: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorId).toBe(MOCK_ACTOR);
    expect(producerMocks.calls.stops).toContain(retryProc);
  });

  it("G4: forced re-run overwriting in-flight entries is not orphaned by the older run settling", async () => {
    const boot1 = deferred<{ port: number; url: string; proc: unknown }>();
    const boot2 = deferred<{ port: number; url: string; proc: unknown }>();
    const gotoGate = deferred<unknown>();
    let boots = 0;
    producerMocks.behavior.spawnImpl = () => {
      boots += 1;
      return boots === 1 ? boot1.promise : boot2.promise;
    };
    producerMocks.behavior.gotoImpl = () => gotoGate.promise;
    const first = new AbortController();
    const p1 = inspectSeatedActorSeatPlacement({
      scenarioId: "mock-seated-g4",
      force: true,
      signal: first.signal,
    });
    // Forced re-run overwrites the in-flight maps with its own run/ownership.
    const p2 = inspectSeatedActorSeatPlacement({ scenarioId: "mock-seated-g4", force: true });
    await vi.waitFor(() => {
      if (producerMocks.calls.spawns.length !== 2) throw new Error("both boots not started");
    });
    first.abort(new Error("first abandoned"));
    await expect(p1).rejects.toThrow("first abandoned");
    // Identity-safe finally: the older run must not delete the newer run's
    // entries, so a late joiner joins run 2 instead of spawning run 3.
    const third = new AbortController();
    const p3 = inspectSeatedActorSeatPlacement({ scenarioId: "mock-seated-g4", signal: third.signal });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(producerMocks.calls.spawns).toHaveLength(2);
    queueSuccessReads();
    boot2.resolve({ port: 73, url: "http://127.0.0.1:73/", proc: { pid: 777003 } });
    await vi.waitFor(() => {
      if (producerMocks.calls.gotos.length !== 1) throw new Error("run 2 has not reached goto");
    });
    gotoGate.resolve(null);
    const [rows2, rows3] = await Promise.all([p2, p3]);
    expect(rows2).toHaveLength(1);
    expect(rows3).toEqual(rows2);
  });
});
