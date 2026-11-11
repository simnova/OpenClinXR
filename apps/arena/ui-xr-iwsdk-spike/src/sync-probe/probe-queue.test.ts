/**
 * ackts-01 RED: finalize-review ack serverTs must land in probe.ackServerTsBySeq.
 *
 * Pre-fix record: C1/C2 fail because IntentQueueProbe has no ackServerTsBySeq.
 */
import type { SyncConnection } from "@openclinxr/xr-sync-client/headset";
import { describe, expect, it } from "vitest";
import { createIntentQueue, type IntentQueueProbe } from "./probe-queue.js";

type ProbeWithAckTs = IntentQueueProbe & { ackServerTsBySeq?: Record<number, number> };
type IntentResult = Awaited<ReturnType<SyncConnection["sendIntent"]>>;

function makeProbe(): ProbeWithAckTs {
  return {
    sent: 0,
    sentSeqs: [],
    sentByKind: {},
    sentSeqsByKind: {},
    lastSentPose: null,
    acks: 0,
    ackSeqs: [],
    ackServerTsBySeq: {},
    rejects: 0,
    rejectDetails: [],
    rttMs: [],
  } as ProbeWithAckTs;
}

async function waitForSettle(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (condition()) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function fakeConnection(behavior: (kind: string) => Promise<IntentResult>): SyncConnection {
  return {
    sendIntent: ((kind: string) => behavior(kind)) as SyncConnection["sendIntent"],
  } as SyncConnection;
}

describe("probe-queue ack serverTs (ackts-01)", () => {
  it("C1 finalize-review ack serverTs recorded by seq", async () => {
    const probe = makeProbe();
    const connection = fakeConnection(async () => ({ status: "ack", seq: 4, serverTs: 1234, rttMs: 5 }));
    const queue = createIntentQueue(connection, probe, waitForSettle);
    await queue.sendIntentAndSettle("finalize-review", {});
    expect(probe.ackServerTsBySeq?.[4]).toBe(1234);
  });

  it("C2 control: pose ack serverTs recorded by seq", async () => {
    const probe = makeProbe();
    const connection = fakeConnection(async () => ({ status: "ack", seq: 3, serverTs: 1200, rttMs: 2 }));
    const queue = createIntentQueue(connection, probe, waitForSettle);
    await queue.sendIntentAndSettle("pose", { x: 0, y: 1.6, z: 0 });
    expect(probe.ackServerTsBySeq?.[3]).toBe(1200);
  });

  it("C3 reject records no serverTs entry", async () => {
    const probe = makeProbe();
    const connection = fakeConnection(async () => ({ status: "reject", seq: 5, reason: "nope", rttMs: 1 }));
    const queue = createIntentQueue(connection, probe, waitForSettle);
    await queue.sendIntentAndSettle("score-station", {});
    expect(Object.hasOwn(probe.ackServerTsBySeq ?? {}, 5)).toBe(false);
    expect(probe.rejects).toBe(1);
  });

  it("C4 send failure records no serverTs entry", async () => {
    const probe = makeProbe();
    const connection = fakeConnection(async () => {
      throw new Error("boom");
    });
    const queue = createIntentQueue(connection, probe, waitForSettle);
    await queue.sendIntentAndSettle("note-submit", { text: "hi" });
    expect(Object.values(probe.ackServerTsBySeq ?? {}).length).toBe(0);
    expect(probe.rejects).toBe(1);
  });
});
