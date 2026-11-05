import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clinicKneePainScenario, edChestPainScenario, scenarioDialogueSeedBank } from "@openclinxr/scenario-fixtures";
import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C28 RED (lane manager, 2026-11-05): the SHIPPED seed bank (no test overlay) carries utterancePhrases per answerable
// seed and an utteranceFallback for ed-chest and knee; the reserved tag utterance_unmatched is refused at boot and
// replay; normalizeUtterance is Unicode-safe (NFKC + case fold, accents folded, any-script letters kept).
const TIMING = { doorwaySeconds: 1, encounterSeconds: 150, noteSeconds: 1, breakAfterStationOrders: [] };
const SHORT = { ...TIMING, encounterSeconds: 8 };
const neverFires = <T extends { eventSchedule: Array<{ atSecond: number }> }>(scenario: T, timing = TIMING): T => ({
  ...scenario,
  status: "approved",
  eventSchedule: scenario.eventSchedule.map((entry) => ({ ...entry, atSecond: timing.encounterSeconds })),
});
const KNEE = neverFires(clinicKneePainScenario);
const CHEST = neverFires(edChestPainScenario);
const TRACE_SUFFIX = ".conversation-trace.json";

const bankEntry = (scenarioId: string) => {
  const found = scenarioDialogueSeedBank.find((entry) => entry.scenarioId === scenarioId);
  if (!found) throw new Error(`bank entry ${scenarioId} missing`);
  return found as { seeds: ReadonlyArray<{ seedId: string; actorId: string; spokenText?: string; caption?: string; safetyExpectation: string; utterancePhrases?: string[] }>; utteranceFallback?: { line: string } };
};
const answerable = (scenarioId: string) => bankEntry(scenarioId).seeds.filter((seed) => seed.safetyExpectation === "responds_from_visible_facts");

