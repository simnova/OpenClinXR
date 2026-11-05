import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clinicKneePainScenario, edChestPainScenario, scenarioDialogueSeedBank, type DialogueFixtureSeed } from "@openclinxr/scenario-fixtures";
import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer, type TopicAffect } from "./index.js";

// C24 RED (planted by the lane manager, 2026-11-05): a seed's authored `affect` sets the answering actor's emotion.
// Contract (names are the spec):
//   On a cast station, when utterance-end to actor A with accepted topicTag T selects a seed (C23b) that carries
//   affect in {anxious, concerned, reassured, neutral}, the turn's single emotion transition ends in that affect:
//   actors[A].emotion === affect, and the trace emotions entry for that turn has to === affect. Later turns of A
//   start the engine from that affect. Unchanged: the opening turn, a turn with no topic / no matching seed, and
//   other actors keep the policy's result (knee: no acknowledgement rule, so they hold the baseline "anxious").
//   The recorded cast.topicAnswers selectors carry `affect` (no line text) so replay recomputes the same emotions
//   from recorded data alone. A seed whose affect is present but not one of the four values refuses boot with a
//   message naming "dialogueSeeds". A trace file whose cast.topicAnswers affect is not one of the four refuses
//   replay with "replay-bad-trace".
// Counterweights: parent (authored concerned) and assistant (authored neutral) end in different emotions while the
// policy gives both anxious, so a constant cannot pass; Jordan asked in between stays anxious; known-good: with no
// dialogueSeeds every actor stays anxious.
// Part A type link: TopicAffect must equal the DialogueFixtureSeed["affect"] value set (compile-time).
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const affectTypeLinked: Equal<TopicAffect, NonNullable<DialogueFixtureSeed["affect"]>> = true;

const TIMING = { doorwaySeconds: 1, encounterSeconds: 8, noteSeconds: 1, breakAfterStationOrders: [] };
const neverFires = <T extends { eventSchedule: Array<{ atSecond: number }> }>(scenario: T): T => ({
  ...scenario,
  status: "approved",
  eventSchedule: scenario.eventSchedule.map((entry) => ({ ...entry, atSecond: TIMING.encounterSeconds })),
});
const KNEE = neverFires(clinicKneePainScenario);
const CHEST = neverFires(edChestPainScenario);
const TRACE_SUFFIX = ".conversation-trace.json";

const kneeSeeds = scenarioDialogueSeedBank.find((entry) => entry.scenarioId === KNEE.scenarioId)?.seeds ?? [];
const seedOf = (seedId: string) => {
  const found = kneeSeeds.find((entry) => entry.seedId === seedId);
  if (!found) throw new Error(`fixture seed ${seedId} missing`);
  return found;
};
const MECHANISM = seedOf("clinic_knee_mechanism_history");
const PARENT = seedOf("clinic_knee_parent_return_to_play");
const ASSISTANT = seedOf("clinic_knee_assistant_swelling_notes");
const PARENT_TOPIC = "return_to_play_counseling";
const ASSISTANT_TOPIC = "swelling_timeline_question";

