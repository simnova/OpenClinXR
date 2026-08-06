import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assessHumanoidProportions, extractJointsFromGlb } from "./humanoid-proportions-probe.js";
import { inspectHumanoidMeshHygiene } from "./humanoid-mesh-hygiene-probe.js";

/**
 * CONTRACTS (#64) — L3 re-bake of the four cagematch assets that still shipped the pre-#58 bind.
 *
 * PRE-FIX (measured): every SOUND humanoid shared `handY=0.9200 footY=0.0500`; these four did not:
 *
 *   anny-garment-hint-v1/current/peds_patient_child_garment_hint_v1.glb   handY=0.1380
 *   anny-real-garment/current/peds_patient_child_real_garment.glb         handY=0.1380
 *   anny-school-age/current/peds_patient_child_mpfb2_eye.glb              handY=0.1380
 *   anny-real-garment/current/ed_chest_pain_patient_real_garment.glb      handY=0.1996
 *
 * FIX PATH (this slice): drive `automate_blender.py` (already carrying #58's
 * `align_y_height_bind_for_gltf_yup_export` + arm-span floor) on each lane's real-Anny base OBJ +
 * manifest, promote into the lane `current/` mirrors. School-age mpfb2 lane then runs
 * `add_mpfb2_eye_rig.py` on the re-baked sound base (lane entry point). Mesh datablock names for
 * phenotype real garment are pinned so peds tshirt vs ED adult upper stay distinguishable.
 *
 * THE TWO CONTRACTS PULL APART, and the second is the one that matters.
 *
 * A sound body is available for nothing: copy `generated-humanoids/peds_patient_child.glb` — already
 * SOUND — over all four. That would satisfy the proportions check completely while destroying what
 * makes each asset an asset. The second contract refuses it by requiring each file to keep the
 * meshes that distinguish it:
 *
 *   real_garment      → openclinxr_real_garment_peds_tshirt_v1_mesh
 *   mpfb2_eye         → openclinxr_mpfb2_left_eye_mesh / openclinxr_mpfb2_right_eye_mesh
 *   garment_hint_v1   → openclinxr_garment_hint_peds_tshirt_v1_mesh
 *   ed_chest_pain     → openclinxr_real_garment_peds_upper_v1_mesh on an ADULT base
 *
 * SCOPE: bind-pose geometry. Says nothing about whether these faces or garments look good.
 */

type Asset = { path: string; mustKeep: readonly string[] };

const BROKEN: readonly Asset[] = [
  {
    path: "apps/ui-xr/public/cagematch/anny-real-garment/current/peds_patient_child_real_garment.glb",
    mustKeep: ["openclinxr_real_garment_peds_tshirt_v1_mesh"],
  },
  {
    path: "apps/ui-xr/public/cagematch/anny-school-age/current/peds_patient_child_mpfb2_eye.glb",
    mustKeep: ["openclinxr_mpfb2_left_eye_mesh", "openclinxr_mpfb2_right_eye_mesh"],
  },
  {
    path: "apps/ui-xr/public/cagematch/anny-garment-hint-v1/current/peds_patient_child_garment_hint_v1.glb",
    mustKeep: ["openclinxr_garment_hint_peds_tshirt_v1_mesh"],
  },
  {
    path: "apps/ui-xr/public/cagematch/anny-real-garment/current/ed_chest_pain_patient_real_garment.glb",
    mustKeep: ["openclinxr_real_garment_peds_upper_v1_mesh", "ed_chest_pain_patient_adult.anny_base"],
  },
];

describe("every shipped cagematch humanoid has a sound bind pose (#64)", () => {
  it("all four remaining cagematch assets pass bind-pose proportions", async () => {
    const failures: string[] = [];
    for (const asset of BROKEN) {
      if (!existsSync(asset.path)) continue;
      const { joints } = await extractJointsFromGlb(asset.path);
      const result = assessHumanoidProportions({ joints });
      if (!result.sound) failures.push(`${asset.path}: ${result.violations.join("; ")}`);
    }
    expect(failures).toEqual([]);
  }, 180_000);

  it("each asset keeps the meshes that make it that asset", async () => {
    // Live guard, not planted: passes today and must keep passing. Copying the already-sound
    // peds_patient_child.glb over these four would satisfy the contract above and fail this one.
    for (const asset of BROKEN) {
      if (!existsSync(asset.path)) continue;
      const { meshes } = await inspectHumanoidMeshHygiene({ glbPath: asset.path });
      const names = new Set(meshes.map((m) => m.name));
      for (const required of asset.mustKeep) {
        expect(names.has(required), `${asset.path} lost ${required}`).toBe(true);
      }
    }
  }, 180_000);
});
