/**
 * Runtime wire: driveVisemeTimeline → applyVisemeWeights → live mesh morphs (#63).
 *
 * WHY: #45 and #62 landed correct and inert. main.ts wrote morphTargetInfluences[0] and
 * openclinxr_* expression targets only — never named viseme_* weights. This module is the
 * vertical connection; main.ts call sites stay thin (size-frozen).
 *
 * Decisions (not locked by brief):
 * - Interpolation: step (same as #45); frame pick by speech progress.
 * - Dialogue phonemes (a/e/m/sil) mapped to ARKit-style tokens that resolve on shipped GLBs
 *   (viseme_AA, viseme_E, …). Never invent target names outside the mesh dictionary.
 * - claimScope: mouth morph application only. notEvidenceFor anatomy / bind-pose.
 */

import {
  driveVisemeTimeline,
  frameDurationSeconds,
  totalTimelineDurationSeconds,
  type PhonemeCue,
  type VisemeFrame,
} from "./viseme-timeline-drive.js";
import {
  applyVisemeWeights,
  type MorphTargetLike,
} from "./viseme-morph-apply.js";
export {
  attachBakedCuesToSpeech,
  bakedCuesDurationMs,
  loadBakedMouthCuesForUtterance,
  mouthCuesToPhonemeCues,
  type BakedMouthCuesLoad,
  type MouthCuesDocument,
} from "./viseme-baked-cues.js";
export { resolveMorphIndex } from "./viseme-morph-apply.js";
export type { PhonemeCue } from "./viseme-timeline-drive.js";

/** Dialogue / gen-drive tokens → ARKit-style phoneme labels resolveVisemeTarget understands. */
const DIALOGUE_PHONEME_TO_ARKIT: Readonly<Record<string, string>> = {
  sil: "sil",
  silence: "sil",
  rest: "sil",
  a: "AA",
  e: "E",
  i: "IH",
  o: "OH",
  u: "OU",
  m: "sil",
  b: "sil",
  p: "sil",
  f: "FV",
  v: "FV",
  t: "L",
  d: "L",
  n: "L",
  l: "L",
  s: "TH",
  z: "TH",
  k: "sil",
  g: "sil",
  q: "sil",
  c: "sil",
  r: "L",
  w: "OU",
  y: "IH",
  // ARPAbet vowels widened onto the visemes02 names the rebaked parent carries (#469).
  // AH was the defect: dialogue-pronunciations.ts "a": "AH" resolved to nothing. Oculus/ARPAbet
  // standard vowel→viseme assignment; the contract asserts AH/IY/OW/UW reach distinct baked shapes.
  AH: "aa",
  AE: "aa",
  AO: "O",
  AW: "O",
  AY: "aa",
  EH: "E",
  ER: "E",
  EY: "E",
  IY: "I",
  OW: "O",
  OY: "O",
  UH: "U",
  UW: "U",
  // ARKit / mesh tokens passthrough
  AA: "AA",
  E: "E",
  IH: "IH",
  OH: "OH",
  OU: "OU",
  FV: "FV",
  L: "L",
  TH: "TH",
};

export type MorphRootLike = {
  traverse: (callback: (object: unknown) => void) => void;
  userData?: Record<string, unknown>;
};

export type NamedVisemeDriveResult = {
  activeTargetName: string | null;
  influence: number;
  weights: Record<string, number>;
  /** Jaw bone aperture from the driven frame (#552). */
  jawOpenRadians: number;
  availableTargets: string[];
  appliedMeshCount: number;
  /** How many `jaw` bones received the aperture rotation. */
  jawBonesTouched: number;
  frameIndex: number;
  frameCount: number;
  /**
   * Progress [0, 1] the frame was picked at — the value pickFrame actually saw. Evidence
   * consumers can align a morph reading to the drive's own position in the timeline (#723):
   * under headless WebGL load the rAF timestamp lags the sampler's readback clock by up to
   * ~500 ms, which made the plateau look ~3x earlier than it really began.
   */
  progress: number;
  /** Drive's clock (page performance.now(), ms) when the frame was picked; absent when the caller had no clock. */
  nowMs?: number;
};

type JawBoneLike = {
  name?: string;
  isBone?: boolean;
  type?: string;
  rotation: { x: number; y: number; z: number };
  userData?: Record<string, unknown>;
};

/**
 * Apply `jawOpenRadians` to every bone named `jaw` under the root (scene graph + skinned skeletons).
 * Rest local X is cached on first touch so silence restores the bind pose rather than stacking.
 * Axis: local X — MPFB/MakeHuman jaw hinge. Sign: positive X opens the mouth on the shipped Y-up rig.
 */
