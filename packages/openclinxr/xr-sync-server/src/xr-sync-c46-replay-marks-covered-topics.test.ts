import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { edChestPainScenario, scenarioDialogueSeedBank } from "@openclinxr/scenario-fixtures";
import { connect } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C46 RED (lane manager, 2026-11-08): a replayed station marks every topic its recorded answers covered, as the live run did.
// Fixture: a real C40 emulated trace (see provenance in the fixture file) whose nurse utterance-end carries
// coveredTags [team_communication, urgent_escalation]. Known-good column: fixture.provenance.liveMarkedChips, the data-asked=true chips the
// live page showed after the same trace (c40-run checks C1 and H9). The assertion is set equality, never a count.
const fixtureFile: unknown = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "xr-sync-c46-nurse-two-topic.fixture.json"), "utf8"));
const fixture = fixtureFile as { provenance: { mainSha: string; liveMarkedChips: string[] }; trace: TraceShape };
interface TraceShape {
  stationId: string;
  scenarioId: string;
  events: Array<Record<string, unknown>>;
  turns: Array<Record<string, unknown>>;
  emotions: Array<Record<string, unknown>>;
}
const OFF_MENU = "c46_not_on_the_menu";
const LIVE_SET = [...fixture.provenance.liveMarkedChips].sort();
const CHEST = { ...edChestPainScenario, status: "approved" };

const servers: EncounterServer[] = [];
const leavers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (leavers.length > 0) await leavers.pop()?.().catch(() => undefined);
  while (servers.length > 0) await servers.pop()?.close().catch(() => undefined);
});

const clone = (trace: TraceShape): TraceShape => JSON.parse(JSON.stringify(trace)) as TraceShape;
const nurseEnd = (trace: TraceShape): Record<string, unknown> => trace.events.find((e) => e["kind"] === "utterance-end" && e["turnId"] === 4) as Record<string, unknown>;

/** Append one more recorded nurse turn whose utterance-end carries only `tag` (a per-topic event beside the covering one). */
function withPerTopicTurn(trace: TraceShape, turnId: number, seq: number, tag: string, coveredTags?: string[]): void {
  trace.turns.push({ turnId, actorId: "nurse_maria_alvarez_v1", replyId: "c3-ack-onset", cueId: "cue-followup-02", startSeq: seq, end: "completed", endSeq: null });
  trace.events.push({ seq, kind: "utterance-end", actorId: "nurse_maria_alvarez_v1", turnId, tag, ...(coveredTags === undefined ? {} : { coveredTags }), modality: "typed" });
  trace.events.push({ seq: null, kind: "turn-completed", actorId: "nurse_maria_alvarez_v1", turnId });
  trace.emotions.push(JSON.parse(JSON.stringify(trace.emotions[trace.emotions.length - 1])) as Record<string, unknown>);
}

function writeReplayDir(trace: TraceShape): string {
  const dir = mkdtempSync(join(tmpdir(), "xr-sync-c46-"));
  const traceFile = "c46-station.conversation-trace.json";
  writeFileSync(join(dir, traceFile), JSON.stringify(trace));
  writeFileSync(join(dir, "exam-session.review-index.json"), JSON.stringify({ schema: "openclinxr.xr-sync.exam-session-review-index.v1", complete: true, stationCount: 1, stations: [{ stationId: trace.stationId, stationIndex: 0, scenarioId: trace.scenarioId, traceFile, phases: [], turnCount: trace.turns.length, turnEnds: [], observerPresent: false, notePresent: false, noteChars: 0, noteFile: null }] }));
  return dir;
}
async function bootReplay(trace: TraceShape, stepMs = 20): Promise<EncounterServer> {
  const server = await (createEncounterServer as (o: Record<string, unknown>) => Promise<EncounterServer>)({ replayDir: writeReplayDir(trace), replayStepMs: stepMs, scenarios: [CHEST], dialogueSeeds: scenarioDialogueSeedBank });
  servers.push(server);
  return server;
}

async function joinOutcome(trace: TraceShape): Promise<string> {
  const server = await bootReplay(trace);
  return connect(server.url, { roomOptions: { replayStationId: trace.stationId } }).then(
    async (conn) => { leavers.push(() => conn.leave()); return "joined"; },
    (error: unknown) => String((error as Error).message),
  );
}

/** Replay `trace` through a real replay server and the client, return the final topic menu. */
async function replayMenu(trace: TraceShape, history?: Array<Array<{ tag: string; asked: boolean }>>, stepMs = 20): Promise<Array<{ tag: string; asked: boolean }>> {
  const server = await bootReplay(trace, stepMs);
  const conn = await connect(server.url, { roomOptions: { replayStationId: trace.stationId } });
  leavers.push(() => conn.leave());
  let last: Array<{ tag: string; asked: boolean }> = [];
  let done = false;
  conn.onState((snap) => {
    const s = snap as { replayDone?: boolean; topicMenu?: Array<{ tag: string; asked: boolean }> };
    last = (s.topicMenu ?? []).map((e) => ({ tag: e.tag, asked: e.asked }));
    history?.push(last);
    if (s.replayDone === true) done = true;
  });
  const deadline = Date.now() + 20000;
  while (!done) {
    if (Date.now() > deadline) throw new Error("timed out waiting for replayDone");
    await new Promise((r) => setTimeout(r, 10));
  }
  return last;
}
const marked = (menu: Array<{ tag: string; asked: boolean }>): string[] => menu.filter((e) => e.asked).map((e) => e.tag).sort();
const show = (label: string, replay: string[], expected: string[]): void => {
  console.log(`C46 ${label} replay set ${JSON.stringify(replay)} expected set ${JSON.stringify(expected)}`);
};