function blueprint(timing = TIMING): Record<string, unknown> {
  return {
    blueprintId: "bp-fixture-c28",
    title: "Fixture two-station form",
    stationSlots: [
      { slotId: "slot-a", order: 1, label: "Fixture label A", requiredEnvironmentIds: [], requiredTraceTags: [] },
      { slotId: "slot-b", order: 2, label: "Fixture label B", requiredEnvironmentIds: [], requiredTraceTags: [] },
    ],
    timing,
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

async function say(server: EncounterServer, learner: SyncConnection, actorId: string, text: string) {
  expect(await learner.sendIntent("select-actor", { actorId })).toMatchObject({ status: "ack" });
  expect(await learner.sendIntent("utterance-start", {})).toMatchObject({ status: "ack" });
  expect(await learner.sendIntent("utterance-end", { text })).toMatchObject({ status: "ack" });
  await waitFor(() => live(server).actors[actorId]?.speaking === true, 3000, "reply");
  const reply = live(server).actors[actorId];
  await waitFor(() => live(server).actors[actorId]?.speaking !== true, 8000, "reply end");
  return { replyId: reply?.replyId ?? "", caption: reply?.caption ?? "" };
}

async function session(scenarios: unknown[], actors: string[], options: Record<string, unknown> = {}, timing = TIMING) {
  const server = await boot({ examBlueprint: blueprint(timing), scenarios, dialogueSeeds: scenarioDialogueSeedBank, ...options });
  const learner = await connect(server.url, { roomOptions: { actors } });
  leavers.push(() => learner.leave());
  await waitFor(() => live(server).phase === "encounter", 5000, "slot-a encounter");
  return { server, learner };
}

describe("shipped data", () => {
  it.each([
    ["ed-chest", edChestPainScenario.scenarioId],
    ["knee", clinicKneePainScenario.scenarioId],
  ])("%s: every answerable seed carries a line and at least 4 phrases that normalize non-empty and distinct; the entry has a fallback", (_name, scenarioId) => {
    const entry = bankEntry(scenarioId);
    expect(entry.utteranceFallback?.line.trim().length).toBeGreaterThan(0);
    const seen = new Set<string>();
    expect(answerable(scenarioId).length).toBeGreaterThanOrEqual(3);
    for (const seed of answerable(scenarioId)) {
      expect(typeof (seed.caption ?? seed.spokenText), seed.seedId).toBe("string");
      expect(seed.utterancePhrases?.length ?? 0, seed.seedId).toBeGreaterThanOrEqual(4);
      for (const phrase of seed.utterancePhrases ?? []) {
        const normalized = phrase.toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
        expect(normalized, phrase).not.toBe("");
        expect(seen.has(`${seed.actorId}|${normalized}`), `duplicate ${phrase}`).toBe(false);
        seen.add(`${seed.actorId}|${normalized}`);
      }
    }
  });

  it("knee: every shipped seed's first phrase selects that seed's answer on turn 2, an unrelated sentence gets the fallback", async () => {
    const seeds = answerable(KNEE.scenarioId);
    const fallback = bankEntry(KNEE.scenarioId).utteranceFallback?.line ?? "";
    const { server, learner } = await session([KNEE, CHEST], ["a1", "a2"]);
    const first = seeds[0]!;
    const opened = new Set<string>();
    for (const seed of seeds) {
      if (!opened.has(seed.actorId)) {
        opened.add(seed.actorId);
        expect((await say(server, learner, seed.actorId, "hello there")).replyId).toBe(`${seed.actorId}:opening`); // each actor's first turn is its opening
      }
      const reply = await say(server, learner, seed.actorId, (seed.utterancePhrases ?? [])[0] ?? "");
      expect(reply.replyId, seed.seedId).toBe(`${seed.actorId}:seed:${seed.seedId}`);
    }
    const unmatched = await say(server, learner, first.actorId, "do you like the weather in june");
    expect(unmatched.caption).toContain(fallback);
  }, 120000);

  it("ed-chest: the patient's shipped phrase selects the shipped onset answer; unrelated text gets the ed-chest fallback", async () => {
    const seeds = answerable(CHEST.scenarioId);
    const patientSeed = seeds.find((seed) => seed.seedId === "patient_onset_history")!;
    const { server, learner } = await session([CHEST, KNEE], ["a1", "a2", "a3"]);
    await say(server, learner, patientSeed.actorId, "hello there");
    const reply = await say(server, learner, patientSeed.actorId, "Tell me, when did the chest pressure start?");
    expect(reply.replyId).toBe(`${patientSeed.actorId}:seed:patient_onset_history`);
    const fallback = bankEntry(CHEST.scenarioId).utteranceFallback?.line ?? "";
    expect((await say(server, learner, patientSeed.actorId, "what is the capital of france")).caption).toContain(fallback);
  }, 90000);
});

describe("typed text is matched Unicode-safely", () => {
  it("compatibility forms, case, accents and non-Latin scripts match their authored phrases; unrelated text still falls back", async () => {
    const entry = bankEntry(KNEE.scenarioId);
    const [mechanism, rom] = [entry.seeds.find((seed) => seed.seedId === "clinic_knee_mechanism_history")!, entry.seeds.find((seed) => seed.seedId === "clinic_knee_rom_exam_on_learner_request")!];
    const bank = scenarioDialogueSeedBank.map((item) => item.scenarioId !== KNEE.scenarioId ? item : {
      ...item,
      seeds: entry.seeds.map((seed) => seed.seedId === mechanism.seedId ? { ...seed, utterancePhrases: ["Колено болит", "Straße", "ΣΊΣΥΦΟΣ"] } : seed.seedId === rom.seedId ? { ...seed, utterancePhrases: ["ｃａｆé", "ﬁnger"] } : seed),
    });
    const { server, learner } = await session([KNEE, CHEST], ["a1", "a2"], { dialogueSeeds: bank });
    await say(server, learner, mechanism.actorId, "hello there");
    const mechanismId = `${mechanism.actorId}:seed:${mechanism.seedId}`;
    const romId = `${rom.actorId}:seed:${rom.seedId}`;
    const fallback = bankEntry(KNEE.scenarioId).utteranceFallback?.line ?? "";
    for (const [typed, expected] of [["КОЛЕНО БОЛИТ?", mechanismId], ["is it STRASSE", mechanismId], ["σίσυφος", mechanismId], ["CAFE", romId], ["my FINGER", romId]] as const) {
      expect((await say(server, learner, mechanism.actorId, typed)).replyId, typed).toBe(expected);
    }
    expect((await say(server, learner, mechanism.actorId, "膝が痛い")).caption).toContain(fallback);
  }, 150000);
});

describe("reserved tag utterance_unmatched", () => {
  it("boot refuses an authored answer carrying it", async () => {
    const entry = bankEntry(KNEE.scenarioId);
    const bad = scenarioDialogueSeedBank.map((item) => item.scenarioId !== KNEE.scenarioId ? item : { ...item, seeds: entry.seeds.map((seed, index) => index === 0 ? { ...seed, expectedTraceTags: ["utterance_unmatched"] } : seed) });
    await expect(bootServer({ examBlueprint: blueprint(), scenarios: [KNEE, CHEST], dialogueSeeds: bad })).rejects.toThrow(/dialogueSeeds.*utterance_unmatched/);
  }, 30000);

  it("replay refuses a recorded selector carrying it; the unmutated trace replays", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c28r-"));
    const seed = answerable(KNEE.scenarioId)[0]!;
    const { server, learner } = await session([neverFires(clinicKneePainScenario, SHORT), neverFires(edChestPainScenario, SHORT)], ["a1", "a2"], { traceDir }, SHORT);
    await say(server, learner, seed.actorId, "hello there");
    await say(server, learner, seed.actorId, (seed.utterancePhrases ?? [])[0] ?? "");
    await waitFor(() => readdirSync(traceDir).includes("exam-session.review-index.json"), 30000, "review index");
    await server.close();
    const name = readdirSync(traceDir).find((entry) => entry.endsWith(TRACE_SUFFIX) && (JSON.parse(readFileSync(join(traceDir, entry), "utf8")) as { stationId: string }).stationId === "slot-a");
    if (name === undefined) throw new Error("no slot-a trace");
    const file = join(traceDir, name);
    const trace = JSON.parse(readFileSync(file, "utf8")) as { cast: { topicAnswers: Array<{ topicTags: string[] }> } };
    const replay = await boot({ replayDir: traceDir, replayStepMs: 10 });
    await (await connect(replay.url, { roomOptions: { replayStationId: "slot-a" } })).leave();
    const topicAnswers = trace.cast.topicAnswers.map((answer) => ({ ...answer, topicTags: [...answer.topicTags, "utterance_unmatched"] }));
    writeFileSync(file, JSON.stringify({ ...trace, cast: { ...trace.cast, topicAnswers } }));
    const bad = await boot({ replayDir: traceDir, replayStepMs: 10 });
    await expect(connect(bad.url, { roomOptions: { replayStationId: "slot-a" } })).rejects.toThrow();
  }, 90000);
});
