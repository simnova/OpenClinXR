/**
 * R1 sweater-stage split (rehide-aisha-shoulder-skin.py): the SINGLE shared
 * predicate for the AISHA-SWEATER-POKE-THROUGH downstream change
 * (tsk_4c6a7143f7dff5e0). No second copy of this rule exists.
 *
 * Owning gate: packages/openclinxr/asset-registry/src/aisha-sweater-stage.test.ts.
 * The pins below move only on a new Aisha shoulder-rehide stage run.
 *
 * Source: r2 rehide-aisha-shoulder-skin.py report
 * openclinxr.rehide-aisha-shoulder-skin.v1 (E/scratch-rehide.report.json):
 * inputSha 37e905ea9fa0d4f3664d95a1c34ab45219a77ed63a46b4976b0bb1a063443ce9,
 * outputSha 4148864b18186c788c8a30f16f7fb7d924752f3c53fb4ede24d767278656e99c.
 * The tool moves the 20 posed-converged body-skin tris poking through the
 * green sweater at both shoulders (S2 union over 8 times of
 * ClinicalIdleConversation, held-out t_h=0.5 never selected; SELECTION.json:
 * L 761..768,777,778 + R 4300..4307,4313,4314) back under the hide mask,
 * patch-prim-in-place: the skin prim shrinks by 60 indices (7060 -> 7040
 * tris) and the moved 20 land in a new hidden prim (60 indices). Union
 * verified in-run: sorted(live kept + live hidden) == sorted(baseline skin
 * prim) exactly (no triangle lost or added); other prims' indices
 * byte-identical; attributes/morphs shared.
 *
 * The 2 hashes below are the full sha256 of the 2 new INDICES accessor byte
 * buffers. Roles are bound: the kept prim MUST carry the kept pin and the
 * hidden prim the hidden pin (a swapped pair is refused even though both
 * shas are in the set). No caller keeps its own copy of this rule.
 *
 * Exact bindings: the hidden prim references the SAME attribute accessor
 * indices and the SAME morph-target accessor indices as the baseline skin
 * prim — compared by accessor index identity, not byte signature. The hidden
 * prim carries the exact hide material the stage writes (the body's first
 * openclinxr_hidden_* primitive's material); any other openclinxr_hidden_*
 * material is refused. The kept prim keeps the baseline prim's material
 * (mpfb_skin_ob_patient_aisha_v1).
 *
 * Pure (no `node:` or glTF imports): kept/hidden/baseline are caller-decoded
 * index arrays plus their precomputed sha256 hex digests, accessor-index
 * maps, and material names/indices. Fits the asset-registry browser-safe
 * pattern (cf humanoid-body-mesh.ts: self-contained predicate).
 */

export const AISHA_SWEATER_STAGE_ACTOR = "mpfb-ob-patient-aisha";
// Pinned by the r2 tool run (E/scratch-rehide.report.json, kept prim 7040 tris).
export const AISHA_SWEATER_STAGE_KEPT_INDICES_SHA256 =
  "2c5c5625f9ee7cd2a6ae9ce621e9c0f7910c08ba3117daf8c00c6f87846cadb4";
// Pinned by the r2 tool run (E/scratch-rehide.report.json, hidden prim 20 tris).
export const AISHA_SWEATER_STAGE_HIDDEN_INDICES_SHA256 =
  "c09ac063be040e4bd78ff24ffbf93ecfda8e7c73bfc7cf22cbcbd56bd8710832";

/** V-neck opening band (bind metres, from the shirt's neckline boundary
 * edges): floorY = min neck-vert y (cuff max y=1.2656 gap; provenance:
 * SELECTION.json band.floorY 1.347289800643921, r1 STATE); lateralGate =
 * max|neck-vert x| (opening halfwidth; provenance: SELECTION.json
 * band.lateralGate 0.09766576439142227, r1 STATE); distanceMm = 12 (covers
 * the 87 opening-adjacent faces + margin; provenance: SELECTION.json
 * band.distanceMm, r1 STATE). CW-A: visible band faces after are a
 * superset of before. */