describe("replay marks covered topics (C46)", () => {
  it("the fixture holds the nurse utterance-end with two on-menu coveredTags", () => {
    expect(nurseEnd(fixture.trace)["coveredTags"]).toEqual(["team_communication", "urgent_escalation"]);
    expect(LIVE_SET).toEqual(["history_opqrst", "risk_factor_question", "team_communication", "urgent_escalation"]);
  });

  it("the replayed marked set equals the live marked set (set equality)", async () => {
    const menu = await replayMenu(clone(fixture.trace));
    show("main", marked(menu), LIVE_SET);
    expect(marked(menu)).toEqual(LIVE_SET);
  }, 60000);

  it("counterweight (a): an off-menu tag in coveredTags marks nothing", async () => {
    const trace = clone(fixture.trace);
    nurseEnd(trace)["coveredTags"] = ["team_communication", OFF_MENU];
    const expected = LIVE_SET.filter((tag) => tag !== "urgent_escalation");
    const menu = await replayMenu(trace);
    show("(a)", marked(menu), expected);
    expect(menu.map((e) => e.tag)).not.toContain(OFF_MENU);
    expect(menu.length).toBeGreaterThan(0);
    expect(marked(menu)).toEqual(expected);
  }, 60000);

  it("counterweight (b): an absent coveredTags still marks the one matched topic", async () => {
    const trace = clone(fixture.trace);
    delete nurseEnd(trace)["coveredTags"];
    const expected = LIVE_SET.filter((tag) => tag !== "urgent_escalation");
    const menu = await replayMenu(trace);
    show("(b)", marked(menu), expected);
    expect(marked(menu)).toEqual(expected);
  }, 60000);

  it("empty coveredTags is refused like the live validator (one shared contract; absent is how a turn marks only its matched topic)", async () => {
    const trace = clone(fixture.trace);
    nurseEnd(trace)["coveredTags"] = [];
    const outcome = await joinOutcome(trace);
    console.log(`C46 (b2) join outcome ${outcome}`);
    expect(outcome).toMatch(/replay-bad-trace.*coveredTags/u);
  }, 60000);

  it("validation (e): coveredTags that excludes the event's own tag, or an utterance-end without a tag, is refused with replay-bad-trace", async () => {
    const excluded = clone(fixture.trace);
    nurseEnd(excluded)["coveredTags"] = ["urgent_escalation", "family_communication"];
    const tagless = clone(fixture.trace);
    delete nurseEnd(tagless)["tag"];
    const outcomes = [await joinOutcome(excluded), await joinOutcome(tagless)];
    console.log(`C46 (e) join outcomes ${JSON.stringify(outcomes)}`);
    expect(outcomes.every((o) => /replay-bad-trace.*coveredTags/u.test(o))).toBe(true);
  }, 60000);

  it("validation (d): coveredTags on a non-utterance-end event or a non-string array refuses the station, as the live validator does", async () => {
    const outcomes: string[] = [];
    for (const mutate of [
      (t: TraceShape) => { (t.events.find((e) => e["kind"] === "turn-completed") as Record<string, unknown>)["coveredTags"] = ["team_communication"]; },
      (t: TraceShape) => { nurseEnd(t)["coveredTags"] = ["team_communication", 7]; },
      (t: TraceShape) => { nurseEnd(t)["coveredTags"] = "team_communication"; },
    ]) {
      const trace = clone(fixture.trace);
      mutate(trace);
      outcomes.push(await joinOutcome(trace));
    }
    console.log(`C46 (d) join outcomes ${JSON.stringify(outcomes)}`);
    expect(outcomes.every((o) => /replay-bad-trace/u.test(o))).toBe(true);
  }, 60000);

  it("counterweight (c): the same coveredTags event fed twice (and per-topic events for the same tags) marks each chip exactly once and leaves the set unchanged", async () => {
    const trace = clone(fixture.trace);
    withPerTopicTurn(trace, 5, 14, "team_communication", ["team_communication", "urgent_escalation"]);
    withPerTopicTurn(trace, 6, 15, "urgent_escalation");
    const history: Array<Array<{ tag: string; asked: boolean }>> = [];
    // Step above the 50 ms patch interval so every applied event reaches the client as its own snapshot.
    const menu = await replayMenu(trace, history, 120);
    show("(c)", marked(menu), LIVE_SET);
    const tags = menu.map((e) => e.tag);
    expect(new Set(tags).size).toBe(tags.length);
    // Marked count per chip = number of unasked -> asked transitions seen across the snapshots; a toggling or re-marking double-mark exceeds 1.
    const markedCount = new Map<string, number>();
    const previous = new Map<string, boolean>();
    for (const snapshot of history) {
      for (const entry of snapshot) {
        if (entry.asked && previous.get(entry.tag) !== true) markedCount.set(entry.tag, (markedCount.get(entry.tag) ?? 0) + 1);
        previous.set(entry.tag, entry.asked);
      }
    }
    const counts = Object.fromEntries(menu.map((e) => [e.tag, markedCount.get(e.tag) ?? 0]));
    console.log(`C46 (c) marked counts ${JSON.stringify(counts)}`);
    for (const tag of LIVE_SET) expect(counts[tag]).toBe(1);
    expect(marked(menu)).toEqual(LIVE_SET);
  }, 60000);
});
