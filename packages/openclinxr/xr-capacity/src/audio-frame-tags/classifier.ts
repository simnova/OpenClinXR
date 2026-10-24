import {CONFIG, type Classification, type NodeRecord} from './types.js';

function validRangeAt(record: NodeRecord, offset: number) {
  const first = record.tuples[offset + 4]!, last = record.tuples[offset + 5]!;
  return first > 0 && last >= first && record.tuples[offset + 6] === last - first + 1;
}
function extent(record: NodeRecord | null): [number, number] | null {
  let first = Infinity, last = -Infinity;
  if(record) for(let i=0;i<record.tuples.length;i+=CONFIG.tupleWidth) if(validRangeAt(record,i)) {
    first=Math.min(first,record.tuples[i+4]!);last=Math.max(last,record.tuples[i+5]!);
  }
  return first===Infinity?null:[first,last];
}
function debt(record: NodeRecord | null) {
  return record?.firstTag !== null && record?.firstTag !== undefined && record.lastTag !== null
    ? record.lastTag + record.lastQuantum - record.firstTag - record.frames : null;
}
function malformed(record: NodeRecord) {
  if (!Number.isSafeInteger(record.callbacks) || record.callbacks < 0 || record.frames < 0
    || record.callbacks===0&&record.frames!==0
    || record.tupleRows > record.tupleLimit || record.tuples.length !== record.tupleRows * CONFIG.tupleWidth) return true;
  return record.tuples.some(n => !Number.isFinite(n));
}
export function classify(producer: NodeRecord | null, checker: NodeRecord | null): Classification {
  const nodes = [producer, checker].filter((n): n is NodeRecord => n !== null);
  let strictFailure = nodes.some(n => malformed(n) || n.tagGaps > 0 || n.invalidClock > 0);
  for (const n of nodes) for (let i = CONFIG.tupleWidth; i < n.tuples.length; i += CONFIG.tupleWidth) {
    if (n.tuples[i + 1] !== n.tuples[i - CONFIG.tupleWidth + 1]! + n.tuples[i - CONFIG.tupleWidth + 2]!) strictFailure = true;
  }
  // Sum actual saved range intersections, not the broad first/last envelope.
  let intersection = 0;
  if(producer&&checker)for(let i=0;i<producer.tuples.length;i+=CONFIG.tupleWidth)if(validRangeAt(producer,i))for(let j=0;j<checker.tuples.length;j+=CONFIG.tupleWidth)if(validRangeAt(checker,j))
    intersection+=Math.max(0,Math.min(producer.tuples[i+5]!,checker.tuples[j+5]!)-Math.max(producer.tuples[i+4]!,checker.tuples[j+4]!)+1);
  const exercised = !!producer && !!checker && producer.callbacks > 0 && checker.callbacks >= CONFIG.preludeCallbacks
    && producer.positiveSamples > 0 && checker.positiveSamples > 0 && intersection > 0;
  const contentFailure = !!checker && (checker.missingPrefix > 0 || checker.invalidSamples > 0
    || checker.positiveSamples>0&&checker.firstId!==1
    || checker.firstIdCallback !== null && checker.firstIdCallback < CONFIG.preludeCallbacks
    || checker.skippedIds > 0 || checker.duplicateOrBackwardIds > 0 || checker.zerosAfterFirstId > 0)
    || !!producer?.ordinalOverflow;
  const reasons = [];
  if (strictFailure) reasons.push('Strict global-tag/actual-quantum continuity failed and remains latched.');
  if (contentFailure) reasons.push('Observed generated input has missing, zero, invalid, repeated or out-of-order IDs.');
  if (!exercised) reasons.push('No positive saved cross-node ID intersection or required callback observations.');
  return {
    globalTagContinuity: strictFailure ? 'FAIL' : exercised ? 'PASS' : 'UNEXERCISED',
    observedContentContinuity: contentFailure ? 'FAIL' : exercised ? 'PASS' : 'UNEXERCISED',
    callbackCoverage: exercised ? 'EXERCISED' : 'UNEXERCISED', savedIdIntersection: intersection,
    producerIdRange: extent(producer), checkerIdRange: extent(checker),
    tagSpanDebt: {producer: debt(producer), checker: debt(checker)}, reasons,
    claim: 'Observed software buffers only. Unaccounted global spans do not prove absent callbacks, physical loss, delivery or silence. currentTime shares the currentFrame timeline. Clean new data means nonreproduction under this new graph.',
  };
}
