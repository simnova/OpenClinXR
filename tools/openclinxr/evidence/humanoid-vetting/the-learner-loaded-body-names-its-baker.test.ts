import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runtimeHumanoidVariantAssetPath } from "@openclinxr/xr-asset-loading";
import { resolveHumanoidVariantOrCastPath } from "@openclinxr/xr-scene";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const MATERIALIZER = "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py";
const PATIENT_ACTOR_ID = "patient_maya_johnson_v1";

describe("the learner-loaded body names its baker", () => {
  it("records the materializer path and the live sha256 on the cast sidecar", () => {
    const runtimeGlb = runtimeHumanoidVariantAssetPath(
      {
        scenarioId: () => "peds_asthma_parent_anxiety_v1",
        selectedHumanoidSourceComparator: () => null,
        runtimeActorRole: () => "patient",
        runtimePatientActorId: () => PATIENT_ACTOR_ID,
        runtimeFamilyActorId: () => "parent_tara_johnson_v1",
        runtimeClinicalTeamActorId: () => "nurse_kevin_lee_v1",
        encounterBundle: () => ({}),
        resolveCastPath: (input: {
          scenarioId: string;
          actorId: string;
          role: string;
          fallbackPath: string;
          comparatorOverridePath?: string | null;
        }) => resolveHumanoidVariantOrCastPath(input),
      } as unknown as Parameters<typeof runtimeHumanoidVariantAssetPath>[0],
      PATIENT_ACTOR_ID,
      "/not-the-cast-fallback.glb",
    );
    const publicRel = runtimeGlb.replace(/^\//, "");
    const glbOnDisk = path.join(ROOT, "apps", "ui-xr", "public", publicRel);
    const sidecar = `${glbOnDisk.slice(0, -".glb".length)}.provenance.json`;
    const doc = JSON.parse(readFileSync(sidecar, "utf8")) as {
      recipe?: { inputs?: Array<{ path?: string; sha256?: string }> };
    };
    const row = doc.recipe?.inputs?.find((input) => input.path === MATERIALIZER);
    const live = createHash("sha256")
      .update(readFileSync(path.join(ROOT, MATERIALIZER)))
      .digest("hex");
    expect(row?.path).toBe(MATERIALIZER);
    expect(row?.sha256).toBe(live);
  });
});
