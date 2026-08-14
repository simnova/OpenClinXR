import { describe, expect, it } from "vitest";

import { resolveScenarioActorCast } from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";
import { resolveHumanoidVariantOrCastPath } from "../../../apps/ui-xr/src/humanoid-runtime-asset-url.js";

/**
 * 2026-08-14 medical wardrobe — the physician is no longer a shared clinical-team
 * look-alike. `mpfb-clinical-physician-adult.glb` (scrub shirt + scrub pants + CC0
 * crude lab coat over the same Anny reference as the nurse adult) resolves FIRST
 * for the `physician` role on BOTH resolver copies; RT / MA / nurse / consultant
 * stay on `mpfb-clinical-nurse-adult.glb` (#388/#85: no one-mesh-two-roles for the
 * physician).
 *
 * The two resolvers are:
 *   - registry SSOT: `resolveScenarioActorCast` (packages/openclinxr/asset-registry)
 *   - runtime: `resolveHumanoidVariantOrCastPath` (apps/ui-xr) — the copy the
 *     running app calls. The patient-attire dual-resolver agreement contract
 *     (patient-attire-by-care-setting.test.ts) asserts they agree per station;
 *     this test pins the physician mapping itself.
 *
 * claimScope: physician/nurse-class role → cast GLB identity on both resolvers.
 * notEvidenceFor: mesh quality, wardrobe fit, clinical likeness, scene placement.
 */

const PHYSICIAN_GLB = "mpfb-clinical-physician-adult.glb";
const NURSE_GLB = "mpfb-clinical-nurse-adult.glb";
const WARD = "ward_delirium_med_rec_v1";

describe("the physician resolves to its own MPFB body", () => {
  it("registry SSOT: the ward physician is cast to the physician GLB, not the nurse file", () => {
    const cast = resolveScenarioActorCast(WARD);
    const physician = cast.find((a) => a.role.toLowerCase() === "physician");
    expect(physician, "ward scenario has a physician actor").toBeDefined();
    expect(physician!.runtimeAssetPath).toBe(`/generated-humanoids/${PHYSICIAN_GLB}`);
    expect(physician!.assetPath).toBe(`apps/ui-xr/public/generated-humanoids/${PHYSICIAN_GLB}`);
  });

  it("runtime resolver agrees with the registry for the physician actor", () => {
    const cast = resolveScenarioActorCast(WARD);
    const physician = cast.find((a) => a.role.toLowerCase() === "physician");
    expect(physician).toBeDefined();

    const resolved = resolveHumanoidVariantOrCastPath({
      scenarioId: WARD,
      actorId: physician!.actorId,
      role: physician!.role,
      fallbackPath: physician!.runtimeAssetPath,
    });
    expect(resolved).toBe(`/generated-humanoids/${PHYSICIAN_GLB}`);
  });

  it("nurse-class roles still resolve to the nurse file first", () => {
    for (const role of ["nurse", "respiratory_therapist", "medical_assistant", "consultant"]) {
      const resolved = resolveHumanoidVariantOrCastPath({
        scenarioId: WARD,
        actorId: `probe_${role}`,
        role,
        fallbackPath: "/generated-humanoids/probe.glb",
      });
      expect(resolved, `role ${role} must stay on the nurse-class body`).toBe(
        `/generated-humanoids/${NURSE_GLB}`,
      );
    }
  });

  it("the physician GLB constant mirrors the runtime path in cast-asset-constants", async () => {
    const mod = await import(
      "../../../packages/openclinxr/asset-registry/src/cast-asset-constants.js"
    );
    expect(mod.MPFB_CLINICAL_PHYSICIAN_ADULT_GLB).toBe(PHYSICIAN_GLB);
  });
});
