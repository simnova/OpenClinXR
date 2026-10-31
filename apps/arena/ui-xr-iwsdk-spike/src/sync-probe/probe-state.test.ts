/**
 * C2 counterweight: proves the page cannot move server state except through
 * validated intents, and that rendered colour follows server state only.
 *
 * - A page-side attempt to send a "state" message changes nothing (no ack/reject).
 * - Mutating the page's local snapshot copy does not change server state.
 * - resolveActorColour is a pure function of the server speaking flag.
 */
import { Client } from "@colyseus/sdk";
import { connect, type EncounterSnapshot, type SyncConnection } from "@openclinxr/xr-sync-client/headset";
import {
  createEncounterServer,
  type EncounterServer,
} from "@openclinxr/xr-sync-server";
import { afterEach, describe, expect, it } from "vitest";
import {
  ACTOR_TURN_COLOUR,
  BASE_ACTOR_COLOUR,
  BASE_TURN_COLOUR,
  CUE_ENVELOPES,
  DEFAULT_CUE_ENVELOPE,
  EMOTION_TINTS,
  LEARNER_TURN_COLOUR,
  PHASE_COLOURS,
  PROBE_ACTOR_IDS,
  SPEAKING_ACTOR_COLOUR,
  quantizePoseComponent,
  resolveActorColour,
  resolveActorTint,
  resolveCueEnvelope,
  resolveMouthAmplitude,
  resolvePhaseColour,
  resolvePhaseLabel,
  resolveStationLabel,
  resolveTurnIndicatorColour,
  summarizeMs,
  sweepYawDegrees,
  yawQuaternionDegrees,
} from "./probe-state.js";
import { parseProbeQuery } from "./probe-query.js";

const servers: EncounterServer[] = [];
const leavers: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  while (leavers.length > 0) {
    const leave = leavers.pop();
    try {
      await leave?.();
    } catch {
      // Best-effort teardown.
    }
  }
  while (servers.length > 0) {
    const server = servers.pop();
    try {
      await server?.close();
    } catch {
      // Best-effort teardown.
    }
  }
});

async function waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (condition()) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("sync-probe pure probe logic", () => {
  it("colour follows the server speaking flag only", () => {
    expect(resolveActorColour(true)).toBe(SPEAKING_ACTOR_COLOUR);
    expect(resolveActorColour(false)).toBe(BASE_ACTOR_COLOUR);
    expect(BASE_ACTOR_COLOUR).not.toBe(SPEAKING_ACTOR_COLOUR);
    expect(PROBE_ACTOR_IDS).toEqual(["a1", "a2"]);
  });

  it("sweep yaw hits the fixed keyframes", () => {
    expect(sweepYawDegrees(-100)).toBe(0);
    expect(sweepYawDegrees(0)).toBe(0);
    expect(sweepYawDegrees(2000)).toBe(30);
    expect(sweepYawDegrees(4000)).toBe(-30);
    expect(sweepYawDegrees(6000)).toBe(0);
    expect(sweepYawDegrees(99999)).toBe(0);
  });

  it("yaw quaternion is a unit yaw rotation", () => {
    const quat = yawQuaternionDegrees(90);
    expect(quat.x).toBe(0);
    expect(quat.z).toBe(0);
    expect(quat.y).toBeCloseTo(Math.SQRT1_2, 10);
    expect(quat.w).toBeCloseTo(Math.SQRT1_2, 10);
  });

  it("pose quantization is float32-stable", () => {
    for (const value of [0, 0.1, -2.5, 100.5, 1.23456789]) {
      expect(quantizePoseComponent(value)).toBe(Math.fround(value));
    }
  });

  it("query parsing accepts loopback ws and the probe flags", () => {
    const query = parseProbeQuery("?sync=ws://127.0.0.1:4567&iwer=1&autostart=1");
    expect(query).toEqual({ syncUrl: "ws://127.0.0.1:4567", useIwer: true, autostart: true, forceIwer: false, script: "c2", replayStationId: "" });
    expect(parseProbeQuery("?sync=ws://127.0.0.1:4567&script=c3").script).toBe("c3");
    expect(parseProbeQuery("?sync=ws://127.0.0.1:4567&script=c10&replayStationId=station-2")).toMatchObject({ script: "c10", replayStationId: "station-2" });
    expect(() => parseProbeQuery("?sync=ws://127.0.0.1:4567&script=c10")).toThrow();
    expect(() => parseProbeQuery("?iwer=1")).toThrow();
    expect(() => parseProbeQuery("?sync=https://example.com/x")).toThrow();
    expect(() => parseProbeQuery("?sync=ws://127.0.0.1:4567&script=c9")).toThrow();
  });

  it("summaries report exact bucketed percentiles", () => {
    const summary = summarizeMs([3, 1, 2]);
    expect(summary).toEqual({ n: 3, p50: 2, p95: 3, max: 3 });
    expect(summarizeMs([])).toEqual({ n: 0, p50: 0, p95: 0, max: 0 });
  });
});

