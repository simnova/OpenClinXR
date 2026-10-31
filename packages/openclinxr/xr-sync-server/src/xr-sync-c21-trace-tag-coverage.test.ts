import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clinicKneePainScenario, edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterAll, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C21 RED (planted by root, 2026-10-31): the review index says which of each cast station's required trace tags
// the session produced, per scenario rubric item, and the replay headset shows it beside the C20 checklist.
// Contract (names are the spec):
//   A station's PRODUCED tags = every string `tag` on its conversation trace events (C19 scheduled-event is the
//   first source), plus "patient_note_submitted" when the trace holds a note-submitted event (precedent:
//   review-workflow/src/assembled-exam-review-packet.ts:470 treats note.submitted as that tag).
//   Split rule = domain/src/station-state.ts:113 evaluateRequiredTraceTags: dedupe the required list, keep its
//   order; observed = required tags produced, missing = the rest.
//   Each CAST station's C9 review index entry gains:
//     observedTraceTags / missingRequiredTraceTags: the split of that station's scenario requiredTraceTags;
//     rubricCoverage: [{ rubricId, observedTags, missingTags }] in scenario reviewRubric order, each item's
//       requiredTraceTags split by the same rule. No rubric label text in the index.
//   Off a cast station (no scenarios) entries carry none of the three fields (C9 unchanged).
//   C20 replay with a scenarios bank: state replayRubricCoverage = [{ id, observedCount, requiredCount }] in the
//   station's rubric order, counts = that index entry's rubricCoverage lengths; [] when the station has no
//   scenario rubric (no bank, or scenarioId not in the bank). The C20 replayRubric field is unchanged.
// Fixture: chest schedule copied to atSecond 2 (fires in a 6 s encounter, C19 precedent); knee schedule copied
// to atSecond 6 = the encounter length, so it never fires (C19 clause 3). A note is submitted at slot-a only.
// Timings are illustrative test values.

const TIMING = { doorwaySeconds: 1, encounterSeconds: 6, noteSeconds: 2, breakAfterStationOrders: [] };
const withSchedule = <T extends { eventSchedule: Array<{ atSecond: number }> }>(scenario: T, atSecond: number): T => ({
  ...scenario,
  status: "approved",
  eventSchedule: scenario.eventSchedule.map((entry) => ({ ...entry, atSecond })),
});
const CHEST_SOON = withSchedule(edChestPainScenario, 2);
const KNEE_LATE = withSchedule(clinicKneePainScenario, 6);
const INDEX_FILE = "exam-session.review-index.json";
const TRACE_SUFFIX = ".conversation-trace.json";
const NOTE_TAG = "patient_note_submitted";
const STEP_MS = 50;

