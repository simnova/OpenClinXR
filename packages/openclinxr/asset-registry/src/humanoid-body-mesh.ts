/**
 * Single predicate for "which mesh in a glTF is the humanoid body?" (#331).
 *
 * The evidence suite used to recognise the body by being the biggest mesh
 * ("largest primitive", "largest by vertex count"), and that stopped being safe
 * when #324 fitted real CC0 footwear: `openclinxr_footwear_flats_L_mesh`
 * (28,800 tris) outgrew `hm08_basemesh_adult_lean_female` (26,756 tris), so a
 * size-based pick chose a shoe and every body-identity assertion downstream
 * measured a shoe instead of the body. SIZE IS NOT IDENTITY — the same lesson
 * #313 landed one level up for asset paths (`isRuntimeHumanoidAssetPath`:
 * recognise a runtime humanoid by what it is, not the folder it sits in).
 *
 * The identity signal, measured 2026-08-11 on the three shipped rails
 * (library lean_female / heavy_male / MPFB aisha): the body is the ONLY mesh
 * carrying morph targets (32/32/40) and every garment carries zero. Skinning
 * does not discriminate — everything is skinned. On the Anny rail garments
 * carry the same morph count as the body (25), so when several meshes carry
 * morph targets the resolver prefers the fullest morph stack and breaks ties
 * by the largest among the identity-qualified candidates — the pattern
 * `face-morph-census.ts:18` already blesses ("the largest primitive that
 * CARRIES MORPH TARGETS, not the largest primitive"). Size is a TIEBREAK
 * among identity-qualified candidates, never the primary discriminator, and a
 * mesh set with no morph-carrying mesh has no body: null, not a guess.
 *
 * The function is self-contained (no imports, no module-scope references) so
 * it can be injected anywhere the evidence modules run, mirroring
 * `humanoid-asset-path.ts`.
 */

export type HumanoidBodyMeshCandidate = {
  name: string;
  triangleCount: number;
  morphTargetCount: number;
  skinned: boolean;
};

/**
 * Resolve the humanoid body mesh from a glTF mesh list, by identity (the
 * morph-carrying mesh) rather than by being biggest.
 *
 * Returns null when no mesh carries morph targets — the caller must not guess
 * by size in that case.
 */
export function resolveHumanoidBodyMesh<T extends HumanoidBodyMeshCandidate>(
  meshes: readonly T[],
): T | null {
  if (!Array.isArray(meshes) || meshes.length === 0) return null;

  const carriers = meshes.filter(
    (m) =>
      m !== null
      && typeof m === "object"
      && typeof m.morphTargetCount === "number"
      && m.morphTargetCount > 0,
  );
  if (carriers.length === 0) return null;

  const ranked = [...carriers].sort((a, b) => {
    // The body carries the full morph stack (face + body dials); a garment
    // clone carries at most the same stack, never more.
    if (b.morphTargetCount !== a.morphTargetCount) {
      return b.morphTargetCount - a.morphTargetCount;
    }
    // A body is a skinned mesh; prefer the skinned carrier when counts tie.
    if (Boolean(b.skinned) !== Boolean(a.skinned)) {
      return Number(Boolean(b.skinned)) - Number(Boolean(a.skinned));
    }
    // Final tiebreak among equally-qualified carriers: the largest. This is
    // the face-morph-census pattern (largest morph-carrying primitive), never
    // a size-based pick over the whole mesh list.
    return b.triangleCount - a.triangleCount;
  });
  return ranked[0] ?? null;
}
