import type { createRecord } from '../../stage0/record.js';
export type BoundaryLabel = 'warmup-start' | 'sample-start' | 'sample-end';
export interface BoundaryMarker { mark(label: BoundaryLabel, xrReceiptMs: number): Promise<unknown> }
export interface BoundaryObservation { label: BoundaryLabel; xrReceiptMs: number; observedAtMs: number; audio: 'not-applicable' | 'pending' | 'acknowledged' | 'failed'; reason: string | null }
/** Owned-instance decoration only. No change to frozen Stage0 modules or per-frame asynchronous polling. */
export function attachBoundaries(data: ReturnType<typeof createRecord>, marker: BoundaryMarker | null, failed: (reason: string) => void, clock: () => number = () => performance.now()) {
  const original = data.store.put; const observations: BoundaryObservation[] = []; const pending = new Set<Promise<void>>(); let stopped = false; let warmup = false; let start: number | null = null; let end = false;
  const send = (label: BoundaryLabel, receipt: number) => {
    const observation: BoundaryObservation = { label, xrReceiptMs: receipt, observedAtMs: clock(), audio: marker ? 'pending' : 'not-applicable', reason: null }; observations.push(observation);
    if (!marker) return;
    let work: Promise<void>;
    try {
      work = marker.mark(label, receipt).then(() => { observation.audio = 'acknowledged'; }, error => { observation.audio = 'failed'; observation.reason = String(error); if (!stopped) failed(`Audio boundary ${label}: ${String(error)}`); }).finally(() => pending.delete(work)); pending.add(work);
    } catch (error) { observation.audio = 'failed'; observation.reason = String(error); if (!stopped) failed(`Audio boundary ${label}: ${String(error)}`); }
  };
  data.store.put = (row, head, views) => {
    const index = original(row, head, views); if (index < 0 || stopped) return index;
    const phase = row[2]; const receipt = row[0]; if (typeof receipt !== 'number' || !Number.isFinite(receipt)) return index;
    if (!warmup && (phase === 1 || phase === 4)) { warmup = true; send('warmup-start', receipt); }
    if (phase === 2 && start === null) { start = receipt; send('sample-start', receipt); }
    if (phase === 2 && start !== null && !end && receipt - start >= 60000) { end = true; send('sample-end', receipt); }
    return index;
  };
  return { snapshot: () => observations.map(row => ({ ...row })), get pending() { return pending.size; }, async drain() { await Promise.all(Array.from(pending)); }, stop() { stopped = true; data.store.put = original; }, get stopped() { return stopped; } };
}
