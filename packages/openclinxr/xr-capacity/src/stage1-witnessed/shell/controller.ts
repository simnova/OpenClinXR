import { createRecord } from '../../stage0/record.js';
import type { Admission } from '../../stage0/shell.js';
import type { WitnessedAudioHandle, DuplexAudioOwnership, WitnessedAudioRecord, PrepareWitnessedAudioOptions } from '../audio/types.js';
import { gradeWitnessedRun } from '../grading/index.js';
import { normalizeAudioSettings } from '../../stage1/grading/audio.js';
import type { WitnessedStage1Record } from '../grading/types.js';
import { attachBoundaries } from '../../stage1/shell/boundary.js';
import { createXrLifecycle } from '../../stage1/shell/xr.js';
import type { MediaAdmission, WitnessedStage1Configuration, WitnessedStage1Metadata } from './types.js';
type Prepare = (options: PrepareWitnessedAudioOptions) => Promise<WitnessedAudioHandle>;
const emptyOwnership = (): DuplexAudioOwnership => ({ factoryInvoked: false, created: { tracks: 0, contexts: 0, nodes: 0, ports: 0, oscillators: 0 }, remaining: { tracks: 0, contexts: 0, nodes: 0, ports: 0, oscillators: 0 } });
export function createWitnessedStage1(metadata: WitnessedStage1Metadata, purpose: 'readiness' | 'cohort', canvas: HTMLCanvasElement, prepareAudio: Prepare, onClosed: () => void = () => {}) {
  const data = createRecord(metadata, purpose); const mediaAbort = new AbortController(); let configuration: WitnessedStage1Configuration | null = null; let audio: WitnessedAudioHandle | null = null; let audioRecord: WitnessedAudioRecord | null = null; let boundary: ReturnType<typeof attachBoundaries> | null = null;
  let mediaRequested = false; let mediaReady = false; let xrRequested = false; let stopping = false; let explicitStop = false; let final: WitnessedStage1Record | null = null; let finalizing: Promise<void> | null = null;
  let resolveClosed: (record: WitnessedStage1Record) => void = () => {}; const closed = new Promise<WitnessedStage1Record>(done => { resolveClosed = done; });
  const fail = (reason: string) => { if (!data.record.failureReasons.includes(reason)) data.record.failureReasons.push(reason); void halt(reason, true); };
  async function finalize() {
    if (finalizing) return finalizing;
    finalizing = (async () => {
      if (mediaRequested) await api.mediaAdmission;
      boundary?.stop(); await boundary?.drain();
      if (audio) { try { audioRecord = await audio.stop(); } catch (error) { data.record.failureReasons.push(`Audio drain: ${String(error)}`); audioRecord = audio.snapshot(); } }
      mediaAbort.abort(); await boundary?.drain();
      if (audioRecord?.outcome === 'failed') data.record.failureReasons.push(`Audio failure: ${audioRecord.reason ?? 'failed'}`);
      const cfg = configuration ?? { mode: 'off' as const, slot: { pair: 1 as const, position: 1 as const, nonce: metadata.nonce }, release: null };
      final = { schema: 'quest-stage1-witnessed-record.v1', mode: cfg.mode, slot: cfg.slot, pageTimeOriginMs: performance.timeOrigin, xr: { ...data.record, frames: data.store.snapshot(), storage: data.store.info() }, audio: audioRecord, audioOwnership: audioRecord ? structuredClone(audioRecord.ownership) : emptyOwnership() };
      if (cfg.release && purpose === 'cohort') { const result = gradeWitnessedRun(final, cfg.release); if (!result.valid || result.audio?.functionalPass !== true) for (const reason of result.reasons) if (!final.xr.failureReasons.includes(reason)) final.xr.failureReasons.push(reason); }
      if (final.xr.failureReasons.length) { final.xr.status = explicitStop ? 'stopped' : 'failed'; final.xr.phase = final.xr.status; }
      resolveClosed(structuredClone(final)); onClosed();
    })(); return finalizing;
  }
  const xr = createXrLifecycle(data, purpose, canvas, () => audio?.notifyXRSessionCreated(), () => { queueMicrotask(() => { void finalize(); }); });
  async function halt(reason: string, technical: boolean) { if (final) return; stopping = true; if (!technical) explicitStop = true; if (!mediaReady || technical) mediaAbort.abort(); await xr.stop(reason, technical); await finalize(); }
  const api = {
    identity: Object.freeze({ ...data.record.identity }), closed,
    mediaAdmission: Promise.resolve<MediaAdmission>({ accepted: false, mode: 'off', readyAt: null, reason: 'not-prepared', audioConfigHash: null }),
    admission: Promise.resolve<Admission>({ accepted: false, admittedAt: null, watchdogDeadline: null, measurementStarted: false, phase: 'ready', reason: 'not-started' }),
    configure(options: WitnessedStage1Configuration) {
      if (configuration || mediaRequested || xrRequested) throw new Error('Configure exactly once before media preparation');
      if (options.slot.nonce !== metadata.nonce || ![1,2,3].includes(options.slot.pair) || ![1,2].includes(options.slot.position) || !['off','duplex'].includes(options.mode)) throw new Error('Invalid exact slot/mode/nonce');
      if (purpose === 'cohort' && !options.release) throw new Error('Cohort requires prospectively bound release');
      if (options.release) { const release = options.release; if (release.schema !== 'quest-stage1-witnessed-release.v1' || release.identity.bundleSha256 !== metadata.bundleSha256 || release.identity.protocolSha256 !== metadata.protocolSha256 || release.identity.sceneManifestSha256 !== metadata.sceneManifestSha256 || release.audioConfigSha256 !== metadata.audioConfigSha256 || release.workletSha256 !== metadata.workletSha256 || release.witnessWorkletSha256 !== metadata.witnessWorkletSha256 || !release.slots.some(s => s.pair === options.slot.pair && s.position === options.slot.position && s.nonce === options.slot.nonce && s.mode === options.mode)) throw new Error('Release source/config/scheduled slot mismatch'); data.record.releaseId = release.releaseId; }
      configuration = structuredClone(options); data.event('configured', `${options.mode};pair=${options.slot.pair};position=${options.slot.position}`);
    },
    prepare() {
      if (mediaRequested) return api.mediaAdmission; mediaRequested = true;
      api.mediaAdmission = (async (): Promise<MediaAdmission> => {
        try {
          if (!configuration || stopping) throw new Error('Explicit configuration required before preparation');
          if (configuration.mode === 'duplex') {
            const pending = prepareAudio({ signal: mediaAbort.signal, runNonce: metadata.nonce, workletUrl: new URL(metadata.workletFile, location.href).href, expectedWorkletSha256: metadata.workletSha256, witnessWorkletUrl: new URL(metadata.witnessWorkletFile, location.href).href, expectedWitnessWorkletSha256: metadata.witnessWorkletSha256, inputClass: metadata.inputClass, onFault: fail });
            const prepared = await pending; if (stopping || mediaAbort.signal.aborted) { audioRecord = await prepared.stop('Late media preparation after stop'); throw new Error('Media preparation completed after stop'); }
            audio = prepared; audioRecord = audio.snapshot(); if (audioRecord.source.configSha256 !== metadata.audioConfigSha256 || audioRecord.source.workletSha256 !== metadata.workletSha256 || audioRecord.source.witnessWorkletSha256 !== metadata.witnessWorkletSha256) throw new Error('Prepared audio config/worklet identity mismatch');
            if (configuration.release) { const expected = configuration.release.effectiveAudio; const stable = (value: MediaTrackSettings) => JSON.stringify(Object.fromEntries(Object.entries(normalizeAudioSettings(value)).sort(([a],[b]) => a.localeCompare(b)))); if (audioRecord.actual.sampleRate !== expected.sampleRate || !audioRecord.actual.trackSettings || stable(audioRecord.actual.trackSettings) !== stable(expected.trackSettings)) throw new Error('Prepared effective audio configuration differs from released condition'); }
          }
          mediaReady = true; const readyAt = audio?.readyMs ?? performance.now(); data.event('media-ready', `${configuration.mode};actual work acknowledged before XR`); return { accepted: true, mode: configuration.mode, readyAt, reason: null, audioConfigHash: audioRecord?.source.configSha256 ?? null };
        } catch (error) { const candidate = (error as { record?: WitnessedAudioRecord })?.record; if (candidate?.schema === 'quest-stage1-witnessed-audio.v1') audioRecord = candidate; data.record.failureReasons.push(`Media preparation: ${String(error)}`); void xr.stop('Media preparation failed', true); return { accepted: false, mode: configuration?.mode ?? 'off', readyAt: null, reason: String(error), audioConfigHash: audioRecord?.source.configSha256 ?? null }; }
      })(); return api.mediaAdmission;
    },
    start() { if (xrRequested) return api.admission; xrRequested = true; if (!configuration || !mediaReady || stopping) { fail('XR requires completed explicit media preparation'); return api.admission; } boundary = attachBoundaries(data, audio, fail); api.admission = xr.start(configuration.release); return api.admission; },
    stop: (reason = 'Explicit Stage1 stop') => halt(reason, false),
    snapshot() { if (!final) throw new Error('Final snapshot only after stage1.closed'); return structuredClone(final); },
    boundarySnapshot: () => { if (!final) throw new Error('Boundary harvest only after closure'); return boundary?.snapshot() ?? []; },
  };
  return api;
}
