/** Offline Q5 contracts using synthetic host fixtures; no browser, microphone or Quest evidence. */
import assert from "node:assert/strict";
import { createContext, runInContext } from "node:vm";
import { pathToFileURL } from "node:url";
import { createRecord, gradeRun, gradeCohort, initializeSession, xrPixelProof, type Stage0Profile } from "@openclinxr/xr-capacity/stage0";
import { AudioWindowRecorder, DUPLEX_WORKLET_SOURCE, prepareDuplexAudio, AudioPreparationError } from "@openclinxr/xr-capacity/stage1";
import { WitnessRecorder, WITNESS_WORKLET_SOURCE, prepareWitnessedDuplexAudio, WitnessedAudioPreparationError } from "@openclinxr/xr-capacity/stage1-witnessed";
import { gradeControllerCohort, INVENTORY, PROTOCOL_SHA256, CLARIFICATIONS_SHA256, PLAN_SHA256, type ControllerMetadata, type ControllerRelease } from "@openclinxr/xr-capacity/controller";

type WireMessage = { type: string; sequence?: number; rows?: Float64Array };
type Processor = { port: { onmessage(event: { data: unknown }): void }; process(input: Float32Array[][], output: Float32Array[][]): boolean };
function workletReports(source: string): Float64Array[] {
  const messages: WireMessage[] = []; let Constructor: (new (options: unknown) => Processor) | undefined;
  class HostProcessor { port = { onmessage: (_event: { data: unknown }) => {}, postMessage: (message: WireMessage) => { messages.push(structuredClone(message)); } }; }
  const scope = createContext({ AudioWorkletProcessor: HostProcessor, Float32Array, Float64Array,
    sampleRate: 48000, currentFrame: 0, currentTime: 0,
    registerProcessor: (_name: string, value: typeof Constructor) => { Constructor = value; } });
  runInContext(source, scope); assert.ok(Constructor, "exported worklet must register a processor");
  const processor = new Constructor({ processorOptions: { mode: "input" } }); let acknowledged = 0;
  const step = (frame: number) => {
    scope["currentFrame"] = frame; scope["currentTime"] = frame / 48000;
    processor.process([[new Float32Array(128).fill(.001)]], [[new Float32Array(128)]]);
    for (; acknowledged < messages.length; acknowledged++) {
      const message = messages[acknowledged]!;
      if (message.type === "report") processor.port.onmessage({ data: { type: "ack", sequence: message.sequence } });
    }
  };
  for (let i = 0; i < 400; i++) step(i * 128);
  processor.port.onmessage({ data: { type: "stop" } }); step(400 * 128);
  assert.ok(messages.some(message => message.type === "final"), "worklet must drain a terminal receipt");
  return messages.filter(message => message.type === "report").map(message => {
    assert.ok(message.rows instanceof Float64Array); return message.rows;
  });
}

