// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: every number below is a MEASURED
// value from the freeze, not a reference to a math constant. The bedside heading for this ward
// happens to land on pi because the physician faces straight down the long axis of the bed;
// rewriting it as Math.PI would replace an observation with an assertion.
import type { DurableAcceptedScenePlanRecord } from "./accepted-scene-plan-evidence.js";

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
 * IF A BOUND ASSET IS REPUBLISHED this record goes stale and the runtime's reopen refuses with
 * `evidence_changed`, naming the instance. That is the invalidation working. The repair is to run
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
        "caseContentSha256": "ac7c9e24e6dbf18ac14e9e341fad00e8f94d1bc52525aca6d81d3b0ba04e0543",
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
          "assetSha256": "59f590701ad182c4eca33e90a7ba25f0cb94b8698afd7fc2318436fc3c26e9a6",
          "byteCount": 18840492
        },
        {
          "instanceId": "scene_closure_supine_bedside_station_v1:senior_resident_ward_v1",
          "kind": "actor",
          "contentId": "senior_resident_ward_v1",
          "assetPath": "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb",
          "assetSha256": "4a6d8a78cd2eabd724cfd2570881cf36df25064545941c7f10dbce44ea597d3c",
          "byteCount": 11736568
        },
        {
          "instanceId": "scene_closure_supine_bedside_station_v1:ward_nurse_patel_v1",
          "kind": "actor",
          "contentId": "ward_nurse_patel_v1",
          "assetPath": "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb",
          "assetSha256": "bc5b9009af57703716647c09a7033a8758f08952d3ec6b177485f953cf4e042d",
          "byteCount": 11112092
        },
        {
          "instanceId": "scene_closure_supine_bedside_station_v1:daughter_lena_ellis_v1",
          "kind": "actor",
          "contentId": "daughter_lena_ellis_v1",
          "assetPath": "apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb",
          "assetSha256": "8f7ad8acda01542f829908ae0a7de266a80b6525f08b538532d904e0f0f27b93",
          "byteCount": 8411080
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
      "planRevision": "plan-v1-bb6eab9141446d890e45c86195075b14",
      "acknowledgment": {
        "acknowledgedBy": "scene_closure_build_time_freeze",
        "acknowledgedAtIso": "2026-09-10T00:05:00.000Z",
        "acknowledgedPlanRevision": "plan-v1-bb6eab9141446d890e45c86195075b14"
      }
    }
  } as Record<string, DurableAcceptedScenePlanRecord>);
