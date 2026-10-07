/** Mouth-station verifier types: evaluator records, summaries and probe rows (MADR 0061 verifier). */

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

/** One cue in the fixed-capture cue track the evaluator drives. */
export type CueTrackCue = {
  /** Cue start in seconds on the evaluator clock. */
  startS: number;
  /** Cue end in seconds on the evaluator clock. */
  endS: number;
  /** Viseme token active over the cue span. */
  viseme: string;
  /** Cue intensity as authored in the track. */
  intensity: number;
};

/** One ground-truth tooth centroid sample from the step3 capture. */
export type ToothSample = {
  /** Pale-pixel count behind the centroid; frames below 20 are not compared. */
  n: number;
  /** Capture-crop centroid x, pixels. */
  cx: number;
  /** Capture-crop centroid y, pixels. */
  cy: number;
  /** Capture target label for the sample. */
  target: string;
  /** Lip gap in capture pixels at the sample. */
  lipGapPx: number;
  /** Visible tooth pixel count in the capture. */
  mouthTeethN: number;
};

/** Per-frame evaluator record: measured geometry plus projection errors. */
export type FrameRecord = {
  /** Zero-based frame index. */
  frame: number;
  /** Frame time in seconds on the fixed 30 fps clock. */
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
  /** Projected full front-shell centroid, capture-crop pixels. */
  projCyCropPx: number;
  /** Signed projection error vs the step3 tooth sample, capture-crop pixels. */
  projDxCropPx: number | null;
  /** Signed projection error vs the step3 tooth sample, capture-crop pixels. */
  projDyCropPx: number | null;
  /** Mean head-local 3D distance from lower shell to the inner lip rim, mm. */
  rimGapHeadLocalMm: number;
};

/** One trailing-word gap point in the evaluator summary. */
export type NowGapPoint = {
  /** Zero-based frame index. */
  frame: number;
  /** Frame time in seconds. */
  timeS: number;
  /** Active viseme target (null when silence). */
  viseme: string | null;
  /** Lower-lip minus lower-teeth forward gap, head-local mm. */
  forwardGapHeadLocalMm: number;
};

/** Aggregate evaluator summary: gap stats, ground-truth gates and rim stats. */
export type EvaluatorSummary = {
  /** Frame count in the evaluated track. */
  frames: number;
  /** Minimum forward gap over all frames, head-local mm. */
  forwardGapHeadLocalMinMm: number;
  /** Maximum forward gap over all frames, head-local mm. */
  forwardGapHeadLocalMaxMm: number;
  /** Mean forward gap over all frames, head-local mm. */
  forwardGapHeadLocalMeanMm: number;
  /** Standard deviation of the forward gap series, head-local mm. */
  forwardGapHeadLocalStdMm: number;
  /** Trailing "now" word of the line: last two vowel cues. */
  nowVisemes: string[];
  /** Frames spanning the trailing word. */
  nowFrames: number[];
  /** Per-frame gap series over the trailing word. */
  nowGapSeries: NowGapPoint[];
  /** Mean forward gap over the trailing word, head-local mm. */
  nowForwardGapMeanMm: number;
  /** Frames with at least one penetrating vert. */
  penetrationFrames: number;
  /** Gated: detrended median <= 2px, |bias| <= 3px, max <= 5px. The bias is the
   * signed dy median: the capture's visible crown set shifts through the lip
   * aperture as teeth sit deeper (face-legal seat), while the model projects
   * the full anatomical shell, so a constant cy offset is visibility
   * composition, not mistracking. Detrended spread carries the tracking gate. */
  groundTruthDyMedianCropPx: number;
  /** Maximum absolute dy error over compared frames, capture-crop px. */
  groundTruthDyMaxCropPx: number;
  /** Signed dy median (visibility-composition bias), capture-crop px. */
  groundTruthDyBiasCropPx: number;
  /** Median absolute detrended dy error, capture-crop px. */
  groundTruthDyDetrendedMedianCropPx: number;
  /** Maximum absolute detrended dy error, capture-crop px. */
  groundTruthDyDetrendedMaxCropPx: number;
  /** Recorded, not gated: cx carries the capture's visibility composition. */
  groundTruthDxMedianCropPx: number;
  /** Maximum absolute dx error over compared frames, capture-crop px. */
  groundTruthDxMaxCropPx: number;
  /** Why cx is recorded rather than gated. */
  groundTruthCxKnownLimitation: string;
  /** Compared frame count (samples with n >= 20). */
  groundTruthFrames: number;
  /** Inner-rim gap series stats, head-local mm. */
  rimGapHeadLocalMinMm: number;
  /** Maximum rim gap over all frames, head-local mm. */
  rimGapHeadLocalMaxMm: number;
  /** Mean rim gap over all frames, head-local mm. */
  rimGapHeadLocalMeanMm: number;
  /** Minimum rim gap over the now frames (the solver rest target). */
  rimGapNowMinMm: number;
  /** Inner-rim vertex count. */
  rimVertCount: number;
  /** Range of lower-shell centroid head-local Y over all frames: absolute jaw-coupled travel, mm. */
  lowerTeethTravelHeadLocalMm: number;
  /** Max head-local upper-teeth displacement per drive viseme, mm. */
  upperDisplacementByVisemeMaxHeadLocalMm: Record<string, number>;
  /** Evaluator wall-clock time, milliseconds. */
  wallClockMs: number;
};

