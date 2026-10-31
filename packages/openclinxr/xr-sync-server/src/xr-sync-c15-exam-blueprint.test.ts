import { mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C15 RED (planted by root, 2026-10-30): the live exam session boots from the factory's exam blueprint.
// Contract (names are the spec):
//   createEncounterServer({ examBlueprint }) where examBlueprint is a @openclinxr/shared-schemas ExamBlueprint
//   (the shape @openclinxr/exam-assembly createStep2CsStyleSeedBlueprint returns):
//     stations = examBlueprint.stationSlots sorted by (order, slotId) -> their slotIds;
//     timing = { doorwaySeconds, encounterSeconds, noteSeconds } from examBlueprint.timing.
//   Boot refuses (rejects, message names "examBlueprint"): examBlueprint together with stations or timing;
//     duplicate slotId; duplicate order; any of doorway/encounter/note seconds not a positive integer.
//   Live state: blueprintId (the blueprint's id; "" without a blueprint) and stationLabel (the current slot's label;
//     "" without a blueprint). Rotation follows slot order.
//   C9 review index (blueprint session): top-level blueprintId; each station entry carries stationLabel.
//   C14 grade carry-over: the scoreDir/replayDir overlap guard compares real paths, so a scoreDir that is a symlink
//     resolving inside replayDir is refused.
// Fixture ids, labels and the 1 s timings are illustrative test values.

const TIMING = { doorwaySeconds: 1, encounterSeconds: 1, noteSeconds: 1 };
const SESSION_TIMEOUT_MS = 15000;
const INDEX_FILE = "exam-session.review-index.json";

function blueprint(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    blueprintId: "bp-fixture-c15",
    title: "Fixture two-station form",
    // Deliberately out of order: the server must sort by order.
    stationSlots: [
      { slotId: "slot-b", order: 2, label: "Fixture label B", requiredEnvironmentIds: [], requiredTraceTags: [] },
      { slotId: "slot-a", order: 1, label: "Fixture label A", requiredEnvironmentIds: [], requiredTraceTags: [] },
    ],
    timing: { ...TIMING, breakAfterStationOrders: [] },
    requiredTraceTags: [],
    requiredSafetyCriticalTraceTags: [],
    ...overrides,
  };
}

const servers: EncounterServer[] = [];
const leavers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (leavers.length > 0) await leavers.pop()?.().catch(() => undefined);
  while (servers.length > 0) await servers.pop()?.close().catch(() => undefined);
});

const boot = createEncounterServer as (o: Record<string, unknown>) => Promise<EncounterServer>;

async function start(options: Record<string, unknown>): Promise<EncounterServer> {
  const server = await boot(options);
  servers.push(server);
  return server;
}

async function joinLearner(server: EncounterServer): Promise<SyncConnection> {
  const connection = await connect(server.url, { roomOptions: { actors: ["a1", "a2"] } });
  leavers.push(() => connection.leave());
  return connection;
}

async function waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

type LiveState = { stationId: string; stationIndex: number; stationCount: number; phase: string; blueprintId?: unknown; stationLabel?: unknown };
const state = (server: EncounterServer): LiveState => JSON.parse(server.getStateJSON()) as LiveState;

describe("xr-sync-server C15 exam blueprint boot", () => {
  it("known-good: inline stations + timing still boot the first station", async () => {
    const server = await start({ stations: ["station-1", "station-2"], timing: TIMING });
    await joinLearner(server);
    const s = state(server);
    expect([s.stationId, s.stationIndex, s.stationCount]).toEqual(["station-1", 0, 2]);
  }, 20000);

  it("a blueprint server starts at the lowest-order slot with its label and the blueprint id", async () => {
    const server = await start({ examBlueprint: blueprint() });
    await joinLearner(server);
    const s = state(server);
    expect([s.stationId, s.stationIndex, s.stationCount, s.phase]).toEqual(["slot-a", 0, 2, "doorway"]);
    expect(s.blueprintId).toBe("bp-fixture-c15");
    expect(s.stationLabel).toBe("Fixture label A");
  }, 20000);

  it("without a blueprint, blueprintId and stationLabel are empty strings", async () => {
    const server = await start({ stations: ["station-1"], timing: TIMING });
    await joinLearner(server);
    const s = state(server);
    expect([s.blueprintId, s.stationLabel]).toEqual(["", ""]);
  }, 20000);

  it("the session runs the slots in blueprint order and the review index records the blueprint", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c15-"));
    const server = await start({ examBlueprint: blueprint(), traceDir });
    await joinLearner(server);
    await waitFor(() => readdirSync(traceDir).includes(INDEX_FILE), SESSION_TIMEOUT_MS * 2, "review index");
    const index = JSON.parse(readFileSync(join(traceDir, INDEX_FILE), "utf8")) as {
      blueprintId?: unknown;
      complete: boolean;
      stations: Array<{ stationId: string; stationIndex: number; stationLabel?: unknown }>;
    };
    expect(index.complete).toBe(true);
    expect(index.blueprintId).toBe("bp-fixture-c15");
    expect(index.stations.map((s) => [s.stationId, s.stationIndex, s.stationLabel])).toEqual([
      ["slot-a", 0, "Fixture label A"],
      ["slot-b", 1, "Fixture label B"],
    ]);
  }, 40000);

  it("boot refuses conflicting or malformed blueprint config", async () => {
    await expect(boot({ examBlueprint: blueprint(), stations: ["x"] })).rejects.toThrow(/examBlueprint/);
    await expect(boot({ examBlueprint: blueprint(), timing: TIMING })).rejects.toThrow(/examBlueprint/);
    const dupSlot = blueprint({
      stationSlots: [
        { slotId: "slot-a", order: 1, label: "A", requiredEnvironmentIds: [], requiredTraceTags: [] },
        { slotId: "slot-a", order: 2, label: "A2", requiredEnvironmentIds: [], requiredTraceTags: [] },
      ],
    });
    await expect(boot({ examBlueprint: dupSlot })).rejects.toThrow(/examBlueprint/);
    const dupOrder = blueprint({
      stationSlots: [
        { slotId: "slot-a", order: 1, label: "A", requiredEnvironmentIds: [], requiredTraceTags: [] },
        { slotId: "slot-b", order: 1, label: "B", requiredEnvironmentIds: [], requiredTraceTags: [] },
      ],
    });
    await expect(boot({ examBlueprint: dupOrder })).rejects.toThrow(/examBlueprint/);
    const zeroEncounter = blueprint({ timing: { doorwaySeconds: 1, encounterSeconds: 0, noteSeconds: 1, breakAfterStationOrders: [] } });
    await expect(boot({ examBlueprint: zeroEncounter })).rejects.toThrow(/examBlueprint/);
  }, 20000);

  it("C14 carry-over: a scoreDir symlinked inside replayDir is refused", async () => {
    const root = mkdtempSync(join(tmpdir(), "xr-sync-c15-link-"));
    const replayDir = join(root, "replay");
    mkdirSync(join(replayDir, "inner"), { recursive: true });
    const link = join(root, "scores-link");
    symlinkSync(join(replayDir, "inner"), link);
    // Known-good control on the same replayDir: a real scoreDir outside it boots.
    servers.push(await boot({ replayDir, scoreDir: join(root, "scores-out"), reviewRubric: [{ id: "r1", label: "one" }] }));
    await expect(boot({ replayDir, scoreDir: link, reviewRubric: [{ id: "r1", label: "one" }] })).rejects.toThrow(/scoreDir/);
  }, 20000);
});
