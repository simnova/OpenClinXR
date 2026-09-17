import { expect, it } from "vitest";
import { createActorAudioRuntime } from "../../../../packages/openclinxr/xr-dialogue/src/actor-audio-runtime.js";
let runtime = createActorAudioRuntime();
const startActorTurnSpeech = (...args) => runtime.startActorTurnSpeech(...args);
const startPreparedActorTurnAudioOutcome = (...args) => runtime.startPreparedActorTurnAudioOutcome(...args);

function fixture(name, overrides = {}) {
  const actorId = `failure-control-${name}`;
  const slot = {};
  const counts = { triggers: 0, starts: 0, stops: 0, disconnects: 0, sourceCreates: 0 };
  const source = { playbackRate: { value: 1 }, connect() {}, onended: null,
    start() { counts.starts++; overrides.start?.(slot); },
    stop() { counts.stops++; return overrides.stop?.(); },
    disconnect() { counts.disconnects++; },
  };
  if (overrides.noDisconnect) delete source.disconnect;
  runtime = createActorAudioRuntime({ developmentFixture: true, fixtureSearch: "?openclinxrSpeakFixture=1" });
  runtime.diagnostics.installRuntime({
    context: { state: 'running', currentTime: 1, sampleRate: 22050,
      createBufferSource() { counts.sourceCreates++; return source; },
    }, destination: {},
    getSlot() { if (overrides.getSlotThrows) throw Error('host-slot-refused'); return slot; },
    triggerDialogue(ctx) {
      counts.triggers++;
      if (overrides.triggerThrows) throw Error('host-action-refused');
      slot.activeSpeech = { text: ctx.spokenText, startedAtMs: 0, durationMs: 900 };
    },
    entry: { scenarioId: 'mock-failure-controls', actorId, responseText: 'Prepared', runnerConversationTurn: 1,
      waveformSha256: 'a'.repeat(64), cueSha256: 'b'.repeat(64), buffer: { duration: 1 },
      cues: [{ phoneme: 'PP', atSecond: 0, durationSeconds: 1 }], decodedSampleRate: 22050, decodedSampleCount: 22050 },
  });
  return { actorId, slot, counts };
}

it('a throwing host action is a typed refusal without allocating a source', () => {
  const f = fixture('host-action', { triggerThrows: true });
  expect(startPreparedActorTurnAudioOutcome({ actorId: f.actorId, spokenText: 'Prepared' }))
    .toEqual({ kind: 'refused', reason: 'playback_failed' });
  expect(f.counts).toMatchObject({ triggers: 1, sourceCreates: 0 });
});
it('a throwing host slot lookup is a typed refusal without allocating a source', () => {
  const f = fixture('host-slot', { getSlotThrows: true });
  expect(startPreparedActorTurnAudioOutcome({ actorId: f.actorId, spokenText: 'Prepared' }))
    .toEqual({ kind: 'refused', reason: 'playback_failed' });
  expect(f.counts.sourceCreates).toBe(0);
});
it('a partially attempted source is stopped and disconnected; unaccepted startup restores plain authored speech', () => {
  const f = fixture('start-throws', { start() { throw Error('source-start-refused'); } });
  expect(startPreparedActorTurnAudioOutcome({ actorId: f.actorId, spokenText: 'Prepared' }))
    .toEqual({ kind: 'refused', reason: 'playback_failed' });
  expect(f.counts).toMatchObject({ starts: 1, stops: 1, disconnects: 1 });
  expect(f.slot.mediaPositionSeconds).toBeUndefined();
  expect(f.slot.activeSpeech).toEqual({ text: 'Prepared', startedAtMs: 0, durationMs: 900 });
  expect(f.slot.activeSpeech.clockKind).toBeUndefined();
});
it('cleanup preserves a replacement speech and reader rather than clearing a newer owner', () => {
  const replacement = { text: 'Replacement', startedAtMs: 2, durationMs: 1000 };
  const reader = () => 2;
  const f = fixture('newer-owner', { start(slot) { slot.activeSpeech = replacement; slot.mediaPositionSeconds = reader; } });
  expect(startPreparedActorTurnAudioOutcome({ actorId: f.actorId, spokenText: 'Prepared' }))
    .toEqual({ kind: 'refused', reason: 'playback_failed' });
  expect(f.counts).toMatchObject({ starts: 1, stops: 1, disconnects: 1 });
  expect(f.slot.activeSpeech).toBe(replacement);
  expect(f.slot.mediaPositionSeconds).toBe(reader);
});
it('one facade prepared attempt reports a stop refusal precisely and never invokes ordinary fallback', () => {
  const f = fixture('stop-refused', { stop() { return false; } });
  expect(startPreparedActorTurnAudioOutcome({ actorId: f.actorId, spokenText: 'Prepared' })).toEqual({ kind: 'audio_started' });
  let ordinaryCalls = 0;
  expect(startActorTurnSpeech({ actorId: f.actorId, spokenText: 'Prepared' }, () => { ordinaryCalls++; return true; }))
    .toEqual({ kind: 'refused', reason: 'owned_stop_refusal' });
  expect(f.counts).toMatchObject({ triggers: 1, starts: 1, stops: 1 });
  expect(ordinaryCalls).toBe(0);
});
it('a source that refuses failed-attempt cleanup stays managed and blocks ordinary fallback', () => {
  const f = fixture('cleanup-refused', { noDisconnect: true, start() { throw Error('source-start-refused'); }, stop() { return false; } });
  expect(startPreparedActorTurnAudioOutcome({ actorId: f.actorId, spokenText: 'Prepared' }))
    .toEqual({ kind: 'refused', reason: 'owned_stop_refusal' });
  let ordinaryCalls = 0;
  expect(startActorTurnSpeech({ actorId: f.actorId, spokenText: 'Ordinary' }, () => { ordinaryCalls++; return true; }))
    .toEqual({ kind: 'refused', reason: 'owned_stop_refusal' });
  expect(ordinaryCalls).toBe(0);
  expect(f.slot.activeSpeech.clockKind).toBe('audio_source_compatibility_accessor');
});
