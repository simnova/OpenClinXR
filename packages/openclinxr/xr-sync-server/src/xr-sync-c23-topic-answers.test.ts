import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clinicKneePainScenario, edChestPainScenario, scenarioDialogueSeedBank } from "@openclinxr/scenario-fixtures";
import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C23b RED (planted by root, 2026-10-31): the learner's topic selects the answer the scenario authored for it.
// Contract (names are the spec):
//   Server option dialogueSeeds: the factory's scenarioDialogueSeedBank shape, Array<{ scenarioId, seeds }>, each
//   seed { seedId, actorId, expectedTraceTags, safetyExpectation, spokenText?, caption?, ... }. Requires scenarios;
//   entries for scenarios no station casts are ignored; a malformed entry, or a seed of a cast scenario naming an
//   actor that scenario does not cast, refuses boot with a message naming "dialogueSeeds".
//   On a cast station, utterance-end to actor A with an accepted topicTag T (C22) on A's turn >= 2 answers with
//   the FIRST seed, in authored order, whose actorId is A, whose expectedTraceTags include T, whose
//   safetyExpectation is "responds_from_visible_facts", and which has an authored line (caption ?? spokenText):
//   replyId `${A}:seed:${seedId}`, caption "<displayName>: <line>" (the C17 caption format).
//   Unchanged: turn 1 is the C17 opening; no topicTag, no matching seed, or no dialogueSeeds -> C3 table by the
//   actor's own turn count with caption "". Persisted trace turns carry the live replyId; no authored line text
//   reaches any persisted file.
// Counterweights: the same two topics asked in both orders must give the authored line per topic (a turn-count
// table cannot pass both orders); a topic whose only seed belongs to another actor gets the C3 row, not that
// actor's line. Fixture: both schedules at the encounter length so they never fire (C19 clause 3).

const TIMING = { doorwaySeconds: 1, encounterSeconds: 8, noteSeconds: 1, breakAfterStationOrders: [] };
const neverFires = <T extends { eventSchedule: Array<{ atSecond: number }> }>(scenario: T): T => ({
  ...scenario,
  status: "approved",
  eventSchedule: scenario.eventSchedule.map((entry) => ({ ...entry, atSecond: TIMING.encounterSeconds })),
});
const KNEE = neverFires(clinicKneePainScenario);
const CHEST = neverFires(edChestPainScenario);
const TRACE_SUFFIX = ".conversation-trace.json";
const C3_IDS = ["c3-ack-open", "c3-ack-onset", "c3-ack-recap"];
const c3Row = (turnCount: number): string => C3_IDS[(turnCount - 1) % C3_IDS.length] ?? "";

const kneeSeeds = scenarioDialogueSeedBank.find((entry) => entry.scenarioId === KNEE.scenarioId)?.seeds ?? [];
function seed(seedId: string) {
  const found = kneeSeeds.find((entry) => entry.seedId === seedId);
  if (!found) throw new Error(`fixture seed ${seedId} missing`);
  return found;
}
function actor(actorId: string) {
  const found = KNEE.actors.find((entry) => entry.actorId === actorId);
  if (!found) throw new Error(`fixture actor ${actorId} missing`);
  return found;
}
const MECHANISM = seed("clinic_knee_mechanism_history");
const ROM = seed("clinic_knee_rom_exam_on_learner_request");
const PARENT = seed("clinic_knee_parent_return_to_play");
const JORDAN = actor(MECHANISM.actorId);
const answerOf = (entry: typeof MECHANISM) => ({
  replyId: `${entry.actorId}:seed:${entry.seedId}`,
  caption: `${actor(entry.actorId).displayName}: ${entry.caption ?? entry.spokenText ?? ""}`,
});

