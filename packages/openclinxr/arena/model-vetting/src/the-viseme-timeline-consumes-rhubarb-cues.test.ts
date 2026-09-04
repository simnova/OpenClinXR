import { describe, expect, it } from "vitest";
import {
  PEDS_ASTHMA_PATIENT_VISeme_DIALOGUE_UTTERANCE,
  buildVisemeTimelineFromDialogue,
  visemeForRhubarbValue,
  visemeOpenness,
  visemeTimelineFromRhubarbCues,
  type RhubarbMouthCue,
} from "./viseme-timeline.js";

/**
 * Tracked factory-shaped Rhubarb JSON (seconds, not fitted ms).
 * Two mouth shapes over 400ms. Failed treatment: live gitignored evidence JSON.
 */
const MAYA_RHUBARB_DB_400MS_JSON = `{
  "metadata": { "duration": 0.4, "soundFile": "fixture-maya.wav" },
  "mouthCues": [
    { "start": 0.0, "end": 0.2, "value": "D" },
    { "start": 0.2, "end": 0.4, "value": "B" }
  ]
}`;

const MAYA_RHUBARB_FX_400MS_JSON = `{
  "metadata": { "duration": 0.4, "soundFile": "fixture-maya.wav" },
  "mouthCues": [
    { "start": 0.0, "end": 0.2, "value": "F" },
    { "start": 0.2, "end": 0.4, "value": "X" }
  ]
}`;

const ROUND_TRIP_MS = 10;

function cuesFromTrackedJson(raw: string): RhubarbMouthCue[] {
  const parsed = JSON.parse(raw) as { mouthCues: RhubarbMouthCue[] };
  return parsed.mouthCues;
}

describe("the viseme timeline consumes rhubarb cues", () => {
  it("builds Maya's timeline from Rhubarb D/B cues, not letter-class heuristics", () => {
    const cues = cuesFromTrackedJson(MAYA_RHUBARB_DB_400MS_JSON);
    const fromCues = visemeTimelineFromRhubarbCues(cues, {
      sourceWavPath: "fixture-maya.wav",
      dialogueText: PEDS_ASTHMA_PATIENT_VISeme_DIALOGUE_UTTERANCE,
    });
    const fromLetters = buildVisemeTimelineFromDialogue(PEDS_ASTHMA_PATIENT_VISeme_DIALOGUE_UTTERANCE);

    expect(fromCues.mappingMode).toBe("rhubarb_cue_json");
    expect(fromCues.mappingMode).not.toBe("deterministic_text_phoneme_viseme_runtime_cue");
    expect(fromCues.actorId).toBe("patient_maya_johnson_v1");
    expect(fromCues.phonemeSequence).toEqual(["D", "B"]);
    expect(fromCues.visemeSequence).toEqual(["OH", "E"]);
    expect(fromCues.visemeSequence).not.toEqual(fromLetters.visemeSequence);
    expect(fromCues.sourceWavPath).toBe("fixture-maya.wav");
  });

  it("round-trips Rhubarb start/end within 10ms over a 400ms two-shape fixture", () => {
    const cues = cuesFromTrackedJson(MAYA_RHUBARB_DB_400MS_JSON);
    const timeline = visemeTimelineFromRhubarbCues(cues);
    expect(timeline.cueTimings).toHaveLength(2);
    expect(Math.abs((timeline.durationMs ?? 0) - 400)).toBeLessThanOrEqual(ROUND_TRIP_MS);
    for (const [index, cue] of cues.entries()) {
      const timing = timeline.cueTimings?.[index];
      expect(timing).toBeDefined();
      expect(Math.abs((timing?.startMs ?? NaN) - cue.start * 1000)).toBeLessThanOrEqual(ROUND_TRIP_MS);
      expect(Math.abs((timing?.endMs ?? NaN) - cue.end * 1000)).toBeLessThanOrEqual(ROUND_TRIP_MS);
      expect(timing?.value).toBe(cue.value);
    }
  });

  it("maps every Rhubarb A-H/X value to the landed runtime token table", () => {
    const table: ReadonlyArray<readonly [string, string]> = [
      ["A", "AA"],
      ["B", "E"],
      ["C", "IH"],
      ["D", "OH"],
      ["E", "OU"],
      ["F", "FV"],
      ["G", "L"],
      ["H", "OU"],
      ["X", "sil"],
    ];
    expect(table.map(([letter]) => letter).join("")).toBe("ABCDEFGHX");
    for (const [letter, token] of table) {
      expect(visemeForRhubarbValue(letter)).toBe(token);
      expect(visemeForRhubarbValue(letter.toLowerCase())).toBe(token);
    }
    const cues: RhubarbMouthCue[] = table.map(([value], index) => ({
      start: index * 0.05,
      end: (index + 1) * 0.05,
      value,
    }));
    expect(visemeTimelineFromRhubarbCues(cues).visemeSequence).toEqual(table.map(([, token]) => token));
  });

  it("yields different openness sequences for two different cue fixtures", () => {
    const db = visemeTimelineFromRhubarbCues(cuesFromTrackedJson(MAYA_RHUBARB_DB_400MS_JSON));
    const fx = visemeTimelineFromRhubarbCues(cuesFromTrackedJson(MAYA_RHUBARB_FX_400MS_JSON));
    expect(fx.mappingMode).toBe("rhubarb_cue_json");
    expect(fx.phonemeSequence).toEqual(["F", "X"]);
    expect(fx.visemeSequence).toEqual(["FV", "sil"]);
    expect(db.visemeSequence).not.toEqual(fx.visemeSequence);
    const dbOpenness = db.visemeSequence.map(visemeOpenness);
    const fxOpenness = fx.visemeSequence.map(visemeOpenness);
    expect(dbOpenness).not.toEqual(fxOpenness);
  });
});
