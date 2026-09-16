import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { AssetGenerationCapabilityFacade } from "./index.js";

/**
 * PLANTED RED — BothyBoard tsk_8d3e55209b513362 (MSC-C1). IMMUTABLE HEADER.
 *
 * Do not rewrite this block. Flip NOTHING to it.fails; this file is an ORDINARY
 * failing test by contract. Append a `## FIXED` block BELOW it when green.
 *
 * OBSERVABLE TODAY, measured 2026-09-14 on this tree:
 *
 *   packages/openclinxr/motion-compiler/src/program/compile-scenario-motion.ts:303
 *     sets sourceRefs: [input.scenarioId]. compileMotionProgram derives the clip id
 *     only when provenance carries exactly one touch:<ComplianceRegion> ref, so with
 *     [scenarioId] it falls through to the content hash. That is the card's named defect.
 *   packages/openclinxr/capability-gateway/src/motion-manifest-publication.ts
 *     bakeClipFromPayload hardcodes a synthetic upper_armR track, so today the gateway
 *     bakes a track against a bone the pinned actor does not have. Law 2.
 *   NEITHER compileMotionProgram NOR deriveSkeletonProfileFromRigAsset is exported from
 *     packages/openclinxr/motion-compiler/src/index.ts. Its entire surface today is
 *     planMotionProgram, ScenarioMotionCompileInput, bakeMotionProgramToGlb,
 *     readMotionGlbClipId, MotionGlbBakeClip.
 *   Pinned actor GLB: apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb
 *     deriveSkeletonProfileFromRigAsset yields rigFingerprint rig-12ce9026, bindSpace
 *     bind_world_metres, 138 joints. THE RIG HAS NO BONE NAMED upper_armR. Measured
 *     absent, along with forearmR and handR. The real right-arm chain is clavicleR,
 *     upperarm01R, upperarm02R, lowerarm01R, lowerarm02R.
 *
 * THE INPUT IS REAL. The payload carries the pinned scenario/actor/region plus the
 * pinned actor GLB path and the fixture row's responseClip; the sandbox is a real temp
 * dir — the job writes real files, just not the compiled sidecar.
 *
 * claimScope: that the real ED RLQ touch row routes through planning, the exact
 *   loaded-actor skeleton profile, canonical compile, deterministic bake, and
 *   zero-egress publication with one stable clip identity.
 * notEvidenceFor: production_asset_readiness, quest_readiness, clinical_validity,
 *   scoring_validity, visible deformation, or that any actor visibly moves.
 *
 * ## CURRENT RUN (2026-09-16, worktree /private/tmp/openclinxr-c1-recovery-implementation-20260916)
 * Independently re-derived from the pinned actor GLB BEFORE product source edits
 * via deriveSkeletonProfileFromRigAsset on
 * apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb:
 *   rigFingerprint rig-12ce9026, bindSpace bind_world_metres, 138 joints.
 *   upper_armR/forearmR/handR absent; resolved landmarks upperarm01R / lowerarm01R / wristR.
 * Packet current-mpfb-profile-evidence.json matches this fingerprint.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
const ACTOR_GLB = "apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb";
const EXPECTED_CLIP_ID = "openclinxr_role_patient_guard_withdraw_rlq";

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "openclinxr-real-touch-"));
}

function payload() {
  return {
    scenarioId: "ed_chest_pain_priority_v1",
    actorId: "patient_robert_hayes_v1",
    region: "abdomen_rlq",
    actorGlbPath: ACTOR_GLB,
    expectedClipId: EXPECTED_CLIP_ID,
  };
}

describe("the real touch row publishes a compiled motion sidecar", () => {
  it("(1) the succeeded job publishes the sidecar GLB plus CompiledMotionClipV1 JSON under the authored responseClip", async () => {
    const facade = new AssetGenerationCapabilityFacade({ now: () => "2026-09-14T00:00:00.000Z" });
    const record = await facade.submit({
      profile: "local-development",
      capabilityId: "animation-generation",
      payload: payload(),
      policy: { sandboxWorkdir: sandbox() },
    });

    expect(record.status).toBe("succeeded");
    const jobDir = join(record.policy.sandboxWorkdir, record.id);
    const glbBytes = readFileSync(join(jobDir, `${EXPECTED_CLIP_ID}.glb`));
    const clipJson = JSON.parse(
      readFileSync(join(jobDir, `${EXPECTED_CLIP_ID}.compiled-motion-clip.v1.json`), "utf8"),
    ) as { clipId: string };
    expect(clipJson.clipId).toBe(EXPECTED_CLIP_ID);
    expect(record.manifest?.["clipId"]).toBe(EXPECTED_CLIP_ID);
    expect(record.manifest?.outputs ?? []).toContain(join(jobDir, `${EXPECTED_CLIP_ID}.glb`));
    expect(glbBytes.length).toBeGreaterThan(0);
  });

  it("(2) the published sidecar carries one stable clip identity: clipId equals the fixture row, GLB readback, deterministic bytes, mutation sensitivity", async () => {
    const facade = new AssetGenerationCapabilityFacade({ now: () => "2026-09-14T00:00:00.000Z" });
    const first = await facade.submit({
      profile: "local-development",
      capabilityId: "animation-generation",
      payload: payload(),
      policy: { sandboxWorkdir: sandbox() },
    });
    expect(first.status).toBe("succeeded");
    const firstDir = join(first.policy.sandboxWorkdir, first.id);
    const firstBytes = readFileSync(join(firstDir, `${EXPECTED_CLIP_ID}.glb`));

    const second = await facade.submit({
      profile: "local-development",
      capabilityId: "animation-generation",
      payload: payload(),
      policy: { sandboxWorkdir: sandbox() },
    });
    expect(second.status).toBe("succeeded");
    const secondBytes = readFileSync(join(second.policy.sandboxWorkdir, second.id, `${EXPECTED_CLIP_ID}.glb`));
    expect(Buffer.from(secondBytes).equals(Buffer.from(firstBytes))).toBe(true);

    const mutated = await facade.submit({
      profile: "local-development",
      capabilityId: "animation-generation",
      payload: { ...payload(), region: "chest_L" },
      policy: { sandboxWorkdir: sandbox() },
    });
    expect(mutated.status).toBe("succeeded");
    const mutatedClipId = mutated.manifest?.["clipId"] as string;
    expect(mutatedClipId).not.toBe(EXPECTED_CLIP_ID);
    const mutatedBytes = readFileSync(
      join(mutated.policy.sandboxWorkdir, mutated.id, `${mutatedClipId}.glb`),
    );
    expect(Buffer.from(mutatedBytes).equals(Buffer.from(firstBytes))).toBe(false);
  });

  it("(3) every emitted track names a joint on the derived profile, and publication stays zero-egress with zero spend", async () => {
    const facade = new AssetGenerationCapabilityFacade({ now: () => "2026-09-14T00:00:00.000Z" });
    const record = await facade.submit({
      profile: "local-development",
      capabilityId: "animation-generation",
      payload: payload(),
      policy: { sandboxWorkdir: sandbox() },
    });
    expect(record.status).toBe("succeeded");
    const jobDir = join(record.policy.sandboxWorkdir, record.id);
    const clipJson = JSON.parse(
      readFileSync(join(jobDir, `${EXPECTED_CLIP_ID}.compiled-motion-clip.v1.json`), "utf8"),
    ) as {
      clipId: string;
      targetRig: { rigFingerprint: string; skeletonProfileHash: string; jointNames: readonly string[] };
      tracks: Array<{ boneName: string }>;
    };
    expect(clipJson.targetRig.rigFingerprint).toBe("rig-12ce9026");
    const jointNames = new Set(clipJson.targetRig.jointNames);
    expect(clipJson.tracks.length).toBeGreaterThan(0);
    for (const track of clipJson.tracks) {
      expect(jointNames.has(track.boneName), `track addresses ${track.boneName}, which is not on rig-12ce9026`).toBe(true);
    }
    expect(record.provenance?.externalNetworkUsed).toBe(false);
    expect(record.provenance?.spendCents).toBe(0);
    expect(record.policy.allowExternalNetwork).toBe(false);
  });

  it("(4) COUNTERWEIGHT: a payload that merely supplies the expected clip id does not publish the sidecar", async () => {
    const facade = new AssetGenerationCapabilityFacade({ now: () => "2026-09-14T00:00:00.000Z" });
    const record = await facade.submit({
      profile: "local-development",
      capabilityId: "animation-generation",
      payload: { clipId: EXPECTED_CLIP_ID },
      policy: { sandboxWorkdir: sandbox() },
    });
    expect(record.status).toBe("succeeded");
    const jobDir = join(record.policy.sandboxWorkdir, record.id);
    let sidecarPresent = true;
    try {
      readFileSync(join(jobDir, `${EXPECTED_CLIP_ID}.compiled-motion-clip.v1.json`));
    } catch {
      sidecarPresent = false;
    }
    expect(sidecarPresent, "a bare clipId payload must not produce the compiled sidecar").toBe(false);
  });
});
