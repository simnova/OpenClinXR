import { AnimationClip, AnimationMixer, Group, Object3D, VectorKeyframeTrack } from "three";
import { describe, expect, it } from "vitest";

/**
 * PLANTED RED — BothyBoard card tsk_c0d67f74a7891719 (instrument stage). IMMUTABLE HEADER.
 *
 * Do not rewrite this block. Flip `it.fails` -> `it` and append a `## FIXED` block BELOW it.
 * Do not edit the measured tables or the paths in this header.
 *
 * OBSERVABLE TODAY, measured 2026-09-11 on this tree:
 *
 *   apps/ui-xr/src/main.ts                                mixer exists (clipAction, update)
 *   apps/ui-xr/src/motion-manifest-motion-address.ts      ABSENT
 *
 *   grep -rn "motion-manifest\|manifestMotionClip\|playManifestMotionClip" apps/ui-xr/src -> 0 hits
 *
 * So the runtime plays clips handed to it directly, but nothing resolves a motion manifest
 * address (clipId + GLB path) to a clip and starts it on the mixer — the manifest the gateway
 * publishes has no consumer. That is the UI-XR half of the bake vertical; the bake half (GLB
 * bytes with exact clip identity) and the gateway half (job publishes the GLB) are sibling
 * REDs.
 *
 * THE SUBJECT IS REAL. The clip below is a real three.js AnimationClip on a real toe bone,
 * stepped through the real AnimationMixer — the same seam the frozen-actor-turn test and
 * the case-owned-approach test use. What is under test is manifest addressing: the clip
 * reached by manifest address is the one the mixer advances, and a different clip is not.
 *
 * claimScope: that a manifest-addressed motion clip advances the mixer while other clips
 *   do not.
 * notEvidenceFor: clinical_validity, scoring_validity, production_asset_readiness,
 *   quest_readiness, animation quality, or that any actor visibly moves.
 */

const ADDRESS_MODULE = "./motion-manifest-motion-address.js";
const CLIP_ID = "openclinxr_role_patient_guard_withdraw_rlq";
const OTHER_CLIP = "idle_loop";

function manifestClip(clipId: string): AnimationClip {
  return new AnimationClip(
    clipId,
    1.2,
    [new VectorKeyframeTrack("toe1-1.L.position", [0, 0.6, 1.2], [0, 0.01, 0, 0, 0.15, 0.25, 0, 0.01, 0.5])],
  );
}

/**
 * Resolve a plant's module specifier to an ABSOLUTE url before the deferred import, so a
 * missing module reports its real path rather than a mangled one.
 */
function plantModule(specifier: string): string {
  return new URL(specifier, import.meta.url).href;
}

async function loadAddress(): Promise<
  { playManifestMotionClip: (input: { mixer: AnimationMixer; manifestAddress: { clipId: string }; clips: AnimationClip[] }) => string } | undefined
> {
  try {
    return (await import(/* @vite-ignore */ plantModule(ADDRESS_MODULE))) as {
      playManifestMotionClip: (input: {
        mixer: AnimationMixer;
        manifestAddress: { clipId: string };
        clips: AnimationClip[];
      }) => string;
    };
  } catch {
    return undefined;
  }
}

describe("the manifest-addressed motion clip advances the mixer", () => {
  it.fails("(1) RED: the mixer advances the manifest clip and no other clip", async () => {
    const address = await loadAddress();
    expect(typeof address?.playManifestMotionClip, `${ADDRESS_MODULE} must export playManifestMotionClip`).toBe(
      "function",
    );

    const root = new Group();
    const toe = new Object3D();
    toe.name = "toe1-1.L";
    root.add(toe);

    const mixer = new AnimationMixer(root);
    const other = manifestClip(OTHER_CLIP);
    const played = address!.playManifestMotionClip({
      mixer,
      manifestAddress: { clipId: CLIP_ID },
      clips: [manifestClip(CLIP_ID), other],
    });
    expect(played).toBe(CLIP_ID);

    mixer.update(0.6);
    root.updateMatrixWorld(true);
    expect(toe.position.y).toBeGreaterThan(0.05);

    const otherAction = mixer.existingAction(other);
    expect(otherAction === null || !otherAction.isRunning()).toBe(true);
  });
});

// NOT TESTED: whether the manifest address resolves from a persisted gateway manifest; whether
// the GLB bytes decode to these tracks; gateway publication.
