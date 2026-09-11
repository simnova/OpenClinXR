import { describe, expect, it } from "vitest";

import { planMotionProgram } from "./index.js";

/**
 * PLANTED RED — BothyBoard card tsk_c0d67f74a7891719 (instrument stage). IMMUTABLE HEADER.
 *
 * Do not rewrite this block. Flip `it.fails` -> `it` and append a `## FIXED` block BELOW it.
 * Do not edit the measured tables or the paths in this header.
 *
 * OBSERVABLE TODAY, measured 2026-09-11 on this tree:
 *
 *   packages/openclinxr/motion-compiler/src/compile-motion-program.ts   EXISTS (keystone entry)
 *   packages/openclinxr/motion-compiler/src/motion-glb-bake.ts          ABSENT
 *   packages/openclinxr/motion-compiler/src/index.ts                    exports planMotionProgram only
 *
 *   grep -rn "bakeMotionProgramToGlb\|motionGlbBake\|readMotionGlb" packages/openclinxr/motion-compiler/src -> 0 hits
 *
 * So a MotionProgram compiles to a CompiledMotionClipV1 in memory and stops there: no module
 * bakes clip tracks to GLB bytes, no readback proves those bytes carry the clip, and no
 * manifest address ties the baked bytes to the clipId the runtime will ask for. That is the
 * bake half of the bake vertical this card instruments; the gateway half (job publishes the
 * GLB) and the UI-XR half (mixer advances from the manifest address) are sibling REDs.
 *
 * THE INPUT IS REAL. The program below is planned by the public entrypoint from the shipped
 * abdomen_rlq guarding row shape, and the compile below runs through the keystone entry with
 * an injected primitive so no solver or rig is needed — what is under test is bake identity
 * plumbing, not primitive motion.
 *
 * claimScope: that a deterministic bake turns a compiled clip into GLB bytes that read back
 *   with the exact clip identity, byte-identical across runs.
 * notEvidenceFor: clinical_validity, scoring_validity, production_asset_readiness,
 *   quest_readiness, animation quality, or that any actor visibly moves.
 */

const ENTRY_MODULE = "./compile-motion-program.js";
const BAKE_MODULE = "./motion-glb-bake.js";

type PrimitiveRequestLike = { action: unknown; skeletonProfile: unknown; seed: string };
type TrackLike = {
  property: "rotationAbsoluteNodeLocal";
  boneName: string;
  canonicalLandmark: string;
  interpolation: "LINEAR";
  times: readonly number[];
  values: readonly (readonly [number, number, number, number])[];
};
type FragmentLike = { actionId: string; tracks: readonly TrackLike[] };
type ClipLike = {
  clipId: string;
  compileIdentity: { deterministicSeed: string };
  tracks: readonly TrackLike[];
};

/**
 * Resolve a plant's module specifier to an ABSOLUTE url before the deferred import, so a
 * missing module reports its real path rather than a mangled one.
 */
function plantModule(specifier: string): string {
  return new URL(specifier, import.meta.url).href;
}

async function loadCompileEntry(): Promise<
  | ((input: {
      program: unknown;
      skeletonProfile: unknown;
      primitives?: Record<string, (r: PrimitiveRequestLike) => FragmentLike>;
    }) => ClipLike)
  | undefined
> {
  try {
    const mod = (await import(/* @vite-ignore */ plantModule(ENTRY_MODULE))) as Record<string, unknown>;
    return mod["compileMotionProgram"] as never;
  } catch {
    return undefined;
  }
}

async function loadBake(): Promise<
  { bakeMotionProgramToGlb: (clip: ClipLike) => Uint8Array; readMotionGlbClipId: (bytes: Uint8Array) => string } | undefined
> {
  try {
    return (await import(/* @vite-ignore */ plantModule(BAKE_MODULE))) as {
      bakeMotionProgramToGlb: (clip: ClipLike) => Uint8Array;
      readMotionGlbClipId: (bytes: Uint8Array) => string;
    };
  } catch {
    return undefined;
  }
}

const PROFILE = {
  rigFingerprint: "rig-fp-bake-red",
  effectorBone: "handR",
  joints: [
    { boneName: "upper_armR", bindLocalPosition: { x: 0.18, y: 1.38, z: 0 } },
    { boneName: "forearmR", parentBoneName: "upper_armR", bindLocalPosition: { x: 0, y: -0.28, z: 0 } },
    { boneName: "handR", parentBoneName: "forearmR", bindLocalPosition: { x: 0, y: -0.26, z: 0 } },
  ],
};

function recordingPrimitives(): Record<string, (r: PrimitiveRequestLike) => FragmentLike> {
  return {
    guard_body_region: (r) => ({
      actionId: (r.action as { actionId: string }).actionId,
      tracks: [
        {
          property: "rotationAbsoluteNodeLocal" as const,
          boneName: "upper_armR",
          canonicalLandmark: "upper_arm_r",
          interpolation: "LINEAR" as const,
          times: [0, 0.45, 0.9],
          values: [[0, 0, 0, 1], [Math.sin(0.1), 0, 0, Math.cos(0.1)], [0, 0, 0, 1]] as (
            | readonly [number, number, number, number]
          )[],
        },
      ],
    }),
  };
}

describe("the bake produces a GLB the runtime loads", () => {
  it.fails("(1) RED: the compiled clip bakes to deterministic GLB bytes that read back its exact clipId", async () => {
    const program = planMotionProgram({
      scenarioId: "adult_abdominal_pain_v1",
      actorId: "patient_elena_vasquez_v1",
      touchResponses: [
        {
          region: "abdomen_rlq",
          responseKind: "guarding",
          forceThreshold: 0.28,
          emotionEventId: "guard_rlq_v1",
          emotion: "pain",
          responseClip: "openclinxr_role_patient_guard_withdraw_rlq",
          dialogueLine: "Ow— that hurts a lot.",
          traceTag: "clinical_touch_guard_rlq",
        },
      ],
    });

    const compileMotionProgram = await loadCompileEntry();
    expect(typeof compileMotionProgram, `${ENTRY_MODULE} must export compileMotionProgram`).toBe("function");
    const clip = compileMotionProgram!({ program, skeletonProfile: PROFILE, primitives: recordingPrimitives() });

    const bake = await loadBake();
    expect(typeof bake?.bakeMotionProgramToGlb, `${BAKE_MODULE} must export bakeMotionProgramToGlb`).toBe("function");

    const first = bake!.bakeMotionProgramToGlb(clip);
    const second = bake!.bakeMotionProgramToGlb(clip);

    // GLB magic, little-endian "glTF".
    const view = new DataView(first.buffer, first.byteOffset, first.byteLength);
    expect(view.getUint32(0, true)).toBe(0x46546c67);

    // The bytes carry the clip: readback identity IS the compiled identity.
    expect(bake!.readMotionGlbClipId(first)).toBe(clip.clipId);

    // Deterministic: the same clip bakes to byte-identical output.
    expect(second).toEqual(first);
    expect(clip.compileIdentity.deterministicSeed.length).toBeGreaterThan(0);
  });
});

// NOT TESTED: whether the baked GLB renders plausible motion on any rig; whether the GLB
// carries animation channels a three.js loader accepts; gateway publication; mixer playback.
