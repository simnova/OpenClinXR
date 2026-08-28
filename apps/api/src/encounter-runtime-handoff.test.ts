import { mkdir, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiApp } from "./app.js";

/**
 * Route-level wiring test for the factory's evidence-gated runtime handoff adapter.
 *
 * The factory consumer (`tools/openclinxr/factory/encounter-runtime-handoff-consumer.ts`)
 * writes the adapter report under the gitignored `.openclinxr/encounter-publication/` tree;
 * the `runtime-selection-review-packet` route surfaces it as `encounterRuntimeHandoff`.
 * This test provisions the durable JSON itself (standing in for the consumer output) so the
 * wiring is provable without depending on gitignored state, and asserts the field is omitted
 * when the artifact is absent.
 */
const HANDOFF_REL_PATH =
  ".openclinxr/encounter-publication/encounter-runtime-handoff-peds-asthma-parent-anxiety-2026-08-28.json";
const HANDOFF_ABS_PATH = path.resolve(process.cwd(), "../..", HANDOFF_REL_PATH);

const handoffFixture = {
  generatedAt: "2026-08-28T00:00:00.000Z",
  schemaVersion: "openclinxr.evidence-gated-runtime-handoff-adapter.v1",
  sourceLaunchContractId: "encounter_assets_peds_asthma_parent_anxiety_executable_v1:webxr-launch-contract:v1",
  selectedScenarioId: "peds_asthma_parent_anxiety_v1",
  selectedEncounterId: "encounter_assets_peds_asthma_parent_anxiety_executable_v1",
  selectedStationId: "peds_asthma_parent_anxiety_station_v1",
  runtimeAssetBundleId: "peds_asthma_parent_anxiety_encounter_v1:learner-runtime-bundle:v1",
  status: "launchBlocked",
  learnerLaunchAllowed: false,
  localRuntimeHandoffAllowed: false,
  actorRuntimeHandoffs: [],
  evidenceGates: {
    runtimeRealismEvidenceAttached: false,
    humanoidVisualQaEvidenceAttached: false,
    questWebxrEvidenceAttached: false,
    providerExecutionApproved: false,
    providerExecutionConfigured: false,
  },
  blockers: ["case_defined_actor_realism_requirements_missing"],
  notEvidenceFor: ["quest_readiness", "production_readiness", "clinical_validity", "scoring_validity", "provider_readiness"],
  claimBoundary: "runtime_handoff_adapter_not_learner_launch",
};

async function provisionHandoff(): Promise<void> {
  await mkdir(path.dirname(HANDOFF_ABS_PATH), { recursive: true });
  await writeFile(HANDOFF_ABS_PATH, `${JSON.stringify(handoffFixture, null, 2)}\n`, "utf8");
}

async function removeProvisionedHandoff(): Promise<void> {
  // Remove only what this test wrote; non-recursive rmdir leaves any pre-existing
  // factory output under .openclinxr/encounter-publication/ untouched.
  await rm(HANDOFF_ABS_PATH, { force: true });
  await rmdir(path.dirname(HANDOFF_ABS_PATH)).catch(() => undefined);
  await rmdir(path.resolve(path.dirname(HANDOFF_ABS_PATH), "..")).catch(() => undefined);
}

describe("encounter runtime handoff on the selection-review-packet route", () => {
  beforeEach(provisionHandoff);
  afterEach(removeProvisionedHandoff);

  it("serves the handoff adapter report alongside the peds review packet", async () => {
    const app = createApiApp();
    const response = await app.request("/runtime/selection-review-packet");
    expect(response.status).toBe(200);
    const body = await response.json() as {
      schemaVersion?: string;
      encounterRuntimeHandoff?: {
        schemaVersion?: string;
        selectedScenarioId?: string;
        status?: string;
        learnerLaunchAllowed?: boolean;
        localRuntimeHandoffAllowed?: boolean;
        claimBoundary?: string;
        notEvidenceFor?: string[];
      };
    };
    expect(body.schemaVersion).toBe("openclinxr.encounter-runtime-selection-review-packet.v1");
    expect(body.encounterRuntimeHandoff).toMatchObject({
      schemaVersion: "openclinxr.evidence-gated-runtime-handoff-adapter.v1",
      selectedScenarioId: "peds_asthma_parent_anxiety_v1",
      status: "launchBlocked",
      learnerLaunchAllowed: false,
      localRuntimeHandoffAllowed: false,
      claimBoundary: "runtime_handoff_adapter_not_learner_launch",
      notEvidenceFor: expect.arrayContaining(["quest_readiness", "clinical_validity"]),
    });
  });
});

describe("encounter runtime handoff absence is graceful", () => {
  it("omits the handoff field when the durable artifact is missing", async () => {
    await removeProvisionedHandoff();
    const app = createApiApp();
    const response = await app.request("/runtime/selection-review-packet");
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body["encounterRuntimeHandoff"]).toBeUndefined();
    expect(body["schemaVersion"]).toBe("openclinxr.encounter-runtime-selection-review-packet.v1");
  });
});
