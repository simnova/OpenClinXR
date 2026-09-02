import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildOpenClinXrCapabilityRoutingMatrix,
  evaluateRuntimeProviderReadinessSurface,
} from "@openclinxr/capability-gateway";
import { createRealtimeVoiceGatewayPosture } from "./index.js";

/**
 * OBSERVABLE: capability-gateway emotional-prosody blockers are still
 * emotional_prosody_clinical_review_missing + prosody_safety_evidence_missing.
 * SpeechSynthesisRequest has no performancePlanId. Direction 2026-09-02 DVA-3:
 * unify to emotional_prosody_policy_review_missing + affect_safety_review_missing
 * and carry performancePlanId on synthesis.
 *
 * MEASURED 2026-09-02. capability-gateway/src/internal.ts:122.
 * voice-gateway types.ts SpeechSynthesisRequest:138-145 (no plan id).
 * voice-gateway gateway.ts already uses the unified ids — do not regress those.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 *
 * ## FIXED (DVA-3)
 * capability-gateway uses emotional_prosody_policy_review_missing +
 * affect_safety_review_missing. SpeechSynthesisRequest requires performancePlanId.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

describe("emotional prosody blocker ids are unified", () => {
  it("(0) COUNTERWEIGHT: voice-gateway emotional_prosody already uses unified blocker ids", () => {
    const posture = createRealtimeVoiceGatewayPosture({
      bunAvailable: true,
      pythonBackendWebSocketUrlConfigured: true,
      pythonBackendDependenciesInstalled: true,
      pythonInferenceRuntimeInstalled: true,
    });
    const gate = posture.providerGates.find((item) => item.gateId === "emotional_prosody");
    expect(gate?.blockers).toEqual([
      "emotional_prosody_policy_review_missing",
      "affect_safety_review_missing",
    ]);
  });

  it("(1) capability-gateway emotional-prosody blockers match the unified ids", () => {
    const matrix = buildOpenClinXrCapabilityRoutingMatrix();
    const surface = evaluateRuntimeProviderReadinessSurface(matrix, "production");
    const gate = surface.providerGates.find((item) => item.gateId.includes("emotional-prosody"));
    expect(gate, "production emotional-prosody gate missing").toBeDefined();
    expect(gate?.blockers).toEqual([
      "emotional_prosody_policy_review_missing",
      "affect_safety_review_missing",
    ]);
    expect(gate?.blockers).not.toContain("emotional_prosody_clinical_review_missing");
    expect(gate?.blockers).not.toContain("prosody_safety_evidence_missing");
  });

  it("(2) SpeechSynthesisRequest declares performancePlanId", () => {
    const types = readFileSync(join(SRC, "types.ts"), "utf8");
    const start = types.indexOf("export type SpeechSynthesisRequest");
    const end = types.indexOf("export type TranscriptEvent", start);
    const slice = types.slice(start, end === -1 ? undefined : end);
    expect(slice.length).toBeGreaterThan(40);
    expect(slice).toMatch(/performancePlanId:\s*string/);
  });
});
