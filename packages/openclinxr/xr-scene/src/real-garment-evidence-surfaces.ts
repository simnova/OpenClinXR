/**
 * Real-garment evidence surface tagging for the humanoid source comparators.
 *
 * Extracted from apps/ui-xr/src/main.ts (#314) to keep the runtime god-file under
 * its size ratchet while fixing the parent/nurse sleeve-deform compose failure.
 *
 * The core bug fixed here: three.js's Object3D.traverse() iterates children with
 * the array length captured up front, so removing a garment from the
 * currently-iterated armature mid-traverse shrinks the array under the loop and
 * the next index reads `undefined` — throwing
 * "Cannot read properties of undefined (reading 'traverse')". All detachments are
 * therefore deferred until the traversal completes.
 */

import type { Group } from "three";
import { Color, DoubleSide, Mesh, MeshStandardMaterial } from "three";

/**
 * Derive the sleeveDeform evidence cue from the ACTUAL loaded asset path rather
 * than the comparator alone (#314). The parent/nurse comparators cast the patient
 * primary to the child (peds_patient_child.glb), so a comparator-keyed cue would
 * label the child's exam tshirt with the parent cardigan's provenance.
 */
export function sleeveDeformCueForAssetPath(assetPath: string, fallbackComparator: string): string {
  if (/peds_anxious_parent\.glb/i.test(assetPath)) {
    return "skinned_from_phenotype;separate_sleeve_geo;deform_with_body;peds_asthma_parent_anxiety_v1;parent_cardigan_casual_top;peds_anny_real_garment_parent";
  }
  if (/peds_nurse_kevin\.glb/i.test(assetPath)) {
    return "skinned_from_phenotype;separate_sleeve_geo;deform_with_body;peds_asthma_parent_anxiety_v1;nurse_scrub;peds_anny_real_garment_nurse";
  }
  if (/peds_patient_child/i.test(assetPath)) {
    return "skinned_from_phenotype;separate_sleeve_geo;deform_with_body;peds_asthma_parent_anxiety_v1;short_sleeve_exam_tshirt;peds_anny_real_garment_patient";
  }
  if (fallbackComparator === "ed_anny_real_garment_patient") {
    return "skinned_from_phenotype;separate_sleeve_geo;deform_with_body;ed-gown-geo-reorchestrate;hospital_gown";
  }
  return "skinned_from_phenotype;separate_sleeve_geo;deform_with_body;short_sleeve_exam_tshirt;peds_anny_real_garment_patient";
}


/**
 * Tag the phenotype real-garment meshes (openclinxr_real_garment_*) on a loaded
 * humanoid with sleeve-deform evidence: cyan emissive bind-shape surfaces,
 * frustum-culling disabled, userData evidence flags, and — for the parent/nurse
 * comparators — detachment of the misoriented skinned originals to a static
 * bind-shape so capture shows torso/sleeve volume.
 *
 * Returns the first tagged/evidence mesh, or null when the asset carries no
 * real-garment mesh.
 */
