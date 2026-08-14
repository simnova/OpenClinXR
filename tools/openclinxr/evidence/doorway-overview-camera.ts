/**
 * #398 — the station overview camera must not stand behind the room's own door.
 *
 * The capture camera was an LLM-authored literal — `camera.position.set(1.35, 2.05, 3.15)` at
 * `ui-xr-environment-room-capture.ts:868` — while the door leaf's position is derived per room:
 * `DOOR_LEAF` is `wall_anchor` on `+x` at `DOOR_WALL_INSET_METERS = 0.5`
 * (`environment-zone-templates.ts:415`), `anchorFixtureNearFaceToPlane` puts the assembly's near
 * face at `width/2 − 0.5`, and the assembly half-span is 0.52 (jamb centre 0.48 + jamb half-width
 * 0.04), so the 0.88 m leaf spans `x ∈ [width/2 − 1.46, width/2 − 0.58]`. A constant camera x
 * against a width-derived door band collided in exactly the narrow rooms (6 of 14, measured
 * 2026-08-14; see `the-station-camera-does-not-stand-behind-the-door.test.ts`).
 *
 * This module makes the camera inspectable and deterministic (D9). The camera x derives from the
 * shell width and the constants that DEFINE the leaf — nothing is re-authored:
 *   - `DOOR_WALL_INSET_METERS` is imported from `environment-zone-templates.ts`;
 *   - the leaf BoxGeometry width, the jamb BoxGeometry width and the jamb offset are read from
 *     `buildDoorLeafFixture` in `apps/ui-xr/src/station-architecture-fixtures.ts`.
 *
 * NAMED UNLOCKED DECISION — mirror to the −x side when the known-good x is in-band:
 *   x = 1.35 when 1.35 is outside the leaf's x-span (the eight wide rooms keep today's framing
 *       byte-identical — they are the known-good column and the default capture pair, §7j);
 *   x = −1.35 otherwise (the narrow rooms mirror to the side opposite the +x door leaf, which
 *       removes the door from the frame and clears the leaf band at every width: the mirror
 *       branch fires only when width ≥ 3.86 m, and then −1.35 < width/2 − 1.46 always).
 * y/z keep the shipped values — the declared framing is a doorway-side elevated overview
 * (camera z beyond the front plane `depth/2`, camera y ≥ 1.8 m, both read in clause (2)).
 *
 * claimScope: camera placement derived from the shipped shell descriptors + door constants.
 * notEvidenceFor: actual occlusion of actor plants bank-wide (only the peds bay's three plants
 * were ray-tested by hand); the jamb/header frame (±0.52 vs the leaf's ±0.44) is a wider
 * occluder than this predicate models; whether the resulting captures frame the cast well.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ENVIRONMENT_SHELL_DESCRIPTORS,
  type EnvironmentShellDescriptor,
} from "../../../packages/openclinxr/asset-registry/src/environment-descriptors.js";
import { DOOR_WALL_INSET_METERS } from "../../../packages/openclinxr/asset-registry/src/environment-zone-templates.js";

export type CameraVerdict = {
  environmentId: string;
  roomWidthMeters: number;
  roomDepthMeters: number;
  camera: { x: number; y: number; z: number };
  doorLeafXSpan: [number, number] | null;
  cameraBehindDoorLeaf: boolean;
};

const HERE = dirname(fileURLToPath(import.meta.url));

/** Door geometry, read from the one file that defines it (D1 — no second source of truth). */
const FIXTURES_SOURCE = readFileSync(
  join(HERE, "../../../apps/ui-xr/src/station-architecture-fixtures.ts"),
  "utf8",
);
const DOOR_FN_START = FIXTURES_SOURCE.indexOf("export function buildDoorLeafFixture");
const DOOR_FN_END = FIXTURES_SOURCE.indexOf("export function ", DOOR_FN_START + 1);
if (DOOR_FN_START < 0 || DOOR_FN_END < 0) {
  throw new Error(
    "buildDoorLeafFixture not found in apps/ui-xr/src/station-architecture-fixtures.ts — the door constants this module derives from have moved",
  );
}
const DOOR_FN = FIXTURES_SOURCE.slice(DOOR_FN_START, DOOR_FN_END);

