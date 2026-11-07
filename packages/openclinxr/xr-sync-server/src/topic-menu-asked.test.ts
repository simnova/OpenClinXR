import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { edChestPainScenario, scenarioDialogueSeedBank } from "@openclinxr/scenario-fixtures";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C37 asked (clauses 2, 4). Each topicMenu entry carries asked: boolean in room state.
//   Source rule: asked is true exactly for the menu tags in the REVIEW's observed set (the station's observedTraceTags in
//   the review index, minus patient_note_submitted which is not on the menu). Whatever the review counts as produced marks
//   the entry: learner topic taps, typed turns, matched speech turns, and scheduled events alike.
//   Multi-tag answers: the nurse answer covers team_communication AND urgent_escalation, the spouse answer
//   family_communication AND empathy_statement. A matched free-text or speech turn records ONE tag on the trace (the first
//   of the answer's tags on the menu), so the review observes one tag and asked marks that one; the sibling tag stays false
//   until a tap on it. (The approved contract also said "both are marked"; both cannot hold with clause 2's equality, and
//   clause 2 wins. Recorded in the C37 ledger section.)
//   asked stays false after: an unknown-topic refusal, an off-menu tag (patient_note_submitted via topicTag), unmatched typed
//   text, and a low-confidence speech turn (even when its text would match). asked is false at the start of a new session and
//   survives a reconnect and a second join into the same room. asked turns true on a typed turn and a matched speech turn.

const TIMING = { doorwaySeconds: 1, encounterSeconds: 40, noteSeconds: 1, breakAfterStationOrders: [] };
const SCHEDULE_AT = 25;
const CHEST = { ...edChestPainScenario, status: "approved" as const, eventSchedule: edChestPainScenario.eventSchedule.map((entry) => ({ ...entry, atSecond: SCHEDULE_AT })) };
const SCHEDULED_TAGS = [...new Set(CHEST.eventSchedule.map((entry) => entry.tag))];
const NOTE_TAG = "patient_note_submitted";
const INDEX_FILE = "exam-session.review-index.json";
const PATIENT = "patient_robert_hayes_v1";
const SPOUSE = "spouse_anna_hayes_v1";
const NURSE = "nurse_maria_alvarez_v1";
const blueprint = {
  blueprintId: "bp-fixture-c37-asked",
  title: "Fixture one-station form",
  stationSlots: [{ slotId: "slot-a", order: 1, label: "Fixture label A", requiredEnvironmentIds: [], requiredTraceTags: [] }],
  timing: TIMING,
  requiredTraceTags: [],
  requiredSafetyCriticalTraceTags: [],
};
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
async function waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
type Entry = { tag: string; asked: boolean };
type Live = { phase: string; lastScheduledEventId: string; topicMenu: Entry[] };
const live = (server: EncounterServer): Live => JSON.parse(server.getStateJSON()) as Live;
const askedTags = (server: EncounterServer): string[] => live(server).topicMenu.filter((entry) => entry.asked === true).map((entry) => entry.tag);
async function joinRoom(server: EncounterServer): Promise<SyncConnection> {
  const connection = await connect(server.url, { roomOptions: { actors: ["a1"] } });
  leavers.push(() => connection.leave());
  return connection;
}
async function say(learner: SyncConnection, actorId: string, payload: Record<string, unknown>) {
  expect(await learner.sendIntent("select-actor", { actorId })).toMatchObject({ status: "ack" });
  // A refused utterance-end leaves the utterance open, so the next start may answer utterance-already-open.
  const started = await learner.sendIntent("utterance-start", {});
  expect(started.status === "ack" || (started.status === "reject" && started.reason === "utterance-already-open")).toBe(true);
  return learner.sendIntent("utterance-end", payload);
}
const fallbackMin = (scenarioDialogueSeedBank.find((entry) => entry.scenarioId === CHEST.scenarioId) as { utteranceFallback?: { minSpeechConfidence?: number } } | undefined)?.utteranceFallback?.minSpeechConfidence ?? 0;

