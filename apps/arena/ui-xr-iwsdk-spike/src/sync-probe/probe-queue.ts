/**
 * C7 probe intent queue: sequential intents out with per-intent settle.
 *
 * Split out of sync-probe.ts for the file-size gate. Arrival order == call
 * order == seq order, so every sent seq is acked in order on a healthy
 * server. The queue updates the shared probe counters; the page owns the
 * connection. The poll-until wait helper lives here too (moved from
 * sync-probe.ts): the queue's settle waits build on it.
 */
import type { IntentKind, SyncConnection } from "@openclinxr/xr-sync-client/headset";

/** Poll-until helper: resolves when condition holds, throws past the deadline. */
export async function waitFor(
  condition: () => boolean,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    if (condition()) {
      return;
    }
    if (performance.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Minimal probe counters the queue updates (SyncProbeEvidence subset). */
export interface IntentQueueProbe {
  sent: number;
  sentSeqs: number[];
  sentByKind: Record<string, number>;
  sentSeqsByKind: Record<string, number[]>;
  lastSentPose: { x: number; y: number; z: number; seq: number } | null;
  acks: number;
  ackSeqs: number[];
  rejects: number;
  rejectDetails: Array<{ seq: number; reason: string }>;
  rttMs: number[];
}

export interface IntentQueue {
  enqueueIntent(kind: IntentKind, payload: Record<string, unknown>): void;
  sendIntentAndSettle(kind: IntentKind, payload: Record<string, unknown>): Promise<void>;
}

export function createIntentQueue(
  connection: SyncConnection,
  probe: IntentQueueProbe,
  waitForSettle: (condition: () => boolean, timeoutMs: number, label: string) => Promise<void>,
): IntentQueue {
  let callIndex = 0;
  let tail: Promise<void> = Promise.resolve();

  function enqueueIntent(kind: IntentKind, payload: Record<string, unknown>): void {
    callIndex += 1;
    const seq = callIndex;
    if (kind === "pose") {
      const pose = payload as { x: number; y: number; z: number };
      probe.lastSentPose = { x: pose.x, y: pose.y, z: pose.z, seq };
    }
    probe.sent += 1;
    probe.sentSeqs.push(seq);
    probe.sentByKind[kind] = (probe.sentByKind[kind] ?? 0) + 1;
    let kindSeqs = probe.sentSeqsByKind[kind];
    if (kindSeqs === undefined) {
      kindSeqs = [];
      probe.sentSeqsByKind[kind] = kindSeqs;
    }
    kindSeqs.push(seq);
    tail = tail.then(async () => {
      try {
        const result = await connection.sendIntent(kind, payload);
        if (result.status === "ack") {
          probe.acks += 1;
          probe.ackSeqs.push(result.seq);
          probe.rttMs.push(Number(result.rttMs.toFixed(2)));
        } else {
          probe.rejects += 1;
          probe.rejectDetails.push({ seq: result.seq, reason: result.reason });
        }
      } catch (error) {
        probe.rejects += 1;
        probe.rejectDetails.push({
          seq,
          reason: `send-failed:${error instanceof Error ? error.message : String(error)}`.slice(0, 120),
        });
      }
    });
  }

  // One intent through the sequential queue; resolves once acked/rejected.
  async function sendIntentAndSettle(kind: IntentKind, payload: Record<string, unknown>): Promise<void> {
    const target = probe.sent + 1;
    enqueueIntent(kind, payload);
    await waitForSettle(() => probe.acks + probe.rejects >= target, 15000, `${kind} settled`);
  }

  return { enqueueIntent, sendIntentAndSettle };
}

export interface IntentDrainDeps {
  sent(): number;
  settled(): number;
  learnerCaughtUp(): boolean;
  skipLearnerCatchUp: boolean;
  waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void>;
}

/**
 * Script tail: every sent intent settled, then the server learner caught up
 * to the last seq (replay rooms never advance a learner seat, so c10 skips).
 */
export async function drainIntents(deps: IntentDrainDeps): Promise<void> {
  await deps.waitFor(() => deps.sent() > 0 && deps.settled() >= deps.sent(), 15000, "intent drain");
  if (!deps.skipLearnerCatchUp) {
    await deps.waitFor(() => deps.learnerCaughtUp(), 10000, "server learner caught up");
  }
}
