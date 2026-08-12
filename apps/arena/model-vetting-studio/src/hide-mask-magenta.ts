import type { Material } from "three";

/**
 * issue-341 --hide-mask-magenta (#341 round 8): the body is ONE glTF mesh with several
 * material primitives (skin, scalp, openclinxr_hidden_*), so three.js exposes
 * `object.material` as an ARRAY and the old `object.material?.name` check never matched
 * (array.name is undefined) — the debug flag silently rendered the undebugged image
 * (measured: round-7 `--hide-mask-magenta` captures byte-identical to plain captures).
 * Replace only the hidden-mask SLOTS with vivid magenta and keep every other material;
 * a single-material mesh keeps the exact single-material render path the original used.
 */
export function magentaSwapMaterials(
  materials: Material | Material[],
  enabled: boolean | undefined,
  magenta: Material,
): Material | Material[] {
  if (!enabled) return materials;
  if (Array.isArray(materials)) {
    return materials.map((m) => (m?.name?.includes("openclinxr_hidden") ? magenta : m));
  }
  return materials.name?.includes("openclinxr_hidden") ? magenta : materials;
}
