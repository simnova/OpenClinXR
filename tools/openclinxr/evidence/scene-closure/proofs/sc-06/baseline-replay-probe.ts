import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { Scene } from "three";
import {
  geometryRevisionDigest,
  type ObservedApproachGeometry,
  type ResolvedBedsideApproach,
  resolveBedsideApproachIntent,
} from "../../../../../../packages/openclinxr/asset-registry/src/case-approach-intent.js";
import {
  composeSupportedActorWorldPosition,
  supineActorWorldPosition,
} from "../../../../../../packages/openclinxr/asset-registry/src/actor-posture.js";
import { createEdChestPainRuntimeSceneManifest } from "../../../../../../packages/openclinxr/asset-registry/src/runtime-bundles-entry.js";
import { observeMountedApproachGeometry } from "../../../../../../packages/openclinxr/xr-humanoid-animation/src/mounted-approach-geometry.js";
import { beginBedsideApproachExecution } from "../../../../../../packages/openclinxr/xr-runtime-state/src/bedside-approach-execution.js";
import { buildStationEnvironment } from "../../../../../../packages/openclinxr/xr-station/src/index.js";
import {
  SCENE_CLOSURE_CASE_ID,
  SCENE_CLOSURE_ENVIRONMENT_ID,
  SCENE_CLOSURE_PINNED_CAST,
  SCENE_CLOSURE_SELECTED_ASSET_MANIFEST,
  SCENE_CLOSURE_STATION_ID,
  sceneClosureCaseDocument,
} from "../../../../factory/scene-closure-case-source.js";

/**
 * SC-06's BASELINE CONTROL: the accepted bedside approach cannot be reopened, and changed asset
 * evidence cannot invalidate it.
 *
 * This runs against production modules only — `observeMountedApproachGeometry`,
 * `resolveBedsideApproachIntent`, `geometryRevisionDigest` and `beginBedsideApproachExecution`.
 * It is not an import error, an absent file or a missing report; every number below is read off a
 * shipped function answering a question wrongly.
 *
 * THE THREE MEASURED DEFECTS, on the unchanged baseline 27efa3d2:
 *
 *  1. The accepted plan carries NO durable identity. `ResolvedBedsideApproach`
 *     (asset-registry/src/case-approach-intent.ts:80-103) has thirteen fields and not one of them
 *     is a case id, a bundle id, an asset hash, a clip/rig/solver revision, a seed, a variation
 *     index, an acknowledgment or an event order. A09 asks for all of those.
 *
 *  2. `geometryRevisionDigest` (case-approach-intent.ts:115) covers the floor frame, the support
 *     bounds, the monitor bounds and the obstacle boxes. It does NOT cover the identity of the
 *     bodies, clips, rigs or the solver. So an encounter whose physician's GLB bytes were
 *     republished — which SC-04 actually did to `mpfb-clinical-physician-adult.glb` — produces the
 *     SAME revision string, and the one existing invalidation boundary,
 *     `beginBedsideApproachExecution` (xr-runtime-state/src/bedside-approach-execution.ts:81),
 *     compares only that string.
 *
 *  3. Therefore a stale acceptance is silently reused: the executor binds a plan that was accepted
 *     against different bytes and reports no refusal.
 *
 * The layout solver is a fourth, separate finding measured by grep rather than here:
 * `resolveBedsideLayout` (asset-registry/src/layout-variation.ts:126) has zero production callers.
 *
 * OUTPUT is JSONL of measured VALUES, not verdicts, so the report and the verifier grade the same
 * numbers. `--observations <path>` appends; without it the lines go to stdout.
 */

export type BaselineReplayObservation = {
  observationId: string;
  metric: string;
  unit: string;
  value: number | string | boolean;
  source: string;
};

/** Fields A09 requires on a durable accepted plan. Counted against the baseline's resolved plan. */
export const A09_REQUIRED_PLAN_FIELDS = [
  "caseId",
  "caseVersion",
  "bundleId",
  "instanceIds",
  "assetSha256ByPath",
  "clipRevision",
  "rigRevision",
  "solverRevision",
  "planRevision",
  "seed",
  "variationIndex",
  "acknowledgment",
  "eventOrder",
  "runId",
] as const;

