export const PEDS_ASTHMA_PATIENT_VISeme_DIALOGUE_UTTERANCE =
  "Maya Johnson: It is hard to breathe and my chest feels tight.";

export type VisemeTimelineMappingMode =
  | "deterministic_text_phoneme_viseme_runtime_cue"
  | "rhubarb_cue_json";

/** One mouth cue from factory lip_sync Rhubarb `--exportFormat json` (start/end in seconds). */
export type RhubarbMouthCue = {
  start: number;
  end: number;
  value: string;
};

export type VisemeCueTiming = {
  startMs: number;
  endMs: number;
  value: string;
};

export type VisemeTimeline = {
  dialogueText: string;
  phonemeSequence: string[];
  visemeSequence: string[];
  durationMs: number;
  mappingMode: VisemeTimelineMappingMode;
  traceTag: "work_of_breathing_assessment";
  actorId: "patient_maya_johnson_v1";
  sourceWavPath?: string;
  cueTimings?: VisemeCueTiming[];
};

/**
 * Rhubarb mouth-shape letters → same runtime tokens as ui-xr viseme-baked-cues
 * (A=AA, B=E, C=IH, D=OH, E=OU, F=FV, G=L, H=OU, X=sil). Copied here so this
 * package does not import ui-xr.
 */
const RHUBARB_VALUE_TO_VISEME: Record<string, string> = {
  A: "AA",
  B: "E",
  C: "IH",
  D: "OH",
  E: "OU",
  F: "FV",
  G: "L",
  H: "OU",
  X: "sil",
};

const RHUBARB_START_END_ROUND_TRIP_MS = 10;

const VISEME_OPENNESS: Record<string, number> = {
  rest: 0,
  sil: 0,
  closed: 0.08,
  teeth: 0.2,
  FV: 0.2,
  rounded: 0.34,
  OU: 0.34,
  wide: 0.46,
  E: 0.46,
  IH: 0.46,
  mid: 0.52,
  L: 0.52,
  open: 0.78,
  AA: 0.78,
  OH: 0.78,
};

export function phonemeSequenceForDialogue(text: string): string[] {
  const spoken = text.replace(/^[^:]+:\s*/u, "").toLowerCase();
  const sequence: string[] = [];
  for (const char of spoken) {
    if (/[aeiou]/u.test(char)) sequence.push(char);
    else if (/[bmp]/u.test(char)) sequence.push("m");
    else if (/[fv]/u.test(char)) sequence.push("f");
    else if (/[tdnlsz]/u.test(char)) sequence.push("t");
    else if (/[kgqcr]/u.test(char)) sequence.push("k");
    else if (/[wy]/u.test(char)) sequence.push("w");
    else if (/[.!?]/u.test(char)) sequence.push("sil");
  }
  return sequence.length > 0 ? sequence.slice(0, 48) : ["sil"];
}

export function visemeForPhoneme(phoneme: string): string {
  if (phoneme === "sil") return "rest";
  if (phoneme === "m") return "closed";
  if (phoneme === "f") return "teeth";
  if (phoneme === "w") return "rounded";
  if (phoneme === "a" || phoneme === "o") return "open";
  if (phoneme === "e" || phoneme === "i") return "wide";
  return "mid";
}

export function visemeForRhubarbValue(value: string): string {
  return RHUBARB_VALUE_TO_VISEME[value.toUpperCase()] ?? "sil";
}

/**
 * Factory Q5 path: ingest lip_sync Rhubarb cue JSON (`start`/`end` seconds, `value` A–H/X).
 * Does not spawn `say` or `rhubarb`.
 */
export function visemeTimelineFromRhubarbCues(
  cues: readonly RhubarbMouthCue[],
  input?: { sourceWavPath?: string; dialogueText?: string },
): VisemeTimeline {
  if (cues.length === 0) {
    throw new Error("visemeTimelineFromRhubarbCues requires at least one Rhubarb mouth cue");
  }
  const cueTimings: VisemeCueTiming[] = cues.map((cue) => ({
    startMs: cue.start * 1000,
    endMs: cue.end * 1000,
    value: cue.value,
  }));
  for (const [index, cue] of cues.entries()) {
    const timing = cueTimings[index];
    if (
      timing === undefined ||
      Math.abs(timing.startMs - cue.start * 1000) > RHUBARB_START_END_ROUND_TRIP_MS ||
      Math.abs(timing.endMs - cue.end * 1000) > RHUBARB_START_END_ROUND_TRIP_MS
    ) {
      throw new Error(`Rhubarb cue ${index} start/end did not round-trip within ${RHUBARB_START_END_ROUND_TRIP_MS}ms`);
    }
  }
  const last = cueTimings[cueTimings.length - 1];
  const visemeSequence = cues.map((cue) => visemeForRhubarbValue(cue.value));
  const timeline: VisemeTimeline = {
    dialogueText: input?.dialogueText ?? PEDS_ASTHMA_PATIENT_VISeme_DIALOGUE_UTTERANCE,
    phonemeSequence: cues.map((cue) => cue.value),
    visemeSequence,
    durationMs: last?.endMs ?? 0,
    mappingMode: "rhubarb_cue_json",
    traceTag: "work_of_breathing_assessment",
    actorId: "patient_maya_johnson_v1",
    cueTimings,
  };
  if (input?.sourceWavPath !== undefined) {
    timeline.sourceWavPath = input.sourceWavPath;
  }
  return timeline;
}