describe("sync-probe server authority", () => {
  it("a page-side state message changes nothing and earns no reply", async () => {
    const server = await createEncounterServer();
    servers.push(server);
    const raw = new Client(server.url);
    const room = await raw.joinOrCreate("encounter", { actors: ["a1", "a2"] });
    leavers.push(() => room.leave());

    const acks: unknown[] = [];
    const rejects: unknown[] = [];
    room.onMessage("ack", (message) => acks.push(message));
    room.onMessage("reject", (message) => rejects.push(message));

    await waitFor(() => JSON.parse(server.getStateJSON()).actors.a1 !== undefined, 5000, "a1 present");
    const before = server.getStateJSON();
    room.send("state", { actors: { a1: { speaking: true, emotion: "angry" } } });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(server.getStateJSON()).toBe(before);
    expect(acks).toEqual([]);
    expect(rejects).toEqual([]);
    expect(JSON.parse(server.getStateJSON()).actors.a1.speaking).toBe(false);
  }, 30000);

  it("mutating the page's local snapshot copy leaves server state untouched", async () => {
    const server = await createEncounterServer();
    servers.push(server);
    const connection: SyncConnection = await connect(server.url, { roomOptions: { actors: ["a1"] } });
    leavers.push(() => connection.leave());

    let latest: EncounterSnapshot | undefined;
    connection.onState((snapshot) => {
      latest = snapshot;
    });
    await waitFor(() => latest?.actors?.a1 !== undefined, 5000, "a1 snapshot");
    const before = server.getStateJSON();

    // Page-side mutation of the local copy (the strongest thing the page can do
    // outside intents): flip the snapshot and re-derive colour from it.
    const local = latest as EncounterSnapshot;
    local.actors.a1 = { id: "a1", speaking: true, emotion: "hijacked", replyId: "hijacked", cueId: "hijacked" };
    expect(resolveActorColour(local.actors.a1?.speaking === true)).toBe(SPEAKING_ACTOR_COLOUR);
    expect(server.getStateJSON()).toBe(before);
    expect(JSON.parse(server.getStateJSON()).actors.a1.speaking).toBe(false);
  }, 30000);

  it("page-local turn-field mutation leaves server state untouched; the turn indicator is pure server state", async () => {    const server = await createEncounterServer();
    servers.push(server);
    const connection: SyncConnection = await connect(server.url, { roomOptions: { actors: ["a1"] } });
    leavers.push(() => connection.leave());

    let latest: EncounterSnapshot | undefined;
    connection.onState((snapshot) => {
      latest = snapshot;
    });
    await waitFor(() => latest?.actors?.a1 !== undefined, 5000, "a1 snapshot");
    const before = server.getStateJSON();

    // Page-side mutation of the local turn fields: forge a turn the server never opened.
    const local = latest as EncounterSnapshot;
    local.turnId = 99;
    local.turnOwner = "actor";
    local.actors.a1 = { id: "a1", speaking: true, emotion: "hijacked", replyId: "page-forged", cueId: "page-forged" };
    const learnerEntry = local.learners[connection.sessionId];
    if (learnerEntry) {
      learnerEntry.speaking = true;
    }
    // The indicator resolver still derives from whatever server state it is given,
    // but the forgery never reaches the server: state is byte-identical.
    expect(resolveTurnIndicatorColour(local.turnOwner, local.actors.a1?.speaking === true)).toBe(
      ACTOR_TURN_COLOUR,
    );
    expect(server.getStateJSON()).toBe(before);
    expect(JSON.parse(server.getStateJSON()).turnId).toBe(0);
    expect(JSON.parse(server.getStateJSON()).turnOwner).toBe("none");
    expect(JSON.parse(server.getStateJSON()).actors.a1.replyId).not.toBe("page-forged");

    // Purity: the resolver is a pure function of server turn state.
    expect(resolveTurnIndicatorColour("actor", true)).toBe(ACTOR_TURN_COLOUR);
    expect(resolveTurnIndicatorColour("actor", false)).toBe(BASE_TURN_COLOUR);
    expect(resolveTurnIndicatorColour("learner", false)).toBe(LEARNER_TURN_COLOUR);
    expect(resolveTurnIndicatorColour("learner", true)).toBe(LEARNER_TURN_COLOUR);
    expect(resolveTurnIndicatorColour("none", false)).toBe(BASE_TURN_COLOUR);
    expect(resolveTurnIndicatorColour("none", true)).toBe(BASE_TURN_COLOUR);
    expect(BASE_TURN_COLOUR).not.toBe(LEARNER_TURN_COLOUR);
    expect(LEARNER_TURN_COLOUR).not.toBe(ACTOR_TURN_COLOUR);
  }, 30000);
});

