export const PEDS_ASTHMA_PATIENT_VISeme_DIALOGUE_UTTERANCE =
  "Maya Johnson: It is hard to breathe and my chest feels tight.";

export type VisemeTimelineMappingMode = "deterministic_text_phoneme_viseme_runtime_cue";

export type VisemeTimeline = {
  dialogueText: string;
  phonemeSequence: string[];
  visemeSequence: string[];
  durationMs: number;
  mappingMode: VisemeTimelineMappingMode;
  traceTag: "work_of_breathing_assessment";
  actorId: "patient_maya_johnson_v1";
};

const VISEME_OPENNESS: Record<string, number> = {
  rest: 0,
  closed: 0.08,
  teeth: 0.2,
  rounded: 0.34,
  wide: 0.46,
  mid: 0.52,
  open: 0.78,
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

export function visemeOpenness(viseme: string): number {
  return VISEME_OPENNESS[viseme] ?? 0.35;
}

export function humanoidDialogueDurationMs(phonemeCount: number, extendedCapture = false): number {
  const baseDurationMs = Math.max(900, Math.min(4800, phonemeCount * 90));
  return extendedCapture ? Math.max(baseDurationMs, 4500) : baseDurationMs;
}

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
      mesh.morphTargetInfluences[browConcernIndex] = Math.min(0.95, Math.max(0, viseme === "rest" ? 0.12 : 0.28));
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