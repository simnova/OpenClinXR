import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clinicKneePainScenario, edChestPainScenario, scenarioDialogueSeedBank } from "@openclinxr/scenario-fixtures";
import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C27 RED (planted by lane manager, 2026-11-05): a learner's typed free text maps to a topic answer
// deterministically from scenario-authored phrases (directive D9: no LLM in this path).
// Contract (names are the spec):
//   Seed data: a seed may carry utterancePhrases: string[] (authored phrase list for the topics of that seed);
//   a seed-bank entry may carry utteranceFallback: { line: string } (the scenario's authored fallback line).
//   utterance-end payload { text: string } (1..500 chars) with NO topicTag, on a cast station, is matched:
//     normalize = lowercase, strip diacritics, non-alphanumerics -> single space, trim.
//     exact  : normalized text equals a normalized phrase of one of the selected actor's answers.
//     phrase : normalized text contains a normalized phrase on whole-word boundaries; longest phrase (in words)
//              wins, ties go to the first authored. exact beats phrase.
//     The topic is the first of the matching answer's topicTags that is in the station topic menu; the reply is
//     then exactly what utterance-end{topicTag} gives (replyId `${actor}:seed:${seedId}`, caption "<name>: <line>").
//     No match -> fallback: caption "<displayName>: <utteranceFallback.line>" (caption "" when none authored),
//     replyId = the C3 row for the actor's turn count.
//   Turn 1 stays the C17 opening. An explicit topicTag wins over text. text that is not a string, "" or > 500
//   chars is rejected "bad-utterance-payload". Off the phrase lists nothing changes (known-good).
//   Trace (review-safe): the utterance-end event carries tag = the topic id (fallback: "utterance_unmatched") and
//   match = "exact" | "phrase" | "fallback". Never the learner's text, never an authored phrase or line.
//   Boot refuses with "dialogueSeeds" when utterancePhrases is not an array of non-empty strings or
//   utteranceFallback has no non-empty line.

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

const FALLBACK_LINE = "Sorry, I did not follow that. Can you ask it another way?";
const MECH_PHRASES = ["how did you hurt your knee", "what happened when you landed"];
const ROM_PHRASES = ["bend your knee", "how far can you bend it"];
const phraseSeeds = (seeds: readonly Record<string, unknown>[]) =>
  seeds.map((entry) =>
    entry["seedId"] === "clinic_knee_mechanism_history" ? { ...entry, utterancePhrases: MECH_PHRASES }
    : entry["seedId"] === "clinic_knee_rom_exam_on_learner_request" ? { ...entry, utterancePhrases: ROM_PHRASES }
    : entry);
const BANK = scenarioDialogueSeedBank.map((entry) =>
  entry.scenarioId !== KNEE.scenarioId ? entry : { ...entry, utteranceFallback: { line: FALLBACK_LINE }, seeds: phraseSeeds(entry.seeds as never) });
const BANK_NO_FALLBACK = scenarioDialogueSeedBank.map((entry) =>
  entry.scenarioId !== KNEE.scenarioId ? entry : { ...entry, seeds: phraseSeeds(entry.seeds as never) });

const kneeSeeds = scenarioDialogueSeedBank.find((entry) => entry.scenarioId === KNEE.scenarioId)?.seeds ?? [];
const seed = (seedId: string) => {
  const found = kneeSeeds.find((entry) => entry.seedId === seedId);
  if (!found) throw new Error(`fixture seed ${seedId} missing`);
  return found;
};
const MECHANISM = seed("clinic_knee_mechanism_history");
const ROM = seed("clinic_knee_rom_exam_on_learner_request");
const JORDAN = KNEE.actors.find((entry) => entry.actorId === MECHANISM.actorId)!;
const answerOf = (entry: typeof MECHANISM) => ({
  replyId: `${entry.actorId}:seed:${entry.seedId}`,
  caption: `${JORDAN.displayName}: ${entry.caption ?? entry.spokenText ?? ""}`,
});
const FALLBACK_CAPTION = `${JORDAN.displayName}: ${FALLBACK_LINE}`;

