/** Producer manager lifecycle controls. Original clock/player assertions stay in their suites. */
import {describe,it,expect} from 'vitest';
import {
  installPreparedActorAudioRuntime,
  startPreparedActorTurnAudio,
  pausePreparedActorTurnAudio,
  resumePreparedActorTurnAudio,
  syncPreparedActorAudio,
} from '../../../../apps/ui-xr/src/prepared-actor-audio.ts';
import {applyNamedSpeechVisemes} from '../../../../packages/openclinxr/xr-dialogue/dist/index.js';

const nativeSeconds = 317009 / 22050;
const cues = [
  {phoneme:'sil',atSecond:0,durationSeconds:1.24},
  {phoneme:'PP',atSecond:1.24,durationSeconds:0.08},
  {phoneme:'aa',atSecond:1.32,durationSeconds:13.05},
];

function fakeRuntime() {
  const sources = [];
  const context = {
    currentTime: 10, state: 'running', sampleRate: 22050,
    async resume() { return undefined; },
    createBufferSource() {
      const source = { playbackRate: {value:1}, buffer: null, connected: false, starts: [], stops: 0,
        connect(dest) { this.connected = dest; },
        start(when, offset) { this.starts.push([when, offset]); },
        stop() { this.stops += 1; }, onended: null };
      sources.push(source); return source;
    },
  };
  const buffer = { sampleRate: 22050, length: 317009, duration: nativeSeconds, numberOfChannels: 1 };
  const root = { userData: {}, traverse() {} };
  const slot = { root, activeSpeech: undefined };
  const spoken = 'clock fixture';
  installPreparedActorAudioRuntime({
    getSlot: () => slot,
    triggerDialogue: (ctx) => { slot.activeSpeech = { text: ctx.spokenText, phonemeSequence: ['a'], startedAtMs: 0, durationMs: 1000, bakedCues: cues }; },
    context, destination: {},
    entry: {
      scenarioId: 's', actorId: 'clock-patient', responseText: spoken, runnerConversationTurn: 1,
      waveformSha256: 'a'.repeat(64), cueSha256: 'b'.repeat(64), buffer, cues,
      decodedSampleRate: 22050, decodedSampleCount: 317009,
    },
  });
  return { context, sources, slot, spoken };
}

