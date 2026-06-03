import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";

const inputPath = "apps/ui-xr/public/xr-assets/humanoids/neutral-generated-human.glb";
const outputDir = "apps/ui-xr/public/xr-assets/humanoids/variants";
const reportPath = "docs/openclinxr/ob-humanoid-source-variants-2026-05-27.json";

type VariantSpec = {
  fileName: string;
  actorId: string;
  role: "patient" | "nurse" | "family";
  skin: [number, number, number, number];
  lips: [number, number, number, number];
  scrub: [number, number, number, number];
  hair: [number, number, number, number];
};

const variants: VariantSpec[] = [
  {
    fileName: "ob-patient-aisha-generated-human.glb",
    actorId: "patient_aisha_khan_v1",
    role: "patient",
    skin: [0.74, 0.56, 0.43, 1],
    lips: [0.49, 0.28, 0.27, 1],
    scrub: [0.32, 0.55, 0.64, 1],
    hair: [0.045, 0.032, 0.025, 1],
  },
  {
    fileName: "ob-nurse-williams-generated-human.glb",
    actorId: "ob_nurse_williams_v1",
    role: "nurse",
    skin: [0.82, 0.66, 0.52, 1],
    lips: [0.54, 0.32, 0.30, 1],
    scrub: [0.02, 0.34, 0.38, 1],
    hair: [0.06, 0.04, 0.03, 1],
  },
  {
    fileName: "ob-partner-omar-generated-human.glb",
    actorId: "partner_omar_khan_v1",
    role: "family",
    skin: [0.70, 0.50, 0.37, 1],
    lips: [0.45, 0.25, 0.24, 1],
    scrub: [0.42, 0.31, 0.23, 1],
    hair: [0.035, 0.027, 0.02, 1],
  },
];

function applySourceLevelClothingFitRefinement(root: ReturnType<Awaited<ReturnType<NodeIO["read"]>>["getRoot"]>, variant: VariantSpec): void {
  for (const node of root.listNodes()) {
    if (node.getName() === "anny_surface_scrub_shirt_mesh" || node.getName() === "anny_surface_scrub_pants_mesh") {
      node.setExtras({
        ...(node.getExtras() ?? {}),
        openClinXrSourceFit: "actor_specific_material_source_variant_only_geometry_deformation_rejected_by_visual_review",
        openClinXrActorRole: variant.role,
      });
    }
  }
}

const materialProfiles = new Map<string, keyof Pick<VariantSpec, "skin" | "lips" | "scrub" | "hair">>([
  ["anny_surface_hair_dark", "hair"],
  ["anny_surface_scrub_teal", "scrub"],
  ["anny_mesh_skin_warm_review", "skin"],
  ["anny_mesh_lip_region_review", "lips"],
  ["anny_mesh_nose_mouth_shadow_review", "skin"],
]);

await mkdir(outputDir, { recursive: true });
await mkdir(path.dirname(reportPath), { recursive: true });

const io = new NodeIO();
const outputs = [];
for (const variant of variants) {
  const document = await io.read(inputPath);
  const root = document.getRoot();
  for (const material of root.listMaterials()) {
    const key = materialProfiles.get(material.getName());
    if (!key) continue;
    material.setBaseColorFactor(variant[key]);
    material.setRoughnessFactor(key === "hair" ? 0.9 : 0.82);
    material.setMetallicFactor(0);
  }
  applySourceLevelClothingFitRefinement(root, variant);

  for (const scene of root.listScenes()) {
    scene.setExtras({
      ...(scene.getExtras() ?? {}),
      openClinXrActorSourceVariant: variant.actorId,
      openClinXrActorRole: variant.role,
      openClinXrSourceQualityGate: "actor_specific_generated_humanoid_source_variant_not_overlay_mask",
    });
  }
  const outputPath = path.join(outputDir, variant.fileName);
  await io.write(outputPath, document);
  const hash = createHash("sha256").update(await readFile(outputPath)).digest("hex");
  outputs.push({ ...variant, outputPath, sha256: hash });
}

await writeFile(reportPath, `${JSON.stringify({
  schemaVersion: "openclinxr.ob-humanoid-source-variants.v1",
  generatedAt: new Date().toISOString(),
  inputPath,
  outputs,
  claimBoundaries: {
    notEvidenceFor: ["aaa_humanoid_realism", "quest_readiness", "production_readiness", "clinical_validity", "scoring_validity"],
  },
}, null, 2)}\n`, "utf8");
console.log(`Wrote ${reportPath}`);
for (const output of outputs) console.log(`${output.fileName} ${output.sha256}`);