function blueprint(): Record<string, unknown> {
  return {
    blueprintId: "bp-fixture-c27",
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
  expect(await learner.sendIntent("utterance-end", payload)).toMatchObject({ status: "ack" });
  await waitFor(() => live(server).actors[actorId]?.speaking === true, 3000, "reply");
  const reply = live(server).actors[actorId];
  // let the reply finish so the next learner turn starts clean
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

describe("xr-sync-server C27 free-text utterances", () => {
  it("known-good: with no phrases authored, text on turn 2 gets the C3 row and an empty caption", async () => {
    const { server, learner } = await session({ dialogueSeeds: scenarioDialogueSeedBank });
    expect(await say(server, learner, { text: "how did you hurt your knee" })).toEqual({ replyId: c3Row(2), caption: "" });
  }, 40000);

  it("turn 1 stays the opening line even for matching text", async () => {
    const server = await boot({ examBlueprint: blueprint(), scenarios: [KNEE, CHEST], dialogueSeeds: BANK });
    const learner = await connect(server.url, { roomOptions: { actors: ["a1", "a2"] } });
    leavers.push(() => learner.leave());
    await waitFor(() => live(server).phase === "encounter", 5000, "encounter");
    expect((await say(server, learner, { text: "how did you hurt your knee" })).replyId).toBe(`${JORDAN.actorId}:opening`);
  }, 30000);

  it("a contained authored phrase answers with that topic's authored line, regardless of case and punctuation", async () => {
    const { server, learner } = await session();
    expect(await say(server, learner, { text: "Jordan, HOW did you hurt your knee today?!" })).toEqual(answerOf(MECHANISM));
    expect(await say(server, learner, { text: "Can you show me how far can you bend it?" })).toEqual(answerOf(ROM));
  }, 60000);

  it("an exact phrase matches, and the topic order does not decide the answer", async () => {
    const { server, learner } = await session();
    expect(await say(server, learner, { text: "Bend your knee." })).toEqual(answerOf(ROM));
    expect(await say(server, learner, { text: "what happened when you landed" })).toEqual(answerOf(MECHANISM));
  }, 60000);

  it("counterweight: a longer phrase beats a shorter one, in either order of mention", async () => {
    const { server, learner } = await session();
    expect(await say(server, learner, { text: "bend your knee, and tell me how did you hurt your knee" })).toEqual(answerOf(MECHANISM));
    expect(await say(server, learner, { text: "how did you hurt your knee, then bend your knee" })).toEqual(answerOf(MECHANISM));
  }, 60000);

  it("counterweight: a phrase inside another word is not a match (whole-word boundaries)", async () => {
    const { server, learner } = await session();
    expect(await say(server, learner, { text: "unbend your kneecap" })).toEqual({ replyId: c3Row(2), caption: FALLBACK_CAPTION });
  }, 40000);

  it("an unmatched text gets the authored fallback line on the C3 row", async () => {
    const { server, learner } = await session();
    expect(await say(server, learner, { text: "what is your favourite colour" })).toEqual({ replyId: c3Row(2), caption: FALLBACK_CAPTION });
  }, 40000);

  it("an unmatched text with no authored fallback gets an empty caption", async () => {
    const { server, learner } = await session({ dialogueSeeds: BANK_NO_FALLBACK });
    expect(await say(server, learner, { text: "what is your favourite colour" })).toEqual({ replyId: c3Row(2), caption: "" });
  }, 40000);

  it("counterweight: an explicit topicTag wins over the text", async () => {
    const { server, learner } = await session();
    expect(await say(server, learner, { topicTag: "knee_rom_exam_requested", text: "how did you hurt your knee" })).toEqual(answerOf(ROM));
  }, 40000);

  it("rejects text that is not a string, is empty, or exceeds 500 characters", async () => {
    const { learner } = await session();
    await learner.sendIntent("select-actor", { actorId: JORDAN.actorId });
    await learner.sendIntent("utterance-start", {});
    for (const text of [7, "", "x".repeat(501)]) {
      expect(await learner.sendIntent("utterance-end", { text })).toMatchObject({ status: "reject", reason: "bad-utterance-payload" });
    }
  }, 40000);

  it("the trace holds topic id + match kind and neither the learner's text nor any authored phrase or line", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c27-"));
    const { server, learner } = await session({ traceDir });
    const typed = ["Jordan, HOW did you hurt your knee today?!", "Bend your knee.", "what is your favourite colour"];
    for (const text of typed) await say(server, learner, { text });
    await server.close();
    await waitFor(() => readdirSync(traceDir).some((name) => name.endsWith(TRACE_SUFFIX)), 30000, "trace file");
    const files = readdirSync(traceDir);
    const slotA = files
      .filter((name) => name.endsWith(TRACE_SUFFIX))
      .map((name) => JSON.parse(readFileSync(join(traceDir, name), "utf8")) as { stationId: string; events: Array<{ kind: string; tag?: string; match?: string }>; turns: Array<{ replyId: string }> })
      .find((trace) => trace.stationId === "slot-a");
    const ends = (slotA?.events ?? []).filter((event) => event.kind === "utterance-end").slice(1);
    expect(ends.map((event) => [event.tag, event.match])).toEqual([
      ["mechanism_of_injury_history", "phrase"],
      ["knee_rom_exam_requested", "exact"],
      ["utterance_unmatched", "fallback"],
    ]);
    const forbidden = [...typed, "hello there", ...MECH_PHRASES, ...ROM_PHRASES, FALLBACK_LINE, ...kneeSeeds.flatMap((entry) => [entry.spokenText, entry.caption])].filter((text): text is string => typeof text === "string");
    for (const name of files) {
      const raw = readFileSync(join(traceDir, name), "utf8").toLowerCase();
      expect(forbidden.filter((text) => raw.includes(text.toLowerCase())), name).toEqual([]);
    }
  }, 90000);

  it("refuses malformed utterancePhrases and utteranceFallback", async () => {
    const mutate = (patch: Record<string, unknown>) => scenarioDialogueSeedBank.map((entry) => entry.scenarioId !== KNEE.scenarioId ? entry : { ...entry, ...patch });
    const withSeedPhrases = (utterancePhrases: unknown) => mutate({ seeds: kneeSeeds.map((entry, index) => (index === 0 ? { ...entry, utterancePhrases } : entry)) });
    for (const bad of [withSeedPhrases("bend"), withSeedPhrases([""]), withSeedPhrases([3]), mutate({ utteranceFallback: {} }), mutate({ utteranceFallback: { line: "" } })]) {
      await expect(bootServer({ examBlueprint: blueprint(), scenarios: [KNEE, CHEST], dialogueSeeds: bad })).rejects.toThrow(/dialogueSeeds/);
    }
  }, 30000);
});
