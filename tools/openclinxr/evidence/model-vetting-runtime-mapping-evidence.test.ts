import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildModelVettingRuntimeMappingEvidence,
  validateModelVettingRuntimeMappingEvidence,
} from "./model-vetting-runtime-mapping-evidence.js";

const sourceReportPath = "docs/openclinxr/model-vetting-report-peds-asthma-parent-anxiety-2026-06-05.json";
const captureManifestPath = "docs/openclinxr/model-vetting-capture-manifest-peds-asthma-parent-anxiety-2026-06-05.json";

describe("model-vetting runtime mapping evidence", () => {
  it("exposes package scripts for runtime mapping evidence generation and validation", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> };

    expect(rootPackage.scripts["asset:model-vetting:runtime-mapping"]).toBe("tsx tools/openclinxr/evidence/model-vetting-runtime-mapping-evidence.ts");
    expect(rootPackage.scripts["asset:model-vetting:runtime-mapping:validate"]).toBe("tsx tools/openclinxr/evidence/model-vetting-runtime-mapping-evidence.ts --validate-latest");
  });

  it("maps complete isolated captures to source-fidelity and runtime binding blockers without promotion", async () => {
    const evidence = buildModelVettingRuntimeMappingEvidence({
      generatedAt: "2026-06-05T19:10:00.000Z",
      sourceReportPath,
      sourceReport: JSON.parse(await readFile(sourceReportPath, "utf8")),
      sourceCaptureManifestPath: captureManifestPath,
      captureManifest: JSON.parse(await readFile(captureManifestPath, "utf8")),
    });

    expect(evidence).toMatchObject({
      schemaVersion: "openclinxr.model-vetting-runtime-mapping-evidence.v1",
      claimScope: "isolated_capture_to_runtime_mapping_gap_analysis_only",
      decision: {
        isolatedCaptureSetComplete: true,
        runtimeActorMappingReady: false,
        scenePlacementEvidenceAllowed: false,
        runtimePromotionAllowed: false,
        productionManifestPromotionAllowed: false,
      },
      providerBoundary: {
        providerExecutionEnabled: false,
        externalNetworkUsed: false,
        paidApiUsed: false,
        credentialsRequired: false,
      },
    });
    expect(evidence.actors).toHaveLength(3);
    for (const actor of evidence.actors) {
      expect(actor.capturedSlotCount).toBe(6);
      expect(actor.missingSlotCount).toBe(0);
      expect(actor.sourceFidelity.sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(actor.sourceFidelity.vertexCount).toBeGreaterThan(0);
      expect(actor.sourceFidelity.animationCount).toBeGreaterThan(0);
      expect(actor.turnMappings[0]?.requiredRuntimeBindings).toContain("emotion_aligned_expression_transition_cue");
      expect(actor.turnMappings[0]?.requiredRuntimeBindings).toContain("dialogue_viseme_and_gaze_mapping");
      expect(actor.mappingChecks.find((check) => check.checkId === "speech_viseme_timeline_binding")?.status).toBe("blocked");
      expect(actor.mappingChecks.find((check) => check.checkId === "emotion_transition_state_binding")?.status).toBe("blocked");
    }
    const nurse = evidence.actors.find((actor) => actor.actorId === "nurse_kevin_lee_v1");
    expect(nurse).toMatchObject({
      candidateId: "peds_nurse_kevin_anny_compatible_candidate",
      capturedSlotCount: 6,
      missingSlotCount: 0,
    });
    expect(nurse?.turnMappings[0]?.traceTag).toBe("nurse_work_of_breathing_assessment");
    expect(nurse?.mappingChecks.find((check) => check.checkId === "speech_viseme_timeline_binding")?.evidence).toHaveLength(1);
    expect(evidence.notEvidenceFor).toContain("quest_readiness");
    expect(evidence.notEvidenceFor).toContain("clinical_validity");
    expect(validateModelVettingRuntimeMappingEvidence(evidence)).toEqual({ ok: true });
  });
});