function blueprint(): Record<string, unknown> {
  return {
    blueprintId: "bp-fixture-c24",
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
type LiveState = { phase: string; actors: Record<string, { speaking: boolean; emotion: string; replyId: string }> };
const live = (server: EncounterServer): LiveState => JSON.parse(server.getStateJSON()) as LiveState;

async function ask(server: EncounterServer, learner: SyncConnection, actorId: string, payload: Record<string, unknown>) {
  expect(await learner.sendIntent("select-actor", { actorId })).toMatchObject({ status: "ack" });
  expect(await learner.sendIntent("utterance-start", {})).toMatchObject({ status: "ack" });
  expect(await learner.sendIntent("utterance-end", { actorId, ...payload })).toMatchObject({ status: "ack" });
  await waitFor(() => live(server).actors[actorId]?.speaking === true, 3000, `${actorId} reply`);
  return live(server).actors[actorId]?.emotion ?? "";
}
type ReplySnapshot = { replayDone?: boolean; turnId?: number; actors?: Record<string, { speaking: boolean; emotion: string; replyId: string }> };
/** Pushes `replyId:emotion` for the parent on each new speaking turn (rising edge or a new turnId while speaking). */
function watchReplies(connection: SyncConnection, out: string[], onDone?: () => void): void {
  let speaking = false;
  let lastTurn = -1;
  connection.onState((raw) => {
    const snapshot = raw as ReplySnapshot;
    const parent = snapshot.actors?.[PARENT.actorId];
    if (parent !== undefined) {
      if (parent.speaking && (!speaking || snapshot.turnId !== lastTurn)) out.push(`${parent.replyId}:${parent.emotion}`);
      speaking = parent.speaking;
      if (parent.speaking) lastTurn = snapshot.turnId ?? -1;
    }
    if (snapshot.replayDone === true) onDone?.();
  });
}
async function replayParentReplies(traceDir: string): Promise<string[]> {
  const server = await boot({ replayDir: traceDir, replayStepMs: 10 });
  const reviewer = await connect(server.url, { roomOptions: { replayStationId: "slot-a" } });
  leavers.push(() => reviewer.leave());
  const replies: string[] = [];
  let done = false;
  watchReplies(reviewer, replies, () => { done = true; });
  await waitFor(() => done, 30000, "replayDone");
  return replies;
}
async function castSession(options: Record<string, unknown> = {}) {
  const server = await boot({ examBlueprint: blueprint(), scenarios: [KNEE, CHEST], ...options });
  const learner = await connect(server.url, { roomOptions: { actors: ["a1", "a2"] } });
  leavers.push(() => learner.leave());
  await waitFor(() => live(server).phase === "encounter", 5000, "slot-a encounter");
  return { server, learner };
}

describe("xr-sync-server C24 authored affect", () => {
  it("type link: TopicAffect equals the seed affect value set", () => {
    expect(affectTypeLinked).toBe(true);
    expect([PARENT.affect, ASSISTANT.affect, MECHANISM.affect]).toEqual(["concerned", "neutral", "anxious"]);
  });

  it("known-good: without dialogueSeeds every actor holds the policy baseline", async () => {
    const { server, learner } = await castSession();
    await ask(server, learner, PARENT.actorId, {});
    expect(await ask(server, learner, PARENT.actorId, { topicTag: PARENT_TOPIC })).toBe("anxious");
    await ask(server, learner, ASSISTANT.actorId, {});
    expect(await ask(server, learner, ASSISTANT.actorId, { topicTag: ASSISTANT_TOPIC })).toBe("anxious");
  }, 30000);

  it("the authored affect becomes the actor's emotion on the topic answer, per actor", async () => {
    const { server, learner } = await castSession({ dialogueSeeds: scenarioDialogueSeedBank });
    expect(await ask(server, learner, PARENT.actorId, {})).toBe("anxious");
    expect(await ask(server, learner, PARENT.actorId, { topicTag: PARENT_TOPIC })).toBe("concerned");
    expect(await ask(server, learner, MECHANISM.actorId, {})).toBe("anxious");
    expect(await ask(server, learner, MECHANISM.actorId, { topicTag: MECHANISM.expectedTraceTags[0] })).toBe("anxious");
    await ask(server, learner, ASSISTANT.actorId, {});
    expect(await ask(server, learner, ASSISTANT.actorId, { topicTag: ASSISTANT_TOPIC })).toBe("neutral");
    // Parent stays at the authored affect across a no-topic turn (engine continues from it) and was not moved by the others.
    expect(live(server).actors[PARENT.actorId]?.emotion).toBe("concerned");
    expect(await ask(server, learner, PARENT.actorId, {})).toBe("concerned");
  }, 40000);

  it("the persisted trace records the affect, and replay recomputes the same emotions", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c24-"));
    const { server, learner } = await castSession({ dialogueSeeds: scenarioDialogueSeedBank, traceDir });
    await ask(server, learner, PARENT.actorId, {});
    await ask(server, learner, PARENT.actorId, { topicTag: PARENT_TOPIC });
    // A third ask interrupts the affect turn: the interruption transition starts from the authored affect.
    await ask(server, learner, PARENT.actorId, {});
    await waitFor(() => readdirSync(traceDir).includes("exam-session.review-index.json"), 30000, "review index");
    await server.close();
    const files = readdirSync(traceDir);
    const traces = files
      .filter((name) => name.endsWith(TRACE_SUFFIX))
      .map((name) => JSON.parse(readFileSync(join(traceDir, name), "utf8")) as {
        stationId: string;
        cast?: { topicAnswers?: Array<{ actorId: string; affect?: string }> };
        emotions: Array<{ to: string; turnIndex: number | undefined }>;
      });
    const slotA = traces.find((trace) => trace.stationId === "slot-a");
    const byTurn = (emotions: Array<{ to: string; turnIndex: number | undefined }> | undefined, turn: number) => emotions?.filter((entry) => entry.turnIndex === turn).map((entry) => entry.to);
    // Turn 1 may also carry the interruption transition of the second utterance-start; the acknowledgement of turn 2 is the affect.
    expect(byTurn(slotA?.emotions, 2)?.[0]).toBe("concerned");
    expect(byTurn(slotA?.emotions, 1)?.[0]).toBe("anxious");
    expect(slotA?.cast?.topicAnswers?.find((answer) => answer.actorId === PARENT.actorId)).toMatchObject({ affect: "concerned" });
    // The emotions the live tracer wrote per turn equal what the reducer-driven replay shows at each reply, including affect-then-interruption.
    const replayed = await replayParentReplies(traceDir);
    expect(replayed.map((entry) => entry.slice(entry.lastIndexOf(":") + 1))).toEqual([1, 2, 3].map((turn) => byTurn(slotA?.emotions, turn)?.[0]));
    expect(replayed.map((entry) => entry.slice(entry.lastIndexOf(":") + 1))).toEqual(["anxious", "concerned", "concerned"]);
    const lines = kneeSeeds.flatMap((entry) => [entry.spokenText, entry.caption]).filter((text): text is string => typeof text === "string");
    for (const name of files) {
      const raw = readFileSync(join(traceDir, name), "utf8");
      expect(lines.filter((line) => raw.includes(line)), name).toEqual([]);
    }
  }, 40000);

  it("replay refuses a recorded selector whose affect is not a dialogue emotion; the unmutated trace replays", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c24r-"));
    const { server, learner } = await castSession({ dialogueSeeds: scenarioDialogueSeedBank, traceDir });
    await ask(server, learner, PARENT.actorId, {});
    await ask(server, learner, PARENT.actorId, { topicTag: PARENT_TOPIC });
    await waitFor(() => readdirSync(traceDir).includes("exam-session.review-index.json"), 30000, "review index");
    await server.close();
    const name = readdirSync(traceDir).find((entry) => entry.endsWith(TRACE_SUFFIX) && (JSON.parse(readFileSync(join(traceDir, entry), "utf8")) as { stationId: string }).stationId === "slot-a");
    if (name === undefined) throw new Error("no slot-a trace");
    const file = join(traceDir, name);
    const trace = JSON.parse(readFileSync(file, "utf8")) as { cast: { topicAnswers: Array<Record<string, unknown>> } };
    const replay = await boot({ replayDir: traceDir, replayStepMs: 10 });
    await (await connect(replay.url, { roomOptions: { replayStationId: "slot-a" } })).leave();
    for (const affect of ["furious", 7, null]) {
      const topicAnswers = trace.cast.topicAnswers.map((answer) => ({ ...answer, affect }));
      writeFileSync(file, JSON.stringify({ ...trace, cast: { ...trace.cast, topicAnswers } }));
      const bad = await boot({ replayDir: traceDir, replayStepMs: 10 });
      await expect(connect(bad.url, { roomOptions: { replayStationId: "slot-a" } }), String(affect)).rejects.toThrow();
    }
  }, 60000);

  it("refuses a seed whose affect is not one of the four dialogue emotions", async () => {
    const bad = { ...PARENT, seedId: "c24_bad_affect", affect: "furious" };
    await expect(
      bootServer({ examBlueprint: blueprint(), scenarios: [KNEE, CHEST], dialogueSeeds: [{ scenarioId: KNEE.scenarioId, seeds: [bad] }] }),
    ).rejects.toThrow(/dialogueSeeds/);
  }, 20000);
});