export async function validateLifecycleContract(): Promise<{ hostOnly: true; checks: string[] }> {
  const checks: string[] = [];
  for (const [label, source, makeCollector, width, offset] of [
    ["duplex", DUPLEX_WORKLET_SOURCE, () => new AudioWindowRecorder(), 21, 3],
    ["witness", WITNESS_WORKLET_SOURCE, () => new WitnessRecorder(), 12, 1],
  ] as const) {
    const batches = workletReports(source), collector = makeCollector();
    for (const batch of batches) assert.equal(collector.acceptBatch(batch), true, `${label} actual VM wire accepted`);
    const windows = collector.snapshot().windows;
    assert.equal(windows.reduce((total, window) => total + window.frames, 0), 400 * 128);
    assert.equal(windows[0]?.partial, false);
    assert.equal(windows.at(-1)?.partial, true);
    assert.equal(collector.acceptBatch(new Float64Array([0])), false, "malformed width must fail closed");
    const bounded = makeCollector(), row = batches[0]!.slice(0, width), frames = row[offset + 1]! - row[offset]!;
    for (let i = 0; i < 512; i++) {
      row[0] = i; row[offset] = i * frames; row[offset + 1] = (i + 1) * frames;
      assert.equal(bounded.acceptBatch(row), true);
    }
    const first = structuredClone(bounded.snapshot().windows[0]); row[0] = 512;
    assert.equal(bounded.acceptBatch(row), false, "bounded storage cannot overwrite row zero");
    assert.deepEqual(bounded.snapshot().windows[0], first);
    checks.push(`${label}: actual-worklet wire, complete/tail windows, malformed rows, fixed capacity`);
  }

  const hash = "a".repeat(64), metadata = { bundleSha256: hash, protocolSha256: hash, sceneManifestSha256: hash,
    nonce: "offline-lifecycle-only", protocol: {}, foveationRequested: 1, rendererVersion: "host-fixture", sourceFiles: {} };
  const data = createRecord(metadata, "cohort");
  const profile: Stage0Profile = { selectedTargetHz: 90, targetSelection: "target-update-accepted", supportedFrameRates: [90],
    rawSessionFrameRate: 90, actualSessionFrameRate: 90, layerKind: "XRWebGLLayer", layerWidth: 2, layerHeight: 1,
    viewports: [[0, 0, 1, 1], [1, 0, 1, 1]], foveationRequested: 1, foveationReadback: 1, framebufferScaleRequested: 1,
    contextAttributes: {}, configuredSamples: 0, boundFramebufferSamples: 0, enabledFeatures: ["local-floor"], availabilityMask: [] };
  const release = { releaseId: "synthetic-offline", identity: metadata, profile, emptyBaseline: { geometries: 0, textures: 0, programs: 0 } };
  assert.equal(gradeRun(data.record, release).candidatePass, false);
  assert.equal(gradeCohort([], release).candidatePass, false);
  assert.equal(data.store.put(new Float64Array(18), new Float32Array(7), new Float32Array(64)), 0);
  data.store.release(); assert.deepEqual(data.store.snapshot(), []);
  assert.equal(data.store.put([], [], []), -1);
  const abort = new AbortController(); abort.abort(); let nativeCalls = 0;
  const renderer = { xr: { setSession: async () => { nativeCalls++; } } } as unknown as Parameters<typeof initializeSession>[0];
  await assert.rejects(initializeSession(renderer, {} as Parameters<typeof initializeSession>[1], () => {},
    { signal: abort.signal, stopped: () => true, lateCleanup: () => {} }), /stopped/i);
  assert.equal(nativeCalls, 0);
  const noTarget = { getContext: () => ({}), xr: { getCamera: () => ({ cameras: [] }) }, getRenderTarget: () => null } as unknown as Parameters<typeof xrPixelProof>[0];
  assert.match(xrPixelProof(noTarget, 0).reason ?? "", /viewport/);
  checks.push("stage0: incomplete grades fail closed, released storage, cancelled setup, missing proof target");
  const controllerMetadata: ControllerMetadata = { ...metadata, protocolSha256: PROTOCOL_SHA256,
    semanticClarificationsSha256: CLARIFICATIONS_SHA256, planSha256: PLAN_SHA256, inventorySha256: hash,
    clarifications: {}, plan: { slots: [], readiness: { nonce: metadata.nonce } }, dependencyFiles: {}, inventory: INVENTORY };
  const controllerRelease: ControllerRelease = { schema: "quest-controller-release.v1", releaseId: "offline-incomplete",
    identity: controllerMetadata, profile, emptyBaseline: release.emptyBaseline, onPrograms: 3, descriptors: [],
    environment: { userAgent: "synthetic-host", platform: "offline", rendererVersion: "host-fixture", secureContext: false } };
  const emptyControllerCohort = gradeControllerCohort([], controllerRelease, controllerMetadata);
  assert.equal(emptyControllerCohort.candidatePass, false);
  assert.equal(emptyControllerCohort.modes.every(mode => mode.pass === false), true);
  assert.equal(emptyControllerCohort.pairs.every(pair => pair.onMinusOffCpuP95Ms === null), true);
  checks.push("controller: empty fixed-slot cohort cannot pass or fabricate paired measurements");

  const options = { signal: abort.signal, runNonce: "offline-cancelled", workletUrl: "https://offline.invalid/worklet.js", expectedWorkletSha256: hash };
  await assert.rejects(prepareDuplexAudio(options), (error: unknown) => error instanceof AudioPreparationError
    && Object.values(error.record.ownership.remaining).every(count => count === 0));
  await assert.rejects(prepareWitnessedDuplexAudio({ ...options, witnessWorkletUrl: "https://offline.invalid/witness.js", expectedWitnessWorkletSha256: hash }),
    (error: unknown) => error instanceof WitnessedAudioPreparationError && Object.values(error.record.ownership.remaining).every(count => count === 0));
  checks.push("audio preparation: pre-cancelled operations retain zero owned resources");
  return { hostOnly: true, checks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await validateLifecycleContract(), null, 2));
}
