import { type Object3D, PropertyBinding } from "three";

/**
 * The hip/thigh-root bone on this rig, resolved by EXACT name, mirroring `resolve-toe-bones.ts`'s
 * own convention and its reason for existing: a substring match on "hip" would also catch a
 * clothing or IK helper named e.g. `hip_pocket_anchor`, and a rig that carries none of these names
 * should return null rather than pin a leg-length measurement to the wrong node.
 *
 * `upperleg01.L` is the MPFB2 default_no_toes target map's own name for the thigh's proximal
 * joint (`tools/openclinxr/asset-pipeline/makeclothes/known-rigs/mpfb2-default-no-toes.json:60`,
 * mapped from the MHX canonical `thigh.L`) — every shipped MPFB actor carries it. `mixamorig:Hips`
 * covers the one non-MPFB naming convention this package's toe resolver already anticipates.
 */
export const KNOWN_HIP_BONE_NAMES = [
  { left: "upperleg01.L", right: "upperleg01.R" },
  { left: "mixamorig:LeftUpLeg", right: "mixamorig:RightUpLeg" },
  { left: "thigh.L", right: "thigh.R" },
] as const;

/**
 * See `resolve-toe-bones.ts` for why both the raw and `PropertyBinding`-sanitised spelling are
 * tried: `GLTFLoader` runs every node name through `PropertyBinding.sanitizeNodeName`, which strips
 * the dot `upperleg01.L` carries in the GLB, so the loaded scene graph carries `upperleg01L`.
 */
export function resolveHipBone(root: Object3D): { left: Object3D | null; right: Object3D | null } {
  for (const names of KNOWN_HIP_BONE_NAMES) {
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
