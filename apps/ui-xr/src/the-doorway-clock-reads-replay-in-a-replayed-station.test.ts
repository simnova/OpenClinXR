import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startEncounterSyncFromUrl } from "@openclinxr/xr-sync-client/headset";
import { describe, expect, it } from "vitest";

// C48 RED: in a replayed station the doorway card clock (#station-clock) reads the static "Replay" and keeps it across ticks.
// The replay signal comes from xr-sync-client's own detection (onReplay); apps/ui-xr holds no second encounterReplayStation parse.
// main.ts cannot be imported (it boots the page), so its clock wiring is pinned by source, and its live DOM by evidence/c48 stills.
const SRC = fileURLToPath(new URL(".", import.meta.url));
const flush = async (): Promise<void> => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };

async function signals(search: string): Promise<number> {
  let count = 0;
  await startEncounterSyncFromUrl({
    search,
    actorIds: () => [],
    register: () => undefined,
    play: () => undefined,
    publish: () => undefined,
    nowMs: () => 1,
    onReplay: () => { count += 1; },
    connectFn: async () => ({ sessionId: "s", sendIntent: async () => ({ status: "ack" }), onState: () => () => undefined, leave: async () => undefined }) as never,
  } as never);
  await flush();
  return count;
}

describe("the doorway clock reads Replay in a replayed station (C48)", () => {
  it("the client signals a replayed station exactly once", async () => {
    expect(await signals("?encounterSync=ws://127.0.0.1:9&encounterReplayStation=slot-a")).toBe(1);
  });

  it("the client signals nothing for a live room", async () => {
    expect(await signals("?encounterSync=ws://127.0.0.1:9")).toBe(0);
  });

  it("main.ts pins the clock to Replay on that signal and stops its tick writer; live ticks still count", () => {
    const main = readFileSync(SRC + "main.ts", "utf8");
    expect(main).toContain('onReplay: () => { replayClock = true; clock.textContent = "Replay"; }');
    expect(main).toContain("if (!replayClock && !breakClock && !syncedServerPhase) clock.textContent = formatStationClock(state.elapsedSecond);");
    expect(main.match(/\bclock\.textContent =/g)?.length).toBe(4);
  });

  it("apps/ui-xr parses no replay URL itself", () => {
    const sources = readdirSync(SRC).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
    expect(sources.filter((name) => readFileSync(SRC + name, "utf8").includes("encounterReplayStation"))).toEqual([]);
  });
});