/** Full evaluator output: provenance, camera, per-frame records and summary. */
export type EvaluatorOutput = {
  /** Schema tag for the evaluator output. */
  schemaVersion: "openclinxr.mouth-solver.evaluator.v2";
  /** GLB path the output was measured from. */
  glbPath: string;
  /** Hex SHA-256 of the evaluated GLB bytes. */
  glbSha256: string;
  /** Cue-track path the output was measured against. */
  trackPath: string;
  /** Fixed evaluator clock, frames per second. */
  frameRate: number;
  /** Capture camera the projection compares against. */
  camera: {
    /** Camera position in world metres. */
    positionWorldM: [number, number, number];
    /** Camera look-at target in world metres. */
    lookAtWorldM: [number, number, number];
    /** Camera field of view, degrees. */
    fovDegrees: number;
    /** Full-frame width, pixels. */
    widthPx: number;
    /** Full-frame height, pixels. */
    heightPx: number;
  };
  /** Per-frame measured records. */
  records: FrameRecord[];
  /** Aggregate summary with gate values. */
  summary: EvaluatorSummary;
};

/** Evaluator drive options for sensitivity probes. */
export type EvaluateParams = {
  /** Pitch perturbation of the capture camera in degrees (0 for the gate run). */
  cameraPitchPerturbDegrees?: number;
  /** Force every teeth viseme morph influence to 0 in measurement (discrimination). */
  zeroTeethMorphs?: boolean;
};

/** One premise-probe row: static morph response at a viseme's runtime jaw angle. */
export type PremiseProbeRow = {
  /** Viseme target name probed. */
  viseme: string;
  /** Runtime jaw angle applied for the probe, degrees. */
  jawDegrees: number;
  /** Mean head-local z of the body morph delta over the outer-lip landmark, mm. */
  lipOuterZMm: number;
  /** Mean head-local z of the body morph delta over the inner rim, mm. */
  rimZMm: number;
  /** Mean head-local z of the teeth morph delta over the lower shell, mm (0 without a teeth target). */
  teethLowerZMm: number;
  /** Mean head-local z of the teeth morph delta over the upper shell, mm. */
  teethUpperZMm: number;
  /** Mean jaw-joint weight over the rim set, 0..1. */
  rimJawShare: number;
  /** Mean jaw-joint weight over the lower shell, 0..1. */
  teethJawShare: number;
};
