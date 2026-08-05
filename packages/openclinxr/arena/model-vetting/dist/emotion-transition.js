const EXPRESSION_WEIGHTS = {
    neutral: { mouthOpen: 0.04, browConcern: 0.08, cheekTension: 0.08 },
    anxious: { mouthOpen: 0.18, browConcern: 0.62, cheekTension: 0.48 },
    concerned: { mouthOpen: 0.12, browConcern: 0.72, cheekTension: 0.36 },
    reassured: { mouthOpen: 0.08, browConcern: 0.18, cheekTension: 0.18 },
    pain: { mouthOpen: 0.34, browConcern: 0.86, cheekTension: 0.72 },
};
export function expressionWeightsForEmotion(emotion) {
    return { ...EXPRESSION_WEIGHTS[emotion] };
}
export function buildPedsAsthmaPatientEmotionTransitionTimeline(input) {
    return {
        fromEmotion: "neutral",
        toEmotion: "anxious",
        durationMs: input?.extendedCapture ? 4500 : 3000,
        mappingMode: "case_definition_driven_expression_transition",
        traceTag: "work_of_breathing_assessment",
        actorId: "patient_maya_johnson_v1",
    };
}
function lerp(from, to, alpha) {
    return from + (to - from) * Math.min(1, Math.max(0, alpha));
}
function ease(progress) {
    const clamped = Math.min(1, Math.max(0, progress));
    return clamped * clamped * (3 - 2 * clamped);
}
export function emotionWeightsAtTimelineProgress(timeline, progress) {
    const fromWeights = expressionWeightsForEmotion(timeline.fromEmotion);
    const toWeights = expressionWeightsForEmotion(timeline.toEmotion);
    const transitionProgress = ease(progress);
    return {
        fromEmotion: timeline.fromEmotion,
        toEmotion: timeline.toEmotion,
        transitionProgress: Number(transitionProgress.toFixed(3)),
        weights: {
            mouthOpen: Number(lerp(fromWeights.mouthOpen, toWeights.mouthOpen, transitionProgress).toFixed(3)),
            browConcern: Number(lerp(fromWeights.browConcern, toWeights.browConcern, transitionProgress).toFixed(3)),
            cheekTension: Number(lerp(fromWeights.cheekTension, toWeights.cheekTension, transitionProgress).toFixed(3)),
        },
    };
}
export function applyMorphTargetEmotionCue(root, weights, timeline, transitionProgress) {
    let appliedTargetCount = 0;
    root.traverse((object) => {
        if (typeof object !== "object" || object === null) {
            return;
        }
        const mesh = object;
        if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) {
            return;
        }
        const mouthOpenIndex = mesh.morphTargetDictionary["openclinxr_mouth_open"];
        const browConcernIndex = mesh.morphTargetDictionary["openclinxr_brow_concern"];
        const cheekTensionIndex = mesh.morphTargetDictionary["openclinxr_cheek_tension"];
        if (typeof mouthOpenIndex === "number") {
            mesh.morphTargetInfluences[mouthOpenIndex] = Math.min(0.95, Math.max(0, weights.mouthOpen));
            appliedTargetCount += 1;
        }
        if (typeof browConcernIndex === "number") {
            mesh.morphTargetInfluences[browConcernIndex] = Math.min(0.95, Math.max(0, weights.browConcern));
            appliedTargetCount += 1;
        }
        if (typeof cheekTensionIndex === "number") {
            mesh.morphTargetInfluences[cheekTensionIndex] = Math.min(0.95, Math.max(0, weights.cheekTension));
            appliedTargetCount += 1;
        }
    });
    return {
        appliedTargetCount,
        fromEmotion: timeline.fromEmotion,
        toEmotion: timeline.toEmotion,
        transitionProgress: Number(transitionProgress.toFixed(3)),
        expressionWeights: weights,
        targetNames: ["openclinxr_mouth_open", "openclinxr_brow_concern", "openclinxr_cheek_tension"],
        mappingMode: timeline.mappingMode,
        notEvidenceFor: "validated affect recognition, clinical scoring, or production facial animation quality",
    };
}
