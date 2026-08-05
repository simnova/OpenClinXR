export type HumanoidExpressionEmotion = "neutral" | "anxious" | "concerned" | "reassured" | "pain";
export type HumanoidExpressionWeights = {
    mouthOpen: number;
    browConcern: number;
    cheekTension: number;
};
export type EmotionTransitionMappingMode = "case_definition_driven_expression_transition";
export type EmotionTransitionTimeline = {
    fromEmotion: HumanoidExpressionEmotion;
    toEmotion: HumanoidExpressionEmotion;
    durationMs: number;
    mappingMode: EmotionTransitionMappingMode;
    traceTag: "work_of_breathing_assessment";
    actorId: "patient_maya_johnson_v1";
};
export declare function expressionWeightsForEmotion(emotion: HumanoidExpressionEmotion): HumanoidExpressionWeights;
export declare function buildPedsAsthmaPatientEmotionTransitionTimeline(input?: {
    extendedCapture?: boolean;
}): EmotionTransitionTimeline;
export declare function emotionWeightsAtTimelineProgress(timeline: EmotionTransitionTimeline, progress: number): {
    fromEmotion: HumanoidExpressionEmotion;
    toEmotion: HumanoidExpressionEmotion;
    transitionProgress: number;
    weights: HumanoidExpressionWeights;
};
export type MorphTargetEmotionCueEvidence = {
    appliedTargetCount: number;
    fromEmotion: HumanoidExpressionEmotion;
    toEmotion: HumanoidExpressionEmotion;
    transitionProgress: number;
    expressionWeights: HumanoidExpressionWeights;
    targetNames: string[];
    mappingMode: EmotionTransitionMappingMode;
    notEvidenceFor: string;
};
export declare function applyMorphTargetEmotionCue(root: {
    traverse: (callback: (object: unknown) => void) => void;
}, weights: HumanoidExpressionWeights, timeline: Pick<EmotionTransitionTimeline, "fromEmotion" | "toEmotion" | "mappingMode">, transitionProgress: number): MorphTargetEmotionCueEvidence;
//# sourceMappingURL=emotion-transition.d.ts.map