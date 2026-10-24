import type { Stage0Frame } from "./types.js";
const COLUMNS = 18; const POSE_COLUMNS = 71;
/** Fixed storage; no JSON, network, dynamic sample objects or growing arrays in a frame callback. */
export function createFrameStore(maximumFrames = 14000) {
  const values = new Float64Array(maximumFrames * COLUMNS);
  const poses = new Float32Array(maximumFrames * POSE_COLUMNS);
  let count = 0; let overflow = false; let released = false;
  return {
    get count() { return count; },
    put(row: ArrayLike<number>, head: ArrayLike<number>, viewMatrices: ArrayLike<number>) {
      if (count >= maximumFrames || released) { overflow = true; return -1; }
      const index = count++; const at = index * COLUMNS;
      for (let i = 0; i < COLUMNS; i++) values[at + i] = row[i] ?? 0;
      for (let i = 0; i < 7; i++) poses[index * POSE_COLUMNS + i] = head[i] ?? 0;
      for (let i = 0; i < 64; i++) poses[index * POSE_COLUMNS + 7 + i] = viewMatrices[i] ?? 0;
      return index;
    },
    finishRow(index: number, collectorMs: number, observedBodyMs: number) { if (index >= 0) { values[index * COLUMNS + 16] = collectorMs; values[index * COLUMNS + 17] = observedBodyMs; } },
    snapshot(): Stage0Frame[] {
      if (released) return [];
      return Array.from({ length: count }, (_, i) => {
        const v = values.subarray(i * COLUMNS, (i + 1) * COLUMNS); const p = poses.subarray(i * POSE_COLUMNS, (i + 1) * POSE_COLUMNS);
        return { receipt: v[0]!, xrTimestamp: v[1]!, phase: v[2]!, updateMs: v[3]!, submissionMs: v[4]!, poseValid: v[5] === 1, viewCount: v[6]!, presenting: v[7] === 1, visible: v[8] === 1, contextLost: v[9] === 1, renderCalls: v[10]!, triangles: v[11]!, programs: v[12]!, geometries: v[13]!, textures: v[14]!, stateFrame: v[15]!, collectorMs: v[16]!, observedBodyMs: v[17]!, head: Array.from(p.subarray(0, 7)), viewMatrices: Array.from(p.subarray(7)) };
      });
    },
    info() { return { maximumFrames, preallocatedBytes: values.byteLength + poses.byteLength, retainedFrames: count, overflow, released }; },
    release() { values.fill(0); poses.fill(0); released = true; },
  };
}
export function clockResolution(read: () => number = performance.now.bind(performance)) {
  let prior = read(); let minimum = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 2048; i++) { const next = read(); if (next > prior) minimum = Math.min(minimum, next - prior); prior = next; }
  return { resolutionMs: Number.isFinite(minimum) ? minimum : null, diagnosticReads: 2049 };
}
