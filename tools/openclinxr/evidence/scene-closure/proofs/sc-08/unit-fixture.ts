import { createHash } from "node:crypto";
import {
  type ClosureInspection,
  inspectClosureEvidence,
  REQUIRED_SOURCE_PATHS,
  type RetainedObject,
} from "./closure-inspection.js";

const sha = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");
/** Synthetic UNIT controls only; never written as a production completion report or media. */
export function unitControl() {
  const commit = "1".repeat(40);
  const physicianPath =
    "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb";
  const gltf = Buffer.from(
    JSON.stringify({
      skins: [{ joints: Array.from({ length: 137 }, (_, i) => i) }],
      animations: [{ name: "openclinxr_retarget_walk_formal_cc0" }],
    }),
  );
  const glb = Buffer.alloc(20 + gltf.length);
  glb.writeUInt32LE(0x46546c67, 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(gltf.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  gltf.copy(glb, 20);
  const sources = new Map<string, Buffer>(
    REQUIRED_SOURCE_PATHS.map((name) => [
      name,
      name === physicianPath ? glb : Buffer.from(name),
    ]),
  );
  sources.set(
    "tools/openclinxr/evidence/scene-closure/proofs/sc-08/a.ts",
    Buffer.from("changed source"),
  );
  let inputs = [...sources].map(([path, bytes]) => ({
    path,
    sha256: sha(bytes),
  }));
  const runId = "unit-run";
  const objects = new Map<string, RetainedObject>();
  const put = (id: string, value: unknown, mediaType = "application/json") => {
    const bytes = Buffer.isBuffer(value)
      ? value
      : Buffer.from(JSON.stringify(value));
    const object = {
      bytes,
      absolutePath: `/unit/${id}`,
      sha256: sha(bytes),
      runId,
      mediaType,
    };
    objects.set(id, object);
    return object;
  };
  const video = put(
    "video",
    Buffer.from("UNIT decoder injection, not real video"),
    "video/mp4",
  );
  const actorIds = [
    "patient_margaret_ellis_v1",
    "senior_resident_ward_v1",
    "ward_nurse_patel_v1",
    "daughter_lena_ellis_v1",
  ];
  const assetPaths = REQUIRED_SOURCE_PATHS.filter((name) =>
    name.endsWith(".glb"),
  );
  const bundle = put("bundle", {
    bundleId: "bundle-1",
    scenarioId: "scene_closure_supine_bedside_v1",
    actors: actorIds.map((actorId, i) => ({
      actorId,
      model: {
        blob: {
          blobName: assetPaths[i]?.replace(/^apps\/ui-xr\/public\//u, ""),
        },
      },
    })),
  });
  const planValue = {
    variation: { seed: "a".repeat(64) },
    case: {
      caseId: "scene_closure_supine_bedside_v1",
      caseVersion: 2,
      environmentId: "inpatient_ward_room_v1",
    },
    instances: [
      {
        instanceId: "inpatient_ward_room_v1:stretcher",
        kind: "support",
        contentId: "ward_stretcher_v1",
      },
      ...actorIds.map((contentId, i) => ({
        contentId,
        assetPath: assetPaths[i],
        assetSha256: sha(sources.get(assetPaths[i]!)!),
      })),
    ],
  };
  const plan = put("plan", planValue);
  sources.set(
    "packages/openclinxr/asset-registry/src/case-frozen-scene-plans.ts",
    Buffer.from(
      `Object.freeze(${JSON.stringify({ scene_closure_supine_bedside_v1: planValue })} as Record<string, DurableAcceptedScenePlanRecord>);`,
    ),
  );
  inputs = [...sources].map(([path, bytes]) => ({ path, sha256: sha(bytes) }));
  const selectedCase = put("case", {
    scenarioId: "scene_closure_supine_bedside_v1",
    version: 2,
  });
  const identities = {
    caseId: "scene_closure_supine_bedside_v1",
    caseVersion: 2,
    caseSha256: selectedCase.sha256,
    bundleId: "bundle-1",
    bundleSha256: bundle.sha256,
    acceptedPlanSha256: plan.sha256,
    patientActorId: "patient_margaret_ellis_v1",
    physicianActorId: "senior_resident_ward_v1",
    physicianClip: "openclinxr_retarget_walk_formal_cc0",
    physicianAssetSha256: sha(glb),
    rig: "mpfb2_standard_137_joint",
    solverSeed: "a".repeat(64),
    environmentId: "inpatient_ward_room_v1",
    supportInstanceId: "inpatient_ward_room_v1:stretcher",
    supportContentId: "ward_stretcher_v1",
  };
  const measurements = {
    recorderStartedAtMs: 0,
    activationAtMs: 100,
    arrivalAtMs: 1500,
    stopAtMs: 1800,
    supportContactCount: 4,
    skinnedJointCount: 137,
    arrivalDistanceMeters: 0.01,
    headingErrorRadians: 0.02,
    stopSpeedMetersPerSecond: 0,
  };
  const trace = put("trace", {
    runId,
    clock: "video-relative-ms",
    headingUnit: "radians",
    identities,
    measurements,
  });
  const executionInputs = inputs.filter((input) =>
    (REQUIRED_SOURCE_PATHS as readonly string[]).includes(input.path),
  );
  put("receipt", {
    runId,
    sourceCommit: commit,
    inputs: executionInputs,
    videoSha256: video.sha256,
    traceSha256: trace.sha256,
    identities,
  });
  put("watch", {
    reviewerId: "reviewer",
    runId,
    sourceCommit: commit,
    videoSha256: video.sha256,
    decodedFrames: 60,
    watchedThroughSeconds: 2,
  });
  const edited = put(
    "edited-video",
    Buffer.from("UNIT injected edit bytes"),
    "video/mp4",
  );
  put("edit-receipt", {
    runId,
    sourceCommit: commit,
    sourceVideoSha256: video.sha256,
    editedVideoSha256: edited.sha256,
    sourceRanges: [{ startSeconds: 0, endSeconds: 2 }],
  });
  put("edited-watch", {
    reviewerId: "reviewer",
    runId,
    sourceCommit: commit,
    videoSha256: edited.sha256,
    decodedFrames: 60,
    watchedThroughSeconds: 2,
  });
  const report: Record<string, unknown> = {
    implementation: {
      productSourceCommit: commit,
      inputs,
      changedFiles: [
        "tools/openclinxr/evidence/scene-closure/proofs/sc-08/a.ts",
      ],
    },
    recordingBinding: {
      executionSourceCommit: commit,
      executionInputs,
      claimMode: "historical",
      runId,
      videoArtifactId: "video",
      traceArtifactId: "trace",
      runReceiptArtifactId: "receipt",
      watchReceiptArtifactId: "watch",
      bundleArtifactId: "bundle",
      acceptedPlanArtifactId: "plan",
      caseArtifactId: "case",
      editedVideoArtifactId: "edited-video",
      editReceiptArtifactId: "edit-receipt",
      editedWatchReceiptArtifactId: "edited-watch",
    },
    reviews: [
      {
        reviewerId: "reviewer",
        decision: "accepted",
        distinctFromImplementer: true,
        reviewedSourceCommit: commit,
        retrievedArtifactIds: ["video", "edited-video"],
      },
    ],
  };
  const inspection: ClosureInspection = {
    sourceReader: {
      read: (revision, name) =>
        revision === commit
          ? (sources.get(name) ?? new Error("missing source"))
          : new Error("wrong revision"),
      current: (name) => sources.get(name) ?? new Error("missing current"),
    },
    decodeVideo: () => ({ durationSeconds: 2, frames: 60 }),
  };
  const verify = () =>
    inspectClosureEvidence(
      report,
      objects,
      ["tools/openclinxr/evidence/scene-closure/proofs/sc-08"],
      inspection,
    );
  return {
    report,
    objects,
    sources,
    inspection,
    verify,
    put,
    measurements,
    identities,
    inputs,
    executionInputs,
  };
}
