import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startEncounterSyncFromUrl } from "@openclinxr/xr-sync-client/headset";
import { describe, expect, it } from "vitest";

// C51 RED A (tsk_4953dd5dc871184b). C50 writes the server's "Station N of M" into #exam-flow-station, whose top is 1399 px at
// 800x600 (evidence/c50/after2/report.json labelTop), so the learner must scroll to learn which station they are in. While
// synced, the doorway header (main.ts `<p class="label">Doorway</p>` block) must show the same text in its own #doorway-station.
//
// PROOF SPLIT: this file asserts STRINGS only. Whether the element is on the first 800x600 screen comes only from the
// c51-capture.mjs report (rects, visibility, font-size). A green file here is not evidence the label is on screen.
// main.ts boots the page and cannot be imported, so its wiring is pinned by source, as in the C50 RED B.
//
// Planted clauses are `it.fails`; flip each to `it(` when its behaviour lands (`live:` requires 0 remaining).
// The plain `it(` blocks are counterweights and pass today: the non-synced, replay and lobby header must not change.
const SRC = fileURLToPath(new URL(".", import.meta.url));
const MAIN = readFileSync(SRC + "main.ts", "utf8");
const flush = async (): Promise<void> => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };

type StandIn = { textContent: string; hidden: boolean };

async function headerAfter(search: string, positions: Array<[number, number]>): Promise<{ doorway: StandIn; flow: StandIn }> {
  // The shell's onStation body, verbatim from main.ts, run against stand-in elements. The doorway stand-in starts as the
  // non-synced markup must leave it: empty and hidden.
  const doorway: StandIn = { textContent: "", hidden: true };
  const flow: StandIn = { textContent: "pending", hidden: false };
  const match = /onStation: \(index, count\) => \{ (.*?) \},?\s*$/mu.exec(MAIN);
  const body = new Function("examFlowStation", "doorwayStation", "index", "count", "let syncedStation = false;" + (match?.[1] ?? ""));
  let listener: ((s: unknown) => void) | undefined;
  await startEncounterSyncFromUrl({
    search,
    actorIds: () => [],
    register: () => undefined,
    play: () => undefined,
    publish: () => undefined,
    nowMs: () => 1,
    onStation: (index: number, count: number) => { body(flow, doorway, index, count); },
    connectFn: async () => ({ sessionId: "s", sendIntent: async () => ({ status: "ack" }), onState: (fn: (s: unknown) => void) => { listener = fn; return () => undefined; }, leave: async () => undefined }) as never,
  } as never);
  for (const [stationIndex, stationCount] of positions) { listener?.({ serverTick: 1, phase: "encounter", turnId: 0, turnOwner: "none", actors: {}, learners: {}, stationIndex, stationCount }); await flush(); }
  return { doorway, flow };
}

const SYNCED = "?encounterSync=ws://127.0.0.1:9";
const HEADER_BLOCK = [
  "<header>",
  "        <p class=\"label\">Doorway</p>",
  "        <h1>${selectedStationContext.title}</h1>",
  "        <p class=\"subtle\">${selectedStationContext.subtitle}</p>",
].join("\n");

describe("the synced station position is in the doorway header (C51)", () => {
  it.fails("main.ts declares #doorway-station inside the doorway <header> (after the subtitle line, so the block below stays contiguous)", () => {
    const header = /<header>\n\s*<p class="label">Doorway<\/p>[\s\S]*?<\/header>/u.exec(MAIN)?.[0] ?? "";
    expect(header).toMatch(/id="doorway-station"/u);
  });

  it.fails("main.ts binds a doorwayStation element to #doorway-station", () => {
    expect(MAIN).toMatch(/const doorwayStation = requireElement<HTMLElement>\("#doorway-station"\);/u);
  });

  it.fails("synced station 1 then station 2 of 3: the doorway header reads exactly 'Station 1 of 3' then 'Station 2 of 3' and is shown", async () => {
    const first = await headerAfter(SYNCED, [[0, 3]]);
    expect(first.doorway).toEqual({ textContent: "Station 1 of 3", hidden: false });
    const second = await headerAfter(SYNCED, [[0, 3], [1, 3]]);
    expect(second.doorway).toEqual({ textContent: "Station 2 of 3", hidden: false });
  });

  it("C50 is unchanged: the same onStation writes 'Station N of M' into #exam-flow-station", async () => {
    expect((await headerAfter(SYNCED, [[0, 3], [2, 3]])).flow.textContent).toBe("Station 3 of 3");
  });

  it("replay and lobby rooms get no onStation, so the doorway header stays empty and hidden", async () => {
    const replay = await headerAfter(`${SYNCED}&encounterReplayStation=slot-a`, [[0, 3]]);
    expect(replay.doorway).toEqual({ textContent: "", hidden: true });
    const lobby = await headerAfter(`${SYNCED}&encounterReviewLobby=1`, [[0, 3]]);
    expect(lobby.doorway).toEqual({ textContent: "", hidden: true });
  });

  it("the non-synced doorway header keeps its eyebrow, h1 and subtitle lines byte-identical to base", () => {
    expect(MAIN).toContain(HEADER_BLOCK);
  });

  it("any #doorway-station markup ships empty and hidden, so the non-synced header shows nothing new", () => {
    const tags = MAIN.match(/<[a-z]+ [^>]*id="doorway-station"[^>]*>[^<]*<\/[a-z]+>/gu) ?? [];
    for (const tag of tags) {
      expect(tag).toMatch(/\shidden[\s>]/u);
      expect(tag).toMatch(/>\s*<\//u);
    }
  });

  it("the replay doorway clock still reads 'Replay' (C48)", () => {
    expect(MAIN).toContain("onReplay: () => { replayClock = true; clock.textContent = \"Replay\"; },");
  });
});
