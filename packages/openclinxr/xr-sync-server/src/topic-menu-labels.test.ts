import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "@openclinxr/xr-sync-client";
import { edChestPainScenario, scenarioDialogueSeedBank } from "@openclinxr/scenario-fixtures";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C37 labels (clauses 1, 3). Room state topicMenu is a list of entries {tag, label, labelSource, note, asked}:
//   same tags and order as C22 (requiredTraceTags deduped, minus patient_note_submitted); [] off a cast station.
//   label: when a seed answer of a cast actor carries the tag in expectedTraceTags AND at least one utterancePhrase,
//     the first such answer in authored order (shipped seed bank) supplies label = its utterancePhrases[0], byte for byte,
//     labelSource "seed-phrase". Otherwise label = the tag text and labelSource "tag".
//   labelSource is "seed-phrase" | "tag" | "other"; "other" requires a non-empty note, the others carry note "".
//   Counterweight A: every "tag" entry is listed in pre-fix.json (evidence/c37), which records the same split computed
//   from the shipped bank before this change; at least one shipped label differs from tag.replaceAll("_", " ").
// pre-fix.json is gitignored (lane convention); this test reads it from the checkout root.

const TIMING = { doorwaySeconds: 1, encounterSeconds: 5, noteSeconds: 1, breakAfterStationOrders: [] };
const CHEST = { ...edChestPainScenario, status: "approved" as const, eventSchedule: edChestPainScenario.eventSchedule.map((entry) => ({ ...entry, atSecond: TIMING.encounterSeconds })) };
const NOTE_TAG = "patient_note_submitted";
const PRE_FIX = join(dirname(fileURLToPath(import.meta.url)), "../../../../.openclinxr/slices/xr-sync-colyseus/evidence/c37/pre-fix.json");

const blueprint = {
  blueprintId: "bp-fixture-c37-labels",
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
type Entry = { tag: string; label: string; labelSource: string; note: string; asked: boolean };
const menuOf = (server: EncounterServer): Entry[] => (JSON.parse(server.getStateJSON()) as { topicMenu: Entry[] }).topicMenu;
async function castMenu(): Promise<Entry[]> {
  const server = await boot({ examBlueprint: blueprint, scenarios: [CHEST], dialogueSeeds: scenarioDialogueSeedBank });
  const learner = await connect(server.url, { roomOptions: { actors: ["a1"] } });
  leavers.push(() => learner.leave());
  await waitFor(() => menuOf(server).length > 0, 5000, "topic menu");
  return menuOf(server);
}

/** The first seed phrase for a tag, read straight off the shipped bank (independent of server code). */
function shippedPhrase(tag: string): string | undefined {
  const bank = scenarioDialogueSeedBank.find((entry) => entry.scenarioId === CHEST.scenarioId);
  const cast = new Set(CHEST.actors.map((actor) => actor.actorId));
  const seed = (bank?.seeds ?? []).find((candidate) =>
    candidate.safetyExpectation === "responds_from_visible_facts" &&
    cast.has(candidate.actorId) &&
    (candidate.caption !== undefined || candidate.spokenText !== undefined) &&
    candidate.expectedTraceTags.includes(tag) &&
    (candidate.utterancePhrases ?? []).length > 0);
  return seed?.utterancePhrases?.[0];
}
const expectedTags = [...new Set(CHEST.requiredTraceTags)].filter((tag) => tag !== NOTE_TAG);

describe("xr-sync-server C37 topic menu labels", () => {
  it("a cast station lists the C22 tags in order and starts with nothing asked", async () => {
    const menu = await castMenu();
    expect(menu.map((entry) => entry.tag)).toEqual(expectedTags);
    expect(menu.every((entry) => entry.asked === false)).toBe(true);
  }, 20000);

  it("an entry with a shipped seed phrase carries it byte for byte; every other entry carries the tag text", async () => {
    const menu = await castMenu();
    for (const entry of menu) {
      const phrase = shippedPhrase(entry.tag);
      if (phrase === undefined) {
        expect(entry, entry.tag).toMatchObject({ label: entry.tag, labelSource: "tag", note: "" });
      } else {
        expect(entry, entry.tag).toMatchObject({ label: phrase, labelSource: "seed-phrase", note: "" });
      }
    }
    // Anchor: the shipped bank gives phrases to some tags and not to others, so both branches ran.
    expect(menu.filter((entry) => entry.labelSource === "seed-phrase").length).toBeGreaterThan(0);
    expect(menu.filter((entry) => entry.labelSource === "tag").length).toBeGreaterThan(0);
  }, 20000);

  it("counterweight A: tag-labelled entries are exactly those pre-fix.json lists, and a shipped label differs from the prettified tag", async () => {
    expect(existsSync(PRE_FIX), `missing ${PRE_FIX}`).toBe(true);
    const preFix = JSON.parse(readFileSync(PRE_FIX, "utf8")) as { tagOnly: string[]; withPhrase: number };
    const menu = await castMenu();
    const tagged = menu.filter((entry) => entry.labelSource === "tag").map((entry) => entry.tag);
    expect(tagged).toEqual(menu.map((entry) => entry.tag).filter((tag) => preFix.tagOnly.includes(tag)));
    expect(new Set(tagged)).toEqual(new Set(preFix.tagOnly));
    expect(menu.filter((entry) => entry.labelSource === "seed-phrase").length).toBe(preFix.withPhrase);
    expect(menu.some((entry) => entry.label !== entry.tag.replaceAll("_", " "))).toBe(true);
  }, 20000);

  it("labelSource is one of the enum values and `other` carries a note", async () => {
    const menu = await castMenu();
    for (const entry of menu) {
      expect(["seed-phrase", "tag", "other"]).toContain(entry.labelSource);
      if (entry.labelSource === "other") expect(entry.note).not.toBe("");
    }
  }, 20000);

  it("known-good: off a cast station the menu is empty", async () => {
    const server = await boot({ timing: { doorwaySeconds: 1, encounterSeconds: 4, noteSeconds: 1 } });
    const learner = await connect(server.url, { roomOptions: { actors: ["a1"] } });
    leavers.push(() => learner.leave());
    await waitFor(() => (JSON.parse(server.getStateJSON()) as { actors: object }).actors !== undefined && Object.keys((JSON.parse(server.getStateJSON()) as { actors: object }).actors).length > 0, 5000, "roster");
    expect(menuOf(server)).toEqual([]);
  }, 20000);
});