interface Recorded {
  steps: Record<string, string[]>;
  rejoin: { reconnect: string[]; secondJoin: string[] };
  statusOf: Record<string, string>;
  finalAsked: string[];
  reviewObserved: string[];
}
let recorded: Promise<Recorded> | null = null;
function recordSession(): Promise<Recorded> {
  recorded ??= (async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c37-"));
    const server = await boot({ examBlueprint: blueprint, scenarios: [CHEST], dialogueSeeds: scenarioDialogueSeedBank, traceDir });
    const learner = await joinRoom(server);
    await waitFor(() => live(server).phase === "encounter", 10000, "encounter");
    const steps: Record<string, string[]> = { start: askedTags(server) };
    const statusOf: Record<string, string> = {};
    const record = async (name: string, send: () => Promise<{ status: string }>): Promise<void> => {
      statusOf[name] = (await send()).status;
      steps[name] = askedTags(server);
    };
    await record("unknown-topic", () => say(learner, PATIENT, { topicTag: "weight_bearing_question" }));
    await record("off-menu-note-tag", () => say(learner, PATIENT, { topicTag: NOTE_TAG }));
    await record("unmatched-typed", () => say(learner, PATIENT, { text: "zebra quartz nine" }));
    await record("low-confidence-speech", () => say(learner, SPOUSE, { text: "how are you holding up", modality: "speech", confidence: 0.1 }));
    await record("typed-match", () => say(learner, PATIENT, { text: "when did the pain start" }));
    await record("speech-match", () => say(learner, NURSE, { text: "i need an ecg now", modality: "speech", confidence: 0.9 }));
    await record("tap", () => say(learner, SPOUSE, { topicTag: "empathy_statement" }));
    await learner.reconnect();
    const afterReconnect = askedTags(server);
    const second = await joinRoom(server);
    await waitFor(() => second.sessionId !== "", 2000, "second join");
    const afterSecondJoin = askedTags(server);
    await waitFor(() => live(server).lastScheduledEventId !== "", 40000, "scheduled event");
    steps["scheduled"] = askedTags(server);
    await waitFor(() => live(server).phase === "note", 40000, "note phase");
    const finalAsked = askedTags(server);
    await waitFor(() => readdirSync(traceDir).includes(INDEX_FILE), 40000, "review index");
    await server.close();
    const index = JSON.parse(readFileSync(join(traceDir, INDEX_FILE), "utf8")) as { stations: Array<{ stationId: string; observedTraceTags: string[] }> };
    const reviewObserved = (index.stations.find((entry) => entry.stationId === "slot-a")?.observedTraceTags ?? []).filter((tag) => tag !== NOTE_TAG);
    return { steps, rejoin: { reconnect: afterReconnect, secondJoin: afterSecondJoin }, statusOf, finalAsked, reviewObserved };
  })();
  return recorded;
}

describe("xr-sync-server C37 topic menu asked state", () => {
  it("asked equals the review's observed set for a scripted session, scheduled tags included", async () => {
    const session = await recordSession();
    expect([...session.finalAsked].sort()).toEqual([...session.reviewObserved].sort());
    // Anchor: the script produced tags from taps, typed text, speech and the schedule, so the equality is not over an empty set.
    expect(session.finalAsked).toEqual(expect.arrayContaining(["history_opqrst", "team_communication", "empathy_statement", ...SCHEDULED_TAGS]));
    expect(session.finalAsked.length).toBeGreaterThanOrEqual(4);
  }, 120000);

  it("counterweight B: refusals, off-menu tags, unmatched text and low-confidence speech leave asked false", async () => {
    const session = await recordSession();
    expect(fallbackMin).toBeGreaterThan(0.1);
    expect(session.statusOf["unknown-topic"]).toBe("reject");
    expect(session.statusOf["off-menu-note-tag"]).toBe("reject");
    expect(session.statusOf["unmatched-typed"]).toBe("ack");
    expect(session.statusOf["low-confidence-speech"]).toBe("ack");
    expect(session.steps["start"]).toEqual([]);
    for (const step of ["unknown-topic", "off-menu-note-tag", "unmatched-typed", "low-confidence-speech"]) {
      expect(session.steps[step], step).toEqual([]);
    }
    // Anchor: asked does turn true in the same session, so the false steps above are not an always-false field.
    expect(session.steps["typed-match"]).toContain("history_opqrst");
  }, 120000);

  it("a typed turn and a matched speech turn mark the tag they resolve to; a tap marks its tag; a multi-tag answer marks the tag the trace records", async () => {
    const session = await recordSession();
    expect(session.steps["typed-match"]).toEqual(["history_opqrst"]);
    expect(session.steps["speech-match"]).toEqual(["history_opqrst", "team_communication"]);
    expect(session.steps["speech-match"]).not.toContain("urgent_escalation");
    expect(session.steps["tap"]).toEqual(["history_opqrst", "team_communication", "empathy_statement"]);
    expect(session.steps["tap"]).not.toContain("family_communication");
    expect(session.steps["scheduled"]).toEqual(expect.arrayContaining([...session.steps["tap"] ?? [], ...SCHEDULED_TAGS]));
  }, 120000);

  it("a reconnect and a second join into the same room keep asked=true", async () => {
    const session = await recordSession();
    // Anchor: something was asked before the rejoin.
    expect(session.steps["tap"]?.length).toBeGreaterThan(0);
    expect(session.rejoin.reconnect).toEqual(session.steps["tap"]);
    expect(session.rejoin.secondJoin).toEqual(session.steps["tap"]);
  }, 120000);

  it("asked is false in a new session", async () => {
    const first = await boot({ examBlueprint: blueprint, scenarios: [CHEST], dialogueSeeds: scenarioDialogueSeedBank });
    const learner = await joinRoom(first);
    await waitFor(() => live(first).phase === "encounter", 10000, "encounter");
    expect(await say(learner, PATIENT, { topicTag: "history_opqrst" })).toMatchObject({ status: "ack" });
    expect(askedTags(first)).toEqual(["history_opqrst"]);
    const second = await boot({ examBlueprint: blueprint, scenarios: [CHEST], dialogueSeeds: scenarioDialogueSeedBank });
    await joinRoom(second);
    await waitFor(() => live(second).topicMenu.length > 0, 10000, "second menu");
    expect(askedTags(second)).toEqual([]);
  }, 60000);
});