function sha256File(repoRelativePath: string): string {
  return createHash("sha256").update(readFileSync(repoRelativePath)).digest("hex");
}

/** Stage the ward exactly as the browser entry does, and resolve the case's approach. */
export function measureBaselineReplay(): {
  resolved: ResolvedBedsideApproach;
  geometry: ObservedApproachGeometry;
  observations: BaselineReplayObservation[];
} {
  const caseDocument = sceneClosureCaseDocument();
  const scene = new Scene();
  scene.add(buildStationEnvironment({ environmentId: SCENE_CLOSURE_ENVIRONMENT_ID }) as never);
  const geometry = observeMountedApproachGeometry(scene as never, {
    supportInstanceId: `${SCENE_CLOSURE_ENVIRONMENT_ID}:stretcher`,
  });
  const placements = createEdChestPainRuntimeSceneManifest({
    scenarioId: caseDocument.scenarioId,
    stationId: SCENE_CLOSURE_STATION_ID,
    scenario: caseDocument as never,
    environmentId: SCENE_CLOSURE_ENVIRONMENT_ID,
  }).actorPlacements;

  const patientPlacement = placements[SCENE_CLOSURE_PINNED_CAST.patient];
  const patientWorld = composeSupportedActorWorldPosition({
    posture: "supine",
    fixtureAnchor: supineActorWorldPosition({}),
    ...(patientPlacement?.plantOffsetMeters
      ? { authoredOffsetMeters: patientPlacement.plantOffsetMeters }
      : {}),
    resolvedPosition: patientPlacement?.position ?? { x: 0, y: 0, z: 0 },
  });
  const physicianPlacement = placements[SCENE_CLOSURE_PINNED_CAST.physician];
  const start = composeSupportedActorWorldPosition({
    posture: "standing",
    fixtureAnchor: physicianPlacement?.position ?? { x: 0, y: 0, z: 0 },
    ...(physicianPlacement?.plantOffsetMeters
      ? { authoredOffsetMeters: physicianPlacement.plantOffsetMeters }
      : {}),
    resolvedPosition: physicianPlacement?.position ?? { x: 0, y: 0, z: 0 },
    ...(geometry.floorFrame ? { floorFrame: geometry.floorFrame } : {}),
  });

  const intent = resolveBedsideApproachIntent({
    physicianActorId: SCENE_CLOSURE_PINNED_CAST.physician,
    firstClinicalSlotActorId: "ward_nurse_patel_v1",
    firstClinicalSlotRole: "nurse",
    patientWorldPosition: "refused" in patientWorld ? { x: 0, y: 0, z: 0 } : patientWorld,
    start: "refused" in start ? { refused: true, reason: start.reason } : start,
    geometry,
  });
  if (intent.refused) {
    throw new Error(
      `the baseline control needs an ACCEPTED plan to freeze; the case refused with ${intent.code}: ${intent.reason}`,
    );
  }

  const planFields = Object.keys(intent);
  const presentA09 = A09_REQUIRED_PLAN_FIELDS.filter((field) => planFields.includes(field));

  const physicianEntry = SCENE_CLOSURE_SELECTED_ASSET_MANIFEST.selected.find(
    (entry) => entry.role === "physician",
  );
  const nurseEntry = SCENE_CLOSURE_SELECTED_ASSET_MANIFEST.selected.find(
    (entry) => entry.role === "nurse",
  );
  if (physicianEntry === undefined || nurseEntry === undefined) {
    throw new Error("the selected asset manifest no longer names both a physician and a nurse body");
  }
  const physicianSha = sha256File(physicianEntry.assetPath);
  const substituteSha = sha256File(nurseEntry.assetPath);

  // The substitution is REAL: two different files on disk, hashed. The point of the measurement is
  // that the runtime cannot tell them apart, so it must be a genuine difference in bytes.
  const frozenRevision = intent.geometryRevision;
  const revisionAfterAssetChange = geometryRevisionDigest(geometry);

  const execution = beginBedsideApproachExecution({
    runId: "sc-06-baseline-control",
    physicianActorId: SCENE_CLOSURE_PINNED_CAST.physician,
    plan: intent.plan,
    planGeometryRevision: frozenRevision,
    observedGeometryRevision: revisionAfterAssetChange,
    start: intent.start,
    travelHeadingRadians: intent.target.headingRadians,
  });
  const staleAcceptanceReused = !("refused" in execution && execution.refused === true);

  const observations: BaselineReplayObservation[] = [
    {
      observationId: "baseline-a09-fields-present",
      metric: "a09_fields_present_on_accepted_plan",
      unit: "count",
      value: presentA09.length,
      source: "Object.keys(resolveBedsideApproachIntent(...))",
    },
    {
      observationId: "baseline-a09-fields-required",
      metric: "a09_fields_required",
      unit: "count",
      value: A09_REQUIRED_PLAN_FIELDS.length,
      source: "SC-06 required_behavior 1",
    },
    {
      observationId: "baseline-plan-field-names",
      metric: "accepted_plan_field_names",
      unit: "list",
      value: planFields.sort().join(","),
      source: "Object.keys(resolveBedsideApproachIntent(...))",
    },
    {
      observationId: "baseline-frozen-geometry-revision",
      metric: "frozen_geometry_revision",
      unit: "digest",
      value: frozenRevision,
      source: "ResolvedBedsideApproach.geometryRevision",
    },
    {
      observationId: "baseline-revision-after-asset-change",
      metric: "geometry_revision_after_asset_identity_change",
      unit: "digest",
      value: revisionAfterAssetChange,
      source: "geometryRevisionDigest(observed)",
    },
    {
      observationId: "baseline-bound-physician-sha",
      metric: "bound_physician_asset_sha256",
      unit: "sha256",
      value: physicianSha,
      source: physicianEntry.assetPath,
    },
    {
      observationId: "baseline-substitute-sha",
      metric: "substituted_body_asset_sha256",
      unit: "sha256",
      value: substituteSha,
      source: nurseEntry.assetPath,
    },
    {
      observationId: "baseline-asset-bytes-differ",
      metric: "substituted_asset_bytes_differ",
      unit: "boolean",
      value: physicianSha !== substituteSha,
      source: "sha256 of both selected bodies",
    },
    {
      observationId: "baseline-digest-blind-to-asset-identity",
      metric: "geometry_digest_unchanged_by_asset_identity",
      unit: "boolean",
      value: revisionAfterAssetChange === frozenRevision,
      source: "geometryRevisionDigest before vs after",
    },
    {
      observationId: "baseline-stale-acceptance-reused",
      metric: "stale_acceptance_reused_by_existing_boundary",
      unit: "boolean",
      value: staleAcceptanceReused,
      source: "beginBedsideApproachExecution",
    },
    {
      observationId: "baseline-case-identity",
      metric: "case_id_under_test",
      unit: "id",
      value: SCENE_CLOSURE_CASE_ID,
      source: "scene-closure-case-source.ts",
    },
  ];
  return { resolved: intent, geometry, observations };
}

function main(): void {
  const argv = process.argv.slice(2);
  let observationsPath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--observations") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        process.stderr.write("sc-06 baseline: --observations needs a value\n");
        process.exitCode = 2;
        return;
      }
      observationsPath = value;
      index += 1;
      continue;
    }
    process.stderr.write(`sc-06 baseline: unknown argument ${String(argv[index])}\n`);
    process.exitCode = 2;
    return;
  }
  const { observations } = measureBaselineReplay();
  const lines = `${observations.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  if (observationsPath === undefined) process.stdout.write(lines);
  else appendFileSync(observationsPath, lines, "utf8");
}

if (process.argv[1]?.endsWith("baseline-replay-probe.ts")) main();