describe('actual prepared manager lifecycle', () => {
  it('natural source end reports full native duration instead of rewinding to start offset', () => {
    const f = fakeRuntime();
    expect(startPreparedActorTurnAudio({ actorId: 'clock-patient', spokenText: f.spoken })).toBe(true);
    const speech = f.slot.activeSpeech;
    f.sources[0].onended();
    syncPreparedActorAudio(20000);
    expect(f.slot.activeSpeech).toBe(speech);
    expect(20000 - speech.startedAtMs).toBeCloseTo(nativeSeconds * 1000, 5);
  });

  it('suspended context reader refuses and clears only owned speech', () => {
    const f = fakeRuntime();
    expect(startPreparedActorTurnAudio({ actorId: 'clock-patient', spokenText: f.spoken })).toBe(true);
    f.context.state = 'suspended';
    syncPreparedActorAudio(16000);
    expect(f.slot.activeSpeech).toBeUndefined();
  });

  it('repeated actor start stops the previous source before acknowledging the replacement', () => {
    const f = fakeRuntime();
    expect(startPreparedActorTurnAudio({ actorId: 'clock-patient', spokenText: f.spoken })).toBe(true);
    const first = f.slot.activeSpeech;
    expect(startPreparedActorTurnAudio({ actorId: 'clock-patient', spokenText: f.spoken })).toBe(true);
    expect(f.sources[0].stops).toBeGreaterThan(0);
    expect(f.slot.activeSpeech).toBeDefined();
    expect(f.slot.activeSpeech).not.toBe(first);
  });

  it('synchronous source.start throw cannot acknowledge voice', () => {
    const f = fakeRuntime();
    f.context.createBufferSource = () => ({ playbackRate: {value:1}, connect() {}, start() { throw Error('source-start-refused'); }, stop() {}, onended: null });
    expect(startPreparedActorTurnAudio({ actorId: 'clock-patient', spokenText: f.spoken })).toBe(false);
    expect(f.slot.activeSpeech).toBeDefined();
  });

  it('manager pause clears owned speech and resume creates a new origin at remaining source time', () => {
    const f = fakeRuntime();
    expect(startPreparedActorTurnAudio({ actorId: 'clock-patient', spokenText: f.spoken })).toBe(true);
    const first = f.slot.activeSpeech;
    f.context.currentTime = 16.25;
    expect(pausePreparedActorTurnAudio('clock-patient')).toBe(true);
    expect(f.slot.activeSpeech).toBeUndefined();
    expect(first).not.toBe(f.slot.activeSpeech);
    f.context.currentTime = 20;
    expect(resumePreparedActorTurnAudio('clock-patient')).toBe(true);
    const resumed = f.slot.activeSpeech;
    expect(resumed).not.toBe(first);
    expect(resumed.originalWallStartedAtMs).toBeDefined();
    expect(resumed.durationMs).toBe(nativeSeconds * 1000);
    expect(resumed).not.toBeUndefined();
  });

  it('equal-text restart does not release the replacement speech', () => {
    const f = fakeRuntime();
    expect(startPreparedActorTurnAudio({ actorId: 'clock-patient', spokenText: f.spoken })).toBe(true);
    const first = f.slot.activeSpeech;
    expect(startPreparedActorTurnAudio({ actorId: 'clock-patient', spokenText: f.spoken })).toBe(true);
    expect(f.slot.activeSpeech).toBeDefined();
    expect(f.slot.activeSpeech).not.toBe(first);
    expect(f.slot.activeSpeech.text).toBe(f.spoken);
  });

  it('overlapping prepared cues are refused before a source is created', () => {
    const f = fakeRuntime();
    installPreparedActorAudioRuntime({
      getSlot: () => f.slot,
      triggerDialogue: (ctx) => { f.slot.activeSpeech = { text: ctx.spokenText, phonemeSequence: ['a'], startedAtMs: 0, durationMs: 1000, bakedCues: cues }; },
      context: f.context, destination: {},
      entry: {
        scenarioId: 's', actorId: 'clock-patient', responseText: f.spoken, runnerConversationTurn: 1,
        waveformSha256: 'a'.repeat(64), cueSha256: 'b'.repeat(64), buffer: { duration: nativeSeconds, sampleRate: 22050, length: 317009 },
        cues: [{phoneme:'PP',atSecond:0,durationSeconds:2},{phoneme:'aa',atSecond:1,durationSeconds:2}],
        decodedSampleRate: 22050, decodedSampleCount: 317009,
      },
    });
    expect(startPreparedActorTurnAudio({ actorId: 'clock-patient', spokenText: f.spoken })).toBe(false);
    expect(f.sources.length).toBe(0);
  });
});

describe('admitted driver refuses malformed overlapping baked intervals', () => {
  it('overlapping cues at 1.25 do not first-match PP', () => {
    const mesh = { morphTargetDictionary: { viseme_sil:0, viseme_PP:1, viseme_aa:2 }, morphTargetInfluences:[0,0,0] };
    const slot = {
      root: { traverse(fn){ fn(mesh); }, userData:{} },
      activeSpeech: { phonemeSequence:['a'], startedAtMs:0, durationMs:14000, bakedCues:[{phoneme:'PP',atSecond:0,durationSeconds:2},{phoneme:'aa',atSecond:1,durationSeconds:2}] },
      mediaPositionSeconds: () => 1.25,
    };
    const r = applyNamedSpeechVisemes(slot, 10000);
    expect(r.activeTargetName).toBe('viseme_sil');
    expect(mesh.morphTargetInfluences[1]).toBe(0);
    expect(mesh.morphTargetInfluences[2]).toBe(0);
  });
});