function blueprint(): Record<string, unknown> {
  return {
    blueprintId: "bp-fixture-c23b",
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
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

type LiveState = {
  stationId: string;
  phase: string;
  actors: Record<string, { speaking: boolean; replyId: string; caption: string }>;
};
const live = (server: EncounterServer): LiveState => JSON.parse(server.getStateJSON()) as LiveState;

/** One learner turn to actorId; returns the actor's reply as the room publishes it. */
async function ask(server: EncounterServer, learner: SyncConnection, actorId: string, payload: Record<string, unknown>) {
  expect(await learner.sendIntent("select-actor", { actorId })).toMatchObject({ status: "ack" });
  expect(await learner.sendIntent("utterance-start", {})).toMatchObject({ status: "ack" });
  expect(await learner.sendIntent("utterance-end", { actorId, ...payload })).toMatchObject({ status: "ack" });
  await waitFor(() => live(server).actors[actorId]?.speaking === true, 3000, `${actorId} reply`);
  const reply = live(server).actors[actorId];
  return { replyId: reply?.replyId ?? "", caption: reply?.caption ?? "" };
}

async function castSession(options: Record<string, unknown> = {}) {
  const server = await boot({ examBlueprint: blueprint(), scenarios: [KNEE, CHEST], ...options });
  const learner = await joinRoom(server);
  await waitFor(() => live(server).phase === "encounter", 5000, "slot-a encounter");
  return { server, learner };
}

describe("xr-sync-server C23b topic answers", () => {
  it("known-good: without dialogueSeeds a topic on turn 2 gets the C3 row (C22 behaviour)", async () => {
    const { server, learner } = await castSession();
    expect((await ask(server, learner, JORDAN.actorId, { topicTag: "mechanism_of_injury_history" })).replyId).toBe(
      `${JORDAN.actorId}:opening`,
    );
    expect(await ask(server, learner, JORDAN.actorId, { topicTag: "mechanism_of_injury_history" })).toEqual({
      replyId: c3Row(2),
      caption: "",
    });
  }, 20000);

  it("a topic on turn 2+ answers with the seed the scenario authored for that actor and topic", async () => {
    const { server, learner } = await castSession({ dialogueSeeds: scenarioDialogueSeedBank });
    // Turn 1 stays the C17 opening even with a topic.
    expect((await ask(server, learner, JORDAN.actorId, { topicTag: "knee_rom_exam_requested" })).replyId).toBe(
      `${JORDAN.actorId}:opening`,
    );
    expect(await ask(server, learner, JORDAN.actorId, { topicTag: "mechanism_of_injury_history" })).toEqual(answerOf(MECHANISM));
    expect(await ask(server, learner, JORDAN.actorId, { topicTag: "knee_rom_exam_requested" })).toEqual(answerOf(ROM));
    // A seed matches on any of its expectedTraceTags.
    expect(await ask(server, learner, JORDAN.actorId, { topicTag: "weight_bearing_question" })).toEqual(answerOf(MECHANISM));
    // No topic -> C3 row by Jordan's own turn count (turn 5).
    expect(await ask(server, learner, JORDAN.actorId, {})).toEqual({ replyId: c3Row(5), caption: "" });
  }, 30000);

  it("counterweight: the same topics in the other order give the same authored line per topic", async () => {
    const { server, learner } = await castSession({ dialogueSeeds: scenarioDialogueSeedBank });
    await ask(server, learner, JORDAN.actorId, {});
    expect(await ask(server, learner, JORDAN.actorId, { topicTag: "knee_rom_exam_requested" })).toEqual(answerOf(ROM));
    expect(await ask(server, learner, JORDAN.actorId, { topicTag: "mechanism_of_injury_history" })).toEqual(answerOf(MECHANISM));
  }, 30000);

  it("counterweight: a topic whose only seed is another actor's gets the C3 row, not that actor's line", async () => {
    const { server, learner } = await castSession({ dialogueSeeds: scenarioDialogueSeedBank });
    expect(PARENT.actorId).not.toBe(JORDAN.actorId);
    await ask(server, learner, JORDAN.actorId, {});
    expect(await ask(server, learner, JORDAN.actorId, { topicTag: "return_to_play_counseling" })).toEqual({
      replyId: c3Row(2),
      caption: "",
    });
    await ask(server, learner, PARENT.actorId, {});
    expect(await ask(server, learner, PARENT.actorId, { topicTag: "return_to_play_counseling" })).toEqual(answerOf(PARENT));
  }, 30000);

  it("the persisted trace carries the live replyIds and no authored line text", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c23b-"));
    const { server, learner } = await castSession({ dialogueSeeds: scenarioDialogueSeedBank, traceDir });
    const replies = [
      await ask(server, learner, JORDAN.actorId, {}),
      await ask(server, learner, JORDAN.actorId, { topicTag: "mechanism_of_injury_history" }),
      await ask(server, learner, JORDAN.actorId, { topicTag: "knee_rom_exam_requested" }),
    ];
    await waitFor(() => readdirSync(traceDir).some((name) => name.endsWith(TRACE_SUFFIX)), 30000, "trace file");
    await server.close();
    const files = readdirSync(traceDir);
    const slotA = files
      .filter((name) => name.endsWith(TRACE_SUFFIX))
      .map((name) => JSON.parse(readFileSync(join(traceDir, name), "utf8")) as { stationId: string; turns: Array<{ replyId: string }> })
      .find((trace) => trace.stationId === "slot-a");
    expect(slotA?.turns.map((turn) => turn.replyId)).toEqual(replies.map((reply) => reply.replyId));
    const lines = kneeSeeds.flatMap((entry) => [entry.spokenText, entry.caption]).filter((text): text is string => typeof text === "string");
    for (const name of files) {
      const raw = readFileSync(join(traceDir, name), "utf8");
      expect(lines.filter((line) => raw.includes(line)), name).toEqual([]);
    }
  }, 40000);

  it("refuses malformed dialogueSeeds and seeds naming an actor the cast scenario does not cast", async () => {
    await expect(bootServer({ dialogueSeeds: scenarioDialogueSeedBank })).rejects.toThrow(/dialogueSeeds/);
    await expect(
      bootServer({ examBlueprint: blueprint(), scenarios: [KNEE, CHEST], dialogueSeeds: [{ scenarioId: KNEE.scenarioId, seeds: "x" }] }),
    ).rejects.toThrow(/dialogueSeeds/);
    const stranger = { ...MECHANISM, seedId: "c23b_stranger", actorId: "nobody_v1" };
    await expect(
      bootServer({ examBlueprint: blueprint(), scenarios: [KNEE, CHEST], dialogueSeeds: [{ scenarioId: KNEE.scenarioId, seeds: [stranger] }] }),
    ).rejects.toThrow(/dialogueSeeds/);
  }, 20000);
});
