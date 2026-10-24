export const CONFIG = Object.freeze({
  sampleRate: 48000, preludeCallbacks: 32, checkerTuples: 64, producerTuples: 16,
  tupleWidth: 7, acquisitionTargetMs: 1900, acquisitionMs: 2000, drainMs: 1000, outerMs: 15000,
  maximumOrdinal: 16777215, numericLimitBytes: 32768, numericJsonCharacters: 4096,
  scalarReservationBytes: 2048,
});
export type Role = 'checker' | 'producer';
// [callback ordinal, global tag, actual quantum, cumulative processed frames,
//  first valid ID, last valid ID, valid IDs]; first/last currentTime below.
export interface NodeRecord {
  role: Role; callbacks: number; frames: number; firstTag: number | null;
  lastTag: number | null; firstTime: number | null; lastTime: number | null;
  lastQuantum: number; tagGaps: number; invalidClock: number;
  firstId: number | null; lastId: number | null; firstIdCallback: number | null; missingPrefix: number;
  positiveSamples: number; preludeZeros: number; activationPrefixZeros: number;
  postActivationZeros: number; zerosAfterFirstId: number; invalidSamples: number;
  skippedIds: number; duplicateOrBackwardIds: number; ordinalOverflow: boolean;
  tupleRows: number; tupleLimit: number; omittedTuples: number; tuples: number[];
  nonzeroOutputSamples: number;
}
export interface Classification {
  globalTagContinuity: 'PASS' | 'FAIL' | 'UNEXERCISED';
  observedContentContinuity: 'PASS' | 'FAIL' | 'UNEXERCISED';
  callbackCoverage: 'EXERCISED' | 'UNEXERCISED';
  savedIdIntersection: number; producerIdRange: [number, number] | null;
  checkerIdRange: [number, number] | null;
  tagSpanDebt: Record<Role, number | null>; reasons: string[];
  claim: string;
}
