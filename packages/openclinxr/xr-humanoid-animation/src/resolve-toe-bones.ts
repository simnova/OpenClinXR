import { PropertyBinding, type Object3D } from "three";

/**
 * Toe bones on this rig, resolved by EXACT name from the conventions the shipped rigs use.
 *
 * A pattern match is refused for the same reason `chain-ownership.ts` refuses one: `toe_ik_target`
 * would match `toe` and the lock would pin a control object instead of a foot. A rig that carries
 * none of these names returns nulls, the lock then does nothing, and `stanceFoot: null` says so —
 * which is a legible refusal rather than a silent pin on the wrong body part.
 */
export const KNOWN_TOE_BONE_NAMES = [
  { left: "toe1-1.L", right: "toe1-1.R" },
  { left: "mixamorig:LeftToeBase", right: "mixamorig:RightToeBase" },
  { left: "toe.L", right: "toe.R" },
] as const;

/**
 * THE LOADER RENAMES THE BONES, and this is the only place that knows it.
 *
 * `GLTFLoader` runs every node name through `PropertyBinding.sanitizeNodeName`, which strips the
 * characters three.js uses as animation-track path separators — a dot among them. The rig's own
 * bones are `toe1-1.L` and `toe1-1.R` in the GLB and `toe1-1L` and `toe1-1R` once loaded.
 *
 * MEASURED IN A BROWSER, not reasoned about: the first UI-XR capture run of this card refused with
 * "the physician's skeleton has not loaded yet" for its whole 45-second wait while all four
 * humanoids had in fact loaded, and the refusal's own diagnostic listed `toe1-1L` and `toe1-1R`
 * under the slot. Both names are tried, and the sanitised form comes from three's own function
 * rather than from a transcription of its rule.
 */
export function resolveToeBones(root: Object3D): { left: Object3D | null; right: Object3D | null } {
  for (const names of KNOWN_TOE_BONE_NAMES) {
    for (const [rawLeft, rawRight] of [
      [names.left, names.right],
      [PropertyBinding.sanitizeNodeName(names.left), PropertyBinding.sanitizeNodeName(names.right)],
    ] as const) {
      const left = root.getObjectByName(rawLeft) ?? null;
      const right = root.getObjectByName(rawRight) ?? null;
      if (left !== null && right !== null) return { left, right };
    }
  }
  return { left: null, right: null };
}