import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clinicKneePainScenario, edChestPainScenario, scenarioDialogueSeedBank } from "@openclinxr/scenario-fixtures";
import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C29 grade-01 blockers (lane manager, 2026-11-05): turn-1 low-confidence speech keeps the opening reply; utterance-start refuses
// modality/confidence; replay refuses malformed or forged speech events. Original C29 header:
// C29 RED (planted by lane manager, 2026-11-05): a recognized spoken utterance enters the room through the SAME
// matcher as C27 typed text (directive D9: no LLM; recognition happens outside the room, the room gets text + confidence).
// Contract (names are the spec):
//   utterance-end payload { text, modality: "speech", confidence } : text 1..500 chars, confidence a finite number in [0,1],
//     no topicTag allowed with speech. Violations -> reject "bad-utterance-payload". modality may only be "speech" or
//     "typed" or absent (absent == typed); any other value -> "bad-utterance-payload". confidence without modality
//     "speech" -> "bad-utterance-payload".
//   Seed-bank entry utteranceFallback may carry minSpeechConfidence (number in [0,1], scenario-authored). Boot refuses
//     with "dialogueSeeds" for any other type/range. Absent -> no gating (0).
//   confidence < minSpeechConfidence (strictly less): the answer is the fallback (caption "<name>: <fallback line>" or "",
//     replyId = C3 row) whatever the text says; trace tag = "speech_low_confidence" (reserved: a seed using it refuses at
//     boot with "reserved"), match = "fallback".
//   confidence >= threshold: exactly what typed text gives (C27 matcher).
//   Trace (review-safe): every utterance-end carries modality "typed"|"speech"; speech events also carry confidence rounded
//     to 2 decimals. Never the text.
//   Replay (replayConversationTrace) reproduces the same replyIds from the recorded events alone, keeps modality/confidence,
//     and runs no recognition.

const TIMING = { doorwaySeconds: 1, encounterSeconds: 300, noteSeconds: 1, breakAfterStationOrders: [] };
const neverFires = <T extends { eventSchedule: Array<{ atSecond: number }> }>(scenario: T): T => ({
  ...scenario,
  status: "approved",
  eventSchedule: scenario.eventSchedule.map((entry) => ({ ...entry, atSecond: TIMING.encounterSeconds })),
});
const KNEE = neverFires(clinicKneePainScenario);
const CHEST = neverFires(edChestPainScenario);
const TRACE_SUFFIX = ".conversation-trace.json";
const C3_IDS = ["c3-ack-open", "c3-ack-onset", "c3-ack-recap"];
const FALLBACK_LINE = "Sorry, I did not follow that. Can you ask it another way?";
const THRESHOLD = 0.5;
const withFallback = (fallback: Record<string, unknown>) =>
  scenarioDialogueSeedBank.map((entry) => entry.scenarioId !== KNEE.scenarioId ? entry : { ...entry, utteranceFallback: fallback });
const BANK = withFallback({ line: FALLBACK_LINE, minSpeechConfidence: THRESHOLD });
const BANK_UNGATED = withFallback({ line: FALLBACK_LINE });

const kneeSeeds = scenarioDialogueSeedBank.find((entry) => entry.scenarioId === KNEE.scenarioId)?.seeds ?? [];
const MECHANISM = kneeSeeds.find((entry) => entry.seedId === "clinic_knee_mechanism_history")!;
const JORDAN = KNEE.actors.find((entry) => entry.actorId === MECHANISM.actorId)!;
const MECH_PHRASE = (MECHANISM.utterancePhrases ?? [])[0] ?? "";
const MECH_REPLY = { replyId: `${MECHANISM.actorId}:seed:${MECHANISM.seedId}`, caption: `${JORDAN.displayName}: ${MECHANISM.caption ?? MECHANISM.spokenText ?? ""}` };
const FALLBACK_CAPTION = `${JORDAN.displayName}: ${FALLBACK_LINE}`;

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
  const { skipOpening: _skip, ...serverOptions } = options;
  const server = await boot({ examBlueprint: blueprint(), scenarios: [KNEE, CHEST], dialogueSeeds: BANK, ...serverOptions });
  const learner = await connect(server.url, { roomOptions: { actors: ["a1", "a2"] } });
  leavers.push(() => learner.leave());
  await waitFor(() => live(server).phase === "encounter", 5000, "slot-a encounter");
  if (options["skipOpening"] !== true) await say(server, learner, { text: "hello there" }); // turn 1: the C17 opening
  return { server, learner };
}
const speech = (text: string, confidence: number) => ({ text, modality: "speech", confidence });


describe("xr-sync-server C29 grade-01 fixes", () => {
  it("turn 1 stays the opening even for low-confidence speech, and the trace still tags it", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c29-t1-"));
    const { server, learner } = await session({ skipOpening: true, traceDir });
    expect((await say(server, learner, speech(MECH_PHRASE, 0.1))).replyId).toBe(`${JORDAN.actorId}:opening`);
    await server.close();
    await waitFor(() => readdirSync(traceDir).some((name) => name.endsWith(TRACE_SUFFIX)), 30000, "trace file");
    const trace = JSON.parse(readFileSync(join(traceDir, readdirSync(traceDir).find((name) => name.endsWith(TRACE_SUFFIX))!), "utf8")) as { events: Array<{ kind: string; tag?: string; modality?: string }> };
    expect(trace.events.filter((event) => event.kind === "utterance-end").map((event) => [event.tag, event.modality])).toEqual([["speech_low_confidence", "speech"]]);
  }, 40000);

  it("utterance-start refuses modality and confidence fields", async () => {
    const { learner } = await session();
    await learner.sendIntent("select-actor", { actorId: JORDAN.actorId });
    for (const payload of [{ modality: "speech" }, { confidence: 0.9 }]) {
      expect(await learner.sendIntent("utterance-start", payload), JSON.stringify(payload)).toMatchObject({ status: "reject", reason: "bad-utterance-payload" });
    }
  }, 40000);
});
