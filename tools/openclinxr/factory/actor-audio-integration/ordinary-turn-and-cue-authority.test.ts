import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { startActorTurnSpeech } from "../../../../apps/ui-xr/src/ordinary-actor-turn-speech.js";
import { installPreparedActorAudioRuntime, startPreparedActorTurnAudio, convertRhubarb } from "../../../../apps/ui-xr/src/prepared-actor-audio.js";
import { mouthCuesToPhonemeCues } from "../../../../packages/openclinxr/xr-dialogue/dist/index.js";

// OWNER PLANT: ordinary turns must not disappear when prepared audio is absent.
function fixture(actorId = "prepared-actor") {
  const sources: { starts: number; stopped: boolean; refuseStop: boolean }[] = [];
  const slot: { activeSpeech?: { text: string; startedAt: number; durationMs: number } } = {};
  let dialogueStarts = 0;
  const context = {
    state: "running", currentTime: 1, sampleRate: 22050,
    createBufferSource() {
      const record = { starts: 0, stopped: false, refuseStop: false };
      sources.push(record);
      return { playbackRate: { value: 1 }, buffer: null, connect() {},
        start() { record.starts += 1; }, stop() { if (record.refuseStop) throw new Error("owned-stop-refusal"); record.stopped = true; } };
    },
  };
  installPreparedActorAudioRuntime({ context, destination: {}, getSlot: () => slot,
    triggerDialogue: (ctx) => { dialogueStarts += 1; slot.activeSpeech = { text: ctx.spokenText, startedAt: 0, durationMs: 1000 }; },
    entry: { scenarioId: "owner-ordinary-control", actorId, responseText: "A prepared line", runnerConversationTurn: 1,
      waveformSha256: "a".repeat(64), cueSha256: "b".repeat(64), buffer: { duration: 1 } as AudioBuffer,
      cues: [{ phoneme: "PP", atSecond: 0, durationSeconds: 1 }], decodedSampleRate: 22050, decodedSampleCount: 22050 },
  });
  return { sources, slot, context, dialogueStarts: () => dialogueStarts };
}

it.fails("ordinary unprepared speech starts existing dialogue and explicitly reports unavailable audio", () => {
  const f = fixture();
  let fallbackStarts = 0;
  const result = startActorTurnSpeech({ actorId: "ordinary-actor", spokenText: "Unprepared authored line" }, () => { fallbackStarts += 1; });
  expect(fallbackStarts).toBe(1);
  expect(f.sources).toHaveLength(0);
  expect(result).toEqual({ kind: "dialogue_only", reason: "prepared_audio_unavailable" });
});

it.fails("prepared speech uses the owned source and reports a typed audible outcome", () => {
  const f = fixture(); let fallbackStarts = 0;
  const result = startActorTurnSpeech({ actorId: "prepared-actor", spokenText: "A prepared line" }, () => { fallbackStarts += 1; });
  expect(f.sources).toHaveLength(1);
  expect(f.sources[0]?.starts).toBe(1);
  expect(fallbackStarts).toBe(0);
  expect(result).toMatchObject({ kind: "audio_started" });
});

it.fails("app preparation uses the existing canonical Rhubarb semantics for all nine shapes", () => {
  const doc = { mouthCues: ["A", "B", "C", "D", "E", "F", "G", "H", "X"].map((value, i) => ({ value, start: i, end: i + 1 })) };
  expect(convertRhubarb(doc)).toEqual(mouthCuesToPhonemeCues(doc));
});

it.fails("ordinary UI-XR frozen-turn host consumes the ordinary/prepared speech boundary", () => {
  const main = readFileSync(new URL("../../../../apps/ui-xr/src/main.ts", import.meta.url), "utf8");
  const begin = main.indexOf("function playLiveFrozenActorTurn(");
  const end = main.indexOf("function hasAuthoredClinicalIdlePoseClip(", begin);
  const host = main.slice(begin, end);
  expect(host).toContain("startActorTurnSpeech(");
});

it("owned stop refusal never becomes ordinary-dialogue fallback success", () => {
  const f = fixture("stop-refusal-actor");
  expect(startPreparedActorTurnAudio({ actorId: "stop-refusal-actor", spokenText: "A prepared line" })).toBe(true);
  f.sources[0]!.refuseStop = true;
  let fallbackStarts = 0;
  const result: unknown = startActorTurnSpeech({ actorId: "stop-refusal-actor", spokenText: "A prepared line" }, () => { fallbackStarts += 1; });
  expect(fallbackStarts).toBe(0);
  expect(f.dialogueStarts()).toBe(1);
  expect(result === false || (typeof result === "object" && result !== null && "kind" in result && result.kind === "refused")).toBe(true);
});

it("invalid overlapping preparation cues remain refused", () => {
  expect(() => convertRhubarb({ mouthCues: [{ value: "A", start: 0, end: 1 }, { value: "B", start: 0.5, end: 1.5 }] })).toThrow();
});

it.fails("prepared-to-unprepared transition stops owned audio before exactly one ordinary dialogue start", () => {
  const f = fixture("owned-to-ordinary");
  expect(startPreparedActorTurnAudio({ actorId: "owned-to-ordinary", spokenText: "A prepared line" })).toBe(true);
  let fallbackStarts = 0;
  const result = startActorTurnSpeech({ actorId: "owned-to-ordinary", spokenText: "Next ordinary line" }, () => {
    expect(f.sources[0]?.stopped).toBe(true);
    fallbackStarts += 1;
    f.slot.activeSpeech = { text: "Next ordinary line", startedAt: 0, durationMs: 1000 };
  });
  expect(fallbackStarts).toBe(1);
  expect(f.sources).toHaveLength(1);
  expect(f.sources[0]?.stopped).toBe(true);
  expect(result).toEqual({ kind: "dialogue_only", reason: "prepared_audio_unavailable" });
});

it.fails("unprepared transition with owned-stop refusal retains the prior source and speech", () => {
  const f = fixture("owned-refusal-next");
  expect(startPreparedActorTurnAudio({ actorId: "owned-refusal-next", spokenText: "A prepared line" })).toBe(true);
  const previousSpeech = f.slot.activeSpeech;
  f.sources[0]!.refuseStop = true;
  let fallbackStarts = 0;
  const result = startActorTurnSpeech({ actorId: "owned-refusal-next", spokenText: "Next ordinary line" }, () => { fallbackStarts += 1; });
  expect(fallbackStarts).toBe(0);
  expect(f.slot.activeSpeech).toBe(previousSpeech);
  expect(f.sources[0]?.stopped).toBe(false);
  expect(f.sources).toHaveLength(1);
  expect(result).toMatchObject({ kind: "refused" });
});

it.fails("a matching prepared entry in a suspended audio context refuses without ordinary fallback", () => {
  const f = fixture("suspended-prepared");
  f.context.state = "suspended";
  let fallbackStarts = 0;
  const result = startActorTurnSpeech({ actorId: "suspended-prepared", spokenText: "A prepared line" }, () => { fallbackStarts += 1; });
  expect(fallbackStarts).toBe(0);
  expect(f.sources).toHaveLength(0);
  expect(f.dialogueStarts()).toBe(0);
  expect(result).toMatchObject({ kind: "refused" });
});
