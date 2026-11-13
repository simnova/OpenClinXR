import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

const FIXTURE_PATH = new URL("./xr-sync-c47-explicit-note.fixture.json", import.meta.url);
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as { trace: { stationId: string; scenarioId: string; events: Record<string, unknown>[]; turns: unknown[]; emotions: unknown[]; cast?: unknown } };
const STEP_MS = 200;
const servers: EncounterServer[] = [];
const clients: SyncConnection[] = [];

afterEach(async () => {
  while (clients.length > 0) await clients.pop()?.leave().catch(() => undefined);
  while (servers.length > 0) await servers.pop()?.close().catch(() => undefined);
});

function replayDir(withReady: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "xs-ready-replay-"));
  const traceFile = "xs-ready.conversation-trace.json";
  const ready = { seq: null, kind: "station-ready", actorId: "", turnId: null };
  const trace = { ...fixture.trace, events: withReady ? [ready, ...fixture.trace.events] : fixture.trace.events };
  writeFileSync(join(dir, traceFile), JSON.stringify(trace));
  writeFileSync(join(dir, "exam-session.review-index.json"), JSON.stringify({
    schema: "openclinxr.xr-sync.exam-session-review-index.v1",
    complete: true,
    stationCount: 1,
    stations: [{ stationId: trace.stationId, stationIndex: 0, scenarioId: trace.scenarioId, traceFile, phases: ["doorway", "encounter", "note", "closed"], turnCount: 0, turnEnds: [], observerPresent: false, notePresent: false, noteChars: 0, noteFile: null }],
  }));
  return dir;
}

async function play(withReady: boolean): Promise<{ phases: string[]; offsets: number[]; started: boolean[] }> {
  const server = await createEncounterServer({ replayDir: replayDir(withReady), replayStepMs: STEP_MS });
  servers.push(server);
  const connection = await connect(server.url, { roomOptions: { replayStationId: fixture.trace.stationId } });
  clients.push(connection);
  const phases: string[] = [];
  const offsets: number[] = [];
  const started: boolean[] = [];
  const began = Date.now();
  let done = false;
  connection.onState((snapshot) => {
    if (snapshot.phase !== "" && phases.at(-1) !== snapshot.phase) {
      phases.push(snapshot.phase);
      offsets.push(Date.now() - began);
      started.push(snapshot.stationStarted === true);
    }
    done = snapshot.replayDone === true;
  });
  const deadline = Date.now() + 5000;
  while (!done && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(done).toBe(true);
  return { phases, offsets, started };
}

describe("XS-READY station replay compatibility", () => {
  it("C4: committed no-ready trace keeps its phase sequence and recorded event-step timing", async () => {
    const replay = await play(false);
    expect(replay.phases).toEqual(["doorway", "encounter", "note", "closed"]);
    const deltas = replay.offsets.slice(1).map((at, index) => at - (replay.offsets[index] ?? 0));
    expect(deltas[0]).toBeGreaterThanOrEqual(STEP_MS - 100);
    expect(deltas[0]).toBeLessThanOrEqual(STEP_MS + 100);
    expect(deltas[1]).toBeGreaterThanOrEqual(STEP_MS - 100);
    expect(deltas[1]).toBeLessThanOrEqual(STEP_MS + 100);
    expect(deltas[2]).toBeGreaterThanOrEqual(STEP_MS * 2 - 100);
    expect(deltas[2]).toBeLessThanOrEqual(STEP_MS * 2 + 100);
  });

  it("C4: a new station-ready event starts replay doorway at that event", async () => {
    const replay = await play(true);
    expect(replay.phases).toEqual(["doorway", "encounter", "note", "closed"]);
    expect(replay.started[0]).toBe(true);
    expect(replay.offsets[0]).toBeGreaterThanOrEqual(STEP_MS - 100);
    expect(replay.offsets[0]).toBeLessThanOrEqual(STEP_MS + 100);
  });
});