export function applyRealGarmentEvidenceSurfaces(
  root: Group,
  comparator: string,
): Mesh | null {
  // Strict: separate real garment only (mesh or node name after GLTFLoader overwrite).
  const realGarmentNameRe = /openclinxr_real_garment|real_garment_from_phenotype/i;
  // Explicit reject: anny_base role clothing multi-prim material slots (top/lower/soft_trim).
  const roleClothingMaterialRe =
    /role_mesh_clothing|clothing_(parent|nurse)_(top|lower|soft_trim)|openclinxr_role_mesh_clothing/i;
  const bodyNameRe = /body|skin|torso|head|face|eye|teeth|hair|scalp|lash|brow|mouth|tongue|ear|hand|finger|nail|foot|toe/i;
  const sleeveDeformEvidence =
    comparator === "peds_anny_real_garment_patient"
      ? "skinned_garment_sleeves_from_phenotype_garmentLayers;weights_clavicle_upper_arm_chest;deforms_on_body_motion_breath;peds_asthma_parent_anxiety_v1;short_sleeve_exam_tshirt;peds_anny_real_garment_patient"
      : comparator === "peds_anny_real_garment_parent"
        ? "skinned_garment_sleeves_from_phenotype_garmentLayers;weights_clavicle_upper_arm_chest;deforms_on_body_motion_breath;peds_asthma_parent_anxiety_v1;parent_cardigan_casual_top;peds_anny_real_garment_parent"
        : comparator === "peds_anny_real_garment_nurse"
          ? "skinned_garment_sleeves_from_phenotype_garmentLayers;weights_clavicle_upper_arm_chest;deforms_on_body_motion_breath;peds_asthma_parent_anxiety_v1;nurse_scrub;peds_anny_real_garment_nurse"
          : "skinned_garment_sleeves_from_phenotype_garmentLayers;weights_clavicle_upper_arm_chest;deforms_on_body_motion_breath;ed-gown-geo-reorchestrate;hospital_gown";
  // #314: per-mesh cue derived from the garment's OWN name so a child's exam tshirt is never
  // labelled with the parent cardigan cue when the parent/nurse comparators tag it.
  const sleeveDeformEvidenceForMesh = (meshName: string): string => {
    if (/cardigan|casual_top/i.test(meshName)) {
      return "skinned_garment_sleeves_from_phenotype_garmentLayers;weights_clavicle_upper_arm_chest;deforms_on_body_motion_breath;peds_asthma_parent_anxiety_v1;parent_cardigan_casual_top;peds_anny_real_garment_parent";
    }
    if (/scrub/i.test(meshName)) {
      return "skinned_garment_sleeves_from_phenotype_garmentLayers;weights_clavicle_upper_arm_chest;deforms_on_body_motion_breath;peds_asthma_parent_anxiety_v1;nurse_scrub;peds_anny_real_garment_nurse";
    }
    if (/tshirt|exam_tshirt/i.test(meshName)) {
      return "skinned_garment_sleeves_from_phenotype_garmentLayers;weights_clavicle_upper_arm_chest;deforms_on_body_motion_breath;peds_asthma_parent_anxiety_v1;short_sleeve_exam_tshirt;peds_anny_real_garment_patient";
    }
    if (/gown/i.test(meshName)) {
      return "skinned_garment_sleeves_from_phenotype_garmentLayers;weights_clavicle_upper_arm_chest;deforms_on_body_motion_breath;ed-gown-geo-reorchestrate;hospital_gown";
    }
    return sleeveDeformEvidence;
  };

  const hasRoleClothingMaterial = (object: Mesh): boolean => {
    const mats = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
    return mats.some((m) => roleClothingMaterialRe.test(String((m as { name?: string }).name ?? "")));
  };

  const isSeparateRealGarmentMesh = (object: Mesh): boolean => {
    const nm = object.name || "";
    if (!realGarmentNameRe.test(nm)) return false;
    // Never treat role clothing multi-prim slots as the real garment even if names collide.
    if (hasRoleClothingMaterial(object)) return false;
    return true;
  };

  /**
   * #314: three.js's Object3D.traverse() iterates children with the array length
   * captured up front, so removing a garment from the currently-iterated armature
   * (e.g. spawnStaticRealGarmentEvidence's `object.parent.remove`) shrinks the array
   * under the loop and the next index reads `undefined` — throwing
   * "Cannot read properties of undefined (reading 'traverse')" and failing the
   * parent/nurse compose. Defer all detachments until the traverse completes.
   */
  const pendingGarmentRemovals: Mesh[] = [];

  /**
   * Spawn a static cyan bind-shape evidence mesh on the humanoid root so capture shows
   * torso/sleeve volume (not skinned collapse into a lower-body pants blob).
   * Rotates only when bind-shape is still Z-up / floor-plane; bind-fixed Y-up garments keep axes.
   */
  const spawnStaticRealGarmentEvidence = (object: Mesh, host: Group): Mesh | null => {
    const nm = object.name || "";
    if (!realGarmentNameRe.test(nm)) return null;
    if (object.userData.openClinXrGarmentYUpOrientApplied) {
      const existingName = `${nm}:y_up_capture_evidence`;
      const existing = host.getObjectByName(existingName);
      return existing instanceof Mesh ? existing : null;
    }
    const geom = object.geometry as {
      boundingBox?: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null;
      computeBoundingBox?: () => void;
      computeVertexNormals?: () => void;
      computeBoundingSphere?: () => void;
      attributes?: { position?: { count: number; getX: (i: number) => number; getY: (i: number) => number; getZ: (i: number) => number; setXYZ: (i: number, x: number, y: number, z: number) => void; needsUpdate?: boolean } };
      clone?: () => typeof geom;
    } | undefined;
    if (!geom) return null;
    if (typeof geom.computeBoundingBox === "function") geom.computeBoundingBox();
    const bb = geom.boundingBox;
    if (!bb) return null;
    const ySpan = Math.abs(bb.max.y - bb.min.y);
    const zSpan = Math.abs(bb.max.z - bb.min.z);
    const yCenter = (bb.max.y + bb.min.y) / 2;
    // Z-up / floor-plane heuristic: thin in Y, tall in Z, center near origin
    const needsZUpBake = zSpan > ySpan * 2 && yCenter < 0.35 && zSpan > 0.4;
    // Parent/nurse sleeve-deform capture always detaches to static bind-shape so skinning cannot
    // collapse the separate upper garment into a giant lower-body cyan pants blob.
    const forceStaticDetach =
      comparator === "peds_anny_real_garment_parent" || comparator === "peds_anny_real_garment_nurse";
    if (!needsZUpBake && !forceStaticDetach) return null;

    const working = typeof geom.clone === "function" ? (geom.clone() ?? geom) : geom;
    const pos = working.attributes?.position;
    if (!pos || typeof pos.count !== "number") return null;
    if (needsZUpBake) {
      for (let i = 0; i < pos.count; i += 1) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        // rotate -90° about X: (x,y,z) -> (x, z, -y)
        pos.setXYZ(i, x, z, -y);
      }
      pos.needsUpdate = true;
      if (typeof working.computeVertexNormals === "function") working.computeVertexNormals();
      if (typeof working.computeBoundingBox === "function") working.computeBoundingBox();
      if (typeof working.computeBoundingSphere === "function") working.computeBoundingSphere();
    } else if (typeof working.computeBoundingBox === "function") {
      working.computeBoundingBox();
    }

    const cyanMat = new MeshStandardMaterial({
      color: new Color(0x00ffcc),
      emissive: new Color(0x00ffcc),
      emissiveIntensity: 1.1,
      roughness: 0.55,
      metalness: 0.05,
      side: DoubleSide,
    });
    const evidenceName = `${nm}:y_up_capture_evidence`;
    const existing = host.getObjectByName(evidenceName);
    if (existing instanceof Mesh) {
      object.visible = false;
      object.userData.openClinXrGarmentYUpOrientApplied = "skinned_original_hidden_after_static_y_up_evidence_spawn";
      object.userData.openClinXrComparatorVisibilityPolicy = "hidden_misoriented_skinned_phenotype_garment_superseded_by_y_up_evidence";
      return existing;
    }
    const evidence = new Mesh(working as never, cyanMat);
    evidence.name = evidenceName;
    evidence.frustumCulled = false;
    evidence.renderOrder = 3;
    evidence.visible = true;
    if (typeof working.computeBoundingBox === "function") working.computeBoundingBox();
    const ebb = working.boundingBox;
    if (ebb && needsZUpBake) {
      // Z-up bake can leave oversize cube-like volume — fit to adult torso.
      const height = Math.abs(ebb.max.y - ebb.min.y);
      const width = Math.abs(ebb.max.x - ebb.min.x);
      const s = Math.min(1, 0.55 / Math.max(width, 0.01), 0.75 / Math.max(height, 0.01));
      if (s < 0.99) {
        evidence.scale.setScalar(s);
      }
      const yMid = ((ebb.max.y + ebb.min.y) / 2) * (s < 0.99 ? s : 1);
      evidence.position.set(0, 1.22 - yMid, 0.08);
    } else if (ebb) {
      // Bind-fixed Y-up garment already sits on torso; keep bind-shape world placement (no re-lift).
      evidence.position.set(0, 0, 0);
    } else {
      evidence.position.set(0, 0.35, 0.08);
    }
    evidence.userData.openClinXrExposedSeparateGeometry = "real_garment_mesh_from_phenotype_garmentLayers";
    evidence.userData.openClinXrGarmentEvidenceSurface = needsZUpBake
      ? "phenotype_embedded_sleeve_torso_y_up_oriented"
      : "phenotype_embedded_sleeve_torso_static_bind_shape_for_capture";
    evidence.userData.openClinXrSleeveDeformEvidence = sleeveDeformEvidenceForMesh(nm);
    evidence.userData.openClinXrGarmentYUpOrientApplied = needsZUpBake
      ? "baked_neg_x_90_static_reparent_for_sleeve_deform_capture"
      : "static_bind_shape_reparent_for_sleeve_deform_capture_no_axis_bake";
    evidence.userData.openClinXrGarmentSkinDetachedForCapture =
      "phenotype_garment_static_evidence_mesh_on_humanoid_root_for_capture_noticeability";
    host.add(evidence);

    object.visible = false;
    object.frustumCulled = true;
    object.userData.openClinXrGarmentYUpOrientApplied = "skinned_original_hidden_after_static_y_up_evidence_spawn";
    object.userData.openClinXrComparatorVisibilityPolicy = "hidden_misoriented_skinned_phenotype_garment_superseded_by_y_up_evidence";
    object.userData.openClinXrSleeveDeformEvidence = sleeveDeformEvidenceForMesh(nm);
    // #314: do NOT detach here — the caller is iterating the scene graph (root.traverse)
    // and mutating the current node's children array mid-iteration throws undefined.traverse.
    // The object is hidden immediately; physical detachment runs after the traverse.
    pendingGarmentRemovals.push(object);
    return evidence;
  };

  const applyCyanMaterial = (raw: unknown): unknown => {
    if (!raw || typeof raw !== "object") return raw;
    const src = raw as {
      clone?: () => Record<string, unknown>;
      emissive?: Color;
      emissiveIntensity?: number;
      color?: Color;
      map?: unknown;
      needsUpdate?: boolean;
    };
    const mat = typeof src.clone === "function" ? src.clone() : src;
    if (mat.emissive) {
      mat.emissive = new Color(0x00ffcc);
      mat.emissiveIntensity = 1.15;
    }
    if (mat.color) {
      mat.color = new Color(0x00ffcc);
    }
    if ("map" in mat) {
      mat.map = null;
    }
    mat.needsUpdate = true;
    return mat;
  };

  const tagGarment = (object: Mesh): Mesh => {
    // Do not resurrect skinned originals already superseded by static evidence (second pass)
    if (object.userData?.openClinXrComparatorVisibilityPolicy === "hidden_misoriented_skinned_phenotype_garment_superseded_by_y_up_evidence") {
      object.visible = false;
      object.userData.openClinXrSleeveDeformEvidence = sleeveDeformEvidenceForMesh(object.name || "");
      return object;
    }
    object.visible = true;
    object.frustumCulled = false;
    object.renderOrder = 2;
    object.userData.openClinXrExposedSeparateGeometry = "real_garment_mesh_from_phenotype_garmentLayers";
    object.userData.openClinXrGarmentEvidenceSurface = "phenotype_embedded_sleeve_torso";
    object.userData.openClinXrSleeveDeformEvidence = sleeveDeformEvidenceForMesh(object.name || "");
    const staticEvidence = spawnStaticRealGarmentEvidence(object, root);
    if (staticEvidence) {
      return staticEvidence;
    }
    if (Array.isArray(object.material)) {
      object.material = object.material.map((m) => applyCyanMaterial(m)) as typeof object.material;
    } else if (object.material) {
      object.material = applyCyanMaterial(object.material) as typeof object.material;
    }
    return object;
  };

  let firstTagged: Mesh | null = null;

  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    // Skip already-spawned static evidence so we do not double-tag
    if (object.userData?.openClinXrGarmentYUpOrientApplied === "baked_neg_x_90_static_reparent_for_sleeve_deform_capture"
      || object.userData?.openClinXrGarmentYUpOrientApplied === "static_bind_shape_reparent_for_sleeve_deform_capture_no_axis_bake") {
      if (!firstTagged) firstTagged = object;
      return;
    }
    const nm = object.name || "";
    if (isSeparateRealGarmentMesh(object)) {
      const tagged = tagGarment(object);
      if (!firstTagged) firstTagged = tagged;
      return;
    }
    // Explicitly leave role clothing multi-prim slots alone (no cyan / no sleeveDeform tags)
    if (hasRoleClothingMaterial(object)) {
      object.userData.openClinXrRoleClothingSlot =
        "anny_base_role_clothing_material_not_real_garment_evidence_surface";
      return;
    }
    if (bodyNameRe.test(nm.toLowerCase())) {
      object.visible = true;
      object.userData.openClinXrBodyEvidenceSurface = true;
    }
  });

  // #314: detach superseded skinned originals now that the scene-graph traversal has
  // finished — mutating children mid-traverse is what threw undefined.traverse.
  for (const garment of pendingGarmentRemovals) {
    if (garment.parent) {
      garment.parent.remove(garment);
    }
  }

  // Prefer a live static evidence mesh on root if spawn happened after firstTagged was set to hidden original
  const evidenceOnRoot = root.children.find(
    (c): c is Mesh =>
      c instanceof Mesh
      && realGarmentNameRe.test(c.name || "")
      && Boolean(c.userData?.openClinXrGarmentSkinDetachedForCapture),
  );
  if (evidenceOnRoot) {
    firstTagged = evidenceOnRoot;
  }

  return firstTagged;
}
