import { describe, expect, it } from "vitest";
import {
  mapEmotionPerformance,
  stripProviderMarkup,
  type EmotionPerformanceMapperInput,
  type EmotionPerformancePlan,
} from "./emotion-performance-mapper.js";

const AGE_BANDS = ["child", "adolescent", "adult", "adult-parent"] as const;

const NEVER_EMIT_TAGS = [
  "[cry]",
  "<loud>",
  "<build-intensity>",
  "[hum-tune]",
  "<sing-song>",
  "<singing>",
  "[lip-smack]",
  "[tongue-click]",
  "[tsk]",
];

function planFor(overrides: Partial<EmotionPerformanceMapperInput>): EmotionPerformancePlan {
  return mapEmotionPerformance({
    dialogueEmotion: "neutral",
    somaticEmotion: null,
    styleFamily: "satir",
    style: "congruent",
    intensityBucket: "low",
    ageBand: "adult",
    ...overrides,
  });
}

function emittedTags(plan: EmotionPerformancePlan): readonly string[] {
  return [...plan.prosody.wrapTags, ...plan.prosody.inlineTags];
}

describe("mapEmotionPerformance emits one plan from the full key", () => {
  it("returns a non-empty plan echoing the dialogue key", () => {
    const plan = mapEmotionPerformance({
      dialogueEmotion: "calm",
      somaticEmotion: "neutral",
      styleFamily: "neutral",
      style: "neutral",
      intensityBucket: "low",
      ageBand: "school_age",
    });
    expect(plan).toEqual(expect.objectContaining({ dialogueEmotion: "calm" }));
    expect(Object.keys(plan).length).toBeGreaterThan(0);
    expect(plan.performancePlanId).toMatch(/^perf\.v1\./);
  });

  it("is deterministic: same key produces an identical plan", () => {
    const input: EmotionPerformanceMapperInput = {
      dialogueEmotion: "anxious",
      somaticEmotion: "pain",
      styleFamily: "satir",
      style: "congruent",
      intensityBucket: "high",
      ageBand: "adult",
      actorRole: "family",
    };
    expect(mapEmotionPerformance(input)).toEqual(mapEmotionPerformance(input));
  });
});

describe("mapEmotionPerformance row resolution", () => {
  it("maps known dialogue emotions to their own rows", () => {
    expect(planFor({ dialogueEmotion: "anxious" }).rowKey).toBe("anxious");
    expect(planFor({ dialogueEmotion: "concerned" }).rowKey).toBe("concerned");
    expect(planFor({ dialogueEmotion: "reassured" }).rowKey).toBe("reassured");
    expect(planFor({ dialogueEmotion: "neutral" }).rowKey).toBe("neutral");
  });

  it("falls back to the neutral row for an unknown dialogue cell", () => {
    const plan = planFor({ dialogueEmotion: "calm" });
    expect(plan.rowKey).toBe("neutral");
    expect(plan.facePresetId).toBe("face.neutral");
  });

  it("somatic pain composes the pain row (FACE + prosody + speed pin)", () => {
    const plan = planFor({ dialogueEmotion: "concerned", somaticEmotion: "pain" });
    expect(plan.rowKey).toBe("pain");
    expect(plan.facePresetId).toBe("face.pain");
    expect(plan.prosody.speed).toBe(0.85);
    expect(plan.prosody.wrapTags).toEqual(["<soft>"]);
  });

  it("a non-pain somatic value behaves as no somatic state", () => {
    const plan = planFor({ dialogueEmotion: "anxious", somaticEmotion: "neutral" });
    expect(plan.rowKey).toBe("anxious");
    expect(plan.somaticEmotion).toBe("neutral");
  });
});

describe("mapEmotionPerformance prosody allowlist", () => {
  it.each([
    ["neutral", { dialogueEmotion: "neutral" }],
    ["reassured", { dialogueEmotion: "reassured" }],
    ["concerned", { dialogueEmotion: "concerned" }],
    ["anxious", { dialogueEmotion: "anxious" }],
    ["pain", { dialogueEmotion: "neutral", somaticEmotion: "pain" }],
  ])("%s row emits at most one wrap and one inline tag in range", (_row, overrides) => {
    const plan = planFor(overrides as Partial<EmotionPerformanceMapperInput>);
    expect(plan.prosody.wrapTags.length).toBeLessThanOrEqual(1);
    expect(plan.prosody.inlineTags.length).toBeLessThanOrEqual(1);
    expect(plan.prosody.speed).toBeGreaterThanOrEqual(0.7);
    expect(plan.prosody.speed).toBeLessThanOrEqual(1.5);
  });

  it("never emits [cry], <loud>, <build-intensity> or age-forbidden tags for any row × age band", () => {
    const dialogueRows = ["neutral", "reassured", "concerned", "anxious"] as const;
    for (const dialogueEmotion of dialogueRows) {
      for (const ageBand of AGE_BANDS) {
        const plan = planFor({ dialogueEmotion, ageBand });
        for (const tag of emittedTags(plan)) {
          expect(NEVER_EMIT_TAGS).not.toContain(tag);
          expect(tag).not.toBe("[laugh]");
          expect(tag).not.toBe("[chuckle]");
          expect(tag).not.toBe("[giggle]");
        }
      }
      const painPlan = planFor({ dialogueEmotion, somaticEmotion: "pain", ageBand: "child" });
      for (const tag of emittedTags(painPlan)) {
        expect(NEVER_EMIT_TAGS).not.toContain(tag);
      }
    }
  });

  it("emits the documented per-row tags and speeds", () => {
    expect(planFor({ dialogueEmotion: "neutral" }).prosody).toEqual({
      wrapTags: [],
      inlineTags: ["[pause]"],
      speed: 1.0,
      droppedTags: [],
    });
    expect(planFor({ dialogueEmotion: "reassured" }).prosody).toEqual({
      wrapTags: ["<soft>"],
      inlineTags: ["[exhale]"],
      speed: 1.0,
      droppedTags: [],
    });
    expect(planFor({ dialogueEmotion: "concerned" }).prosody).toEqual({
      wrapTags: ["<soft>"],
      inlineTags: ["[pause]"],
      speed: 1.0,
      droppedTags: [],
    });
    expect(planFor({ dialogueEmotion: "anxious" }).prosody).toEqual({
      wrapTags: ["<soft>"],
      inlineTags: ["[breath]"],
      speed: 0.95,
      droppedTags: [],
    });
  });
});

describe("stripProviderMarkup", () => {
  it("removes recognized inline and wrap tags and records them as dropped", () => {
    const result = stripProviderMarkup("okay [laugh] and <loud> really </loud> thanks");
    expect(result.cleanText).toBe("okay and really thanks");
    expect(result.droppedTags).toEqual(["<loud>", "[laugh]"]);
  });

  it("preserves unrecognized brackets so legitimate dialogue is not eaten", () => {
    const result = stripProviderMarkup("the [token] is on the desk <custom>");
    expect(result.cleanText).toBe("the [token] is on the desk <custom>");
    expect(result.droppedTags).toEqual([]);
  });

  it("leaves plain text untouched", () => {
    const result = stripProviderMarkup("breathing sounds labored today");
    expect(result.cleanText).toBe("breathing sounds labored today");
    expect(result.droppedTags).toEqual([]);
  });
});
