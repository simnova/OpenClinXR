import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C53 RED A (tsk_819aeb93cd2192e6). The blueprint carries timing.breakAfterStationOrders, but the server never reads it:
// exam-blueprint.ts derives doorway/encounter/note only, and the phase clock rotates at "closed". Contract:
//   examBlueprint.timing.breakSeconds (optional integer >= 0; absent -> 0 -> no break) is the ONLY break duration.
//   After the station whose slot order is in timing.breakAfterStationOrders reaches "closed", with breakSeconds > 0, the
//   room enters phase "break" for breakSeconds on the room clock (phaseRemainingS counting down), then rotates as today.
//   Never a break after the last station. An order that is not a slot order is refused at boot (message names
//   "examBlueprint"). During "break" conversation intents are refused with outside-encounter-phase; pose is accepted.
// Every phase sequence below is read from the station's persisted conversation trace (phase-changed events) and every
// remaining-second list from the server state's phaseRemainingS: the room clock, never Date arithmetic.
// Planted clauses are `it.fails`; flip each to `it(` when its behaviour lands (`live:` requires 0 remaining).
// Plain `it(` blocks are counterweights and pass on base. The 1 s phases and the 3 s break are illustrative test values
// chosen to keep the suite short; they are not product values.

const PHASES = { doorwaySeconds: 1, encounterSeconds: 1, noteSeconds: 1 };
const BREAK_SECONDS = 3;
// Station is 3 s, break 3 s: a two-station session with one break closes in ~9 s plus rotation. 25 s bounds it with
// margin for a loaded host (the C7 suite uses 15 s for 6 s of phases).
const SESSION_TIMEOUT_MS = 25000;
const BASE_SEQUENCE = ["doorway", "encounter", "note", "closed"];

interface LiveState { stationId?: string; stationIndex?: number; phase: string; phaseRemainingS?: number }
interface PersistedTrace { stationId?: string; events: Array<{ kind: string; phase?: string }> }

function blueprint(timing: Record<string, unknown>): Record<string, unknown> {
  return {
    blueprintId: "bp-fixture-c53",
    title: "Fixture two-station form with a break",
    stationSlots: [
      { slotId: "slot-a", order: 1, label: "Fixture label A", requiredEnvironmentIds: [], requiredTraceTags: [] },
      { slotId: "slot-b", order: 2, label: "Fixture label B", requiredEnvironmentIds: [], requiredTraceTags: [] },
    ],
    timing: { ...PHASES, ...timing },
    requiredTraceTags: [],
    requiredSafetyCriticalTraceTags: [],
  };
}

const servers: EncounterServer[] = [];
const leavers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (leavers.length > 0) await leavers.pop()?.().catch(() => undefined);
  while (servers.length > 0) await servers.pop()?.close().catch(() => undefined);
});

const create = createEncounterServer as (o: Record<string, unknown>) => Promise<EncounterServer>;
const state = (server: EncounterServer): LiveState => JSON.parse(server.getStateJSON()) as LiveState;

async function waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

interface Run { server: EncounterServer; connection: SyncConnection; traceDir: string; samples: LiveState[]; stop: () => void }

async function boot(examTiming: Record<string, unknown>, roomOptions: Record<string, unknown> = {}): Promise<Run> {
  const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c53-"));
  const server = await create({ examBlueprint: blueprint(examTiming), traceDir });
  servers.push(server);
  const connection = await connect(server.url, { roomOptions: { actors: ["a1", "a2"], ...roomOptions } });
  leavers.push(() => connection.leave());
  // Server state sampled every 10 ms, so each 1 s remaining-second value is seen many times.
  const samples: LiveState[] = [];
  const timer = setInterval(() => samples.push(state(server)), 10);
  return { server, connection, traceDir, samples, stop: () => clearInterval(timer) };
}

/** Run the whole session to the last station's "closed", then persist every station trace. */
async function finish(run: Run): Promise<Map<string | undefined, string[]>> {
  await waitFor(() => state(run.server).stationId === "slot-b", SESSION_TIMEOUT_MS, "slot-b room");
  await waitFor(() => state(run.server).phase === "closed", SESSION_TIMEOUT_MS, "slot-b closed");
  run.stop();
  await run.server.close();
  servers.pop();
  leavers.pop();
  const traces = readdirSync(run.traceDir)
    .filter((f) => f.endsWith(".conversation-trace.json"))
    .map((f) => JSON.parse(readFileSync(join(run.traceDir, f), "utf8")) as PersistedTrace);
  return new Map(traces.map((t) => [t.stationId, t.events.filter((e) => e.kind === "phase-changed").map((e) => e.phase ?? "")]));
}

