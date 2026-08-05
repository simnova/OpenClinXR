export declare const PEDS_ASTHMA_PATIENT_VISeme_DIALOGUE_UTTERANCE = "Maya Johnson: It is hard to breathe and my chest feels tight.";
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
export declare function phonemeSequenceForDialogue(text: string): string[];
export declare function visemeForPhoneme(phoneme: string): string;
export declare function visemeOpenness(viseme: string): number;
export declare function humanoidDialogueDurationMs(phonemeCount: number, extendedCapture?: boolean): number;
export declare function buildVisemeTimelineFromDialogue(dialogueText: string, input?: {
    extendedCapture?: boolean;
}): VisemeTimeline;
export declare function visemeAtTimelineProgress(timeline: VisemeTimeline, progress: number): {
    index: number;
    phoneme: string;
    viseme: string;
    openness: number;
};
export type MorphTargetVisemeCueEvidence = {
    appliedTargetCount: number;
    currentViseme: string;
    mouthOpenness: number;
    targetNames: string[];
    mappingMode: VisemeTimelineMappingMode;
    notEvidenceFor: string;
};
export declare function applyMorphTargetVisemeCue(root: {
    traverse: (callback: (object: unknown) => void) => void;
}, openness: number, viseme: string): MorphTargetVisemeCueEvidence;
//# sourceMappingURL=viseme-timeline.d.ts.map