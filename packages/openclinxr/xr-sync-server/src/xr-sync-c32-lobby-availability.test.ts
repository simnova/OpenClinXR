import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { edChestPainScenario, scenarioDialogueSeedBank } from "@openclinxr/scenario-fixtures";
import { connect, type EncounterSnapshot, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C32 RED (lane manager, 2026-11-06): the review lobby lists each recorded station with its availability.
//   lobbyStations[i].available: boolean, lobbyStations[i].unavailableReason: string ("" when available).
//   A station whose recorded replyIds do not resolve (C31 replay-unresolved-reply) or whose trace failed C11 is
//   available=false with the reason; select-station on it rejects "station-unavailable" (never "unknown-station").
//   A station that resolves is available=true and select launches its replay as before.
// Part A: replayed captions are "" whenever an actor is not speaking (phase / interrupt / completion clear them);
//   a recorded scheduled interjection is a valid silent turn (replyId scheduled:*, caption "") and its station is available.
const TIMING = { doorwaySeconds: 1, encounterSeconds: 10, noteSeconds: 1, breakAfterStationOrders: [] };
const SCHEDULED_AT = 4;
const CHEST = { ...edChestPainScenario, status: "approved", eventSchedule: edChestPainScenario.eventSchedule.map((e) => ({ ...e, atSecond: SCHEDULED_AT })) };
const entry = scenarioDialogueSeedBank.find((e) => e.scenarioId === CHEST.scenarioId) as unknown as { seeds: Array<{ seedId: string; actorId: string }> };
const patientId = entry.seeds.find((s) => s.seedId === "patient_onset_history")!.actorId;
const blueprint = { blueprintId: "bp-c32", title: "C32", stationSlots: [{ slotId: "slot-a", order: 1, label: "A", requiredEnvironmentIds: [], requiredTraceTags: [] }], timing: TIMING, requiredTraceTags: [], requiredSafetyCriticalTraceTags: [] };

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

/** Record a live station (opening, one learner turn, the scheduled interjection) and add a forged second station. */
async function recordTwoStations(): Promise<string> {
  const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c32-"));
  const server = await boot({ examBlueprint: blueprint, scenarios: [CHEST], dialogueSeeds: scenarioDialogueSeedBank, traceDir });
  const learner = await connect(server.url, { roomOptions: { actors: [patientId] } });
  leavers.push(() => learner.leave());
  const state = () => JSON.parse(server.getStateJSON()) as { phase: string; actors: Record<string, { speaking: boolean }> };
  await waitFor(() => state().phase === "encounter", 5000, "encounter");
  await learner.sendIntent("select-actor", { actorId: patientId });
  await learner.sendIntent("utterance-start", {});
  await learner.sendIntent("utterance-end", { text: "hello there" });
  await waitFor(() => readdirSync(traceDir).includes("exam-session.review-index.json"), 40000, "review index");
  await server.close();
  servers.splice(servers.indexOf(server), 1);
  const indexPath = join(traceDir, "exam-session.review-index.json");
  const index = JSON.parse(readFileSync(indexPath, "utf8")) as { stationCount: number; stations: Array<Record<string, unknown>> };
  const first = index.stations[0]!;
  const traceFile = first["traceFile"] as string;
  const forged = readFileSync(join(traceDir, traceFile), "utf8").split(`${patientId}:opening`).join("stranger:opening").split(String(first["stationId"])).join("slot-b");
  writeFileSync(join(traceDir, "slot-b.conversation-trace.json"), forged);
  index.stations.push({ ...first, stationId: "slot-b", stationIndex: 1, traceFile: "slot-b.conversation-trace.json" });
  index.stationCount = 2;
  writeFileSync(indexPath, JSON.stringify(index));
  return traceDir;
}

type Row = { stationId: string; available?: boolean; unavailableReason?: string };
type Snap = EncounterSnapshot & { mode?: string; replayDone?: boolean; lobbyStations?: Row[] };
const bootReplay = (traceDir: string) => boot({ replayDir: traceDir, replayStepMs: 20, scenarios: [CHEST], dialogueSeeds: scenarioDialogueSeedBank });
async function lobby(url: string): Promise<{ conn: SyncConnection; latest: () => Snap }> {
  const conn = await connect(url, { roomOptions: { reviewLobby: true } });
  leavers.push(() => conn.leave());
  let latest: Snap = {} as Snap;
  conn.onState((snap) => { latest = snap as Snap; });
  await waitFor(() => latest.mode === "lobby" && (latest.lobbyStations?.length ?? 0) === 2, 5000, "lobby rows");
  return { conn, latest: () => latest };
}

describe("review lobby availability (C32)", () => {
  it("marks the unresolvable station unavailable with its reason, refuses its select, launches the resolvable one", async () => {
    const traceDir = await recordTwoStations();
    const server = await bootReplay(traceDir);
    const { conn, latest } = await lobby(server.url);
    const rows = latest().lobbyStations!;
    expect(rows.map((r) => [r.stationId, r.available, r.unavailableReason ?? null])).toEqual([
      ["slot-a", true, ""],
      ["slot-b", false, expect.stringMatching(/^replay-unresolved-reply: stranger:opening/)],
    ]);
    const refused = await conn.sendIntent("select-station", { stationId: "slot-b" });
    expect(refused).toMatchObject({ status: "reject", reason: "station-unavailable" });
    expect(latest().mode).toBe("lobby");
    const launched = await conn.sendIntent("select-station", { stationId: "slot-a" });
    expect(launched.status).toBe("ack");
    await waitFor(() => latest().mode === "replay" && latest().replayDone === true, 20000, "replay done");
    expect((latest() as { stationId?: string }).stationId).toBe("slot-a");
  }, 120000);

  it("replayed captions are empty whenever no actor is speaking; the scheduled interjection is a valid silent turn", async () => {
    const traceDir = await recordTwoStations();
    const server = await bootReplay(traceDir);
    const conn = await connect(server.url, { roomOptions: { replayStationId: "slot-a" } });
    leavers.push(() => conn.leave());
    const seen: Array<{ speaking: boolean; caption: string; replyId: string }> = [];
    let done = false;
    conn.onState((snap) => {
      const s = snap as Snap & { actors: Record<string, { speaking: boolean; caption?: string; replyId: string }> };
      for (const actor of Object.values(s.actors ?? {})) seen.push({ speaking: actor.speaking, caption: actor.caption ?? "", replyId: actor.replyId });
      if (s.replayDone === true) done = true;
    });
    await waitFor(() => done, 20000, "replayDone");
    expect(seen.filter((a) => !a.speaking && a.caption !== "")).toEqual([]);
    expect(seen.some((a) => a.speaking && a.caption !== "")).toBe(true);
    const scheduled = seen.filter((a) => a.speaking && a.replyId.startsWith("scheduled:"));
    expect(scheduled.length).toBeGreaterThan(0);
    expect(scheduled.every((a) => a.caption === "")).toBe(true);
  }, 120000);
});
