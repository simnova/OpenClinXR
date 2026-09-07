/**
 * Generated-material tint helpers — extracted verbatim from apps/ui-xr/src/main.ts
 * (shrink-only SIZE_FREEZE). Pure three.js; no app state.
 */

import { Color, type Group, Mesh, MeshStandardMaterial } from "three";

export function tintGeneratedSceneMaterials(root: Group, tintColor: number, actorId?: string): void {
  const tint = new Color(tintColor);
  root.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return;
    }
    const surfaceOverride = generatedHumanoidSurfaceMaterialOverride(object, actorId);
    if (surfaceOverride) {
      object.material = surfaceOverride;
      return;
    }
    if (Array.isArray(object.material)) {
      object.material = object.material.map((material) => tintGeneratedMaterial(material, tint));
      return;
    }
    object.material = tintGeneratedMaterial(object.material, tint);
  });
}

export function generatedHumanoidSurfaceMaterialOverride(object: Mesh, actorId?: string): Mesh["material"] | null {
  const actorKey = actorId ?? "";
  if (object.name.includes("anny_surface_scrub")) {
    const color = actorKey.includes("patient_aisha")
      ? 0x527f94
      : actorKey.includes("partner_omar")
        ? 0x6b503d
        : 0x0b6874;
    const material = new MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.02 });
    material.userData["openClinXrMaterialPolicy"] = "runtime_actor_source_variant_clothing_color_without_overlay_mask";
    return material;
  }
  if (object.name.includes("anny_surface_hair")) {
    const color = actorKey.includes("ob_nurse") ? 0x24140d : 0x1d130e;
    const material = new MeshStandardMaterial({ color, roughness: 0.92 });
    material.userData["openClinXrMaterialPolicy"] = "runtime_actor_source_variant_hair_color_without_overlay_mask";
    return material;
  }
  return null;
}

export function tintGeneratedMaterial(material: Mesh["material"], tint: Color): Mesh["material"] {
  if (!(material instanceof MeshStandardMaterial)) {
    return material;
  }
  if (material.name.includes("openclinxr_legacy_blocky_mesh")) {
    const hiddenLegacy = material.clone();
    hiddenLegacy.transparent = true;
    hiddenLegacy.opacity = 0;
    hiddenLegacy.depthWrite = false;
    hiddenLegacy.userData["openClinXrMaterialPolicy"] =
      "hide_legacy_blocky_review_mesh_in_normal_runtime_so_generated_anny_actor_surface_drives_visual_realism";
    return hiddenLegacy;
  }
  if (material.name.includes("anny_mesh_skin_warm_review")) {
    const skin = material.clone();
    skin.color.setHex(0xd3a184);
    skin.roughness = 0.82;
    skin.metalness = 0;
    skin.userData["openClinXrMaterialPolicy"] = "runtime_warm_skin_tone_for_generated_anny_humanoid";
    return skin;
  }
  if (material.name.includes("anny_mesh_lip_region_review")) {
    const lips = material.clone();
    lips.color.setHex(0x9f5f57);
    lips.roughness = 0.76;
    lips.metalness = 0;
    lips.userData["openClinXrMaterialPolicy"] = "runtime_subtle_lip_region_contrast_for_generated_anny_humanoid";
    return lips;
  }
  if (material.name.includes("anny_mesh_nose_mouth_shadow_review")) {
    const shadow = material.clone();
    shadow.color.setHex(0x8f695a);
    shadow.roughness = 0.88;
    shadow.metalness = 0;
    shadow.userData["openClinXrMaterialPolicy"] = "runtime_subtle_nose_mouth_shadow_for_generated_anny_humanoid";
    return shadow;
  }
  if (material.name.startsWith("anny_") || material.name.includes("review")) {
    const preserved = material.clone();
    preserved.userData["openClinXrMaterialPolicy"] = "preserve_anny_authored_skin_face_clothing_contrast";
    return preserved;
  }
  const cloned = material.clone();
  cloned.color.lerp(tint, 0.18);
  return cloned;
}
