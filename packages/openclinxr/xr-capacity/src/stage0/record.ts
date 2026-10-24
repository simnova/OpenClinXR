import { clockResolution, createFrameStore } from './recorder.js';
import type { Stage0Metadata, Stage0Record } from './types.js';
export function createRecord(metadata: Stage0Metadata, purpose: Stage0Record['purpose']) {
  const store = createFrameStore();
  const record: Stage0Record = {
    schema: 'quest-stage0-record.v1', identity: { bundleSha256: metadata.bundleSha256, protocolSha256: metadata.protocolSha256, sceneManifestSha256: metadata.sceneManifestSha256, nonce: metadata.nonce }, purpose,
    phase: 'ready', status: 'ready', releaseId: null, profile: null, requestedAt: null, admittedAt: null, watchdogDeadline: null,
    warmupStart: null, sampleStart: null, sampleEnd: null, endedAt: null, frames: [], events: [], failureReasons: [],
    resources: { emptyBefore: null, roomWarm: null, emptyAfter: null, ownerBefore: 0, ownerAfter: 0 }, proofs: { preview: null, afterSample: null },
    cleanup: { sessionEnded: false, rendererDisposed: false, workloadListeners: 0, workloadTimers: 0, controlListeners: 0, controlTimers: 0, animationCallbacks: 0, queries: 0, layerStable: true, roomResourcesDisposed: false },
    clock: { primary: 'performance.now at user animation callback entry', secondary: 'XR supplied rAF timestamp; not receipt or presentation authority', ...clockResolution(), cpuZerosAreQuantized: true }, storage: store.info(),
    gpu: { enabled: false, available: false, elapsedMs: null, reason: 'not-enabled-in-this-low-observer-profile', samples: [], discarded: 0, pending: 0 },
    limitations: ['Recorder overhead is unknown.', 'JS heap bytes, allocation rates and garbage collection are uncollected/unknown; typed-buffer bytes are not total JavaScript memory.', 'Primary receipts enter the user callback after Three internal XR camera preparation; CPU spans exclude that prior library work.', 'Collector span ends after raw store copy; observed body ends there and excludes tail validation and phase-boundary work.', 'Renderer memory fields are counts, not bytes; native/GPU resident bytes are unavailable.', 'Submission spans are JavaScript wall time, not native CPU or GPU execution.', 'No compositor FPS, motion-to-photon, maximum capacity or readiness claim.', 'The fixed report buffers remain owned until page release; they are not workload graphics resources.'],
  };
  const event = (type: string, detail = '') => { if (record.events.length >= 128) throw new Error('Event bound exceeded'); record.events.push({ at: performance.now(), type, detail }); };
  return { record, store, event };
}
