import {CONFIG, type NodeRecord, type Role} from './types.js';

const FIELDS = ['callbacks','frames','firstTag','lastTag','firstTime','lastTime','lastQuantum','tagGaps','invalidClock',
  'firstId','lastId','firstIdCallback','missingPrefix','positiveSamples','preludeZeros','activationPrefixZeros',
  'postActivationZeros','zerosAfterFirstId','invalidSamples','skippedIds','duplicateOrBackwardIds',
  'ordinalOverflow','tupleRows','tupleLimit','omittedTuples','nonzeroOutputSamples'] as const;
function encodedLength(value:unknown):number {
  if(value===null)return 4;
  if(typeof value==='number'&&Number.isFinite(value))return String(value).length;
  if(!Array.isArray(value))throw Error('Non-numeric serialization shape');
  let length=2+Math.max(0,value.length-1);for(const item of value)length+=encodedLength(item);return length;
}
export function encodeNodes(producer: NodeRecord | null, checker: NodeRecord | null): string {
  const packed = [producer, checker].map(record => {
    if(record===null)return null;
    const limit=record.role==='checker'?CONFIG.checkerTuples:CONFIG.producerTuples;
    if(record.tupleLimit!==limit||record.tupleRows>limit||record.tuples.length!==record.tupleRows*CONFIG.tupleWidth)throw Error('Tuple cap/shape exceeded');
    const scalars=FIELDS.map(key=>record[key]===null?-1:Number(record[key]));
    if(scalars.some(n=>!Number.isFinite(n))||record.tuples.some(n=>!Number.isFinite(n)))throw Error('Nonfinite numeric snapshot; no coercion permitted');
    return [scalars,record.tuples];
  });
  const length=encodedLength(packed);
  if(length>CONFIG.numericJsonCharacters)throw Error('Numeric serialization cap exceeded BEFORE full allocation; no truncation permitted');
  const result = JSON.stringify(packed);
  if (result.length!==length) throw new Error('Numeric serialization length mismatch');
  return result;
}
export function decodeNodes(payload: string): {producer: NodeRecord | null; checker: NodeRecord | null} {
  if (payload.length > CONFIG.numericJsonCharacters) throw new Error('Numeric payload cap exceeded');
  const packed: unknown = JSON.parse(payload);
  if (!Array.isArray(packed) || packed.length !== 2) throw new Error('Two node slots required');
  const nodes = packed.map((entry: unknown, index) => {
    if (entry === null) return null;
    if (!Array.isArray(entry) || entry.length !== 2 || !Array.isArray(entry[0]) || entry[0].length !== FIELDS.length
      || !Array.isArray(entry[1]) || entry[1].some((n: unknown) => typeof n !== 'number' || !Number.isFinite(n))) throw new Error('Malformed node payload');
    const record: Record<string, unknown> = {role: index === 0 ? 'producer' : 'checker', tuples: entry[1]};
    FIELDS.forEach((key, i) => {
      const n: unknown = entry[0][i];
      if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error('Nonfinite node aggregate');
      record[key] = key==='ordinalOverflow' ? n === 1 : n === -1 && ['firstTag','lastTag','firstTime','lastTime','firstId','lastId','firstIdCallback'].includes(key) ? null : n;
    });
    const role = record['role'] as Role, limit = role === 'checker' ? CONFIG.checkerTuples : CONFIG.producerTuples;
    if (record['tupleLimit'] !== limit || entry[1].length > limit * CONFIG.tupleWidth) throw new Error('Fixed tuple bound mismatch');
    return record as unknown as NodeRecord;
  });
  return {producer: nodes[0]!, checker: nodes[1]!};
}
// Conservatively count ALL listed numeric copies simultaneously. No heap claim.
export const NUMERIC_BOUNDS = Object.freeze({
  tupleBytes: (CONFIG.checkerTuples + CONFIG.producerTuples) * CONFIG.tupleWidth * 8,
  scalarReservationBytes: CONFIG.scalarReservationBytes,
  serializationCharacters: CONFIG.numericJsonCharacters,
  tupleCopyBytes: 4480, twoUtf16StringsBytes: 4096 * 2 * 2, utf8DiskCopyBytes: 4096,
  peakBytes: 4480 * 2 + 4096 * 2 * 2 + 4096 + 2048, limitBytes: CONFIG.numericLimitBytes,
  scalarSlots: {workletAggregates:52,receivedAggregates:52,packedAggregates:52,scratch:32,mainAndDriverMetadata:68},
  scope: 'All listed copies counted concurrently: worklet/transferred tuple buffers4480, explicit tuple-array copy4480, TWO UTF16 numeric JSON strings16384, one UTF8 disk buffer4096, numeric scalars/scratch2048. Not JS/native heap or opaque DevTools internals; no full-payload UI copy.',
});
export function countMetadataScalars(value:unknown):number {
  if(typeof value==='number'||typeof value==='boolean')return 1;
  if(!value||typeof value!=='object')return 0;
  let count=0;for(const key in value)if(Object.hasOwn(value,key))count+=countMetadataScalars((value as Record<string,unknown>)[key]);
  return count;
}
