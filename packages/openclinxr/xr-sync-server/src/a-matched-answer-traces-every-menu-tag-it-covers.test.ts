import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { edChestPainScenario, scenarioDialogueSeedBank } from "@openclinxr/scenario-fixtures";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C39 (C37 F1): a matched free-text or speech turn traces EVERY tag of the matched answer that is on the menu
// (deduped, authored order). Counterweights: (a) a single-tag answer traces one tag, (b) an off-menu tag is never
// traced, (c) unmatched text traces none, (d) low-confidence speech traces none even when its text matches,
// (e) each tag appears once. The authored-answer cases run through a room with an injected seed (public entrypoint only).


const TIMING = { doorwaySeconds: 1, encounterSeconds: 20, noteSeconds: 1, breakAfterStationOrders: [] };
const CHEST = { ...edChestPainScenario, status: "approved" as const };
const NOTE_TAG = "patient_note_submitted";
const INDEX_FILE = "exam-session.review-index.json";
const PATIENT = "patient_robert_hayes_v1";
const SPOUSE = "spouse_anna_hayes_v1";
const NURSE = "nurse_maria_alvarez_v1";
const blueprint = {
  blueprintId: "bp-fixture-c39",
  title: "Fixture one-station form",
  stationSlots: [{ slotId: "slot-a", order: 1, label: "Fixture label A", requiredEnvironmentIds: [], requiredTraceTags: [] }],
  timing: TIMING,
  requiredTraceTags: [],
  requiredSafetyCriticalTraceTags: [],
};
const servers: EncounterServer[] = [];
const leavers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (leavers.length > 0) await leavers.pop()?.().catch(() => undefined);
  while (servers.length > 0) await servers.pop()?.close().catch(() => undefined);
});
async function waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
type Live = { phase: string; topicMenu: Array<{ tag: string; asked: boolean }> };
const live = (server: EncounterServer): Live => JSON.parse(server.getStateJSON()) as Live;
const askedTags = (server: EncounterServer): string[] => live(server).topicMenu.filter((entry) => entry.asked).map((entry) => entry.tag);
async function say(learner: SyncConnection, actorId: string, payload: Record<string, unknown>) {
  expect(await learner.sendIntent("select-actor", { actorId })).toMatchObject({ status: "ack" });
  const started = await learner.sendIntent("utterance-start", {});
  expect(started.status === "ack" || (started.status === "reject" && started.reason === "utterance-already-open")).toBe(true);
  return learner.sendIntent("utterance-end", payload);
}