export function visemeOpenness(viseme: string): number {
  return VISEME_OPENNESS[viseme] ?? 0.35;
}

export function humanoidDialogueDurationMs(phonemeCount: number, extendedCapture = false): number {
  const baseDurationMs = Math.max(900, Math.min(4800, phonemeCount * 90));
  return extendedCapture ? Math.max(baseDurationMs, 4500) : baseDurationMs;
}

/** Fixture-only letter heuristic. Prefer visemeTimelineFromRhubarbCues when cues exist. */
export function buildVisemeTimelineFromDialogue(
  dialogueText: string,
  input?: { extendedCapture?: boolean },
): VisemeTimeline {
  const phonemeSequence = phonemeSequenceForDialogue(dialogueText);
  const visemeSequence = phonemeSequence.map(visemeForPhoneme);
  return {
    dialogueText,
    phonemeSequence,
    visemeSequence,
    durationMs: humanoidDialogueDurationMs(phonemeSequence.length, input?.extendedCapture ?? false),
    mappingMode: "deterministic_text_phoneme_viseme_runtime_cue",
    traceTag: "work_of_breathing_assessment",
    actorId: "patient_maya_johnson_v1",
  };
}

export function visemeAtTimelineProgress(timeline: VisemeTimeline, progress: number): {
  index: number;
  phoneme: string;
  viseme: string;
  openness: number;
} {
  const clampedProgress = Math.min(1, Math.max(0, progress));
  if (timeline.cueTimings && timeline.cueTimings.length > 0 && timeline.durationMs > 0) {
    const atMs = clampedProgress * timeline.durationMs;
    let index = timeline.cueTimings.length - 1;
    for (const [i, cue] of timeline.cueTimings.entries()) {
      if (atMs >= cue.startMs && atMs < cue.endMs) {
        index = i;
        break;
      }
    }
    const viseme = timeline.visemeSequence[index] ?? "rest";
    return {
      index,
      phoneme: timeline.phonemeSequence[index] ?? "sil",
      viseme,
      openness: visemeOpenness(viseme),
    };
  }
  const index = Math.min(
    timeline.visemeSequence.length - 1,
    Math.max(0, Math.floor(clampedProgress * timeline.visemeSequence.length)),
  );
  const viseme = timeline.visemeSequence[index] ?? "rest";
  return {
    index,
    phoneme: timeline.phonemeSequence[index] ?? "sil",
    viseme,
    openness: visemeOpenness(viseme),
  };
}

export type MorphTargetVisemeCueEvidence = {
  appliedTargetCount: number;
  currentViseme: string;
  mouthOpenness: number;
  targetNames: string[];
  mappingMode: VisemeTimelineMappingMode;
  notEvidenceFor: string;
};

export function applyMorphTargetVisemeCue(
  root: { traverse: (callback: (object: unknown) => void) => void },
  openness: number,
  viseme: string,
): MorphTargetVisemeCueEvidence {
  let appliedTargetCount = 0;
  root.traverse((object) => {
    if (typeof object !== "object" || object === null) {
      return;
    }
    const mesh = object as {
      morphTargetDictionary?: Record<string, number>;
      morphTargetInfluences?: number[];
    };
    if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) {
      return;
    }
    const mouthOpenIndex = mesh.morphTargetDictionary["openclinxr_mouth_open"];
    const browConcernIndex = mesh.morphTargetDictionary["openclinxr_brow_concern"];
    const cheekTensionIndex = mesh.morphTargetDictionary["openclinxr_cheek_tension"];
    if (typeof mouthOpenIndex === "number") {
      mesh.morphTargetInfluences[mouthOpenIndex] = Math.min(0.95, Math.max(0, openness));
      appliedTargetCount += 1;
    }
    if (typeof browConcernIndex === "number") {
      mesh.morphTargetInfluences[browConcernIndex] = Math.min(
        0.95,
        Math.max(0, viseme === "rest" || viseme === "sil" ? 0.12 : 0.28),
      );
      appliedTargetCount += 1;
    }
    if (typeof cheekTensionIndex === "number") {
      mesh.morphTargetInfluences[cheekTensionIndex] = Math.min(0.95, Math.max(0, openness * 0.22));
      appliedTargetCount += 1;
    }
  });
  return {
    appliedTargetCount,
    currentViseme: viseme,
    mouthOpenness: Number(openness.toFixed(3)),
    targetNames: ["openclinxr_mouth_open", "openclinxr_brow_concern", "openclinxr_cheek_tension"],
    mappingMode: "deterministic_text_phoneme_viseme_runtime_cue",
    notEvidenceFor: "production phoneme timing, validated facial animation, or clinical affect scoring",
  };
}