/** Distinct consecutive values of phaseRemainingS while the given station is in "break". */
function breakCountdown(samples: LiveState[], stationId: string): number[] {
  const values = samples.filter((s) => s.stationId === stationId && s.phase === "break").map((s) => s.phaseRemainingS ?? -1);
  return values.filter((v, i) => i === 0 || v !== values[i - 1]);
}

describe("a blueprint break pauses the synced rotation (C53)", () => {
  it.fails("breakAfterStationOrders [1] with breakSeconds 3: slot-a runs doorway, encounter, note, closed, break (3, 2, 1), then slot-b runs as base", async () => {
    const run = await boot({ breakAfterStationOrders: [1], breakSeconds: BREAK_SECONDS });
    const phases = await finish(run);
    expect(phases.get("slot-a")).toEqual([...BASE_SEQUENCE, "break"]);
    expect(breakCountdown(run.samples, "slot-a")).toEqual([3, 2, 1]);
    expect(phases.get("slot-b")).toEqual(BASE_SEQUENCE);
    expect(run.samples.find((s) => s.stationId === "slot-b")?.phase).toBe("doorway");
  }, 40000);

  it.fails("during the break a conversation intent is refused outside-encounter-phase and a pose is accepted", async () => {
    const run = await boot({ breakAfterStationOrders: [1], breakSeconds: BREAK_SECONDS });
    await waitFor(() => state(run.server).phase === "break", SESSION_TIMEOUT_MS, "slot-a break");
    expect(await run.connection.sendIntent("select-actor", { actorId: "a1" })).toMatchObject({ status: "reject", reason: "outside-encounter-phase" });
    expect(await run.connection.sendIntent("pose", { x: 0, y: 1.6, z: 0 })).toMatchObject({ status: "ack" });
    run.stop();
  }, 40000);

  it.fails("boot refuses a break order that is not a slot order, naming examBlueprint", async () => {
    await expect(create({ examBlueprint: blueprint({ breakAfterStationOrders: [7], breakSeconds: BREAK_SECONDS }) })).rejects.toThrow(/examBlueprint/);
  }, 20000);

  it("counterweight: breakSeconds 0 with breakAfterStationOrders [1] rotates as base, no break", async () => {
    const run = await boot({ breakAfterStationOrders: [1], breakSeconds: 0 });
    const phases = await finish(run);
    expect([phases.get("slot-a"), phases.get("slot-b")]).toEqual([BASE_SEQUENCE, BASE_SEQUENCE]);
    expect(run.samples.some((s) => s.phase === "break")).toBe(false);
  }, 40000);

  it("counterweight: breakAfterStationOrders [1] with breakSeconds absent rotates as base, no break", async () => {
    const run = await boot({ breakAfterStationOrders: [1] });
    const phases = await finish(run);
    expect([phases.get("slot-a"), phases.get("slot-b")]).toEqual([BASE_SEQUENCE, BASE_SEQUENCE]);
    expect(run.samples.some((s) => s.phase === "break")).toBe(false);
  }, 40000);

  it("counterweight: breakSeconds 3 with breakAfterStationOrders [] rotates as base, no break", async () => {
    const run = await boot({ breakAfterStationOrders: [], breakSeconds: BREAK_SECONDS });
    const phases = await finish(run);
    expect([phases.get("slot-a"), phases.get("slot-b")]).toEqual([BASE_SEQUENCE, BASE_SEQUENCE]);
    expect(run.samples.some((s) => s.phase === "break")).toBe(false);
  }, 40000);

  it("counterweight: a break order equal to the last station never adds a break after it", async () => {
    const run = await boot({ breakAfterStationOrders: [2], breakSeconds: BREAK_SECONDS });
    const phases = await finish(run);
    expect([phases.get("slot-a"), phases.get("slot-b")]).toEqual([BASE_SEQUENCE, BASE_SEQUENCE]);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(run.samples.some((s) => s.phase === "break")).toBe(false);
  }, 40000);

  it("counterweight: a client roomOptions break duration is never read", async () => {
    const run = await boot({ breakAfterStationOrders: [1] }, { breakSeconds: BREAK_SECONDS, timing: { breakSeconds: BREAK_SECONDS } });
    const phases = await finish(run);
    expect(phases.get("slot-a")).toEqual(BASE_SEQUENCE);
    expect(run.samples.some((s) => s.phase === "break")).toBe(false);
  }, 40000);
});
