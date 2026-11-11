import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type ActorTurnBindings, applyUtteranceIntent, type TurnActorState } from "./actor-turns.js";
import { type ConversationTraceEvent, PROBE_CASE_EMOTION_POLICY, reduceConversationEvents } from "./conversation-trace.js";
import { CAST_TRACE_OPENING_CUE_ID } from "./conversation-trace-cast.js";
import { ConversationTracer } from "./conversation-tracer.js";
import { CAST_OPENING_CUE_ID } from "./scenario-cast.js";
import type { TopicAnswer } from "./topic-answers.js";

const loadFixture = (name: string): unknown => JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), name), "utf8"));
const c46Fixture = loadFixture("xr-sync-c46-nurse-two-topic.fixture.json");
const c47DraftFixture = loadFixture("xr-sync-c47-draft-note.fixture.json");
const c47ExplicitFixture = loadFixture("xr-sync-c47-explicit-note.fixture.json");

// CUE-AUTHOR RED (task cue-author-01): a topic-answer actor turn carries
// cueId `cue-answer:${replyId}` instead of the scripted C3 row picked by
// turn count. Drives the exported applyUtteranceIntent directly.

const ACTOR = "actor-a";
const OTHER = "actor-b";

function actorState(): TurnActorState {
  return { speaking: false, emotion: "neutral", replyId: "", cueId: "", caption: "", intake: "", retries: 0 };
}

interface Harness {
  bindings: ActorTurnBindings;
  client: Parameters<typeof applyUtteranceIntent>[1];
  learner: Parameters<typeof applyUtteranceIntent>[2];
}

function setup(topicMenu: readonly string[] | null, topicAnswers: readonly TopicAnswer[] | null, castVoice: ActorTurnBindings["castVoice"] = null): Harness {
  const actors = new Map<string, TurnActorState>([
    [ACTOR, actorState()],
    [OTHER, actorState()],
  ]);
  const bindings = {
    actors,
    selectedActor: new Map<string, string>([["sess1", ACTOR]]),
    turnId: 0,
    setTurnId: (id: number): void => {
      bindings.turnId = id;
    },
    turnOwner: "none",
    setTurnOwner: (owner: string): void => {
      bindings.turnOwner = owner;
    },
    tracer: new ConversationTracer(),
    clock: { setTimeout: (): { clear(): void } => ({ clear(): void {} }) },
    turnLog: [],
    actorTurnCounts: new Map<string, number>(),
    castVoice,
    topicMenu,
    topicAnswers,
    turnOpenedAtMs: new Map<number, number>(),
    open: null as { turnId: number; actorId: string; timer: { clear(): void } } | null,
    getOpenTurn(): { turnId: number; actorId: string; timer: { clear(): void } } | null {
      return bindings.open;
    },
    setOpenTurn(turn: { turnId: number; actorId: string; timer: { clear(): void } } | null): void {
      bindings.open = turn;
    },
    reject: (_client: unknown, _seq: number, reason: string): void => {
      throw new Error(`rejected: ${reason}`);
    },
  } as unknown as ActorTurnBindings & { open: { turnId: number; actorId: string; timer: { clear(): void } } | null };
  const client = { sessionId: "sess1" } as unknown as Parameters<typeof applyUtteranceIntent>[1];
  const learner = { speaking: false } as unknown as Parameters<typeof applyUtteranceIntent>[2];
  return { bindings, client, learner };
}

/** One full learner turn: utterance-start then utterance-end with the payload. */
function utter(harness: Harness, seq: number, payload: Record<string, unknown>): void {
  expect(applyUtteranceIntent(harness.bindings, harness.client, harness.learner, seq, "utterance-start", {})).toBe(true);
  expect(applyUtteranceIntent(harness.bindings, harness.client, harness.learner, seq + 1, "utterance-end", payload)).toBe(true);
}

