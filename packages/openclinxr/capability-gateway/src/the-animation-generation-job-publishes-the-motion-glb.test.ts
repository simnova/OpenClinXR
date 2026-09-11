import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { AssetGenerationCapabilityFacade } from "./index.js";

/**
 * PLANTED RED — BothyBoard card tsk_c0d67f74a7891719 (instrument stage). IMMUTABLE HEADER.
 *
 * Do not rewrite this block. Flip `it.fails` -> `it` and append a `## FIXED` block BELOW it.
 * Do not edit the measured tables or the paths in this header.
 *
 * OBSERVABLE TODAY, measured 2026-09-11 on this tree:
 *
 *   packages/openclinxr/capability-gateway/src/deterministic-asset-adapter.ts   EXISTS (fixture adapter)
 *   packages/openclinxr/capability-gateway/src/motion-manifest-publication.ts   ABSENT
 *
 *   submit({ capabilityId: "animation-generation", ... }) succeeds and writes
 *   `<jobId>/animation-generation-manifest.json` + `<jobId>/animation-generation-source.asset.json`
 *   (deterministic-asset-adapter.ts:27-58) — JSON fixtures, no GLB, no clip identity, and the
 *   manifest `outputs` names only those two JSON files.
 *
 * So the animation-generation job succeeds without publishing any motion bytes: nothing ties the
 * job's artifacts to the clipId the motion-compiler bake produced, and no manifest address exists
 * for the UI-XR runtime to load. That is the gateway half of the bake vertical; the bake half
 * (GLB bytes with exact clip identity) and the UI-XR half (mixer advances from the manifest
 * address) are sibling REDs.
 *
 * THE INPUT IS REAL. The payload carries the clip identity the keystone compiler derives
 * (`responseClipForBodyRegion` naming, `compileIdentity.deterministicSeed`), and the sandbox
 * is a real temp dir — the job writes real files, just not the motion GLB.
 *
 * claimScope: that an animation-generation job publishes the motion GLB under its clip identity
 *   with zero-egress license provenance.
 * notEvidenceFor: production_asset_readiness, quest_readiness, clinical_validity,
 *   scoring_validity, or that any actor visibly moves.
 */

const CLIP_ID = "openclinxr_role_patient_guard_withdraw_rlq";

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "openclinxr-motion-pub-"));
}

describe("the animation-generation job publishes the motion GLB", () => {
  it.fails("(1) RED: the succeeded job artifacts include the motion GLB addressed by clipId", async () => {
    const facade = new AssetGenerationCapabilityFacade({ now: () => "2026-09-11T00:00:00.000Z" });
    const record = await facade.submit({
      profile: "local-development",
      capabilityId: "animation-generation",
      payload: {
        clipId: CLIP_ID,
        motionProgramHash: "program-hash-for-bake-red",
        deterministicSeed: "seed-for-bake-red",
      },
      policy: { sandboxWorkdir: sandbox() },
    });

    expect(record.status).toBe("succeeded");
    const glb = record.artifacts.find((artifact) => artifact.path.endsWith(".glb"));
    expect(glb, "no .glb artifact was published for the motion clip").toBeDefined();
    expect(glb?.mediaType).toBe("model/gltf-binary");
    expect(glb?.path).toContain(CLIP_ID);
    expect(record.manifest?.outputs ?? []).toContain(glb?.path);
  });

  it.fails("(2) RED: the publication carries motion license provenance with zero egress and zero spend", async () => {
    const facade = new AssetGenerationCapabilityFacade({ now: () => "2026-09-11T00:00:00.000Z" });
    const record = await facade.submit({
      profile: "local-development",
      capabilityId: "animation-generation",
      payload: { clipId: CLIP_ID },
      policy: { sandboxWorkdir: sandbox() },
    });

    expect(record.status).toBe("succeeded");
    expect(record.provenance?.license).toContain("motion");
    expect(record.provenance?.externalNetworkUsed).toBe(false);
    expect(record.provenance?.spendCents).toBe(0);
    expect(record.policy.allowExternalNetwork).toBe(false);
  });
});

// NOT TESTED: whether the published GLB bytes decode to the compiled clip; whether the manifest
// address resolves from a learner runtime; mixer playback.
