import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startEncounterSyncFromUrl } from "@openclinxr/xr-sync-client/headset";
import { describe, expect, it } from "vitest";
import { writeSyncedDoorwayEyebrow } from "./synced-shell-writers.js";

// Eyebrow RED: in a synced room the eyebrow above the station title follows the
// server phase (Doorway, Encounter, Note, ...) instead of the fixed text
// "Doorway". main.ts cannot be imported (it boots the page): its wiring is
// pinned by source (the import specifier only) and the live write rule by the
// imported writer driven through the real sync client.
const SRC = fileURLToPath(new URL(".", import.meta.url));
const MAIN = readFileSync(`${SRC}main.ts`, "utf8");
const SYNC = "?encounterSync=ws://127.0.0.1:9";
const flush = async (): Promise<void> => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };

interface EyebrowStandIn {
  el: { textContent: string | null };
  history: string[];
  writes: () => number;
}

function makeEyebrow(): EyebrowStandIn {
  let value: string | null = "Doorway";
  let count = 0;
  const history: string[] = [];
  return {
    el: {
      get textContent(): string | null { return value; },
      set textContent(next: string | null) { count += 1; value = next; },
    },
    history,
    writes: () => count,
  };
}

const at = (phase: string, phaseRemainingS: number): Record<string, unknown> => ({ phase, phaseRemainingS });

/** Drive the real client with snapshots; each onPhase calls the imported writer. */
async function drive(search: string, snapshots: Array<Record<string, unknown>>, eyebrow: EyebrowStandIn): Promise<Array<[string, number]>> {
  const seen: Array<[string, number]> = [];
  let listener: ((s: unknown) => void) | undefined;
  await startEncounterSyncFromUrl({
    search,
    actorIds: () => [],
    register: () => undefined,
    play: () => undefined,
    publish: () => undefined,
    nowMs: () => 1,
    onStation: () => undefined,
    onPhase: (phase: string, remaining: number) => {
      seen.push([phase, remaining]);
      writeSyncedDoorwayEyebrow(eyebrow.el, phase);
      eyebrow.history.push(eyebrow.el.textContent ?? "");
    },
    connectFn: async () => ({ sessionId: "s", sendIntent: async () => ({ status: "ack" }), onState: (fn: (s: unknown) => void) => { listener = fn; return () => undefined; }, leave: async () => undefined }) as never,
  } as never);
  for (const snapshot of snapshots) { listener?.({ serverTick: 1, turnId: 0, turnOwner: "none", actors: {}, learners: {}, ...snapshot }); await flush(); }
  return seen;
}

describe("the synced doorway eyebrow follows the room phase", () => {
  it("doorway, encounter, note snapshots read Doorway, Encounter, Note in that order", async () => {
    const eyebrow = makeEyebrow();
    const seen = await drive(SYNC, [at("doorway", 12), at("encounter", 300), at("note", 90)], eyebrow);
    expect(seen).toEqual([["doorway", 12], ["encounter", 300], ["note", 90]]);
    expect(eyebrow.history).toEqual(["Doorway", "Encounter", "Note"]);
  });

  it("with no sync query the writer is never called and the eyebrow keeps Doorway", async () => {
    const eyebrow = makeEyebrow();
    const seen = await drive("?station=ed_chest_pain_priority_v1", [at("doorway", 12), at("encounter", 300)], eyebrow);
    expect(seen).toEqual([]);
    expect(eyebrow.writes()).toBe(0);
    expect(eyebrow.el.textContent).toBe("Doorway");
  });

  it("an unknown or missing phase keeps the last value and never writes an empty string", async () => {
    const eyebrow = makeEyebrow();
    await drive(SYNC, [at("encounter", 300)], eyebrow);
    expect(eyebrow.el.textContent).toBe("Encounter");
    writeSyncedDoorwayEyebrow(eyebrow.el, "");
    expect(eyebrow.el.textContent).toBe("Encounter");
    writeSyncedDoorwayEyebrow(eyebrow.el, undefined);
    expect(eyebrow.el.textContent).toBe("Encounter");
    expect(writeSyncedDoorwayEyebrow(eyebrow.el, "")).toBe("");
    expect(writeSyncedDoorwayEyebrow(eyebrow.el, undefined)).toBe("");
    expect(eyebrow.el.textContent).toBe("Encounter");
    expect(eyebrow.history.every((text) => text.length > 0)).toBe(true);
    expect(eyebrow.el.textContent).not.toBe("");
  });

  it("main.ts imports the writer from ./synced-doorway-eyebrow", () => {
    expect(MAIN).toMatch(/import \{ writeSyncedDoorwayEyebrow \} from "\.\/synced-shell-writers\.js";/u);
  });
});