const cueOf = (harness: Harness, actorId: string): string => harness.bindings.actors.get(actorId)?.cueId ?? "";
const replyOf = (harness: Harness, actorId: string): string => harness.bindings.actors.get(actorId)?.replyId ?? "";

/** Cast voice rostering exactly `ids` (mirrors scenario-cast voice lines). */
function voiceFor(ids: string[]): NonNullable<ActorTurnBindings["castVoice"]> {
  const map = new Map(ids.map((id) => [id, { actorId: id, displayName: id, role: "", openingUtterance: `Hello from ${id}` }]));
  return { actors: map };
}

/** Events the live room pushed for this harness (timers never fire, so no turn-completed). */
function liveEvents(harness: Harness): ConversationTraceEvent[] {
  return harness.bindings.tracer.snapshot().events;
}

/** Reducer cueIds for `events`: `cast` mirrors the live room's roster + selectors (null = off-cast). */
function reducedCues(
  events: readonly ConversationTraceEvent[],
  cast: { actors: string[]; topicAnswers: readonly TopicAnswer[] } | null,
): string[] {
  const context =
    cast === null
      ? undefined
      : {
          scenarioId: "cue-author-station",
          actors: [...cast.actors],
          baseline: "neutral",
          emotionPolicy: PROBE_CASE_EMOTION_POLICY,
          topicAnswers: cast.topicAnswers.map((answer) => ({ actorId: answer.actorId, topicTags: [...answer.topicTags], replyId: answer.replyId })),
        };
  return reduceConversationEvents(events, context).turns.map((turn) => turn.cueId);
}

const ANSWERS: readonly TopicAnswer[] = [
  { actorId: ACTOR, topicTags: ["tag-a"], replyId: `${ACTOR}:seed:answer_a`, line: "Answer A line", phrases: [] },
  { actorId: ACTOR, topicTags: ["tag-b"], replyId: `${ACTOR}:seed:answer_b`, line: "Answer B line", phrases: [] },
];
const MENU = ["tag-a", "tag-b"] as const;

