import { createRecord } from '@openclinxr/xr-capacity/stage0';
import { attachBoundaries } from '@openclinxr/xr-capacity/stage1';
import { prepareWitnessedDuplexAudio } from '@openclinxr/xr-capacity/stage1-witnessed';
import type { WitnessedAudioHandle } from '@openclinxr/xr-capacity/stage1-witnessed';
import { createWitnessedStage1 } from '@openclinxr/xr-capacity/stage1-witnessed';
import type { WitnessedStage1Metadata } from '@openclinxr/xr-capacity/stage1-witnessed';
const node = document.querySelector('#stage1-witnessed-metadata'); if (!node?.textContent) throw new Error('Missing fixture metadata');
const metadata = JSON.parse(node.textContent) as WitnessedStage1Metadata, query = new URLSearchParams(location.search), nonce = query.get('nonce');
if (metadata.inputClass !== 'synthetic-host' || !nonce || !/^[a-zA-Z0-9-]{16,128}$/.test(nonce)) throw new Error('Explicit synthetic-host metadata and nonce required'); metadata.nonce = nonce;
let resolve: (value: unknown) => void = () => {}, handle: WitnessedAudioHandle | null = null;
const done = new Promise<unknown>(finish => { resolve = finish; }); Object.defineProperty(window, 'witnessedHostDone', { value: done });
const timers = new Set<ReturnType<typeof setTimeout>>(), faults: string[] = [];
const delay = (ms: number) => new Promise<void>(finish => { const timer = setTimeout(() => { timers.delete(timer); finish(); }, ms); timers.add(timer); });
const api = createWitnessedStage1(metadata, 'readiness', document.querySelector<HTMLCanvasElement>('#host-canvas')!, async options => { handle = await prepareWitnessedDuplexAudio(options); return handle; });
api.configure({ mode: 'duplex', slot: { pair: 1, position: 2, nonce }, release: null });
let started = false;
document.querySelector<HTMLButtonElement>('#host-start')!.onclick = () => {
  if (started) return; started = true; const preparation = api.prepare(); // Synchronous trusted context resume before awaiting permission.
  void (async () => {
    const beginMs = performance.now(), fixture = createRecord(metadata, 'readiness'); let boundaries: ReturnType<typeof attachBoundaries> | null = null;
    try {
      const admitted = await preparation; if (!admitted.accepted || !handle) throw new Error(admitted.reason ?? 'Host preparation failed');
      const active: WitnessedAudioHandle = handle; active.notifyXRSessionCreated(); // Explicit HOST control fixture, never an actual XR-session assertion.
      boundaries = attachBoundaries(fixture, active, reason => { faults.push(reason); void api.stop('Synthetic host marker failure'); });
      const wait = (ms: number) => Promise.race([delay(ms), api.closed.then(() => { throw new Error('Controller closed during the declared host fixture'); })]);
      const write = (phase: number) => { const row = new Float64Array(18); row[0] = performance.now(); row[1] = row[0]; row[2] = phase; const index = fixture.store.put(row, new Float32Array(7), new Float32Array(64)); fixture.store.finishRow(index, 0, 0); return row[0]; };
      const readyAtMs = performance.now(); await wait(1000); const warmupReceiptMs = write(1); await wait(10000); const sampleStartReceiptMs = write(2); await wait(60005); const sampleEndReceiptMs = write(2); await boundaries.drain();
      await wait(Math.max(0, 75000 - (performance.now() - readyAtMs))); boundaries.stop(); await api.stop('Explicit synthetic host fixture complete'); const record = await api.closed;
      resolve({ schema: 'quest-stage1-witnessed-host-fixture.v1', scope: 'Synthetic THREE boundary rows/control only; no actual XR callbacks, pose, render or physical candidate', actualXR: false, syntheticSessionNotify: true, beginMs, readyAtMs, finishedMs: performance.now(), warmupReceiptMs, sampleStartReceiptMs, sampleEndReceiptMs, graphLifetimeObservedMs: record.audio?.timing.stoppedMs !== null && record.audio?.timing.stoppedMs !== undefined && record.audio.preparation.graphActivatedMs !== null ? record.audio.timing.stoppedMs - record.audio.preparation.graphActivatedMs : null, boundaries: boundaries.snapshot(), syntheticRows: fixture.store.snapshot(), record, faults, remainingFixtureTimers: timers.size });
    } catch (error) { faults.push(String(error)); boundaries?.stop(); for (const timer of timers) clearTimeout(timer); timers.clear(); await api.stop('Host fixture failed'); resolve({ schema: 'quest-stage1-witnessed-host-fixture.v1', actualXR: false, syntheticSessionNotify: true, failed: true, faults, record: await api.closed, remainingFixtureTimers: timers.size }); }
  })();
};
