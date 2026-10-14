/**
 * Per-toe arrived-phase travel (rest-stance slice, M2 meter).
 *
 * INSTRUMENT ONLY. Scoped to CLOSE-ACTIVE arrived frames (phase arrived with
 * a labelled stance foot): that is the arrival close's own glide window (the
 * D1 defect). Frames after the close yields (stance unlabelled, double
 * support) belong to the settled correction — a separate, out-of-scope
 * mechanism whose own first-frame snap this meter must not attribute to the
 * close — so they are excluded from the gate quantities and reported only as
 * a full-window diagnostic.
 *
 * Per toe, from the first close-active frame: max horizontal displacement
 * from the arrived-entry position (`maxM`, the glide a viewer sees — a foot
 * gliding on the floor after the actor stopped) and the consecutive-frame
 * path sum (`sumM`, diagnostic: for the close's monotone blend the two agree;
 * an arc bulge or oscillation would separate them). Both in world XZ; heights
 * never enter.
 */

export type ArrivedToeTravel = {
  /** Index of the first close-active arrived frame, null when the record has none. */
  startFrame: number | null;
  /** Close-active arrived frame count. */
  frames: number;
  leftMaxM: number | null;
  rightMaxM: number | null;
  leftSumM: number | null;
  rightSumM: number | null;
  /** Diagnostic: max displacement over ALL arrived frames (includes post-close). */
  leftFullMaxM: number | null;
  rightFullMaxM: number | null;
  /** All-arrived frame count (diagnostic). */
  fullFrames: number;
};

type ToeFrame = {
  phase: string | null;
  stanceFoot: string | null;
  leftToe: { x: number; y: number; z: number } | null;
  rightToe: { x: number; y: number; z: number } | null;
};

function isCloseActive(f: ToeFrame): boolean {
  return f.phase === "arrived" && (f.stanceFoot === "left" || f.stanceFoot === "right");
}

/**
 * The close's own per-frame world-step cap (`ARRIVAL_CLOSE_MAX_STEP_METERS`,
 * toe-local-write.ts: the halving loop guarantees no close frame moves a toe
 * more than this). A larger frame-to-frame XZ step cannot be the close — it
 * is the settled correction's own snap (which the frame module also applies
 * on arrived frames, including while the close runs) — so the close-active
 * window ends before it. Principled boundary, not a fitted threshold.
 */
const CLOSE_STEP_CAP_M = 0.03;

function xzStep(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function toeTravel(
  frames: ToeFrame[],
  idx: number[],
  foot: "left" | "right",
): { maxM: number | null; sumM: number | null } {
  if (idx.length === 0) return { maxM: null, sumM: null };
  const key = foot === "left" ? "leftToe" : "rightToe";
  const first = idx[0] !== undefined ? frames[idx[0]]?.[key] : null;
  if (first === null || first === undefined) return { maxM: null, sumM: null };
  let max = 0;
  let sum = 0;
  let prev = first;
  for (const i of idx) {
    const toe = frames[i]?.[key];
    if (toe === null || toe === undefined) return { maxM: null, sumM: null };
    max = Math.max(max, xzStep(toe, first));
    sum += xzStep(toe, prev);
    prev = toe;
  }
  return { maxM: max, sumM: sum };
}

export function computeArrivedToeTravel(frames: ToeFrame[]): ArrivedToeTravel {
  const fullIdx: number[] = [];
  for (let i = 0; i < frames.length; i += 1) {
    if (frames[i]?.phase === "arrived") fullIdx.push(i);
  }
  // Close-active window: leading run of labelled arrived frames whose every
  // frame-to-frame per-toe XZ step fits the close's own cap.
  const activeIdx: number[] = [];
  for (const i of fullIdx) {
    const f = frames[i] as ToeFrame | undefined;
    if (f === undefined || !isCloseActive(f)) break;
    if (activeIdx.length > 0) {
      const prev = frames[activeIdx[activeIdx.length - 1] as number] as ToeFrame | undefined;
      const stepL =
        f.leftToe !== null && prev?.leftToe !== null && prev?.leftToe !== undefined
          ? xzStep(f.leftToe, prev.leftToe as { x: number; z: number })
          : Number.POSITIVE_INFINITY;
      const stepR =
        f.rightToe !== null && prev?.rightToe !== null && prev?.rightToe !== undefined
          ? xzStep(f.rightToe, prev.rightToe as { x: number; z: number })
          : Number.POSITIVE_INFINITY;
      if (!(stepL <= CLOSE_STEP_CAP_M && stepR <= CLOSE_STEP_CAP_M)) break;
    } else if (f.leftToe === null || f.rightToe === null) {
      break;
    }
    activeIdx.push(i);
  }
  const empty: ArrivedToeTravel = {
    startFrame: null,
    frames: 0,
    leftMaxM: null,
    rightMaxM: null,
    leftSumM: null,
    rightSumM: null,
    leftFullMaxM: null,
    rightFullMaxM: null,
    fullFrames: fullIdx.length,
  };
  if (activeIdx.length === 0) return empty;
  const left = toeTravel(frames, activeIdx, "left");
  const right = toeTravel(frames, activeIdx, "right");
  const leftFull = toeTravel(frames, fullIdx, "left");
  const rightFull = toeTravel(frames, fullIdx, "right");
  return {
    startFrame: activeIdx[0] ?? null,
    frames: activeIdx.length,
    leftMaxM: left.maxM,
    rightMaxM: right.maxM,
    leftSumM: left.sumM,
    rightSumM: right.sumM,
    leftFullMaxM: leftFull.maxM,
    rightFullMaxM: rightFull.maxM,
    fullFrames: fullIdx.length,
  };
}
