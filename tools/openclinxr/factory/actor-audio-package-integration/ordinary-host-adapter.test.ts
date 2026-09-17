import { expect, it } from "vitest";
import { createActorAudioRuntime } from "../../../../packages/openclinxr/xr-dialogue/src/actor-audio-runtime.js";
let runtime = createActorAudioRuntime();
const startActorTurnSpeech = (...args: Parameters<typeof runtime.startActorTurnSpeech>) => runtime.startActorTurnSpeech(...args);
const startPreparedActorTurnAudio = (...args: Parameters<typeof runtime.startPreparedActorTurnAudio>) => runtime.startPreparedActorTurnAudio(...args);

// OWNER RED: an ordinary adapter must verify actual host speech, not acknowledge a trigger.
type Speech = { text: string; startedAt: number; durationMs: number };
function host(initial?: Speech) {
  const slot: { activeSpeech?: Speech } = initial ? { activeSpeech: initial } : {};
  runtime = createActorAudioRuntime({ developmentFixture: true, fixtureSearch: "?openclinxrSpeakFixture=1" });
  runtime.diagnostics.installRuntime({
    context: { state: "running", currentTime: 1, sampleRate: 22050,
      createBufferSource: () => ({ playbackRate: { value: 1 }, connect() {}, start() {}, stop() {} }),
    } as unknown as AudioContext,
    destination: {} as AudioNode,
    getSlot: () => slot,
    triggerDialogue: (context) => { slot.activeSpeech = { text: context.spokenText, startedAt: 0, durationMs: 1000 }; },
    entry: { scenarioId: "owner-adapter-control", actorId: "different-prepared-actor",
      responseText: "Prepared", runnerConversationTurn: 1, waveformSha256: "a".repeat(64),
      cueSha256: "b".repeat(64), buffer: { duration: 1 } as AudioBuffer,
      cues: [{ phoneme: "PP", atSecond: 0, durationSeconds: 1 }],
      decodedSampleRate: 22050, decodedSampleCount: 22050 },
  });
  return slot;
}
function invoke(slot: ReturnType<typeof host>, setup: () => void, actorId = "ordinary-host"): unknown {
  // Structural cast permits planting the future overload without weakening assertions.
  const route = startActorTurnSpeech as unknown as (context: { actorId: string; spokenText: string },
    adapter: { readSpeech: () => Speech | undefined; startDialogue: () => void }) => unknown;
  return route({ actorId, spokenText: "Ordinary line" }, {
    readSpeech: () => slot.activeSpeech, startDialogue: setup,
  });
}
it("actual new correctly named speech is an explicit dialogue-only success", () => {
  const slot = host();
  expect(invoke(slot, () => { slot.activeSpeech = { text: "Ordinary line", startedAt: 1, durationMs: 1000 }; }))
    .toEqual({ kind: "dialogue_only", reason: "prepared_audio_unavailable" });
});
it("unchanged previous same-text speech is refused", () => {
  const slot = host({ text: "Ordinary line", startedAt: 0, durationMs: 1000 });
  expect(invoke(slot, () => {})).toMatchObject({ kind: "refused", reason: "ordinary_setup_failed" });
});
it("new speech with the wrong text is refused", () => {
  const slot = host();
  expect(invoke(slot, () => { slot.activeSpeech = { text: "Wrong", startedAt: 1, durationMs: 1000 }; }))
    .toMatchObject({ kind: "refused", reason: "ordinary_setup_failed" });
});
it("no actual speech after a completed action is refused", () => {
  const slot = host(); let called = 0;
  expect(invoke(slot, () => { called += 1; })).toMatchObject({ kind: "refused", reason: "ordinary_setup_failed" });
  expect(called).toBe(1);
});
it("existing direct prepared boolean compatibility still starts a real owned fixture source", () => {
  const slot = host();
  expect(startPreparedActorTurnAudio({ actorId: "different-prepared-actor", spokenText: "Prepared" })).toBe(true);
  expect(slot.activeSpeech?.text).toBe("Prepared");
});
it("reinstalling the previous owned speech object after retirement is not new ordinary speech", () => {
  const slot = host();
  expect(startPreparedActorTurnAudio({ actorId: "different-prepared-actor", spokenText: "Prepared" })).toBe(true);
  const previous = slot.activeSpeech!;
  previous.text = "Ordinary line";
  expect(invoke(slot, () => { slot.activeSpeech = previous; }, "different-prepared-actor"))
    .toMatchObject({ kind: "refused", reason: "ordinary_setup_failed" });
});
it("an ordinary host action that throws is a typed refusal, never a success or escaped exception", () => {
  const slot = host();
  expect(invoke(slot, () => { throw new Error("ordinary host refused setup"); }))
    .toMatchObject({ kind: "refused", reason: "ordinary_setup_failed" });
});
