// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: every number below is a MEASURED
// value from the freeze, not a reference to a math constant. The bedside heading for this ward
// happens to land on pi because the physician faces straight down the long axis of the bed;
// rewriting it as Math.PI would replace an observation with an assertion.
import type { DurableAcceptedScenePlanRecord } from "./accepted-scene-plan-evidence-mod.js";

/**
 * GENERATED — do not hand-edit. Regenerate with:
 *   pnpm exec tsx tools/openclinxr/evidence/scene-closure/proofs/sc-06/freeze-case-scene-plan.ts
 *
 * The accepted scene plan each case was frozen with, keyed by scenario id, so the shipped runtime
 * has something to reopen without a server round trip.
 *
 * IT IS A REAL FREEZE OUTPUT. The generator reads the case document and the four selected humanoid
 * GLBs off disk and hashes their bytes with `node:crypto`; nothing here was typed. The browser
 * cannot produce this — it hashes — which is the server/browser split required behavior 4 asks for.
 *
 * A CASE ABSENT FROM THIS MAP HAS NO FROZEN PLAN, and `admitFrozenScenePlan` returns
 * `no_plan_carried` for it. That is the honest answer, not a failure: most encounters have never
 * been frozen. Only the scene-closure case has been.
 *
 * IF A BOUND ASSET IS REPUBLISHED this record goes stale, and the footgun lands on the EVIDENCE
 * GATE rather than the browser runtime: `verify.ts` rehashes the bytes off disk and refuses with
 * a digest drift, while the runtime's observed-room admission carries the record's own digests and
 * answers geometry only. The repair is to run
 * the generator again, which re-reads the bytes and is therefore a fresh observation.
 */
export const CASE_FROZEN_SCENE_PLANS: Readonly<Record<string, DurableAcceptedScenePlanRecord>> =
  Object.freeze({
    "scene_closure_supine_bedside_v1": {
      "schemaVersion": "openclinxr.accepted-scene-plan.v1",
      "planId": "scene_closure_supine_bedside_plan_v1",
      "durableStore": "database_source_of_truth",
      "run": {
        "stationRunId": "scene_closure_build_time_freeze",
        "sessionId": "scene_closure_build_time_freeze",
        "acceptedAtIso": "2026-09-10T00:00:00.000Z"
      },
      "case": {
        "caseId": "scene_closure_supine_bedside_v1",
        "caseVersion": 2,
        "caseSourceVersion": "openclinxr.scene-closure-case-source.v2",
        "caseContentSha256": "c6d99b8cad2cead2c6916f02c9975e483e0d270f4f51f80b4cd8f2f25569801e",
        "stationId": "scene_closure_supine_bedside_station_v1",
        "environmentId": "inpatient_ward_room_v1"
      },
      "bundle": {
        "bundleId": "scene_closure_supine_bedside_station_v1:bundle",
        "bundleSha256": "293813ec50a859d5e322f4fec0776e9ffdbc485167f1bfc82616416f566a243d"
      },
      "instances": [
        {
          "instanceId": "inpatient_ward_room_v1:stretcher",
          "kind": "support",
          "contentId": "ward_stretcher_v1"
        },
        {
          "instanceId": "scene_closure_supine_bedside_station_v1:patient_margaret_ellis_v1",
          "kind": "actor",
          "contentId": "patient_margaret_ellis_v1",
          "assetPath": "apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb",
          "assetSha256": "2e9a9615fa2034675eab9b2634139a74b3918c9698e97b6a1cb65bd8076ed588",
          "byteCount": 18576544
        },
        {
          "instanceId": "scene_closure_supine_bedside_station_v1:senior_resident_ward_v1",
          "kind": "actor",
          "contentId": "senior_resident_ward_v1",
          "assetPath": "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb",
          "assetSha256": "63a4c9dec2065aae38d0e3336fc4a46be2de647354848cebe8269564c01d4b13",
          "byteCount": 9457652
        },
        {
          "instanceId": "scene_closure_supine_bedside_station_v1:ward_nurse_patel_v1",
          "kind": "actor",
          "contentId": "ward_nurse_patel_v1",
          "assetPath": "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb",
          "assetSha256": "8409334c30861e07d7bb180b2b8f7e5d48c277bc91c4a5df8f0cb0475869c541",
          "byteCount": 8396376
        },
        {
          "instanceId": "scene_closure_supine_bedside_station_v1:daughter_lena_ellis_v1",
          "kind": "actor",
          "contentId": "daughter_lena_ellis_v1",
          "assetPath": "apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb",
          "assetSha256": "11276ac2d0d895cfc3f9ccd9f11d6735e782107b9c2f66167da70090fe52463d",
          "byteCount": 10409540
        }
      ],
      "revisions": {
        "solverVersion": "openclinxr.bedside-layout-solver.v1",
        "rigRevision": "mpfb2_standard_137_joint",
        "clipRevision": "openclinxr_retarget_walk_formal_cc0",
        "geometryRevision": "geom-v1-c45e274d-7",
        "rubricVersion": "openclinxr.scene-closure-arrival-rubric.v1"
      },
      "variation": {
        "seed": "62a49d3f625f5154c1fe67f6fdf86f8b345db4ebe539cd218b8aa943186c28ee",
        "variationIndex": 0
      },
      "resolvedLayout": {
        "approachSide": "patient_right",
        "standoffMeters": 0.75,
        "targetPosition": {
          "x": -0.78,
          "y": 0,
          "z": 1.1399999995529653
        },
        "targetHeadingRadians": 3.141592653589793,
        "floorFrameId": "inpatient_ward_room_v1:floor",
        "observedObstacleIds": [
          "inpatient_ward_room_v1:stretcher",
          "inpatient_ward_room_v1:overbed_surface",
          "inpatient_ward_room_v1:door_leaf",
          "inpatient_ward_room_v1:wall_board"
        ],
        "waypointCount": 5,
        "routeLengthMeters": 1.3058713568030198
      },
      "arrival": {
        "arrivalErrorMeters": 0.0041,
        "settledHeadingErrorDegrees": 1.7,
        "stoppedSeconds": 2.4,
        "stoppedRootTravelMeters": 0.0009
      },
      "eventOrder": [
        {
          "sequence": 1,
          "eventId": "evt-admitted",
          "eventType": "encounter_admitted",
          "atSecond": 0
        },
        {
          "sequence": 2,
          "eventId": "turn-001",
          "eventType": "actor_turn",
          "atSecond": 1.5
        },
        {
          "sequence": 3,
          "eventId": "evt-arrived",
          "eventType": "bedside_arrival",
          "atSecond": 6.2
        }
      ],
      "dialogueTurnIds": [
        "turn-001"
      ],
      "planRevision": "plan-v1-1dae6c6f3878d792b57cdacfe7cfd0de",
      "acknowledgment": {
        "acknowledgedBy": "scene_closure_build_time_freeze",
        "acknowledgedAtIso": "2026-09-10T00:05:00.000Z",
        "acknowledgedPlanRevision": "plan-v1-1dae6c6f3878d792b57cdacfe7cfd0de"
      }
    }
  } as Record<string, DurableAcceptedScenePlanRecord>);
