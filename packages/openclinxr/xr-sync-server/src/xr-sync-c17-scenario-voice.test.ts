import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clinicKneePainScenario, edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C17 RED (planted by root, 2026-10-31): a cast actor speaks and feels from its scenario.
// Contract (names are the spec), on a C16 cast station (createEncounterServer({ examBlueprint, scenarios })):
//   An actor's FIRST reply in a station is its scenario opening line: actors[id].replyId === `${actorId}:opening`
//   and actors[id].caption === `${displayName}: ${openingUtterance}` (scenario-fixtures
//   learnerVisibleAuthoredCaption format). Later turns of that actor use the C3 table (replyId starts "c3-") and
//   caption "". Every actor state carries caption ("" off a cast station and before any authored reply).
//   Emotion transitions on a cast station follow that scenario's emotionPolicy (no policy: emotion never moves),
//   not the C4 probe policy. Off a cast station, C3/C4 behaviour is unchanged.
//   Review safety (C4 rule): after close, no trace file under traceDir contains the opening utterance text.
// Fixture note: knee copied with status "approved" (C16 precedent). Knee's policy has no learner_acknowledgement
// transition, so a knee actor stays at baseline "anxious" after a turn; the C4 probe policy would move it.

const TIMING = { doorwaySeconds: 1, encounterSeconds: 20, noteSeconds: 1, breakAfterStationOrders: [] };
const KNEE_APPROVED = { ...clinicKneePainScenario, status: "approved" as const };
const CHEST = edChestPainScenario;

function blueprint(): Record<string, unknown> {
  return {
    blueprintId: "bp-fixture-c17",
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

const boot = createEncounterServer as (o: Record<string, unknown>) => Promise<EncounterServer>;
async function start(options: Record<string, unknown>): Promise<EncounterServer> {
  const server = await boot(options);
  servers.push(server);
  return server;
}
async function joinLearner(server: EncounterServer, actors: string[] = ["a1", "a2"]): Promise<SyncConnection> {
  const connection = await connect(server.url, { roomOptions: { actors } });
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

type ActorState = { id: string; speaking: boolean; emotion: string; replyId: string; caption?: unknown };
type LiveState = { stationId: string; phase: string; actors: Record<string, ActorState> };
const state = (server: EncounterServer): LiveState => JSON.parse(server.getStateJSON()) as LiveState;

/** One learner turn addressed to actorId; resolves when the actor's reply has ended on the server clock. */
async function turn(server: EncounterServer, learner: SyncConnection, actorId: string): Promise<ActorState> {
  expect(await learner.sendIntent("select-actor", { actorId })).toMatchObject({ status: "ack" });
  await learner.sendIntent("utterance-start", {});
  await learner.sendIntent("utterance-end", {});
  await waitFor(() => state(server).actors[actorId]?.speaking === true, 5000, `${actorId} speaking`);
  const speaking = state(server).actors[actorId] as ActorState;
  await waitFor(() => state(server).actors[actorId]?.speaking === false, 10000, `${actorId} reply ends`);
  return speaking;
}
async function castStation(scenarios: unknown[], traceDir?: string) {
  const server = await start({ examBlueprint: blueprint(), scenarios, ...(traceDir ? { traceDir } : {}) });
  const learner = await joinLearner(server);
  await waitFor(() => state(server).phase === "encounter", 5000, "encounter");
  return { server, learner };
}
const actorOf = (scenario: typeof CHEST, index = 0) => {
  const actor = scenario.actors[index];
  if (!actor) throw new Error("fixture has no actor");
  return actor;
};

describe("xr-sync-server C17 scenario voice", () => {
  it("known-good: off a cast station the C3 table and C4 probe policy still drive the reply and emotion", async () => {
    const server = await start({});
    const learner = await joinLearner(server);
    const spoken = await turn(server, learner, "a1");
    expect(spoken.replyId).toBe("c3-ack-open");
    expect(state(server).actors["a1"]?.emotion).toBe("reassured");
  }, 30000);

  it("a cast actor's first reply is its scenario opening line, with a learner-visible caption", async () => {
    const { server, learner } = await castStation([CHEST, KNEE_APPROVED]);
    const actor = actorOf(CHEST);
    const spoken = await turn(server, learner, actor.actorId);
    expect([spoken.replyId, spoken.caption]).toEqual([
      `${actor.actorId}:opening`,
      `${actor.displayName}: ${actor.openingUtterance}`,
    ]);
  }, 30000);

  it("the actor's second reply falls back to the C3 table with an empty caption", async () => {
    const { server, learner } = await castStation([CHEST, KNEE_APPROVED]);
    const actor = actorOf(CHEST);
    await turn(server, learner, actor.actorId);
    const second = await turn(server, learner, actor.actorId);
    expect(second.replyId).toMatch(/^c3-/);
    expect(second.caption).toBe("");
  }, 40000);

  it("each cast actor opens with its own line", async () => {
    const { server, learner } = await castStation([CHEST, KNEE_APPROVED]);
    const other = actorOf(CHEST, 1);
    const spoken = await turn(server, learner, other.actorId);
    expect(spoken.replyId).toBe(`${other.actorId}:opening`);
  }, 30000);

  it("emotion follows the scenario policy: knee stays at its anxious baseline, chest (no policy) stays neutral", async () => {
    const knee = await castStation([KNEE_APPROVED, CHEST]);
    const kneeActor = actorOf(KNEE_APPROVED).actorId;
    await turn(knee.server, knee.learner, kneeActor);
    expect(state(knee.server).actors[kneeActor]?.emotion).toBe(KNEE_APPROVED.emotionPolicy?.baseline);

    const chest = await castStation([CHEST, KNEE_APPROVED]);
    const chestActor = actorOf(CHEST).actorId;
    await turn(chest.server, chest.learner, chestActor);
    expect(state(chest.server).actors[chestActor]?.emotion).toBe("neutral");
  }, 60000);

  it("review safety: no trace file carries the opening utterance text", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c17-"));
    const { server, learner } = await castStation([CHEST, KNEE_APPROVED], traceDir);
    const actor = actorOf(CHEST);
    const spoken = await turn(server, learner, actor.actorId);
    expect(spoken.replyId).toBe(`${actor.actorId}:opening`);
    await server.close(); // the conversation trace persists on room dispose
    expect(readdirSync(traceDir).length).toBeGreaterThan(0);
    for (const file of readdirSync(traceDir)) {
      expect(readFileSync(join(traceDir, file), "utf8")).not.toContain(actor.openingUtterance);
    }
  }, 30000);
});