export function applyJawOpenToRoot(root: MorphRootLike, jawOpenRadians: number): number {
  const open = Number.isFinite(jawOpenRadians) ? jawOpenRadians : 0;
  const touched = new Set<JawBoneLike>();

  const consider = (bone: JawBoneLike | null | undefined): void => {
    if (!bone) return;
    const name = typeof bone.name === "string" ? bone.name : "";
    if (name !== "jaw" && name.toLowerCase() !== "jaw") return;
    if (touched.has(bone)) return;
    touched.add(bone);
    const ud = (bone.userData ??= {});
    if (typeof ud.openClinXrJawRestRotationX !== "number") {
      ud.openClinXrJawRestRotationX = bone.rotation.x;
    }
    bone.rotation.x = (ud.openClinXrJawRestRotationX as number) + open;
  };

  root.traverse((object) => {
    const node = object as JawBoneLike & {
      isSkinnedMesh?: boolean;
      skeleton?: { bones: JawBoneLike[]; update?: () => void };
    };
    const isBone = node.isBone === true || node.type === "Bone";
    if (isBone) consider(node);
    if (node.isSkinnedMesh && node.skeleton?.bones) {
      for (const bone of node.skeleton.bones) consider(bone);
      node.skeleton.update?.();
    }
  });

  return touched.size;
}

export type LiveVisemeInfluenceSample = {
  meshName: string;
  targetName: string;
  influence: number;
  index: number;
};

export function collectMorphTargetNames(root: MorphRootLike): string[] {
  const names = new Set<string>();
  root.traverse((object) => {
    const mesh = object as { morphTargetDictionary?: Record<string, number> } | null;
    const dict = mesh?.morphTargetDictionary;
    if (!dict) return;
    for (const name of Object.keys(dict)) {
      names.add(name);
    }
  });
  return [...names].sort();
}

export function mapDialoguePhonemeToArkit(phoneme: string): string {
  const raw = phoneme.trim();
  if (!raw) return "sil";
  return DIALOGUE_PHONEME_TO_ARKIT[raw] ?? DIALOGUE_PHONEME_TO_ARKIT[raw.toLowerCase()] ?? raw;
}

/**
 * Per-phone dwell weights for a normalised timeline, in seconds. Proportions only: the caller's
 * `durationMs` scales the whole utterance uniformly, so these numbers choose how the total is
 * shared, never wall-clock. External reference (no known-good column in this tree — #382):
 * English conversational speech puts stressed vowels near 100-200 ms and stop closures near
 * 20-80 ms. Keyed on the raw tokens the pipeline can emit: CMUdict ARPAbet (uppercase) and the
 * #376 grapheme-fallback letters (lowercase).
 */
const VOWEL_DWELL_SECONDS = 0.24;
const STOP_DWELL_SECONDS = 0.08;
const NASAL_DWELL_SECONDS = 0.12;
const FRICATIVE_DWELL_SECONDS = 0.16;
const GLIDE_DWELL_SECONDS = 0.16;
const SIL_DWELL_SECONDS = 0.16;

const VOWEL_TOKENS: ReadonlySet<string> = new Set([
  "AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW",
  "a", "e", "i", "o", "u",
]);
const STOP_TOKENS: ReadonlySet<string> = new Set(["P", "B", "T", "D", "K", "G", "t", "k"]);
const NASAL_TOKENS: ReadonlySet<string> = new Set(["M", "N", "NG", "m"]);
const FRICATIVE_TOKENS: ReadonlySet<string> = new Set([
  "F", "V", "S", "Z", "SH", "ZH", "TH", "DH", "CH", "JH", "HH", "f",
]);
const GLIDE_TOKENS: ReadonlySet<string> = new Set(["L", "R", "W", "Y", "w"]);
const SILENCE_TOKENS: ReadonlySet<string> = new Set(["sil", "silence", "rest"]);

/** Dwell length for a raw phoneme token; unknown tokens get a mid-length dwell, never zero. */
function phonemeDwellSeconds(phoneme: string): number {
  const raw = phoneme.trim();
  if (SILENCE_TOKENS.has(raw.toLowerCase())) return SIL_DWELL_SECONDS;
  if (VOWEL_TOKENS.has(raw)) return VOWEL_DWELL_SECONDS;
  if (STOP_TOKENS.has(raw)) return STOP_DWELL_SECONDS;
  if (NASAL_TOKENS.has(raw)) return NASAL_DWELL_SECONDS;
  if (FRICATIVE_TOKENS.has(raw)) return FRICATIVE_DWELL_SECONDS;
  if (GLIDE_TOKENS.has(raw)) return GLIDE_DWELL_SECONDS;
  return FRICATIVE_DWELL_SECONDS;
}

