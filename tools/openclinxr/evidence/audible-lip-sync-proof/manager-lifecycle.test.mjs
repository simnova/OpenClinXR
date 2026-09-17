/** Producer manager lifecycle controls. Original clock/player assertions stay in their suites. */
import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
import {
  installPreparedActorAudioRuntime,
  registerPreparedActorAudioEntry,
  startPreparedActorTurnAudio,
  pausePreparedActorTurnAudio,
  resumePreparedActorTurnAudio,
  syncPreparedActorAudio,
} from '../../../../apps/ui-xr/src/prepared-actor-audio.ts';
import {applyNamedSpeechVisemes} from '../../../../packages/openclinxr/xr-dialogue/dist/index.js';
import {Group,Mesh,Line,PerspectiveCamera} from 'three';
import {createHumanoidEmotionExpressionState,updateGeneratedHumanoidAnimations} from '../../../../packages/openclinxr/xr-humanoid-animation/dist/index.js';

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
  beforeEach(()=>vi.stubGlobal('window',{})); afterEach(()=>vi.unstubAllGlobals());
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

  it('live stop refusal fails closed without creating a replacement source', () => {
    const f = fakeRuntime();
    expect(startPreparedActorTurnAudio({ actorId: 'clock-patient', spokenText: f.spoken })).toBe(true);
    const first = f.slot.activeSpeech;
    f.sources[0].stop = () => false;
    expect(startPreparedActorTurnAudio({ actorId: 'clock-patient', spokenText: f.spoken })).toBe(false);
    expect(f.sources.length).toBe(1);
    expect(f.slot.activeSpeech).toBe(first);
  });

  it('three same-actor starts own distinct generations and late end cannot clear the live one or actorB', () => {
    const a = fakeRuntime();
    const slotB = { root: { userData: {}, traverse() {} }, activeSpeech: undefined };
    const spokenB = 'actor b';
    installPreparedActorAudioRuntime({
      getSlot: (id) => id === 'actor-B' ? slotB : a.slot,
      triggerDialogue: (ctx) => {
        const slot = ctx.actorId === 'actor-B' ? slotB : a.slot;
        slot.activeSpeech = { text: ctx.spokenText, phonemeSequence: ['a'], startedAtMs: 0, durationMs: 1000, bakedCues: cues };
      },
      context: a.context, destination: {},
      entry: {
        scenarioId: 's', actorId: 'clock-patient', responseText: a.spoken, runnerConversationTurn: 1,
        waveformSha256: 'a'.repeat(64), cueSha256: 'b'.repeat(64), buffer: { duration: nativeSeconds, sampleRate: 22050, length: 317009 },
        cues, decodedSampleRate: 22050, decodedSampleCount: 317009,
      },
    });
    registerPreparedActorAudioEntry({
      scenarioId: 's', actorId: 'actor-B', responseText: spokenB, runnerConversationTurn: 1,
      waveformSha256: 'a'.repeat(64), cueSha256: 'b'.repeat(64), buffer: { duration: nativeSeconds, sampleRate: 22050, length: 317009 },
      cues, decodedSampleRate: 22050, decodedSampleCount: 317009,
    });
    const gens = [];
    expect(startPreparedActorTurnAudio({ actorId: 'clock-patient', spokenText: a.spoken })).toBe(true);
    gens.push(a.slot.root.userData.openClinXrPreparedGeneration);
    const firstSource = a.sources[0];
    expect(startPreparedActorTurnAudio({ actorId: 'clock-patient', spokenText: a.spoken })).toBe(true);
    gens.push(a.slot.root.userData.openClinXrPreparedGeneration);
    expect(startPreparedActorTurnAudio({ actorId: 'clock-patient', spokenText: a.spoken })).toBe(true);
    gens.push(a.slot.root.userData.openClinXrPreparedGeneration);
    expect(new Set(gens).size).toBe(3);
    expect(startPreparedActorTurnAudio({ actorId: 'actor-B', spokenText: spokenB })).toBe(true);
    const live = a.slot.activeSpeech;
    const other = slotB.activeSpeech;
    firstSource.onended();
    syncPreparedActorAudio(20000);
    expect(a.slot.activeSpeech).toBe(live);
    expect(slotB.activeSpeech).toBe(other);
  });

  it('manager resume starts at held offset and public loop stays alive at media 9', () => {
    const root = new Group(), actorSlot = new Group(); actorSlot.add(root);
    const slot = {
      actorId: 'clock-patient', assetId: 'clock-fixture', root, actorSlot,
      baseX:0,baseY:0,baseZ:0,baseScaleX:1,baseScaleY:1,baseScaleZ:1,baseRotationY:0,phaseOffsetMs:0,
      mouthCue:new Mesh(),gazeCue:new Line(),eyeFocusCue:new Group(),expressionCue:new Group(),
      emotionExpression:createHumanoidEmotionExpressionState({deterministicClock:true}),sourceComparatorFreezeEnabled:false,
    };
    const spoken = 'clock fixture';
    const sources = [];
    const context = {
      currentTime: 10, state: 'running', sampleRate: 22050, async resume() {},
      createBufferSource() {
        const source = { playbackRate:{value:1}, buffer:null, starts:[], stops:0, connect() {}, start(when, offset){ this.starts.push([when, offset]); }, stop(){ this.stops += 1; }, onended:null };
        sources.push(source); return source;
      },
    };
    installPreparedActorAudioRuntime({
      getSlot: () => slot,
      triggerDialogue: (ctx) => { slot.activeSpeech = { actorId: slot.actorId, assetId: slot.assetId, text: ctx.spokenText, emotion:'neutral', emotionContext:{source:'explicit_fixture',baselineMood:'neutral',cueIds:[],emotion:'neutral'}, gazeTargetKind:'learner_camera', gazeTargetActorId:null, phonemeSequence:['a'], visemeSequence:['a'], startedAtMs:0, durationMs:1000, bakedCues:cues }; },
      context, destination: {},
      entry: { scenarioId:'s', actorId:'clock-patient', responseText:spoken, runnerConversationTurn:1, waveformSha256:'a'.repeat(64), cueSha256:'b'.repeat(64), buffer:{duration:nativeSeconds,sampleRate:22050,length:317009}, cues, decodedSampleRate:22050, decodedSampleCount:317009 },
    });
    expect(startPreparedActorTurnAudio({ actorId:'clock-patient', spokenText:spoken })).toBe(true);
    const first = slot.activeSpeech;
    context.currentTime = 16.25;
    expect(pausePreparedActorTurnAudio('clock-patient')).toBe(true);
    context.currentTime = 20;
    expect(resumePreparedActorTurnAudio('clock-patient')).toBe(true);
    const resumed = slot.activeSpeech;
    expect(resumed).not.toBe(first);
    expect(sources.at(-1).starts[0][1]).toBeCloseTo(6.25, 5);
    expect(resumed.durationMs).toBe(nativeSeconds * 1000);
    expect(resumed.originalWallStartedAtMs).toBeDefined();
    expect(Object.getOwnPropertyDescriptor(resumed,'originalWallStartedAtMs').writable).toBe(false);
    const ctx = { slots:[slot], slotsByActorId:new Map([[slot.actorId,slot]]), actorSlotsByActorId:new Map([[slot.actorId,actorSlot]]),
      virtualDeviceSlotsByActorId:new Map(),activeVirtualDeviceSpeechByActorId:new Map(),runtimePatientActorId:()=>slot.actorId,
      runtimeFamilyActorId:()=>'',runtimeClinicalTeamActorId:()=>'',runtimeActorRole:()=>undefined,isPediatricAsthmaRuntimeScenario:()=>false,
      shouldUseCleanHumanoidSourceComparatorCapture:()=>false,humanoidDialogueDurationMs:()=>2000,applyIdlePosture:()=>{},applyRolePosture:()=>{},
      seatedClipPerforming:()=>false,resolveGazeTargetWorld:(_s,c)=>c.position.clone(),normalizeLiveEmotion:()=> 'neutral',liveTurnForCue:()=>undefined,
      bundleTurnsForScenario:()=>[],runtimeTurnForTraceTag:()=>undefined,isDeterministicCaptureClock:()=>true,isMouthGazePoseReviewCaptureMode:()=>false,
      selectedCaptureMode:()=>'',selectedHumanoidSourceComparator:()=>null,scenarioIdForEvidence:()=> 'clock-unit',comparatorScenarioId:()=> 'clock-unit',
      assetPathForSlot:()=> 'fixture.glb',animationPlaybackForSlot:()=>undefined,morphTargetAppliedTargetCount:()=>0,
      visemeTimelineComparatorEvidencePresent:()=>false,emotionTransitionCuePresent:()=>false,currentSpeechEvidence:()=>undefined,recordActingCueEvidence:()=>{} };
    syncPreparedActorAudio(20000);
    expect(20000 - resumed.startedAtMs).toBeCloseTo(6250, 5);
    context.currentTime = 22.75;
    syncPreparedActorAudio(25000);
    updateGeneratedHumanoidAnimations(ctx, 1/60, 25000, new PerspectiveCamera());
    expect(slot.activeSpeech).toBe(resumed);
    expect(25000 - resumed.startedAtMs).toBeCloseTo(9000, 5);
    expect(resumed.durationMs).toBe(nativeSeconds * 1000);
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
