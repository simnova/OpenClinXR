import { describe, expect, it } from "vitest";
import { validateScenario } from "@openclinxr/shared-schemas";
import {
  affectForAuthoredRecord,
  keywordAffectFallbackFromText,
  PEDS_ASTHMA_SCENARIO_ID,
  PEDS_CREDIBILITY_VETO_ROLES,
  resolveAuthoredUtteranceRecord,
} from "./authored-utterance-record.js";
import { pediatricAsthmaDialogueSeeds, pediatricAsthmaScenario } from "./pediatric-asthma.js";

describe("pediatric asthma authored actor floor", () => {
  it("stays draft and drops abdominal / RLQ guarding", () => {
    expect(pediatricAsthmaScenario.status).toBe("draft");
    expect(pediatricAsthmaScenario.scenarioId).toBe(PEDS_ASTHMA_SCENARIO_ID);
    expect(validateScenario(pediatricAsthmaScenario).ok).toBe(true);

    const maya = pediatricAsthmaScenario.actors.find((actor) => actor.actorId === "patient_maya_johnson_v1");
    const regions = (maya?.bodyMechanics?.touchResponses ?? []).map((row) => row.region);
    expect(regions).not.toContain("abdomen_rlq");
    expect(regions.some((region) => region.startsWith("abdomen_"))).toBe(false);
  });

  it("makes Maya, Tara, and Kevin separately addressable through authored seeds", () => {
    const maya = resolveAuthoredUtteranceRecord({
      scenarioId: PEDS_ASTHMA_SCENARIO_ID,
      learnerUtterance: "Maya, can you show me how hard it feels to breathe?",
    });
    const tara = resolveAuthoredUtteranceRecord({
      scenarioId: PEDS_ASTHMA_SCENARIO_ID,
      learnerUtterance: "Tara, what changed before this started?",
    });
    const kevin = resolveAuthoredUtteranceRecord({
      scenarioId: PEDS_ASTHMA_SCENARIO_ID,
      learnerUtterance: "Kevin, please start oxygen now.",
    });

    expect(maya?.speakerActorId).toBe("patient_maya_johnson_v1");
    expect(tara?.speakerActorId).toBe("parent_tara_johnson_v1");
    expect(kevin?.speakerActorId).toBe("nurse_kevin_lee_v1");
    expect(new Set([maya?.speakerActorId, tara?.speakerActorId, kevin?.speakerActorId]).size).toBe(3);
  });

  it("binds every persistable Peds seed with one identifier for speaker, spokenText, caption, and affect", () => {
    const persistable = pediatricAsthmaDialogueSeeds.filter(
      (seed) => seed.safetyExpectation !== "blocks_hidden_truth_probe",
    );
    expect(persistable.length).toBeGreaterThanOrEqual(3);
    for (const seed of persistable) {
      const record = resolveAuthoredUtteranceRecord({
        scenarioId: PEDS_ASTHMA_SCENARIO_ID,
        seedId: seed.seedId,
      });
      expect(record, seed.seedId).toMatchObject({
        authoredBindingId: seed.seedId,
        bindingKind: "seed",
        speakerActorId: seed.actorId,
        spokenText: seed.spokenText,
        caption: seed.caption,
        affect: seed.affect,
      });
      expect(record?.authoredBindingId).toBe(seed.seedId);
      expect(record?.planId).toBe(`plan:${seed.seedId}`);
    }
  });

  it("does not let keyword-affect fallback override the authored affect", () => {
    const maya = pediatricAsthmaScenario.actors.find((actor) => actor.actorId === "patient_maya_johnson_v1");
    const kevin = pediatricAsthmaScenario.actors.find((actor) => actor.actorId === "nurse_kevin_lee_v1");
    const mayaRecord = resolveAuthoredUtteranceRecord({
      scenarioId: PEDS_ASTHMA_SCENARIO_ID,
      actorId: "patient_maya_johnson_v1",
    });
    const kevinRecord = resolveAuthoredUtteranceRecord({
      scenarioId: PEDS_ASTHMA_SCENARIO_ID,
      actorId: "nurse_kevin_lee_v1",
    });

    expect(keywordAffectFallbackFromText(maya?.demeanor ?? "")).toBe("neutral");
    expect(mayaRecord?.affect).toBe("anxious");
    expect(affectForAuthoredRecord(mayaRecord!.affect, keywordAffectFallbackFromText(maya?.demeanor ?? ""))).toBe(
      "anxious",
    );

    expect(keywordAffectFallbackFromText(kevin?.demeanor ?? "")).toBe("urgent");
    expect(kevinRecord?.affect).toBe("concerned");
    expect(affectForAuthoredRecord(kevinRecord!.affect, keywordAffectFallbackFromText(kevin?.demeanor ?? ""))).toBe(
      "concerned",
    );
  });

  it("names the three-reviewer credibility veto roles without promoting the draft", () => {
    expect([...PEDS_CREDIBILITY_VETO_ROLES]).toEqual(["pediatrician", "psychometrician", "simulation_qa"]);
    expect(pediatricAsthmaScenario.governance.requiredReviewerRoles).toEqual(
      expect.arrayContaining([...PEDS_CREDIBILITY_VETO_ROLES]),
    );
    expect(pediatricAsthmaScenario.status).toBe("draft");
  });
});
