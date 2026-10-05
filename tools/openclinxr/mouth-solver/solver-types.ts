/** Shared types for the headless mouth-geometry evaluator (MADR 0060 evaluator half). */

/** Position spaces named on every position field. */
export type PositionSpace =
  /** glTF mesh-local bind coordinates (base POSITION accessor frame). */
  | "bindMesh"
  /** Head-bone local frame (inverse head world matrix). */
  | "headLocal"
  /** World frame of the headless scene root. */
  | "world"
  /** Capture-crop pixels inside the 1280x960 frame (origin top-left of crop). */
  | "cropPx";

export type CueTrackCue = {
  startS: number;
  endS: number;
  viseme: string;
  intensity: number;
};

export type ToothSample = {
  n: number;
  cx: number;
  cy: number;
  target: string;
  lipGapPx: number;
  mouthTeethN: number;
};

export type FrameRecord = {
  frame: number;
  timeS: number;
  /** Active viseme target reported by the runtime drive (null when silence). */
  viseme: string | null;
  /** Jaw bone aperture applied by the runtime drive, radians. */
  jawOpenRadians: number;
  /** Lower-lip surface minus lower-teeth front shell along head-forward, mm. */
  forwardGapHeadLocalMm: number;
  /** Lower-lip landmark minus lower-teeth front shell along head-up, mm. */
  verticalGapHeadLocalMm: number;
  /** Lower front-shell verts at or in front of the lip landmark's max head-local +Z. */
  penetratingVerts: number;
  /** Upper front-shell centroid displacement from rest, mm. */
  upperTeethDisplacementHeadLocalMm: number;
  /** Projected full front-shell centroid, capture-crop pixels. */
  projCxCropPx: number;
  projCyCropPx: number;
  /** Signed projection error vs the step3 tooth sample, capture-crop pixels. */
  projDxCropPx: number | null;
  projDyCropPx: number | null;
};

export type NowGapPoint = {
  frame: number;
  timeS: number;
  viseme: string | null;
  forwardGapHeadLocalMm: number;
};

export type EvaluatorSummary = {
  frames: number;
  forwardGapHeadLocalMinMm: number;
  forwardGapHeadLocalMaxMm: number;
  forwardGapHeadLocalMeanMm: number;
  forwardGapHeadLocalStdMm: number;
  /** Trailing "now" word of the line: last two vowel cues. */
  nowVisemes: string[];
  nowFrames: number[];
  nowGapSeries: NowGapPoint[];
  nowForwardGapMeanMm: number;
  penetrationFrames: number;
  /** Gated: median <= 2px, max <= 5px (step3 tooth-centroid steps p90 1.43 / max 3.17px). */
  groundTruthDyMedianCropPx: number;
  groundTruthDyMaxCropPx: number;
  /** Recorded, not gated: cx carries the capture's visibility composition. */
  groundTruthDxMedianCropPx: number;
  groundTruthDxMaxCropPx: number;
  groundTruthCxKnownLimitation: string;
  groundTruthFrames: number;
  /** Max head-local upper-teeth displacement per drive viseme, mm. */
  upperDisplacementByVisemeMaxHeadLocalMm: Record<string, number>;
  wallClockMs: number;
};

export type EvaluatorOutput = {
  schemaVersion: "openclinxr.mouth-solver.evaluator.v2";
  glbPath: string;
  glbSha256: string;
  trackPath: string;
  frameRate: number;
  camera: {
    positionWorldM: [number, number, number];
    lookAtWorldM: [number, number, number];
    fovDegrees: number;
    widthPx: number;
    heightPx: number;
  };
  records: FrameRecord[];
  summary: EvaluatorSummary;
};

export type EvaluateParams = {
  /** Pitch perturbation of the capture camera in degrees (0 for the gate run). */
  cameraPitchPerturbDegrees?: number;
  /** Force every teeth viseme morph influence to 0 in measurement (discrimination). */
  zeroTeethMorphs?: boolean;
};
