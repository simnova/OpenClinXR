import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clinicKneePainScenario, edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C19 RED (planted by root, 2026-10-31): a cast station runs its scenario's event schedule on the server clock.
// Contract (names are the spec), on a C16 cast station:
//   Each scenario eventSchedule entry { eventId, atSecond, actorId, tag } fires once, atSecond seconds after that
//   station's encounter phase starts (server clock; tolerance one 1000 ms phase tick). Entries whose atSecond is
//   >= the encounter length never fire. Only the station's own scenario schedule runs.
//   On fire: state.lastScheduledEventId = eventId; the named actor interjects with no learner intent
//   (actors[actorId].speaking true, replyId `scheduled:${eventId}`) for the C3 first-row duration; the
//   conversation trace records { kind: "scheduled-event", actorId, eventId, tag } (no text). If an actor turn
//   is open when the event is due, the interjection starts when that turn ends (still within the encounter).
//   state.lastScheduledEventId is "" before any fire and off a cast station.
// Fixture note: bank schedules fire at 360-420 s of a 900 s encounter; the test copies each scenario with
// status "approved" and atSecond 2 so a 6 s encounter reaches it. The harness must name the same override.

const TIMING = { doorwaySeconds: 1, encounterSeconds: 6, noteSeconds: 1, breakAfterStationOrders: [] };
const TICK_MS = 1000;
const withSchedule = <T extends { eventSchedule: Array<{ atSecond: number }> }>(scenario: T, atSecond: number): T => ({
  ...scenario,
  status: "approved",
  eventSchedule: scenario.eventSchedule.map((entry) => ({ ...entry, atSecond })),
});
const CHEST_SOON = withSchedule(edChestPainScenario, 2);
const KNEE_SOON = withSchedule(clinicKneePainScenario, 2);
const KNEE_LATE = withSchedule(clinicKneePainScenario, 6);

