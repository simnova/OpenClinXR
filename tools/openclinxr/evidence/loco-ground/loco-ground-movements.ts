/**
 * Proving-ground movement descriptor: one typed row per movement the loco-ground
 * vehicle can run, replacing the hard-coded 6 m route and "walk" clip-name match.
 *
 * Default entry `physician-walk-6m` reproduces today's invocation byte-for-byte:
 * same route-length check, same clip match, same GLB override, same output paths.
 * Second entry `nurse-walk-6m`: the nurse GLB ships the same walk clip name bound
 * to the nurse rig (clip census 2026-10-13 lists `openclinxr_retarget_walk_source`
 * in both GLBs). No turn-in-place clip exists in any shipped GLB (same census),
 * so no turn entry is added. Running a non-default entry additionally needs
 * actor-id plumbing in the capture isolate step (it resolves the physician actor
 * from the bedside-approach evidence); that edit is out of scope and the capture
 * refuses unknown movement ids rather than guessing.
 */

export type LocoGroundRoute = { kind: "walk"; lengthMeters: number } | { kind: "in-place" };

export type LocoGroundMovement = {
  /** CLI id (`--movement=<id>`). */
  id: string;
  /** Repo-relative path to the actor GLB carrying the clip. */
  actorGlb: string;
  /** Exact animation name played at runtime. */
  clipName: string;
  /** Substring matched against GLB animation names when reading clip bytes. */
  clipMatch: string;
  /** Route length the capture refuses to run without, or in-place. */
  route: LocoGroundRoute;
  /** Expected runtime phase sequence for the pass. */
  phases: string[];
  /** Observed steady-state contact count on the default row, null when never run. */
  expectedContacts: number | null;
};

export const LOCO_GROUND_MOVEMENTS: LocoGroundMovement[] = [
  {
    id: "physician-walk-6m",
    actorGlb: "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb",
    clipName: "openclinxr_retarget_walk_source",
    clipMatch: "walk",
    route: { kind: "walk", lengthMeters: 6 },
    phases: ["walking", "settling", "arrived"],
    // 2026-10-13 lockOff before-run: 24 contacts, 12 strides, 95 steady frames.
    expectedContacts: 24,
  },
  {
    id: "nurse-walk-6m",
    actorGlb: "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb",
    clipName: "openclinxr_retarget_walk_source",
    clipMatch: "walk",
    route: { kind: "walk", lengthMeters: 6 },
    phases: ["walking", "settling", "arrived"],
    expectedContacts: null,
  },
];

export const DEFAULT_LOCO_GROUND_MOVEMENT_ID = "physician-walk-6m";

/** Look up a movement row; unknown ids refuse rather than falling back. */
export function locoGroundMovementFromId(id: string): LocoGroundMovement {
  const found = LOCO_GROUND_MOVEMENTS.find((m) => m.id === id);
  if (!found) {
    throw new Error(`unknown movement ${id}: ${LOCO_GROUND_MOVEMENTS.map((m) => m.id).join(",")}`);
  }
  return found;
}
