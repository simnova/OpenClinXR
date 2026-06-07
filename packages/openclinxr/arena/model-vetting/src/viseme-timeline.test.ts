import { describe, expect, it } from "vitest";
import {
  PEDS_ASTHMA_PATIENT_VISeme_DIALOGUE_UTTERANCE,
  buildVisemeTimelineFromDialogue,
  phonemeSequenceForDialogue,
  visemeAtTimelineProgress,
  visemeForPhoneme,
  visemeOpenness,
} from "./viseme-timeline.js";

describe("viseme timeline mapping", () => {
  it("maps the retained peds asthma patient utterance to deterministic phonemes and visemes", () => {
    const timeline = buildVisemeTimelineFromDialogue(PEDS_ASTHMA_PATIENT_VISeme_DIALOGUE_UTTERANCE);
    expect(timeline.traceTag).toBe("work_of_breathing_assessment");
    expect(timeline.actorId).toBe("patient_maya_johnson_v1");
    expect(timeline.phonemeSequence.length).toBeGreaterThan(8);
    expect(timeline.visemeSequence).toEqual(timeline.phonemeSequence.map(visemeForPhoneme));
    expect(timeline.durationMs).toBeGreaterThanOrEqual(900);
  });

  it("strips speaker labels before phoneme extraction", () => {
    expect(phonemeSequenceForDialogue("Maya Johnson: It is hard to breathe.")).toContain("i");
    expect(phonemeSequenceForDialogue("Maya Johnson: It is hard to breathe.")).toContain("sil");
  });

  it("returns wider mouth openness for open vowels than rest", () => {
    expect(visemeOpenness("open")).toBeGreaterThan(visemeOpenness("rest"));
    const timeline = buildVisemeTimelineFromDialogue(PEDS_ASTHMA_PATIENT_VISeme_DIALOGUE_UTTERANCE);
    const early = visemeAtTimelineProgress(timeline, 0.2);
    const later = visemeAtTimelineProgress(timeline, 0.8);
    expect(early.viseme).toBeTruthy();
    expect(later.viseme).toBeTruthy();
    expect(early.index).toBeLessThan(timeline.visemeSequence.length);
  });
});