const LEAF_BOX = /leaf = new Mesh\(new BoxGeometry\(([0-9.]+), ([0-9.]+), ([0-9.]+)\)/u.exec(DOOR_FN);
const JAMB_R_BOX = /const jambR = new Mesh\(new BoxGeometry\(([0-9.]+), ([0-9.]+), ([0-9.]+)\)/u.exec(DOOR_FN);
const JAMB_R_POS = /jambR\.position\.set\(([0-9.]+),/u.exec(DOOR_FN);
if (!LEAF_BOX || !JAMB_R_BOX || !JAMB_R_POS) {
  throw new Error(
    "leaf/jamb BoxGeometry or jambR.position not found in buildDoorLeafFixture — the door constants this module derives from have changed shape",
  );
}

/** 0.44 m — half the 0.88 m leaf, from its BoxGeometry. */
const DOOR_LEAF_HALF_WIDTH_METERS = Number(LEAF_BOX[1]) / 2;
/** 0.52 m — jamb centre 0.48 + jamb half-width 0.04, the assembly's half-span about its root. */
const DOOR_ASSEMBLY_HALF_SPAN_METERS = Number(JAMB_R_POS[1]) + Number(JAMB_R_BOX[1]) / 2;

/** Shipped pre-#398 doorway-overview framing. y/z keep these values; x is the rule below. */
const DOORWAY_CAMERA_Y_METERS = 2.05;
const DOORWAY_CAMERA_Z_METERS = 3.15;
/** Known-good x: the eight wide rooms' captures were graded against it (the known-good column). */
const DOORWAY_CAMERA_X_WHEN_CLEAR_METERS = 1.35;

function doorLeafXSpanForWidth(roomWidthMeters: number): [number, number] {
  const centreX =
    roomWidthMeters / 2 - DOOR_WALL_INSET_METERS - DOOR_ASSEMBLY_HALF_SPAN_METERS;
  return [centreX - DOOR_LEAF_HALF_WIDTH_METERS, centreX + DOOR_LEAF_HALF_WIDTH_METERS];
}

function cameraXForSpan(span: [number, number] | null): number {
  if (!span) return DOORWAY_CAMERA_X_WHEN_CLEAR_METERS;
  const x = DOORWAY_CAMERA_X_WHEN_CLEAR_METERS;
  // Mirror to the −x side only when the known-good x lands inside the leaf band. −1.35 is
  // clear of the band at every width (the branch fires only when width ≥ 3.86 m).
  return x >= span[0] && x <= span[1] ? -x : x;
}

function hasDoorLeaf(descriptor: EnvironmentShellDescriptor): boolean {
  return descriptor.fixtureSlots.some((slot) => slot.slotId === "door_leaf");
}

function verdictForDescriptor(descriptor: EnvironmentShellDescriptor): CameraVerdict {
  const span = hasDoorLeaf(descriptor) ? doorLeafXSpanForWidth(descriptor.roomWidthMeters) : null;
  const x = cameraXForSpan(span);
  return {
    environmentId: descriptor.environmentId,
    roomWidthMeters: descriptor.roomWidthMeters,
    roomDepthMeters: descriptor.roomDepthMeters,
    camera: { x, y: DOORWAY_CAMERA_Y_METERS, z: DOORWAY_CAMERA_Z_METERS },
    doorLeafXSpan: span,
    cameraBehindDoorLeaf: span ? x >= span[0] && x <= span[1] : false,
  };
}

/**
 * One verdict per shipped environment descriptor. Doorless descriptors report a null span and
 * keep the shipped framing — a room without a door cannot put the camera behind its own door.
 */
export function deriveDoorwayOverviewCameraForAllEnvironments(): CameraVerdict[] {
  return Object.values(ENVIRONMENT_SHELL_DESCRIPTORS).map(verdictForDescriptor);
}

/** Verdict for an arbitrary shell width — the same rule holds at widths not in the bank. */
export function deriveDoorwayOverviewCameraForWidth(
  roomWidthMeters: number,
  roomDepthMeters: number,
): CameraVerdict {
  const span = doorLeafXSpanForWidth(roomWidthMeters);
  const x = cameraXForSpan(span);
  return {
    environmentId: `synthetic-width-${roomWidthMeters}`,
    roomWidthMeters,
    roomDepthMeters,
    camera: { x, y: DOORWAY_CAMERA_Y_METERS, z: DOORWAY_CAMERA_Z_METERS },
    doorLeafXSpan: span,
    cameraBehindDoorLeaf: x >= span[0] && x <= span[1],
  };
}

/** Capture-side lookup: the environment the capture is photographing, or null if unmapped. */
export function deriveDoorwayOverviewCameraForEnvironment(
  environmentId: string,
): CameraVerdict | null {
  const descriptor = ENVIRONMENT_SHELL_DESCRIPTORS[environmentId];
  return descriptor ? verdictForDescriptor(descriptor) : null;
}