export const AISHA_SWEATER_NECKLINE_BAND = {
  floorY: 1.3473,
  lateralGate: 0.0977,
  distanceMm: 12,
} as const;

/** CW-B shoulder regions (bind metres, from shirt anatomy): outboard of the
 * neck halfwidth 0.098, above cuff tops 1.2656, inboard of cuff outer 0.293,
 * below shirt top 1.4058. */
export const AISHA_SWEATER_SHOULDER_REGIONS = {
  shoulderR: { x: [0.1, 0.3] as const, y: [1.27, 1.45] as const },
  shoulderL: { x: [-0.3, -0.1] as const, y: [1.27, 1.45] as const },
} as const;

/** Shoulder-region classifier output (not exported: surface stays 9; only
 * aishaSweaterRegionOf's return position binds it, structurally). */
type AishaSweaterShoulderRegion = "shoulderL" | "shoulderR" | "other";

/** Classify a bind-space (x, y) centroid into a CW-B shoulder region. */
export function aishaSweaterRegionOf(
  centroidXY: readonly [number, number],
  regions: typeof AISHA_SWEATER_SHOULDER_REGIONS = AISHA_SWEATER_SHOULDER_REGIONS,
): AishaSweaterShoulderRegion {
  const [x, y] = centroidXY;
  if (x >= regions.shoulderR.x[0] && x <= regions.shoulderR.x[1] && y >= regions.shoulderR.y[0] && y <= regions.shoulderR.y[1]) {
    return "shoulderR";
  }
  if (x >= regions.shoulderL.x[0] && x <= regions.shoulderL.x[1] && y >= regions.shoulderL.y[0] && y <= regions.shoulderL.y[1]) {
    return "shoulderL";
  }
  return "other";
}

/**
 * Face key: 3 vertex positions quantized to 0.1 mm (toFixed(4) metres),
 * vertices sorted, joined ' | '. Matches the WAIST A4 key convention.
 */
export function aishaSweaterFaceKey(verticesXYZ: readonly number[]): string {
  if (verticesXYZ.length !== 9) throw new Error(`face key needs 9 coords, got ${verticesXYZ.length}`);
  const verts = [0, 1, 2].map((v) =>
    [verticesXYZ[v * 3]!, verticesXYZ[v * 3 + 1]!, verticesXYZ[v * 3 + 2]!]
      .map((c) => c.toFixed(4))
      .join(","),
  );
  return [...verts].sort().join(" | ");
}

/** Exact hide material the Aisha stage writes (not exported: surface stays 4). */
const AISHA_SWEATER_STAGE_HIDDEN_MATERIAL =
  "openclinxr_hidden_upper_mpfb_ob_patient_aisha_v1_body_mesh";
/** Material index of the exact hide material in the pre-image and live GLB. */
const AISHA_SWEATER_STAGE_HIDDEN_MATERIAL_INDEX = 5;

export type AishaSweaterSplitWitness = {
  /**
   * sha256 hex of the kept skin prim's raw INDICES bytes.
   * Role-bound: MUST equal the kept pin below.
   */
  keptIndicesSha256: string;
  /**
   * sha256 hex of the new hidden prim's raw INDICES bytes.
   * Role-bound: MUST equal the hidden pin below.
   */
  hiddenIndicesSha256: string;
  /** kept prim's vertex indices, sorted ascending. */
  keptSortedIndices: readonly number[];
  /** hidden prim's vertex indices, sorted ascending. */
  hiddenSortedIndices: readonly number[];
  /** pre-stage skin prim's vertex indices, sorted ascending. */
  baselineSortedIndices: readonly number[];
  /** kept prim's attribute accessor indices by semantic (must equal the baseline prim's). */
  keptAttrAccessors: Record<string, number>;
  /** hidden prim's attribute accessor indices by semantic (must equal the baseline prim's). */
  hiddenAttrAccessors: Record<string, number>;
  /** pre-stage prim's attribute accessor indices by semantic. */
  baselineAttrAccessors: Record<string, number>;
  /** kept prim's morph-target accessor indices by target then semantic (must equal the baseline prim's). */
  keptTargetAccessors: ReadonlyArray<Record<string, number>>;
  /** hidden prim's morph-target accessor indices by target then semantic (must equal the baseline prim's). */
  hiddenTargetAccessors: ReadonlyArray<Record<string, number>>;
  /** pre-stage prim's morph-target accessor indices by target then semantic. */
  baselineTargetAccessors: ReadonlyArray<Record<string, number>>;
  /** material index of the kept prim (must equal the baseline prim's). */
  keptMaterialIndex: number;
  /** material index of the hidden prim (must be the exact stage hide material index). */
  hiddenMaterialIndex: number;
  /** material index of the pre-stage prim. */
  baselineMaterialIndex: number;
  /** material name of the kept prim (must equal the baseline prim's). */
  keptMaterial: string;
  /** material name of the hidden prim (must be the exact stage hide material). */
  hiddenMaterial: string;
  /** material name of the pre-stage prim. */
  baselineMaterial: string;
};

function attrAccessorsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key, i) => key === keysB[i] && a[key] === b[keysB[i]!]!);
}

function targetAccessorsEqual(
  a: ReadonlyArray<Record<string, number>>,
  b: ReadonlyArray<Record<string, number>>,
): boolean {
  if (a.length !== b.length) return false;
  return a.every((target, i) => attrAccessorsEqual(target, b[i]!));
}

/**
 * True iff the kept/hidden pair is exactly the pinned sweater-stage split:
 * the kept prim carries the KEPT pin and the hidden prim the hidden pin (a
 * swapped pair is refused even though both shas are in the pin set), the
 * sorted index union equals the pre-stage skin prim (no triangle lost or
 * added), both prims reference the SAME attribute/morph-target accessor
 * indices as the baseline prim (by accessor INDEX identity), the kept prim
 * keeps the baseline material (index + name) and the hidden prim carries
 * the exact stage hide material (index + name; any other
 * openclinxr_hidden_* material is refused).
 */
export function isAishaSweaterStageSplit(witness: AishaSweaterSplitWitness): boolean {
  // Role binding: kept must equal the KEPT pin, hidden the hidden pin.
  if (witness.keptIndicesSha256 !== AISHA_SWEATER_STAGE_KEPT_INDICES_SHA256) return false;
  if (witness.hiddenIndicesSha256 !== AISHA_SWEATER_STAGE_HIDDEN_INDICES_SHA256) return false;
  if (
    witness.keptSortedIndices.length + witness.hiddenSortedIndices.length !==
    witness.baselineSortedIndices.length
  ) {
    return false;
  }
  const merged = [...witness.keptSortedIndices, ...witness.hiddenSortedIndices].sort((a, b) => a - b);
  for (let i = 0; i < merged.length; i += 1) {
    if (merged[i] !== witness.baselineSortedIndices[i]) return false;
  }
  // Patch-prim-in-place: both new prims share the baseline prim's
  // attribute/morph accessors exactly, compared by accessor INDEX identity.
  if (!attrAccessorsEqual(witness.keptAttrAccessors, witness.baselineAttrAccessors)) return false;
  if (!attrAccessorsEqual(witness.hiddenAttrAccessors, witness.baselineAttrAccessors)) return false;
  if (!targetAccessorsEqual(witness.keptTargetAccessors, witness.baselineTargetAccessors)) return false;
  if (!targetAccessorsEqual(witness.hiddenTargetAccessors, witness.baselineTargetAccessors)) return false;
  if (witness.keptMaterialIndex !== witness.baselineMaterialIndex) return false;
  if (witness.keptMaterial !== witness.baselineMaterial) return false;
  if (witness.hiddenMaterialIndex !== AISHA_SWEATER_STAGE_HIDDEN_MATERIAL_INDEX) return false;
  if (witness.hiddenMaterial !== AISHA_SWEATER_STAGE_HIDDEN_MATERIAL) return false;
  return true;
}
