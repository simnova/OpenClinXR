import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clinicKneePainScenario, edChestPainScenario, scenarioDialogueSeedBank } from "@openclinxr/scenario-fixtures";
import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C30 RED (planted by lane manager, 2026-11-05): the shell shows "please repeat" after a low-confidence speech turn and the
// retry is counted in the trace. Contract (names are the spec):
//   ActorState (and the snapshot) gain two fields set when an utterance-end opens that actor's reply:
//     intake  : string, the resolved trace tag of the learner utterance ("" when none, e.g. an opening with no tag);
//     retries : number, consecutive speech_low_confidence results for that actor INCLUDING this one; any other result resets to 0.
//   Trace: an utterance-end that follows N >= 1 consecutive speech_low_confidence results for the same actor carries
//     retry: N (integer 1..99). The first low-confidence result carries no retry. Never text.
//   Replay reads retry back and refuses a malformed one: that is tested in xr-sync-c4-conversation-trace.test.ts (it already imports ./conversation-trace.js;
//   a new internal import in a test file would raise the package's frozen test-internal-import ceiling).
const TIMING = { doorwaySeconds: 1, encounterSeconds: 300, noteSeconds: 1, breakAfterStationOrders: [] };
const neverFires = <T extends { eventSchedule: Array<{ atSecond: number }> }>(scenario: T): T => ({
  ...scenario,
  status: "approved",
  eventSchedule: scenario.eventSchedule.map((entry) => ({ ...entry, atSecond: TIMING.encounterSeconds })),
});
const KNEE = neverFires(clinicKneePainScenario);
const CHEST = neverFires(edChestPainScenario);
const TRACE_SUFFIX = ".conversation-trace.json";
const FALLBACK_LINE = "Sorry, I did not follow that. Can you ask it another way?";
const THRESHOLD = 0.5;
const withFallback = (fallback: Record<string, unknown>) =>
  scenarioDialogueSeedBank.map((entry) => entry.scenarioId !== KNEE.scenarioId ? entry : { ...entry, utteranceFallback: fallback });
const BANK = withFallback({ line: FALLBACK_LINE, minSpeechConfidence: THRESHOLD });

const kneeSeeds = scenarioDialogueSeedBank.find((entry) => entry.scenarioId === KNEE.scenarioId)?.seeds ?? [];
const MECHANISM = kneeSeeds.find((entry) => entry.seedId === "clinic_knee_mechanism_history")!;
const JORDAN = KNEE.actors.find((entry) => entry.actorId === MECHANISM.actorId)!;
const MECH_PHRASE = (MECHANISM.utterancePhrases ?? [])[0] ?? "";

function blueprint(): Record<string, unknown> {
  return {
    blueprintId: "bp-fixture-c29",
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
async function waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
type LiveState = { phase: string; actors: Record<string, { speaking: boolean; replyId: string; caption: string }> };
const live = (server: EncounterServer): LiveState => JSON.parse(server.getStateJSON()) as LiveState;

async function say(server: EncounterServer, learner: SyncConnection, payload: Record<string, unknown>) {
  const actorId = JORDAN.actorId;
  expect(await learner.sendIntent("select-actor", { actorId })).toMatchObject({ status: "ack" });
  expect(await learner.sendIntent("utterance-start", {})).toMatchObject({ status: "ack" });
  const ended = await learner.sendIntent("utterance-end", payload);
  expect(ended, JSON.stringify(payload)).toMatchObject({ status: "ack" });
  await waitFor(() => live(server).actors[actorId]?.speaking === true, 3000, "reply");
  const reply = live(server).actors[actorId];
  await waitFor(() => live(server).actors[actorId]?.speaking !== true, 8000, "reply end");
  return { replyId: reply?.replyId ?? "", caption: reply?.caption ?? "" };
}
async function session(options: Record<string, unknown> = {}) {
  const server = await boot({ examBlueprint: blueprint(), scenarios: [KNEE, CHEST], dialogueSeeds: BANK, ...options });
  const learner = await connect(server.url, { roomOptions: { actors: ["a1", "a2"] } });
  leavers.push(() => learner.leave());
  await waitFor(() => live(server).phase === "encounter", 5000, "slot-a encounter");
  await say(server, learner, { text: "hello there" }); // turn 1: the C17 opening
  return { server, learner };
}
const speech = (text: string, confidence: number) => ({ text, modality: "speech", confidence });

type ActorLive = { speaking: boolean; replyId: string; caption: string; intake?: string; retries?: number };
const actorLive = (server: EncounterServer): ActorLive => (JSON.parse(server.getStateJSON()) as { actors: Record<string, ActorLive> }).actors[JORDAN.actorId] as ActorLive;
type TraceEvent = { kind: string; tag?: string; match?: string; modality?: string; confidence?: number; retry?: unknown };
type TraceFile = { schema: string; stationId: string; scenarioId?: string; events: TraceEvent[]; cast?: unknown };

describe("xr-sync-server C30 speech retry", () => {
  it("the actor state carries the resolved intake tag and the consecutive low-confidence count", async () => {
    const { server, learner } = await session();
    expect(actorLive(server)).toMatchObject({ retries: 0 });
    await say(server, learner, speech(MECH_PHRASE, 0.2));
    expect(actorLive(server)).toMatchObject({ intake: "speech_low_confidence", retries: 1 });
    await say(server, learner, speech(MECH_PHRASE, 0.1));
    expect(actorLive(server)).toMatchObject({ intake: "speech_low_confidence", retries: 2 });
    await say(server, learner, speech(MECH_PHRASE, 0.9));
    expect(actorLive(server)).toMatchObject({ intake: "mechanism_of_injury_history", retries: 0 });
  }, 60000);

  it("counterweight: typed free text that matches nothing is not a low-confidence retry", async () => {
    const { server, learner } = await session();
    await say(server, learner, speech(MECH_PHRASE, 0.2));
    await say(server, learner, { text: "what is your favourite colour" });
    expect(actorLive(server)).toMatchObject({ intake: "utterance_unmatched", retries: 0 });
  }, 60000);

  it("the trace counts the retry on the utterance that follows low confidence, and carries no text", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c30-"));
    const { server, learner } = await session({ traceDir });
    await say(server, learner, speech(MECH_PHRASE, 0.2));
    await say(server, learner, speech(MECH_PHRASE, 0.3));
    await say(server, learner, speech(MECH_PHRASE, 0.9));
    await say(server, learner, { topicTag: "knee_rom_exam_requested" });
    await server.close();
    await waitFor(() => readdirSync(traceDir).some((name) => name.endsWith(TRACE_SUFFIX)), 30000, "trace file");
    const raws = readdirSync(traceDir).map((name) => readFileSync(join(traceDir, name), "utf8"));
    const slotA = raws.map((raw) => JSON.parse(raw) as TraceFile).find((trace) => trace.stationId === "slot-a");
    const ends = (slotA?.events ?? []).filter((event) => event.kind === "utterance-end");
    expect(ends.map((event) => [event.tag, event.retry])).toEqual([
      [expect.any(String), undefined],
      ["speech_low_confidence", undefined],
      ["speech_low_confidence", 1],
      ["mechanism_of_injury_history", 2],
      ["knee_rom_exam_requested", undefined],
    ]);
    for (const raw of raws) expect(raw.toLowerCase().includes(MECH_PHRASE.toLowerCase())).toBe(false);
  }, 90000);
});
