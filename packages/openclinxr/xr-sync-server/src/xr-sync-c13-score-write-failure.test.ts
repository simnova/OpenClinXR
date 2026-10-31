import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, type EncounterSnapshot, type IntentKind } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C13 root RED (2026-10-30): a score that cannot be written must not be acknowledged.
// The author's writeFacultyScore swallowed fs errors, so the reviewer saw an ack and scoreChecked for a score
// that never reached disk. Contract: write failure -> reject "score-write-failed", state.scoreChecked unchanged.

const RUBRIC = [{ id: "r1", label: "one" }, { id: "r2", label: "two" }];
const ev = (kind: string, extra: Record<string, unknown> = {}) => ({ seq: null, kind, actorId: "", turnId: null, ...extra });

function writeReviewDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "xr-sync-c13w-replay-"));
  writeFileSync(join(dir, "W1.conversation-trace.json"), JSON.stringify({
    schema: "openclinxr.xr-sync.conversation-trace.v1",
    stationId: "station-1",
    events: ["doorway", "encounter", "note", "closed"].map((phase) => ev("phase-changed", { phase })),
    turns: [],
    emotions: [],
  }));
  writeFileSync(join(dir, "exam-session.review-index.json"), JSON.stringify({
    schema: "openclinxr.xr-sync.exam-session-review-index.v1", complete: true, stationCount: 1,
    stations: [{
      stationId: "station-1", stationIndex: 0, traceFile: "W1.conversation-trace.json", phases: ["doorway", "encounter", "note", "closed"],
      turnCount: 0, turnEnds: [], observerPresent: false, notePresent: false, noteChars: 0, noteFile: null,
    }],
  }));
  return dir;
}

const servers: EncounterServer[] = [];
afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close().catch(() => undefined);
});

describe("xr-sync-server C13 score write failure", () => {
  it("rejects score-write-failed and leaves scoreChecked unchanged when the score cannot be written", async () => {
    const blocker = join(mkdtempSync(join(tmpdir(), "xr-sync-c13w-")), "not-a-dir");
    writeFileSync(blocker, "a regular file where scoreDir should be");
    const server = await (createEncounterServer as (o: Record<string, unknown>) => Promise<EncounterServer>)({
      replayDir: writeReviewDir(), scoreDir: blocker, reviewRubric: RUBRIC, replayStepMs: 100,
    });
    servers.push(server);
    const c = await connect(server.url, { roomOptions: { replayStationId: "station-1" } });
    let last: (EncounterSnapshot & { scoreChecked?: number; mode?: string }) | null = null;
    c.onState((s) => {
      last = s as typeof last;
    });
    const deadline = Date.now() + 5000;
    while ((last as { mode?: string } | null)?.mode !== "replay" && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    const result = await c.sendIntent("score-station" as IntentKind, { items: { r1: true, r2: true } });
    expect(result).toMatchObject({ status: "reject", reason: "score-write-failed" });
    await new Promise((r) => setTimeout(r, 200));
    expect((last as { scoreChecked?: number } | null)?.scoreChecked ?? 0).toBe(0);
    await c.leave();
  }, 30000);
});
