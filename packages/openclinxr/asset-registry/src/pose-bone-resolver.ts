/**
 * Pose-bone name resolution for runtime pose code (#306).
 *
 * The shipped MPFB2 actor (`mpfb-ob-patient-aisha.glb`, OB triage patient) cannot be posed by any
 * runtime pose code: its 137-joint rig names bones `upperarm01/02.L`, `lowerarm01/02.L`, `wrist.L`,
 * `upperleg01/02.L`, `lowerleg01/02.L`, `spine01-05`, `neck01-03`, `pelvis.L/R`, `root` — while the
 * pose consumers in `apps/ui-xr/src` address canonical landmarks (`upper_armL`, `thighL`, `spine`,
 * ...) and a missing lookup is a SILENT SKIP, not an error.
 *
 * Resolution strategy (measured 2026-08-11, contract `pose-bones-resolve-on-every-rail.test.ts`):
 *
 *   1. IDENTITY first — a rig that already carries the canonical sanitised name resolves to itself.
 *      This covers the 23-bone Anny and body-param/library rails unchanged (14/14 today).
 *   2. ALIAS MAP second — the MPFB2 rig gets an honest landmark -> shipped-bone map. The map is
 *      wired from MPFB's own rig naming (`rig.*.json` convention), not invented.
 *
 * WHY NOT RE-RIG: re-rigging Aisha down to the 23-bone armature would buy resolution by discarding
 * the fingers, `jaw`, `tongue`, 5-segment spine and 3-segment neck that D11 names MPFB for (contract
 * (3) is the clause that refuses it). The alias map keeps the full rig AND resolves every landmark.
 *
 * WHY NOT NEAREST-JOINT / POSITION: geometric nearest-neighbour picks `oris02` (a mouth bone) for
 * `head`, and joint POSITION conflates rig with pose (A-posed Anny hands at 0.42 stature vs Aisha's
 * wrists at 0.615). Ancestry — checked by the contract — is topological and invariant to both.
 *
 * The alias targets below are the sanitised (dot-stripped, per three.js
 * `PropertyBinding.sanitizeNodeName`) bone names on `mpfb-ob-patient-aisha.glb`, verified against
 * the shipped hierarchy: `upperarm01L > lowerarm01L > wristL`, `spine03 > neck01 > head`,
 * `upperleg01L > lowerleg01L`, `root > upperleg01L/R`.
 */

/**
 * MPFB2 rig: canonical runtime pose landmark -> shipped bone name (sanitised, dots stripped).
 *
 * `pelvis` maps to `root` (not `pelvisL`) because the contract requires `pelvis` to be an ancestor
 * of BOTH thighs, and only `root` is an ancestor of both `upperleg01L` and `upperleg01R`.
 * `chest` maps to the top spine segment `spine01` (directly below `neck01`, above `spine02`).
 */
export const MPFB2_RIG_BONE_NAMES: Readonly<Record<string, string>> = {
  upper_armL: "upperarm01L",
  upper_armR: "upperarm01R",
  forearmL: "lowerarm01L",
  forearmR: "lowerarm01R",
  handL: "wristL",
  handR: "wristR",
  thighL: "upperleg01L",
  thighR: "upperleg01R",
  shinL: "lowerleg01L",
  shinR: "lowerleg01R",
  spine: "spine03",
  neck: "neck01",
  head: "head",
  pelvis: "root",
  chest: "spine01",
};

/**
 * Resolve a canonical runtime pose landmark to the bone name present on the given rig.
 *
 * @param landmark  Canonical pose landmark, three.js-sanitised (e.g. `upper_armL`).
 * @param jointNames  Sanitised bone-name set of the rig (dots stripped).
 * @returns the bone name to address on this rig, or `null` when the landmark cannot be resolved.
 */
export function resolvePoseBone(
  landmark: string,
  jointNames: ReadonlySet<string>,
): string | null {
  if (jointNames.has(landmark)) return landmark;
  const alias = MPFB2_RIG_BONE_NAMES[landmark];
  if (alias !== undefined && jointNames.has(alias)) return alias;
  return null;
}
