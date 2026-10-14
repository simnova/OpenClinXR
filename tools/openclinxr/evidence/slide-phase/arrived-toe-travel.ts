/**
 * Per-toe arrived-phase travel (rest-stance slice, M2 meter).
 *
 * INSTRUMENT ONLY. For each toe, over the record's arrived frames starting at
 * the first one (the turn is complete; only the arrival close still moves
 * feet): max horizontal displacement from the arrived-entry position
 * (`maxM`, the glide a viewer sees — a foot gliding on the floor after the
 * actor stopped) and the consecutive-frame path sum (`sumM`, diagnostic: for
 * the close's monotone blend the two agree; an arc bulge or oscillation would
 * separate them). Both in world XZ; heights never enter.
 */

export type ArrivedToeTravel = {
  /** Index of the first arrived frame, null when the record has none. */
  startFrame: number | null;
  /** Arrived frame count. */
  frames: number;
  leftMaxM: number | null;
  rightMaxM: number | null;
  leftSumM: number | null;
  rightSumM: number | null;
};

type ToeFrame = {
  phase: string | null;
  leftToe: { x: number; y: number; z: number } | null;
  rightToe: { x: number; y: number; z: number } | null;
};

function xzStep(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function toeTravel(
  frames: ToeFrame[],
  arrivedIdx: number[],
  foot: "left" | "right",
): { maxM: number | null; sumM: number | null } {
  if (arrivedIdx.length === 0) return { maxM: null, sumM: null };
  const base = arrivedIdx[0] !== undefined ? frames[arrivedIdx[0]]?.[foot === "left" ? "leftToe" : "rightToe"] : null;
  if (base === null || base === undefined) return { maxM: null, sumM: null };
  let max = 0;
  let sum = 0;
  let prev = base;
  let ok = true;
  for (const i of arrivedIdx) {
    const toe = frames[i]?.[foot === "left" ? "leftToe" : "rightToe"];
    if (toe === null || toe === undefined) {
      ok = false;
      break;
    }
    max = Math.max(max, xzStep(toe, base));
    sum += xzStep(toe, prev);
    prev = toe;
  }
  if (!ok) return { maxM: null, sumM: null };
  return { maxM: max, sumM: sum };
}

export function computeArrivedToeTravel(frames: ToeFrame[]): ArrivedToeTravel {
  const arrivedIdx: number[] = [];
  for (let i = 0; i < frames.length; i += 1) {
    if (frames[i]?.phase === "arrived") arrivedIdx.push(i);
  }
  if (arrivedIdx.length === 0) {
    return { startFrame: null, frames: 0, leftMaxM: null, rightMaxM: null, leftSumM: null, rightSumM: null };
  }
  const left = toeTravel(frames, arrivedIdx, "left");
  const right = toeTravel(frames, arrivedIdx, "right");
  return {
    startFrame: arrivedIdx[0] ?? null,
    frames: arrivedIdx.length,
    leftMaxM: left.maxM,
    rightMaxM: right.maxM,
    leftSumM: left.sumM,
    rightSumM: right.sumM,
  };
}