describe("topic answers carry their own cue", () => {
  it("C1: two turns resolving to the SAME topic answer carry the same cueId, exactly cue-answer plus replyId", () => {
    const harness = setup([...MENU], ANSWERS);
    utter(harness, 1, { actorId: ACTOR, topicTag: "tag-a" });
    const replyId = replyOf(harness, ACTOR);
    const firstCue = cueOf(harness, ACTOR);
    utter(harness, 3, { actorId: ACTOR, topicTag: "tag-a" });
    expect(replyOf(harness, ACTOR)).toBe(replyId);
    expect(cueOf(harness, ACTOR)).toBe(firstCue);
    expect(cueOf(harness, ACTOR)).toBe(`cue-answer:${replyId}`);
  });

  it("C2 counterweight: two DIFFERENT topic answers on the same actor carry different cueIds", () => {
    const harness = setup([...MENU], ANSWERS);
    utter(harness, 1, { actorId: ACTOR, topicTag: "tag-a" });
    const replyA = replyOf(harness, ACTOR);
    const cueA = cueOf(harness, ACTOR);
    utter(harness, 3, { actorId: ACTOR, topicTag: "tag-b" });
    const replyB = replyOf(harness, ACTOR);
    const cueB = cueOf(harness, ACTOR);
    expect(replyA).not.toBe(replyB);
    expect(cueA).toBe(`cue-answer:${replyA}`);
    expect(cueB).toBe(`cue-answer:${replyB}`);
    expect(cueA).not.toBe(cueB);
  });

  it("C3 known-good: fallback keeps the C3 cue by turn count; the cast opening keeps CAST_OPENING_CUE_ID", () => {
    const offCast = setup(null, null);
    utter(offCast, 1, { actorId: ACTOR });
    expect(cueOf(offCast, ACTOR)).toBe("cue-greeting-01");
    utter(offCast, 3, { actorId: ACTOR });
    expect(cueOf(offCast, ACTOR)).toBe("cue-followup-02");
    utter(offCast, 5, { actorId: ACTOR });
    expect(cueOf(offCast, ACTOR)).toBe("cue-recap-03");

    const castVoice = {
      actors: {
        get: (id: string) => (id === ACTOR ? { actorId: ACTOR, displayName: "Actor A", role: "", openingUtterance: "Hello there" } : undefined),
        has: (id: string) => id === ACTOR,
      },
    } as unknown as ActorTurnBindings["castVoice"];
    const onCast = setup(null, null, castVoice);
    utter(onCast, 1, { actorId: ACTOR });
    expect(replyOf(onCast, ACTOR)).toBe(`${ACTOR}:opening`);
    expect(cueOf(onCast, ACTOR)).toBe(CAST_OPENING_CUE_ID);
  });

  it("S0 live==reduced: a seeded topic answer's live cueId equals the reducer's cueId for the same events", () => {
    // ACTOR has no voice line (OTHER is rostered) so both turns resolve the
    // topic answer, exactly like the live room's castVoice/topicAnswers split.
    const harness = setup([...MENU], ANSWERS, voiceFor([OTHER]));
    utter(harness, 1, { actorId: ACTOR, topicTag: "tag-a" });
    const liveCue1 = cueOf(harness, ACTOR);
    utter(harness, 3, { actorId: ACTOR, topicTag: "tag-a" });
    const liveCue2 = cueOf(harness, ACTOR);
    expect(liveCue1).toBe(`cue-answer:${replyOf(harness, ACTOR)}`);
    const reduced = reducedCues(liveEvents(harness), { actors: [OTHER], topicAnswers: ANSWERS });
    expect(reduced).toEqual([liveCue1, liveCue2]);
  });

  it("counterweight both-sides: fallback C3 cues by turn count and the cast opening agree in live and reduced", () => {
    // The actors map holds only the latest turn, so capture each turn's cue with its own harness.
    const first = setup(null, null);
    utter(first, 1, { actorId: ACTOR });
    const f1 = cueOf(first, ACTOR);
    const second = setup(null, null);
    utter(second, 1, { actorId: ACTOR });
    utter(second, 3, { actorId: ACTOR });
    const f2 = cueOf(second, ACTOR);
    expect([f1, f2]).toEqual(["cue-greeting-01", "cue-followup-02"]);
    expect(reducedCues(liveEvents(second), null)).toEqual([f1, f2]);

    const onCast = setup(null, null, voiceFor([ACTOR]));
    utter(onCast, 1, { actorId: ACTOR });
    expect(cueOf(onCast, ACTOR)).toBe(CAST_OPENING_CUE_ID);
    const reducedOpening = reducedCues(liveEvents(onCast), { actors: [ACTOR], topicAnswers: [] });
    expect(reducedOpening).toEqual([CAST_TRACE_OPENING_CUE_ID]);
    expect(reducedOpening[0]).toBe(cueOf(onCast, ACTOR));
  });

  it("STORED_EQ: every stored fixture turn cue equals the reducer recompute", () => {
    const fixtures = [
      ["c46", c46Fixture],
      ["c47-explicit", c47ExplicitFixture],
      ["c47-draft", c47DraftFixture],
    ] as const;
    for (const [name, fixture] of fixtures) {
      const trace = (fixture as { trace: { events: ConversationTraceEvent[]; turns: Array<{ turnId: number; cueId: string }>; cast?: Parameters<typeof reduceConversationEvents>[1] } }).trace;
      const recomputed = reduceConversationEvents(trace.events, trace.cast).turns;
      expect(recomputed.map((turn) => turn.turnId), `${name} turn ids`).toEqual(trace.turns.map((turn) => turn.turnId));
      for (const stored of trace.turns) {
        const match = recomputed.find((turn) => turn.turnId === stored.turnId);
        expect(match?.cueId, `${name} turn ${stored.turnId}`).toBe(stored.cueId);
      }
    }
  });
});
