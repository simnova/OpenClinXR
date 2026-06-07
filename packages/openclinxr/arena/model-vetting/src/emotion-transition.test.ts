import { describe, expect, it } from "vitest";
import {
  applyMorphTargetEmotionCue,
  buildPedsAsthmaPatientEmotionTransitionTimeline,
  emotionWeightsAtTimelineProgress,
  expressionWeightsForEmotion,
} from "./emotion-transition.js";

describe("emotion transition timeline", () => {
  it("builds peds asthma patient neutral-to-anxious transition", () => {
    const timeline = buildPedsAsthmaPatientEmotionTransitionTimeline();
    expect(timeline.fromEmotion).toBe("neutral");
    expect(timeline.toEmotion).toBe("anxious");
    expect(timeline.traceTag).toBe("work_of_breathing_assessment");
  });

  it("eases expression weights across transition progress", () => {
    const timeline = buildPedsAsthmaPatientEmotionTransitionTimeline();
    const start = emotionWeightsAtTimelineProgress(timeline, 0);
    const end = emotionWeightsAtTimelineProgress(timeline, 1);
    expect(start.weights.browConcern).toBeCloseTo(expressionWeightsForEmotion("neutral").browConcern, 2);
    expect(end.weights.browConcern).toBeCloseTo(expressionWeightsForEmotion("anxious").browConcern, 2);
    expect(end.transitionProgress).toBe(1);
  });

  it("applies morph targets for emotion weights", () => {
    const timeline = buildPedsAsthmaPatientEmotionTransitionTimeline();
    const frame = emotionWeightsAtTimelineProgress(timeline, 0.5);
    const influences = [0, 0, 0];
    const dictionary = {
      openclinxr_mouth_open: 0,
      openclinxr_brow_concern: 1,
      openclinxr_cheek_tension: 2,
    };
    const evidence = applyMorphTargetEmotionCue(
      {
        traverse(callback: (object: unknown) => void) {
          callback({ morphTargetDictionary: dictionary, morphTargetInfluences: influences });
        },
      },
      frame.weights,
      timeline,
      frame.transitionProgress,
    );
    expect(evidence.appliedTargetCount).toBe(3);
    expect(influences[1]).toBeGreaterThan(expressionWeightsForEmotion("neutral").browConcern);
  });
});