describe("sync-probe C4 emotion tint and cue mouth amplitude", () => {
  it("tint is a pure function of the server emotion", () => {
    expect(resolveActorTint("neutral")).toBe(EMOTION_TINTS.neutral);
    expect(resolveActorTint("reassured")).toBe(EMOTION_TINTS.reassured);
    expect(resolveActorTint("concerned")).toBe(EMOTION_TINTS.concerned);
    expect(resolveActorTint("anxious")).toBe(EMOTION_TINTS.anxious);
    // Unknown server values fall back to neutral; the resolver reads no page state.
    expect(resolveActorTint("page-forged")).toBe(EMOTION_TINTS.neutral);
    expect(new Set(Object.values(EMOTION_TINTS)).size).toBe(4);
  });

  it("mouth amplitude is 0 whenever the server says silent, whatever cueId the page holds", () => {
    const cueIds = [...Object.keys(CUE_ENVELOPES), "page-forged", ""];
    for (const cueId of cueIds) {
      for (const tMs of [0, 123, 1000, 4321]) {
        expect(resolveMouthAmplitude(cueId, false, tMs)).toBe(0);
      }
    }
  });

  it("mouth amplitude is strictly positive while the server says speaking", () => {
    const cueIds = [...Object.keys(CUE_ENVELOPES), "unknown-future-cue", ""];
    for (const cueId of cueIds) {
      for (const tMs of [0, 123, 1000, 4321, 99999]) {
        const amplitude = resolveMouthAmplitude(cueId, true, tMs);
        expect(amplitude).toBeGreaterThan(0);
        expect(amplitude).toBeLessThanOrEqual((resolveCueEnvelope(cueId).peak));
      }
    }
    expect(resolveCueEnvelope("unknown-future-cue")).toBe(DEFAULT_CUE_ENVELOPE);
  });
});

describe("sync-probe C6 station phase label and ring", () => {
  it("phase label is a pure function of server phase + remaining seconds", () => {
    expect(resolvePhaseLabel("doorway", 3)).toBe("doorway 3s");
    expect(resolvePhaseLabel("encounter", 20)).toBe("encounter 20s");
    expect(resolvePhaseLabel("encounter", 0)).toBe("encounter 0s");
    expect(resolvePhaseLabel("note", 1)).toBe("note 1s");
    expect(resolvePhaseLabel("closed", 0)).toBe("closed 0s");
    // Non-numeric remaining (old server / brief mode) renders the phase alone.
    expect(resolvePhaseLabel("brief", undefined)).toBe("brief");
    expect(resolvePhaseLabel("encounter", Number.NaN)).toBe("encounter");
    // Fractional seconds floor; negatives clamp to 0.
    expect(resolvePhaseLabel("doorway", 2.9)).toBe("doorway 2s");
    // A page-local clock value never enters: same inputs always give the same label.
    expect(resolvePhaseLabel("note", 2)).toBe(resolvePhaseLabel("note", 2));
    expect(resolvePhaseLabel("note", 2)).not.toBe(resolvePhaseLabel("note", 1));
  });

  it("phase ring colour is a pure function of the server phase", () => {
    expect(resolvePhaseColour("doorway")).toBe(PHASE_COLOURS.doorway);
    expect(resolvePhaseColour("encounter")).toBe(PHASE_COLOURS.encounter);
    expect(resolvePhaseColour("note")).toBe(PHASE_COLOURS.note);
    expect(resolvePhaseColour("closed")).toBe(PHASE_COLOURS.closed);
    expect(resolvePhaseColour("brief")).toBe(PHASE_COLOURS.brief);
    expect(new Set(Object.values(PHASE_COLOURS)).size).toBe(5);
    // Unknown server values fall back; the resolver reads no page state.
    expect(resolvePhaseColour("page-forged")).toBe(BASE_TURN_COLOUR);
  });
});

describe("sync-probe C7 station label", () => {
  it("station label is a pure function of server stationId/stationIndex/stationCount", () => {
    expect(resolveStationLabel("station-1", 0, 2)).toBe("station-1 1/2");
    expect(resolveStationLabel("station-2", 1, 2)).toBe("station-2 2/2");
    // Empty stationId (C6 / no stations) renders single-station.
    expect(resolveStationLabel("", 0, 0)).toBe("single-station");
    expect(resolveStationLabel(undefined, null, null)).toBe("single-station");
    // Missing counts render the id alone; a page-local value never enters.
    expect(resolveStationLabel("station-1", null, null)).toBe("station-1");
    expect(resolveStationLabel("station-1", 0, 2)).toBe(resolveStationLabel("station-1", 0, 2));
    expect(resolveStationLabel("station-1", 0, 2)).not.toBe(resolveStationLabel("station-2", 1, 2));
  });
});
