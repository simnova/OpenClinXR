import { writeFile } from "node:fs/promises";

import {
  PEDS_ASTHMA_PARENT_MPFB_COMPARE_INPUT,
  PEDS_ASTHMA_PATIENT_DECISION_INPUT,
  decideHumanoidSourcePath,
} from "./humanoid-source-decision-tree.js";

async function main(): Promise<void> {
  const generatedAt = new Date().toISOString();
  const report = {
    schemaVersion: "openclinxr.humanoid-source-decision-tree-report.v1",
    generatedAt,
    claimScope: "factory_routing_guidance_not_runtime_or_readiness",
    scenarios: {
      peds_patient_maya: decideHumanoidSourcePath(PEDS_ASTHMA_PATIENT_DECISION_INPUT),
      peds_parent_tara_mpfb_compare: decideHumanoidSourcePath(PEDS_ASTHMA_PARENT_MPFB_COMPARE_INPUT),
      peds_patient_mpfb_rig_probe: decideHumanoidSourcePath({
        ...PEDS_ASTHMA_PATIENT_DECISION_INPUT,
        requiresMpfbStandardRigOrShapekeys: true,
      }),
    },
    decisionTreeSummary: {
      useAnnyWhen: [
        "case_driven_phenotype_sliders_or_parametric_body_variation",
        "pediatric_default_topology_with_embedded_eyes_for_uv_mask_face_cagematch",
        "anny_local_import_available_and_no_mpfb_license_review_yet",
      ],
      useMpfbMakehumanWhen: [
        "mpfb_standard_rig_or_makehuman_face_shapekeys_required",
        "adult_or_older_adult_with_reviewed_makehuman_output_license",
        "clothing_hair_library_compatibility_via_makehuman_cc0_assets",
      ],
      useHybridWhen: [
        "anny_glb_needs_mpfb_rig_attempt_but_basemesh_is_not_mpfb_native",
      ],
      blockedWhen: [
        "neither_anny_nor_mpfb_local_probe_available",
        "makehuman_output_license_not_reviewed_for_promotion_claim",
      ],
    },
    notEvidenceFor: [
      "b_plus_visual_realism_gate",
      "production_asset_readiness",
      "quest_readiness",
      "learner_readiness",
      "clinical_validity",
      "scoring_validity",
    ],
  };

  const outputPath = process.argv.includes("--stdout")
    ? null
    : ".openclinxr/evidence/humanoid-source-decision-tree-latest.json";
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    await writeFile(outputPath, serialized, "utf8");
    process.stdout.write(`Wrote ${outputPath}\n`);
  } else {
    process.stdout.write(serialized);
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});