/**
 * #342c — how a wall-mounted fixture is turned to face the wall it is mounted on.
 *
 * Lives in its own module rather than in `environment-zone-templates.ts`, which is at its
 * 500-line zone budget: this is a distinct concern (fixture ORIENTATION) from that file's
 * subject (fixture POSITION), and consumers of one rarely need the other.
 *
 * claimScope: the yaw convention for architecture fixtures authored facing +Z.
 * notEvidenceFor: where a fixture is placed, which wall it belongs to, or how far from it.
 */

import type { NamedShellWall } from "./environment-descriptors.js";

export type { NamedShellWall };

/**
 * Yaw that turns a fixture authored facing +Z so it faces INTO the room from its named
 * wall.
 *
 * A rotation of θ about Y maps local +Z to (sin θ, 0, cos θ), so the four walls fall out of
 * that identity rather than from a table of tuned angles:
 *   -x wall -> face +X -> sin θ = 1  -> +π/2
 *   +x wall -> face −X -> sin θ = −1 -> −π/2
 *   -z wall -> face +Z ->              0
 *   +z wall -> face −Z ->              π
 *
 * Applied only when the slot sets `facesWall`. A fixture that is anchored NEAR a wall but
 * is free-standing (the door leaf) keeps facing the learner.
 */
export function wallFacingYawRadians(wall: NamedShellWall): number {
  if (wall === "-x") return Math.PI / 2;
  if (wall === "+x") return -Math.PI / 2;
  if (wall === "+z") return Math.PI;
  return 0;
}