/**
 * Map dialogue phonemes to duration-weighted cues: each cue carries the phoneme's dwell length
 * and a cumulative `atSecond`. `pickFrame` selects by time through the total, so dwell is
 * proportional to the phone's class (vowel > stop) instead of a uniform 1/N division (#382).
 */
export function mapDialoguePhonemesToCues(phonemes: readonly string[]): PhonemeCue[] {
  let at = 0;
  return phonemes.map((phoneme) => {
    const durationSeconds = phonemeDwellSeconds(phoneme);
    const cue: PhonemeCue = {
      phoneme: mapDialoguePhonemeToArkit(phoneme),
      atSecond: Number(at.toFixed(4)),
      durationSeconds,
    };
    at += durationSeconds;
    return cue;
  });
}

function pickFrame(frames: readonly VisemeFrame[], progress: number): { frame: VisemeFrame; index: number } {
  if (frames.length === 0) {
    return { frame: { atSecond: 0, weights: {}, jawOpenRadians: 0 }, index: 0 };
  }
  const clamped = Math.min(1, Math.max(0, progress));
  if (clamped >= 1) {
    return { frame: frames[frames.length - 1]!, index: frames.length - 1 };
  }
  // Select by time through the cumulative dwell timeline: each frame owns its dwell band
  // [atSecond, atSecond + duration), so a long vowel holds the active shape far longer than a
  // stop closure instead of both owning exactly 1/N of the utterance.
  const total = totalTimelineDurationSeconds(frames);
  const t = clamped * total;
  let acc = 0;
  let index = frames.length - 1;
  for (let i = 0; i < frames.length; i += 1) {
    acc += frameDurationSeconds(frames, i);
    if (t < acc) {
      index = i;
      break;
    }
  }
  return { frame: frames[index]!, index };
}

function activeVisemeFromWeights(weights: Record<string, number>): { name: string | null; influence: number } {
  let name: string | null = null;
  let influence = 0;
  for (const [target, weight] of Object.entries(weights)) {
    if (!target.toLowerCase().startsWith("viseme_")) continue;
    if (weight > influence) {
      name = target;
      influence = weight;
    }
  }
  return { name, influence };
}

/**
 * Drive named viseme_* morphs on every mesh under root that has a morph dictionary.
 * Reads available target names from the live mesh graph; never invents names.
 * When `bakedCues` is supplied, the timeline is the bake's real Rhubarb timing instead of
 * the text-derived dwell model (#722); `phonemeSequence` then only supplies the no-cue fallback.
 */
export function applyDialogueVisemeTimelineToRoot(
  root: MorphRootLike,
  input: {
    phonemeSequence: readonly string[];
    progress: number;
    bakedCues?: readonly PhonemeCue[];
    /** Clock time (ms) of this drive call, recorded for evidence alignment (#723). */
    nowMs?: number;
  },
): NamedVisemeDriveResult {
  const availableTargets = collectMorphTargetNames(root);
  const cues =
    input.bakedCues && input.bakedCues.length > 0
      ? input.bakedCues
      : mapDialoguePhonemesToCues(
          input.phonemeSequence.length > 0 ? input.phonemeSequence : ["sil"],
        );
  const { frames } = driveVisemeTimeline({ phonemes: cues, availableTargets });
  const clampedProgress = Math.min(1, Math.max(0, input.progress));
  const { frame, index } = pickFrame(frames, clampedProgress);
  const weights = frame.weights;
  const jawOpenRadians = frame.jawOpenRadians ?? 0;

  let appliedMeshCount = 0;
  root.traverse((object) => {
    const mesh = object as MorphTargetLike | null;
    if (!mesh?.morphTargetDictionary || !mesh.morphTargetInfluences?.length) {
      return;
    }
    applyVisemeWeights(mesh, weights);
    appliedMeshCount += 1;
  });
  const jawBonesTouched = applyJawOpenToRoot(root, jawOpenRadians);

  const active = activeVisemeFromWeights(weights);
  const result: NamedVisemeDriveResult = {
    activeTargetName: active.name,
    influence: active.influence,
    weights,
    jawOpenRadians,
    availableTargets,
    appliedMeshCount,
    jawBonesTouched,
    frameIndex: index,
    frameCount: frames.length,
    progress: clampedProgress,
    ...(typeof input.nowMs === "number" ? { nowMs: input.nowMs } : {}),
  };

  if (root.userData) {
    root.userData.openClinXrNamedVisemeDrive = {
      ...result,
      claimScope: "mouth",
      notEvidenceFor: [
        "anatomy_bind_pose",
        "production_phoneme_timing",
        "validated_facial_animation",
        "clinical_affect_scoring",
      ],
    };
  }

  return result;
}