describe("a matched answer traces every menu tag it covers (room)", () => {
  it("typed and speech matches on two-tag answers mark both tags; low-confidence, unmatched and single-tag turns do not over-mark", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c39-"));
    const server = await (createEncounterServer as (o: Record<string, unknown>) => Promise<EncounterServer>)({ examBlueprint: blueprint, scenarios: [CHEST], dialogueSeeds: scenarioDialogueSeedBank, traceDir });
    servers.push(server);
    const learner = await connect(server.url, { roomOptions: { actors: ["a1"] } });
    leavers.push(() => learner.leave());
    await waitFor(() => live(server).phase === "encounter", 10000, "encounter");
    const steps: Record<string, string[]> = {};
    const step = async (name: string, send: () => Promise<{ status: string }>) => {
      expect((await send()).status, name).toBe("ack");
      steps[name] = askedTags(server);
    };
    // (d) low-confidence speech whose text matches the spouse answer
    await step("low-confidence", () => say(learner, SPOUSE, { text: "how are you holding up", modality: "speech", confidence: 0.1 }));
    // (c) unmatched
    await step("unmatched", () => say(learner, PATIENT, { text: "zebra quartz nine" }));
    // (a) single-tag
    await step("single", () => say(learner, PATIENT, { text: "when did the pain start" }));
    await step("nurse-speech", () => say(learner, NURSE, { text: "i need an ecg now", modality: "speech", confidence: 0.9 }));
    await step("spouse-typed", () => say(learner, SPOUSE, { text: "how are you holding up" }));
    expect(steps["low-confidence"]).toEqual([]);
    expect(steps["unmatched"]).toEqual([]);
    expect(steps["single"]).toEqual(["history_opqrst"]);
    expect([...(steps["nurse-speech"] ?? [])].sort()).toEqual(["history_opqrst", "team_communication", "urgent_escalation"]);
    expect(steps["spouse-typed"]).toEqual(expect.arrayContaining(["family_communication", "empathy_statement"]));
    expect(steps["spouse-typed"]).toHaveLength(5);
    await waitFor(() => live(server).phase === "note", 40000, "note phase");
    const finalAsked = askedTags(server);
    await waitFor(() => readdirSync(traceDir).includes(INDEX_FILE), 40000, "review index");
    await server.close();
    const index = JSON.parse(readFileSync(join(traceDir, INDEX_FILE), "utf8")) as { stations: Array<{ stationId: string; observedTraceTags: string[] }> };
    const observed = (index.stations.find((entry) => entry.stationId === "slot-a")?.observedTraceTags ?? []).filter((tag) => tag !== NOTE_TAG);
    expect([...finalAsked].sort()).toEqual([...observed].sort());
    expect(new Set(observed).size).toBe(observed.length);
    expect(observed).toEqual(expect.arrayContaining(["team_communication", "urgent_escalation", "family_communication", "empathy_statement"]));
  }, 120000);
});

const PROBE_PHRASE = "c39 probe phrase";
const OFF_MENU = "c39_off_menu_tag";
describe("authored tag lists (room, injected seed)", () => {
  it("(b)(e) a repeated tag traces once and an off-menu tag is never traced; order is authored order", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c39-seed-"));
    const bank = scenarioDialogueSeedBank.map((entry) => entry.scenarioId !== CHEST.scenarioId ? entry : {
      ...entry,
      seeds: [...entry.seeds, {
        seedId: "c39_probe", actorId: NURSE, learnerUtterance: PROBE_PHRASE, visibleFacts: ["probe"], hiddenFactCanaries: [],
        expectedTraceTags: ["urgent_escalation", OFF_MENU, "team_communication", "urgent_escalation"],
        safetyExpectation: "responds_from_visible_facts", spokenText: "probe line", caption: "probe line", utterancePhrases: [PROBE_PHRASE],
      }],
    });
    const server = await (createEncounterServer as (o: Record<string, unknown>) => Promise<EncounterServer>)({ examBlueprint: blueprint, scenarios: [CHEST], dialogueSeeds: bank, traceDir });
    servers.push(server);
    const learner = await connect(server.url, { roomOptions: { actors: ["a1"] } });
    leavers.push(() => learner.leave());
    await waitFor(() => live(server).phase === "encounter", 10000, "encounter");
    expect((await say(learner, NURSE, { text: PROBE_PHRASE })).status).toBe("ack");
    expect([...askedTags(server)].sort()).toEqual(["team_communication", "urgent_escalation"]);
    expect(live(server).topicMenu.map((entry) => entry.tag)).not.toContain(OFF_MENU);
    await waitFor(() => readdirSync(traceDir).some((name) => name.endsWith(".conversation-trace.json")), 40000, "trace file");
    await server.close();
    const traceName = readdirSync(traceDir).find((name) => name.endsWith(".conversation-trace.json")) as string;
    const trace = JSON.parse(readFileSync(join(traceDir, traceName), "utf8")) as { events: Array<{ kind: string; tag?: string; coveredTags?: string[] }> };
    const ends = trace.events.filter((event) => event.kind === "utterance-end");
    expect(ends).toHaveLength(1);
    expect(ends[0]?.tag).toBe("urgent_escalation");
    expect(ends[0]?.coveredTags).toEqual(["urgent_escalation", "team_communication"]);
  }, 120000);
});
