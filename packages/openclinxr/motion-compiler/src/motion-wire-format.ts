/** Production motion interchange format; shared by runtime and independent test oracles. */
export const CLIP_SCHEMA_VERSION = "openclinxr.compiled-motion-clip.v1";

export type Vec3Tuple = readonly [number, number, number];
export type QuatTuple = readonly [number, number, number, number];

export const TRACK_PROPERTIES = ["rotationAbsoluteNodeLocal", "translationAbsoluteNodeLocal"] as const;
export type TrackProperty = (typeof TRACK_PROPERTIES)[number];

/**
 * Interpolation is EXPLICIT because the sampled values encode minimum jerk, and a writer that
 * assumes CUBICSPLINE produces motion nobody authored.
 */
export type CompiledMotionTrack =
  | {
      property: "rotationAbsoluteNodeLocal";
      boneName: string;
      canonicalLandmark: string;
      interpolation: "LINEAR";
      times: readonly number[];
      values: readonly QuatTuple[];
    }
  | {
      property: "translationAbsoluteNodeLocal";
      boneName: string;
      canonicalLandmark: string;
      interpolation: "LINEAR";
      times: readonly number[];
      values: readonly Vec3Tuple[];
    };

export type PrimitiveRequest = {
  action: unknown;
  skeletonProfile: unknown;
  /** DERIVED, per brief section 13 — never a caller-chosen integer. A string so a hash can carry it. */
  seed: string;
};

/**
 * WHAT A PRIMITIVE RETURNS. The other half of the seam, and it was open until 2026-08-30.
 *
 * `PrimitiveRequest` was centralised while every plant kept its own OUTPUT dialect. M4 returned
 * `{ primitiveId, durationMs, channels: [{ jointPath, times, values: number[] }] }` and the
 * canonical entry expected `{ actionId, tracks }` — incompatible on four counts at once: channels
 * against tracks, scalar channel values against canonical quaternion and vector tuples, a duration
 * carried on the fragment against a duration derived at clip composition, and `primitiveId`
 * attribution against the `actionId` the entry needs to compose actions back into one clip.
 *
 * A worker implementing M4 would have produced something `compileMotionProgram` cannot consume
 * without an adapter. That is the original three-signature defect surviving on the return side,
 * closed on the request side one round earlier.
 *
 * `actionId`, not `primitiveId`: one program may carry several actions naming the SAME primitive,
 * and the entry composes fragments back onto the actions that asked for them. Attribution by
 * primitive loses that mapping the moment a case guards two regions.
 *
 * No `durationMs` here: duration is a property of the composed clip, taken from the track times.
 * Two sources for one number is how they diverge.
 */
export type CompiledMotionFragment = {
  actionId: string;
  tracks: readonly CompiledMotionTrack[];
};

