import { it, expect } from "vitest";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { createActorAudioRuntime } from "../../../../packages/openclinxr/xr-dialogue/src/actor-audio-runtime.js";
let runtime = createActorAudioRuntime();
const startActorTurnSpeech = (...args: Parameters<typeof runtime.startActorTurnSpeech>) => runtime.startActorTurnSpeech(...args);
const preparedActorTurnAudioAvailable = (...args: Parameters<typeof runtime.preparedActorTurnAudioAvailable>) => runtime.preparedActorTurnAudioAvailable(...args);
const startPreparedActorTurnAudio = (...args: Parameters<typeof runtime.startPreparedActorTurnAudio>) => runtime.startPreparedActorTurnAudio(...args);
const syncPreparedActorAudio = (...args: Parameters<typeof runtime.syncPreparedActorAudio>) => runtime.syncPreparedActorAudio(...args);
// OWNER PLANT: ordinary turns must not disappear when prepared audio is absent.
function fixture(actorId = "prepared-actor") {
  const sources: { starts: number; stopped: boolean; refuseStop: boolean }[] = [];
  const slot: { activeSpeech?: { text: string; startedAt: number; durationMs: number }; mediaPositionSeconds?: () => number | null } = {};
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
  runtime = createActorAudioRuntime({ developmentFixture: true, fixtureSearch: "?openclinxrSpeakFixture=1" });
  runtime.diagnostics.installRuntime({ context, destination: {}, getSlot: () => slot,
    triggerDialogue: (ctx) => { dialogueStarts += 1; slot.activeSpeech = { text: ctx.spokenText, startedAt: 0, durationMs: 1000 }; },
    entry: { scenarioId: "owner-ordinary-control", actorId, responseText: "A prepared line", runnerConversationTurn: 1,
      waveformSha256: "a".repeat(64), cueSha256: "b".repeat(64), buffer: { duration: 1 } as AudioBuffer,
      cues: [{ phoneme: "PP", atSecond: 0, durationSeconds: 1 }], decodedSampleRate: 22050, decodedSampleCount: 22050 },
  });
  return { sources, slot, context, dialogueStarts: () => dialogueStarts };
}

it("ordinary unprepared speech starts existing dialogue and explicitly reports unavailable audio", () => {
  const f = fixture();
  let fallbackStarts = 0;
  const result = startActorTurnSpeech({ actorId: "ordinary-actor", spokenText: "Unprepared authored line" }, () => { fallbackStarts += 1; f.slot.activeSpeech = { text: "Unprepared authored line", startedAt: 0, durationMs: 1000 }; return true; });
  expect(fallbackStarts).toBe(1);
  expect(f.sources).toHaveLength(0);
  expect(result).toEqual({ kind: "dialogue_only", reason: "prepared_audio_unavailable" });
});

it("prepared speech uses the owned source and reports a typed audible outcome", () => {
  const f = fixture(); let fallbackStarts = 0;
  const result = startActorTurnSpeech({ actorId: "prepared-actor", spokenText: "A prepared line" }, () => { fallbackStarts += 1; return true; });
  expect(f.sources).toHaveLength(1);
  expect(f.sources[0]?.starts).toBe(1);
  expect(fallbackStarts).toBe(0);
  expect(result).toMatchObject({ kind: "audio_started" });
});