/**
 * Generated-drive scalar path: map a lip-sync weight to AA vs silence (named), never index 0.
 * When the mesh has no viseme_* targets, no-op (expression path owns openclinxr_*).
 */
export function applyGeneratedScalarVisemeToRoot(root: MorphRootLike, weight: number): NamedVisemeDriveResult {
  const clamped = Math.min(0.95, Math.max(0, Number.isFinite(weight) ? weight : 0));
  const phoneme = clamped > 0.25 ? "AA" : "sil";
  const result = applyDialogueVisemeTimelineToRoot(root, {
    phonemeSequence: [phoneme],
    progress: 0,
  });
  if (result.activeTargetName && clamped > 0 && clamped < 1) {
    // Scale the active viseme to the scalar openness; keep others at 0.
    const scaled: Record<string, number> = { ...result.weights };
    for (const name of Object.keys(scaled)) {
      scaled[name] = name === result.activeTargetName ? clamped : 0;
    }
    const scaledJaw = result.jawOpenRadians * clamped;
    root.traverse((object) => {
      const mesh = object as MorphTargetLike | null;
      if (!mesh?.morphTargetDictionary || !mesh.morphTargetInfluences?.length) return;
      applyVisemeWeights(mesh, scaled);
    });
    const jawBonesTouched = applyJawOpenToRoot(root, scaledJaw);
    return {
      ...result,
      weights: scaled,
      influence: clamped,
      jawOpenRadians: scaledJaw,
      jawBonesTouched,
    };
  }
  return result;
}

export type SpeechSlotLike = {
  root: MorphRootLike;
  activeSpeech?:
    | {
        phonemeSequence: readonly string[];
        startedAtMs: number;
        durationMs: number;
        /** Baked Rhubarb cue timeline loaded from the served cue files (#722), when one exists. */
        bakedCues?: readonly PhonemeCue[];
      }
    | undefined;
};

/**
 * Thin speech-path entry: phoneme timeline from active dialogue → named morph weights.
 * When `activeSpeech.bakedCues` is present, the baked timeline drives instead of the
 * text-derived dwell model (#722). When speech ends, callers should apply silence via
 * applyDialogueVisemeTimelineToRoot({ sil }).
 */
export function applyNamedSpeechVisemes(slot: SpeechSlotLike, nowMs: number = performance.now()): NamedVisemeDriveResult {
  const speech = slot.activeSpeech;
  if (!speech?.phonemeSequence?.length) {
    return applyDialogueVisemeTimelineToRoot(slot.root, {
      phonemeSequence: ["sil"],
      progress: 0,
      nowMs,
    });
  }
  const progress = Math.min(
    1,
    Math.max(0, (nowMs - speech.startedAtMs) / Math.max(1, speech.durationMs)),
  );
  return applyDialogueVisemeTimelineToRoot(slot.root, {
    phonemeSequence: speech.phonemeSequence,
    progress,
    nowMs,
    ...(speech.bakedCues && speech.bakedCues.length > 0 ? { bakedCues: speech.bakedCues } : {}),
  });
}

/**
 * Live scene-graph sample: read morphTargetInfluences by dictionary name.
 * Used by capture page.evaluate — unfakeable against driver self-report.
 */
export function sampleLiveVisemeInfluencesFromRoot(root: MorphRootLike): LiveVisemeInfluenceSample[] {
  const samples: LiveVisemeInfluenceSample[] = [];
  root.traverse((object) => {
    const mesh = object as {
      name?: string;
      morphTargetDictionary?: Record<string, number>;
      morphTargetInfluences?: number[];
    } | null;
    const dict = mesh?.morphTargetDictionary;
    const influences = mesh?.morphTargetInfluences;
    if (!dict || !influences) return;
    for (const [targetName, index] of Object.entries(dict)) {
      if (!targetName.toLowerCase().startsWith("viseme_")) continue;
      if (typeof index !== "number" || index < 0 || index >= influences.length) continue;
      samples.push({
        meshName: typeof mesh.name === "string" ? mesh.name : "",
        targetName,
        influence: influences[index] ?? 0,
        index,
      });
    }
  });
  return samples;
}
