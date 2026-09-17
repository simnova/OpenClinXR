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

/**
 * REGRESSION GATE: the emotion cue must reach the bodies this studio actually captures.
 *
 * MEASURED DEFECT (2026-09-16): applyMorphTargetEmotionCue indexed morphTargetDictionary with the
 * canonical names DIRECTLY. The MPFB-topology bodies the Model Vetting Studio captures carry
 * MakeHuman FACS names, so every lookup returned undefined and the cue wrote NOTHING while still
 * reporting a full set of expression weights. Probed against the built module:
 *   MPFB (FACS names) appliedTargetCount=0  written=[]
 *   Anny (canonical)  appliedTargetCount=3  written=[all three]
 * After routing through the shared resolver: MPFB appliedTargetCount=2.
 *
 * claimScope: morph-name resolution reaching real indices. notEvidenceFor affect validity.
 */
describe("the emotion cue reaches MPFB-topology bodies", () => {
  const FACS = ["mouth-open", "eyebrows-left-inner-up", "eye-left-slit", "nose-compression-uncompress"];
  const CANONICAL = ["openclinxr_mouth_open", "openclinxr_brow_concern", "openclinxr_cheek_tension"];

  function applyTo(names: string[]) {
    const dictionary: Record<string, number> = Object.fromEntries(names.map((n, i) => [n, i]));
    const influences = names.map(() => 0);
    const evidence = applyMorphTargetEmotionCue(
      {
        traverse(callback: (object: unknown) => void) {
          callback({ morphTargetDictionary: dictionary, morphTargetInfluences: influences });
        },
      },
      expressionWeightsForEmotion("pain"),
      buildPedsAsthmaPatientEmotionTransitionTimeline(),
      1,
    );
    return { evidence, written: names.filter((_, i) => (influences[i] ?? 0) > 0.001) };
  }

  it("writes real targets on a body carrying MakeHuman FACS names", () => {
    const { evidence, written } = applyTo(FACS);
    // pre-fix this was 0 and [] on every MPFB body the studio captured
    expect(evidence.appliedTargetCount).toBeGreaterThan(0);
    expect(written).toContain("mouth-open");
  });

  it("COUNTERWEIGHT: the canonical rail still writes exactly its three", () => {
    const { evidence, written } = applyTo(CANONICAL);
    expect(evidence.appliedTargetCount).toBe(3);
    expect(written).toEqual(CANONICAL);
  });

  it("COUNTERWEIGHT: a body with no matching targets writes nothing", () => {
    // rejects "always write index 0", which would satisfy the first clause
    const { evidence, written } = applyTo(["unrelated_target_a", "unrelated_target_b"]);
    expect(evidence.appliedTargetCount).toBe(0);
    expect(written).toEqual([]);
  });
});