function invokeActualFrozenTurnHost(actorId: string, spokenText: string, f: ReturnType<typeof fixture>, fallback: () => void): unknown {
  const main = readFileSync(new URL("../../../../apps/ui-xr/src/main.ts", import.meta.url), "utf8");
  const begin = main.indexOf("function playLiveFrozenActorTurn(");
  const end = main.indexOf("function hasAuthoredClinicalIdlePoseClip(", begin);
  const body = ts.transpileModule(main.slice(begin, end), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const names = ["generatedHumanoidAnimationSlotsByActorId", "playFrozenActorTurnOnSlot", "startPreparedActorTurnAudio", "startActorTurnSpeech", "preparedActorTurnAudioAvailable", "triggerHumanoidDialogue", "playOneShotResponseClip", "startHumanoidEmotionTransition"];
  const getHost = new Function(...names, body + "\nreturn playLiveFrozenActorTurn;");
  const host = getHost(new Map([[actorId, f.slot]]), (_plan: unknown, _execution: unknown, adapters: { speak: (ctx: unknown) => unknown }) => adapters.speak({ actorId, spokenText }), startPreparedActorTurnAudio, startActorTurnSpeech, preparedActorTurnAudioAvailable, fallback, () => false, () => undefined);
  return host({ actorId, spokenText }, {}, { kind: "learner_camera", actorId: null });
}

it("actual ordinary frozen-turn host executes dialogue-only adapter without a prepared source", () => {
  const f = fixture(); let fallbackStarts = 0;
  const result = invokeActualFrozenTurnHost("ordinary-host-actor", "Ordinary host line", f, () => { fallbackStarts += 1; f.slot.activeSpeech = { text: "Ordinary host line", startedAt: 0, durationMs: 1000 }; });
  expect(result).toBe(true);
  expect(fallbackStarts).toBe(1);
  expect(f.sources).toHaveLength(0);
});

it("actual prepared frozen-turn host executes its existing audible adapter without ordinary fallback", () => {
  const f = fixture("prepared-host-actor"); let fallbackStarts = 0;
  const result = invokeActualFrozenTurnHost("prepared-host-actor", "A prepared line", f, () => { fallbackStarts += 1; return true; });
  expect(result).toBe(true);
  expect(f.sources[0]?.starts).toBe(1);
  expect(fallbackStarts).toBe(0);
  expect(f.dialogueStarts()).toBe(1);
});

it("owned stop refusal never becomes ordinary-dialogue fallback success", () => {
  const f = fixture("stop-refusal-actor");
  expect(startPreparedActorTurnAudio({ actorId: "stop-refusal-actor", spokenText: "A prepared line" })).toBe(true);
  f.sources[0]!.refuseStop = true;
  let fallbackStarts = 0;
  const result: unknown = startActorTurnSpeech({ actorId: "stop-refusal-actor", spokenText: "A prepared line" }, () => { fallbackStarts += 1; return true; });
  expect(fallbackStarts).toBe(0);
  expect(f.dialogueStarts()).toBe(1);
  expect(result === false || (typeof result === "object" && result !== null && "kind" in result && result.kind === "refused")).toBe(true);
});

it("prepared-to-unprepared transition stops owned audio before exactly one ordinary dialogue start", () => {
  const f = fixture("owned-to-ordinary");
  expect(startPreparedActorTurnAudio({ actorId: "owned-to-ordinary", spokenText: "A prepared line" })).toBe(true);
  let fallbackStarts = 0;
  const result = startActorTurnSpeech({ actorId: "owned-to-ordinary", spokenText: "Next ordinary line" }, () => {
    expect(f.sources[0]?.stopped).toBe(true);
    expect(f.slot.mediaPositionSeconds).toBeUndefined();
    expect(f.slot.activeSpeech).toBeUndefined();
    fallbackStarts += 1;
    f.slot.activeSpeech = { text: "Next ordinary line", startedAt: 0, durationMs: 1000 };
    return true;
  });
  expect(fallbackStarts).toBe(1);
  expect(f.sources).toHaveLength(1);
  expect(f.sources[0]?.stopped).toBe(true);
  expect(result).toEqual({ kind: "dialogue_only", reason: "prepared_audio_unavailable" });
  const ordinarySpeech = f.slot.activeSpeech;
  syncPreparedActorAudio(9000);
  expect(f.slot.activeSpeech).toBe(ordinarySpeech);
  expect(f.slot.mediaPositionSeconds).toBeUndefined();
});

it("unprepared transition with owned-stop refusal retains the prior source and speech", () => {
  const f = fixture("owned-refusal-next");
  expect(startPreparedActorTurnAudio({ actorId: "owned-refusal-next", spokenText: "A prepared line" })).toBe(true);
  const previousSpeech = f.slot.activeSpeech;
  f.sources[0]!.refuseStop = true;
  let fallbackStarts = 0;
  const result = startActorTurnSpeech({ actorId: "owned-refusal-next", spokenText: "Next ordinary line" }, () => { fallbackStarts += 1; return true; });
  expect(fallbackStarts).toBe(0);
  expect(f.slot.activeSpeech).toBe(previousSpeech);
  expect(f.sources[0]?.stopped).toBe(false);
  expect(f.sources).toHaveLength(1);
  expect(result).toMatchObject({ kind: "refused" });
});

it("a matching prepared entry in a suspended audio context refuses without ordinary fallback", () => {
  const f = fixture("suspended-prepared");
  f.context.state = "suspended";
  let fallbackStarts = 0;
  const result = startActorTurnSpeech({ actorId: "suspended-prepared", spokenText: "A prepared line" }, () => { fallbackStarts += 1; return true; });
  expect(fallbackStarts).toBe(0);
  expect(f.sources).toHaveLength(0);
  expect(f.dialogueStarts()).toBe(0);
  expect(result).toMatchObject({ kind: "refused" });
});

it("failed ordinary speech setup is a typed refusal rather than a callback-only ACK", () => {
  const f = fixture(); let attempted = 0;
  const result = startActorTurnSpeech({ actorId: "missing-ordinary-slot", spokenText: "No slot line" }, () => { attempted += 1; return false; });
  expect(attempted).toBe(1);
  expect(result).toMatchObject({ kind: "refused" });
  expect(f.sources).toHaveLength(0);
});


it("actual ordinary frozen-turn host refuses a trigger that creates no speech", () => {
  const f = fixture(); let attempted = 0;
  const result = invokeActualFrozenTurnHost("ordinary-no-setup", "No setup line", f, () => { attempted += 1; });
  expect(result).toBe(false);
  expect(f.slot.activeSpeech).toBeUndefined();
  expect(f.sources).toHaveLength(0);
  // Pre-fix the prepared-only host does not attempt ordinary dialogue.
  // Once routed through the ordinary host, it must still refuse this callback.
  expect(attempted).toBeLessThanOrEqual(1);
});

it("default constructor is inert and diagnostics require both actual capability and URL", () => {
  const normal = createActorAudioRuntime();
  expect(() => normal.diagnostics.installRuntime({})).toThrow("diagnostic-disabled");
  expect(() => normal.diagnostics.registerEntry({})).toThrow("diagnostic-disabled");
  const oneGate = createActorAudioRuntime({ developmentFixture: true });
  expect(() => oneGate.diagnostics.installRuntime({})).toThrow("diagnostic-disabled");
  expect(Object.values(normal).some(value => value instanceof Map)).toBe(false);
});
it("two factory instances do not share preparation or host ownership", () => {
  fixture("isolated-a");
  expect(runtime.preparedActorTurnAudioAvailable({ actorId: "isolated-a", spokenText: "A prepared line" })).toBe(true);
  const second = createActorAudioRuntime();
  expect(second.preparedActorTurnAudioAvailable({ actorId: "isolated-a", spokenText: "A prepared line" })).toBe(false);
});

it("the package-owned speech clock follows real context time and freezes while that clock is unchanged", () => {
  const f = fixture("native-clock");
  expect(runtime.startPreparedActorTurnAudio({ actorId: "native-clock", spokenText: "A prepared line" })).toBe(true);
  f.context.currentTime = 1.25;
  runtime.syncPreparedActorAudio(9000);
  const speech = f.slot.activeSpeech as unknown as { startedAtMs: number };
  expect(speech.startedAtMs).toBeCloseTo(8750, 8);
  runtime.syncPreparedActorAudio(12000);
  expect(speech.startedAtMs).toBeCloseTo(11750, 8);
  f.context.currentTime = 1.5;
  runtime.syncPreparedActorAudio(13000);
  expect(speech.startedAtMs).toBeCloseTo(12500, 8);
});
it("a replaced host speech is not cleared or reclocked by an older package-owned session", () => {
  const f = fixture("replacement-clock");
  expect(runtime.startPreparedActorTurnAudio({ actorId: "replacement-clock", spokenText: "A prepared line" })).toBe(true);
  const replacement = { text: "Replacement", startedAt: 42, durationMs: 800 };
  f.slot.activeSpeech = replacement;
  runtime.syncPreparedActorAudio(99999);
  expect(f.slot.activeSpeech).toBe(replacement);
  expect(replacement.startedAt).toBe(42);
  expect(Object.getOwnPropertyDescriptor(replacement, "startedAtMs")).toBeUndefined();
});