function blueprint(): Record<string, unknown> {
  return {
    blueprintId: "bp-fixture-c21",
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
afterAll(async () => {
  while (leavers.length > 0) await leavers.pop()?.().catch(() => undefined);
  while (servers.length > 0) await servers.pop()?.close().catch(() => undefined);
});

const bootServer = createEncounterServer as (o: Record<string, unknown>) => Promise<EncounterServer>;
async function boot(options: Record<string, unknown>): Promise<EncounterServer> {
  const server = await bootServer(options);
  servers.push(server);
  return server;
}
async function joinRoom(server: EncounterServer, roomOptions: Record<string, unknown>): Promise<SyncConnection> {
  const connection = await connect(server.url, { roomOptions });
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

type LiveState = { stationId: string; phase: string };
const live = (server: EncounterServer): LiveState => JSON.parse(server.getStateJSON()) as LiveState;
type Entry = Record<string, unknown> & { stationId: string };
type Trace = { stationId: string; events: Array<Record<string, unknown>> };
interface Recorded {
  traceDir: string;
  entries: Map<string, Entry>;
  indexText: string;
  traces: Map<string, Trace>;
}

/** One recorded cast session shared by the cast clauses: slot-a chest (schedule fires, note), slot-b knee (neither). */
let recorded: Promise<Recorded> | null = null;
function recordCastSession(): Promise<Recorded> {
  recorded ??= (async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c21-"));
    const server = await boot({ examBlueprint: blueprint(), scenarios: [CHEST_SOON, KNEE_LATE], traceDir });
    const learner = await joinRoom(server, { actors: ["a1", "a2"] });
    await waitFor(() => live(server).stationId === "slot-a" && live(server).phase === "note", 15000, "slot-a note");
    expect(await learner.sendIntent("note-submit" as never, { text: "Fixture note." })).toMatchObject({ status: "ack" });
    await waitFor(() => readdirSync(traceDir).includes(INDEX_FILE), 40000, "review index");
    await server.close();
    const indexText = readFileSync(join(traceDir, INDEX_FILE), "utf8");
    const index = JSON.parse(indexText) as { stations: Entry[] };
    const traces = new Map<string, Trace>();
    for (const file of readdirSync(traceDir).filter((name) => name.endsWith(TRACE_SUFFIX))) {
      const trace = JSON.parse(readFileSync(join(traceDir, file), "utf8")) as Trace;
      traces.set(trace.stationId, trace);
    }
    return { traceDir, entries: new Map(index.stations.map((entry) => [entry.stationId, entry])), indexText, traces };
  })();
  return recorded;
}

/** Produced tags read off the persisted trace (the contract's source rule), independent of server output. */
function producedTags(trace: Trace | undefined): Set<string> {
  if (!trace) throw new Error("no trace for station");
  const tags = new Set<string>();
  for (const event of trace.events) {
    if (typeof event["tag"] === "string") tags.add(event["tag"]);
    if (event["kind"] === "note-submitted") tags.add(NOTE_TAG);
  }
  return tags;
}
function split(required: readonly string[], produced: Set<string>): { observed: string[]; missing: string[] } {
  const unique = [...new Set(required)];
  return { observed: unique.filter((tag) => produced.has(tag)), missing: unique.filter((tag) => !produced.has(tag)) };
}
function entryOf(session: Recorded, stationId: string): Entry {
  const entry = session.entries.get(stationId);
  if (!entry) throw new Error(`no index entry for ${stationId}`);
  return entry;
}

type CoverageItem = { id: string; observedCount: number; requiredCount: number };
type ReplayState = { replayDone?: boolean; replayRubricCoverage?: CoverageItem[] };
async function replayCoverage(options: Record<string, unknown>, stationId: string): Promise<CoverageItem[] | undefined> {
  const server = await boot({ replayStepMs: STEP_MS, ...options });
  const reviewer = await joinRoom(server, { replayStationId: stationId });
  let last: ReplayState = {};
  reviewer.onState((raw) => {
    last = raw as ReplayState;
  });
  await waitFor(() => last.replayDone === true, 30000, "replayDone");
  return last.replayRubricCoverage;
}

describe("xr-sync-server C21 required trace tag coverage", () => {
  it("known-good: off a cast station the review index entry carries no tag coverage fields", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c21-plain-"));
    const server = await boot({ stations: ["s1"], timing: { doorwaySeconds: 1, encounterSeconds: 2, noteSeconds: 1 }, traceDir });
    await joinRoom(server, { actors: ["a1"] });
    await waitFor(() => readdirSync(traceDir).includes(INDEX_FILE), 20000, "review index");
    const index = JSON.parse(readFileSync(join(traceDir, INDEX_FILE), "utf8")) as { stations: Entry[] };
    for (const field of ["observedTraceTags", "missingRequiredTraceTags", "rubricCoverage"]) {
      expect(index.stations[0]).not.toHaveProperty(field);
    }
  }, 30000);

  it("a station whose schedule fired and whose note was accepted observes exactly those tags", async () => {
    const session = await recordCastSession();
    const produced = producedTags(session.traces.get("slot-a"));
    // Anchor: the fixture really produced the two tags (otherwise every split below is vacuous).
    expect([...produced].sort()).toEqual([NOTE_TAG, "vitals_review"].sort());
    const expected = split(CHEST_SOON.requiredTraceTags, produced);
    expect(entryOf(session, "slot-a")).toMatchObject({
      observedTraceTags: expected.observed,
      missingRequiredTraceTags: expected.missing,
    });
  }, 60000);

  it("a scheduled tag that never fired is missing, not observed", async () => {
    const session = await recordCastSession();
    expect(producedTags(session.traces.get("slot-b")).size).toBe(0);
    expect(entryOf(session, "slot-b")).toMatchObject({
      observedTraceTags: [],
      missingRequiredTraceTags: [...new Set(KNEE_LATE.requiredTraceTags)],
    });
  }, 60000);

  it("rubricCoverage splits each rubric item in rubric order, with no label text in the index", async () => {
    const session = await recordCastSession();
    for (const [stationId, scenario] of [["slot-a", CHEST_SOON], ["slot-b", KNEE_LATE]] as const) {
      const produced = producedTags(session.traces.get(stationId));
      expect(entryOf(session, stationId)["rubricCoverage"]).toEqual(
        scenario.reviewRubric.map((item) => {
          const { observed, missing } = split(item.requiredTraceTags, produced);
          return { rubricId: item.rubricId, observedTags: observed, missingTags: missing };
        }),
      );
      for (const item of scenario.reviewRubric) expect(session.indexText).not.toContain(item.label);
    }
  }, 60000);

  it("the replay headset state carries per-item coverage counts from the index", async () => {
    const session = await recordCastSession();
    const entry = entryOf(session, "slot-a") as { rubricCoverage?: Array<{ rubricId: string; observedTags: string[]; missingTags: string[] }> };
    const expected = (entry.rubricCoverage ?? []).map((item) => ({
      id: item.rubricId,
      observedCount: item.observedTags.length,
      requiredCount: item.observedTags.length + item.missingTags.length,
    }));
    expect(expected.length).toBe(CHEST_SOON.reviewRubric.length);
    const coverage = await replayCoverage({ replayDir: session.traceDir, scenarios: [CHEST_SOON, KNEE_LATE] }, "slot-a");
    expect(coverage).toEqual(expected);
  }, 60000);

  it("the replay coverage is empty when the station has no scenario rubric", async () => {
    const session = await recordCastSession();
    expect(await replayCoverage({ replayDir: session.traceDir, scenarios: [CHEST_SOON] }, "slot-b")).toEqual([]);
    expect(await replayCoverage({ replayDir: session.traceDir }, "slot-a")).toEqual([]);
  }, 90000);
});
