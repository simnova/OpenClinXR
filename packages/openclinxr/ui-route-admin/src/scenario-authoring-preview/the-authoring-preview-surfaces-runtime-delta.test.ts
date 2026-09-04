import { authoredContentIdentity } from "@openclinxr/domain";
import { clinicKneePainScenario } from "@openclinxr/scenario-fixtures";
import type { Scenario } from "@openclinxr/shared-schemas";
import { describe, expect, it } from "vitest";
import { previewAuthoringRevision } from "./preview-authoring-revision.js";
import { STALE_REVIEW_IDENTITY_REFUSAL, STALE_VALIDATION_REFUSAL } from "./types.js";

function mutateDraft(approved: Scenario): Scenario {
  const patient = approved.actors[0];
  if (!patient) {
    throw new Error("approved revision has no actors");
  }
  return {
    ...approved,
    actors: [
      {
        ...patient,
        displayName: `${patient.displayName} (revised)`,
        openingUtterance: "The knee locked when I landed.",
      },
      ...approved.actors.slice(1),
    ],
    emotionPolicy: {
      baseline: "concerned",
      upperBound: "anxious",
      lowerBound: "neutral",
      transitions: [{ from: "concerned", triggeredBy: "learner_empathetic", to: "reassured" }],
    },
    equipment: [...(approved.equipment ?? []), "knee_immobilizer"],
  };
}

describe("authoring preview consumes production scenario/factory projections", () => {
  it("lists actor, dialogue, emotion, and asset changes versus the approved revision", () => {
    const approved = clinicKneePainScenario;
    const draft = mutateDraft(approved);
    const preview = previewAuthoringRevision({
      draft,
      approved,
      reviewIdentity: authoredContentIdentity(approved),
    });
    expect(preview.validationOk).toBe(true);
    expect(preview.draftIdentity).toBe(authoredContentIdentity(draft));
    const surfaces = new Set(preview.changes.map((change) => change.surface));
    expect(surfaces).toEqual(new Set(["actor", "dialogue", "emotion", "asset"]));
    expect(preview.promotion.allowed).toBe(false);
    if (preview.promotion.allowed) {
      return;
    }
    expect(preview.promotion.reasons).toContain(STALE_REVIEW_IDENTITY_REFUSAL);
  });

  it("refuses promotion when validation fails or review identity is stale", () => {
    const invalid = previewAuthoringRevision({
      draft: { title: "not a scenario" },
      approved: clinicKneePainScenario,
      reviewIdentity: authoredContentIdentity(clinicKneePainScenario),
    });
    expect(invalid.validationOk).toBe(false);
    expect(invalid.promotion.allowed).toBe(false);
    if (invalid.promotion.allowed) {
      return;
    }
    expect(invalid.promotion.reasons).toContain(STALE_VALIDATION_REFUSAL);

    const matching = previewAuthoringRevision({
      draft: clinicKneePainScenario,
      approved: clinicKneePainScenario,
      reviewIdentity: authoredContentIdentity(clinicKneePainScenario),
    });
    expect(matching.changes).toEqual([]);
    expect(matching.promotion).toEqual({ allowed: true });
  });
});
