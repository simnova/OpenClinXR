import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clinicKneePainScenario, edChestPainScenario, scenarioDialogueSeedBank } from "@openclinxr/scenario-fixtures";
import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C31 RED (lane manager, 2026-11-06): a replay server booted with scenarios + dialogueSeeds recomputes each replayed
// actor turn's caption from the cast + shipped seed bank by replyId. The trace stays review-safe (no caption text).
// A replyId that does not resolve refuses the station at join with `replay-unresolved-reply`.
const TIMING = { doorwaySeconds: 1, encounterSeconds: 8, noteSeconds: 1, breakAfterStationOrders: [] };
const CHEST = { ...edChestPainScenario, status: "approved", eventSchedule: edChestPainScenario.eventSchedule.map((e) => ({ ...e, atSecond: TIMING.encounterSeconds })) };
const KNEE = { ...clinicKneePainScenario, status: "approved", eventSchedule: clinicKneePainScenario.eventSchedule.map((e) => ({ ...e, atSecond: TIMING.encounterSeconds })) };
const TRACE_SUFFIX = ".conversation-trace.json";
const entry = scenarioDialogueSeedBank.find((e) => e.scenarioId === CHEST.scenarioId) as unknown as { seeds: Array<{ seedId: string; actorId: string; caption?: string; spokenText?: string; utterancePhrases?: string[] }>; utteranceFallback: { line: string } };
const onset = entry.seeds.find((s) => s.seedId === "patient_onset_history")!;
const patient = CHEST.actors.find((a) => a.actorId === onset.actorId)!;
const blueprint = { blueprintId: "bp-c31", title: "C31", stationSlots: [{ slotId: "slot-a", order: 1, label: "A", requiredEnvironmentIds: [], requiredTraceTags: [] }], timing: TIMING, requiredTraceTags: [], requiredSafetyCriticalTraceTags: [] };

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
type LiveState = { phase: string; actors: Record<string, { speaking: boolean }> };
async function say(server: EncounterServer, learner: SyncConnection, text: string) {
  const state = () => JSON.parse(server.getStateJSON()) as LiveState;
  await learner.sendIntent("select-actor", { actorId: patient.actorId });
  await learner.sendIntent("utterance-start", {});
  await learner.sendIntent("utterance-end", { text });
  await waitFor(() => state().actors[patient.actorId]?.speaking === true, 3000, "reply");
  await waitFor(() => state().actors[patient.actorId]?.speaking !== true, 8000, "reply end");
}

/** Record a live trace: opening, onset answer, unmatched fallback. Returns the trace dir. */
async function record(): Promise<string> {
  const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c31-"));
  const server = await boot({ examBlueprint: blueprint, scenarios: [CHEST], dialogueSeeds: scenarioDialogueSeedBank, traceDir });
  const learner = await connect(server.url, { roomOptions: { actors: [patient.actorId] } });
  leavers.push(() => learner.leave());
  await waitFor(() => (JSON.parse(server.getStateJSON()) as LiveState).phase === "encounter", 5000, "encounter");
  await say(server, learner, "hello there");
  await say(server, learner, onset.utterancePhrases![0]!);
  await say(server, learner, "what is the capital of france");
  await waitFor(() => readdirSync(traceDir).includes("exam-session.review-index.json"), 30000, "review index");
  await server.close();
  servers.splice(servers.indexOf(server), 1);
  return traceDir;
}

/** Replay a station and collect [turnId, replyId, caption] for each speaking actor turn seen in state. */
async function replayCaptions(url: string): Promise<Array<[number, string, string]>> {
  const conn = await connect(url, { roomOptions: { replayStationId: "slot-a" } });
  leavers.push(() => conn.leave());
  const seen = new Map<number, [number, string, string]>();
  let done = false;
  conn.onState((snap) => {
    const s = snap as { turnId: number; replayDone?: boolean; actors: Record<string, { speaking: boolean; replyId: string; caption?: string }> };
    for (const actor of Object.values(s.actors ?? {})) if (actor.speaking && !seen.has(s.turnId)) seen.set(s.turnId, [s.turnId, actor.replyId, actor.caption ?? ""]);
    if (s.replayDone === true) done = true;
  });
  await waitFor(() => done, 15000, "replayDone");
  return [...seen.values()].sort((a, b) => a[0] - b[0]);
}

describe("replay captions (C31)", () => {
  it("recomputes opening, authored answer and fallback captions by replyId; the trace holds none of the text", async () => {
    const traceDir = await record();
    const raw = readdirSync(traceDir).map((n) => readFileSync(join(traceDir, n), "utf8")).join("\n").toLowerCase();
    for (const text of [patient.openingUtterance ?? "", onset.caption ?? onset.spokenText ?? "", entry.utteranceFallback.line].filter((line) => line !== "")) expect(raw.includes(text.toLowerCase())).toBe(false);
    const replay = await boot({ replayDir: traceDir, replayStepMs: 20, scenarios: [CHEST, KNEE], dialogueSeeds: scenarioDialogueSeedBank });
    const turns = await replayCaptions(replay.url);
    expect(turns.map((t) => t[1])).toEqual([`${patient.actorId}:opening`, `${patient.actorId}:seed:patient_onset_history`, expect.stringMatching(/^c3-/)]);
    expect(turns.map((t) => t[2])).toEqual([
      `${patient.displayName}: ${patient.openingUtterance}`,
      `${patient.displayName}: ${onset.caption ?? onset.spokenText}`,
      `${patient.displayName}: ${entry.utteranceFallback.line}`,
    ]);
  }, 120000);

  it("without dialogueSeeds the replay stays silent (captions empty), as before", async () => {
    const traceDir = await record();
    const replay = await boot({ replayDir: traceDir, replayStepMs: 20, scenarios: [CHEST] });
    expect((await replayCaptions(replay.url)).map((t) => t[2])).toEqual(["", "", ""]);
  }, 120000);

  it("refuses the station when a recorded replyId resolves to nothing (forged seed id, foreign opening, unknown scenario)", async () => {
    const traceDir = await record();
    const name = readdirSync(traceDir).find((n) => n.endsWith(TRACE_SUFFIX))!;
    const file = join(traceDir, name);
    const original = readFileSync(file, "utf8");
    const forge = (from: string, to: string) => writeFileSync(file, original.split(from).join(to));
    for (const [from, to] of [[`${patient.actorId}:seed:patient_onset_history`, `${patient.actorId}:seed:forged`], [`${patient.actorId}:opening`, "stranger:opening"], [`${patient.actorId}:opening`, "scheduled:not-authored"]] as const) {
      forge(from, to);
      const bad = await boot({ replayDir: traceDir, replayStepMs: 20, scenarios: [CHEST], dialogueSeeds: scenarioDialogueSeedBank });
      await expect(connect(bad.url, { roomOptions: { replayStationId: "slot-a" } })).rejects.toThrow(/replay-unresolved-reply/);
    }
    writeFileSync(file, original);
    const missing = await boot({ replayDir: traceDir, replayStepMs: 20, scenarios: [KNEE], dialogueSeeds: scenarioDialogueSeedBank });
    await expect(connect(missing.url, { roomOptions: { replayStationId: "slot-a" } })).rejects.toThrow(/replay-unresolved-reply/);
  }, 120000);

  it("a replay server given dialogueSeeds without scenarios refuses boot", async () => {
    const traceDir = await record();
    await expect(bootServer({ replayDir: traceDir, dialogueSeeds: scenarioDialogueSeedBank })).rejects.toThrow(/dialogueSeeds/);
  }, 60000);
});
