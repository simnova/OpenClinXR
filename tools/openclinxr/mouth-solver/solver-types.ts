/** Shared types for the headless mouth-geometry evaluator (MADR 0060 evaluator half). */

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
  /** Lower-lip landmark minus lower-teeth front-shell along head-forward (+Z), mm. */
  forwardGapMm: number;
  /** Lower-lip landmark minus lower-teeth front-shell along head-up (+Y), mm. */
  verticalGapMm: number;
  /** Lower front-shell verts at or in front of the lip landmark's max +Z. */
  penetratingVerts: number;
  /** Upper front-shell centroid displacement from rest, head-local, mm. */
  upperTeethDisplacementMm: number;
  /** Projected full front-shell (upper + lower) centroid in capture-crop pixels. */
  projCx: number;
  projCy: number;
  /** Pixel error against step3 toothSamples (null when n < 20). */
  pixelError: number | null;
};

export type EvaluatorSummary = {
  frames: number;
  forwardGapMinMm: number;
  forwardGapMaxMm: number;
  forwardGapMeanMm: number;
  forwardGapStdMm: number;
  nowViseme: string;
  nowFrames: number[];
  nowForwardGapMeanMm: number;
  penetrationFrames: number;
  groundTruthMedianPx: number;
  groundTruthMaxPx: number;
  groundTruthFrames: number;
  wallClockMs: number;
};

export type EvaluatorOutput = {
  schemaVersion: "openclinxr.mouth-solver.evaluator.v1";
  glbPath: string;
  glbSha256: string;
  trackPath: string;
  frameRate: number;
  camera: {
    position: [number, number, number];
    lookAt: [number, number, number];
    fovDegrees: number;
    widthPx: number;
    heightPx: number;
  };
  records: FrameRecord[];
  summary: EvaluatorSummary;
};

export type EvaluateParams = {
  /** Yaw perturbation of the capture camera in degrees (0 for the gate run). */
  cameraYawPerturbDegrees?: number;
};