function blueprint(): Record<string, unknown> {
  return {
    blueprintId: "bp-fixture-c19",
    title: "Fixture two-station form",
    stationSlots: [
      { slotId: "slot-a", order: 1, label: "Fixture label A", requiredEnvironmentIds: [], requiredTraceTags: [] },
      { slotId: "slot-b", order: 2, label: "Fixture label B", requiredEnvironmentIds: [], requiredTraceTags: [] },
    ],
    timing: TIMING,
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

const bootServer = createEncounterServer as (o: Record<string, unknown>) => Promise<EncounterServer>;
async function boot(options: Record<string, unknown>): Promise<EncounterServer> {
  const server = await bootServer(options);
  servers.push(server);
  return server;
}
async function joinRoom(server: EncounterServer): Promise<SyncConnection> {
  const connection = await connect(server.url, { roomOptions: { actors: ["a1", "a2"] } });
  leavers.push(() => connection.leave());
  return connection;
}
async function waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

type LiveState = {
  stationId: string;
  phase: string;
  lastScheduledEventId?: unknown;
  actors: Record<string, { speaking: boolean; replyId: string }>;
};
const live = (server: EncounterServer): LiveState => JSON.parse(server.getStateJSON()) as LiveState;
const entryOf = (scenario: typeof CHEST_SOON) => {
  const entry = scenario.eventSchedule[0];
  if (!entry) throw new Error("fixture has no schedule entry");
  return entry;
};

describe("xr-sync-server C19 scenario event schedule", () => {
  it("known-good: off a cast station no actor speaks without a learner intent", async () => {
    const server = await boot({ stations: ["s1"], timing: { doorwaySeconds: 1, encounterSeconds: 4, noteSeconds: 1 } });
    await joinRoom(server);
    await waitFor(() => live(server).phase === "note", 10000, "note");
    expect(Object.values(live(server).actors).some((a) => a.speaking)).toBe(false);
  }, 20000);

  it("the scheduled event fires atSecond after encounter start and the named actor interjects", async () => {
    const server = await boot({ examBlueprint: blueprint(), scenarios: [CHEST_SOON, KNEE_SOON] });
    await joinRoom(server);
    expect(live(server).lastScheduledEventId).toBe("");
    await waitFor(() => live(server).phase === "encounter", 5000, "encounter");
    const encounterAt = Date.now();
    const entry = entryOf(CHEST_SOON);
    await waitFor(() => live(server).lastScheduledEventId === entry.eventId, 6000, "scheduled event");
    const firedAfterMs = Date.now() - encounterAt;
    expect(Math.abs(firedAfterMs - entry.atSecond * 1000)).toBeLessThanOrEqual(TICK_MS);
    expect(live(server).actors[entry.actorId]).toMatchObject({ speaking: true, replyId: `scheduled:${entry.eventId}` });
  }, 20000);

  it("an entry at or past the encounter length never fires", async () => {
    const server = await boot({ examBlueprint: blueprint(), scenarios: [KNEE_LATE, CHEST_SOON] });
    await joinRoom(server);
    await waitFor(() => live(server).phase === "note", 15000, "slot-a note");
    expect(live(server).lastScheduledEventId).toBe("");
    expect(Object.values(live(server).actors).some((a) => a.replyId.startsWith("scheduled:"))).toBe(false);
  }, 20000);

  it("each station runs only its own scenario schedule", async () => {
    const server = await boot({ examBlueprint: blueprint(), scenarios: [CHEST_SOON, KNEE_SOON] });
    await joinRoom(server);
    const fired: Array<[string, unknown]> = [];
    await waitFor(() => {
      const s = live(server);
      if (s.lastScheduledEventId && fired.at(-1)?.[1] !== s.lastScheduledEventId) fired.push([s.stationId, s.lastScheduledEventId]);
      return s.stationId === "slot-b" && s.phase === "note";
    }, 30000, "slot-b note");
    expect(fired).toEqual([
      ["slot-a", entryOf(CHEST_SOON).eventId],
      ["slot-b", entryOf(KNEE_SOON).eventId],
    ]);
  }, 40000);

  it("an open learner turn delays the interjection until it ends", async () => {
    const server = await boot({ examBlueprint: blueprint(), scenarios: [CHEST_SOON, KNEE_SOON] });
    const learner = await joinRoom(server);
    await waitFor(() => live(server).phase === "encounter", 5000, "encounter");
    const entry = entryOf(CHEST_SOON);
    const other = CHEST_SOON.actors.find((a) => a.actorId !== entry.actorId)?.actorId ?? "";
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(await learner.sendIntent("select-actor", { actorId: other })).toMatchObject({ status: "ack" });
    await learner.sendIntent("utterance-start", {});
    await learner.sendIntent("utterance-end", {});
    await waitFor(() => live(server).actors[other]?.speaking === true, 3000, "other actor reply");
    const overlap: boolean[] = [];
    await waitFor(() => {
      const s = live(server);
      overlap.push(s.actors[other]?.speaking === true && s.actors[entry.actorId]?.speaking === true);
      return s.actors[entry.actorId]?.replyId === `scheduled:${entry.eventId}` && s.actors[entry.actorId]?.speaking === true;
    }, 6000, "delayed interjection");
    expect(overlap.includes(true)).toBe(false);
  }, 20000);

  it("the trace records the scheduled event with its tag", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c19-"));
    const server = await boot({ examBlueprint: blueprint(), scenarios: [CHEST_SOON, KNEE_SOON], traceDir });
    await joinRoom(server);
    const entry = entryOf(CHEST_SOON);
    await waitFor(() => live(server).lastScheduledEventId === entry.eventId, 10000, "scheduled event");
    await server.close();
    const traces = readdirSync(traceDir).map((f) => JSON.parse(readFileSync(join(traceDir, f), "utf8")) as {
      stationId?: string;
      events?: Array<Record<string, unknown>>;
    });
    const slotA = traces.find((t) => t.stationId === "slot-a");
    expect(slotA?.events?.filter((e) => e["kind"] === "scheduled-event")).toEqual([
      expect.objectContaining({ kind: "scheduled-event", actorId: entry.actorId, eventId: entry.eventId, tag: entry.tag }),
    ]);
  }, 20000);
});
