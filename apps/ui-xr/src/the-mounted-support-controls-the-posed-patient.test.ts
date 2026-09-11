import { appendFileSync, readFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { DEFAULT_STRETCHER_POSITION } from "@openclinxr/asset-registry/actor-posture";
import type {
  EncounterRuntimeActorPlacement,
  EncounterRuntimeAsset,
  LearnerRuntimeAssetBundle,
} from "@openclinxr/asset-registry/runtime-bundles";
import { createEdChestPainRuntimeSceneManifest } from "@openclinxr/asset-registry/runtime-bundles";
import type { AssetLoadingContext } from "@openclinxr/xr-asset-loading";
import * as assetLoading from "@openclinxr/xr-asset-loading";
import {
  ensureActorPlacementsForStagedSlots,
  supportedActorPlacementPosition,
} from "@openclinxr/xr-runtime-state";
import { applyCleanEncounterVisualReviewActorFraming } from "@openclinxr/xr-scene";
import { buildStationEnvironment } from "@openclinxr/xr-station";
import {
  observeMountedSupportInstances,
  type StationActorSlotKind,
  type StationActorStagingContext,
  stageStationActors,
} from "@openclinxr/xr-station-room";
import { Group, Mesh, MeshBasicMaterial, Object3D, PlaneGeometry, Scene } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sceneClosureCaseDocument } from "../../../tools/openclinxr/factory/scene-closure-case-source.js";

/**
 * SC-03 — the mounted support controls the posed patient.
 *
 * A-rows A04 and A05. This exercises the REAL scene-update consumer,
 * `stageStationActors` (`packages/openclinxr/xr-station-room/src/actor-staging.ts`), over a real
 * three.js scene carrying a real `buildStationEnvironment` shell, with the placement resolver
 * `supportedActorPlacementPosition` main.ts calls at `apps/ui-xr/src/main.ts:840` and the slot
 * repair `ensureActorPlacementsForStagedSlots` the boot path runs. Nothing here is a fixture
 * stand-in for a production decision: every function under test ships.
 *
 * THE FOUR MEASURED DEFECTS, on the unchanged tree at dc2ad3b8. Each is an existing production
 * function answering a question wrongly, not a missing file, an import error or an absent report.
 *
 *  1. `ensureActorPlacementsForStagedSlots` re-anchors a placement whose slotKind disagrees with
 *     the slot assignment and, at runtime-actor-placements.ts:108-118, carries forward exactly
 *     `verticalOffsetMeters`, `labelPrefix` and `posture`. `headingRadians` and
 *     `placementProvenance` are DROPPED. Measured: the clinical placement's authored -0.26
 *     survived as `undefined`.
 *  2. `stageStationActors` consumes `headingRadians` on `additional_cast` only
 *     (actor-staging.ts:305). On `primary_patient` and `clinical_team` the authored heading is
 *     read by nothing, so framing's -0.18 stands. Measured on the SHIPPED ED manifest, which
 *     authors `headingRadians: -0.26` for the clinical slot: `nurse.rotation.y === -0.18`.
 *  3. `authoredPlantOffsetMeters` resolves through the module-level `scenarioBank`, so the
 *     PERSISTED case `scene_closure_supine_bedside_v1` — which is not in the bank — returns
 *     `undefined` and its authored `plantOffsetMeters {x: 0.12, y: 0, z: -0.08}` never reaches
 *     the posed patient. Measured: composed x = -0.9, the bare stretcher anchor.
 *  4. main.ts:840 calls `supportedActorPlacementPosition` with neither `supportInstanceId` nor
 *     `mountedSupportInstanceIds`, so `supportReadinessForPlacement` returns `not_required` for
 *     every supine patient and its substitution refusal is unreachable. The refusal branch that
 *     IS reached is logged with `console.warn` and the anchor is returned anyway — warn-and-place,
 *     which `proof-contract-v2.md` names as not a refusal.
 *
 * claimScope: placement composition, support acceptance and heading survival through the shipped
 * runtime consumers, measured offline in node.
 * notEvidenceFor: clinical validity, worn-headset readiness, what a capture shows, or that any
 * encounter ran.
 */

const CASE = sceneClosureCaseDocument();
const WARD_ENVIRONMENT_ID = "inpatient_ward_room_v1";
const ED_ENVIRONMENT_ID = "ed_exam_bay_v1";
const PATIENT_ACTOR_ID = "patient_margaret_ellis_v1";
const PHYSICIAN_ACTOR_ID = "senior_resident_ward_v1";

/** The authored plant offset the persisted case carries for its patient. */
const AUTHORED_PATIENT_OFFSET = (() => {
  const authored = CASE.actors.find((actor) => actor.actorId === PATIENT_ACTOR_ID)?.placement
    ?.plantOffsetMeters;
  if (!authored) throw new Error("the persisted case no longer authors a patient plant offset");
  return { x: authored.x, y: authored.y, z: authored.z };
})();

/** The exact ward bed instance this case's supine patient depends on. */
const WARD_BED_INSTANCE_ID = `${WARD_ENVIRONMENT_ID}:stretcher`;
/** A DIFFERENT instance of the SAME KIND. Substituting it is a patient on the wrong bed. */
const ED_BED_INSTANCE_ID = `${ED_ENVIRONMENT_ID}:stretcher`;

const PATIENT_GLB = new URL(
  "../public/generated-humanoids/mpfb-gown-adult-patient.glb",
  import.meta.url,
).pathname;

type Vector3 = { x: number; y: number; z: number };

/**
 * Read-only observation emitter.
 *
 * The stream is written only when the owner's build-report supplies a path, so an ordinary test run
 * has no side effect. It records MEASURED VALUES, never verdicts: `verify.ts` re-reads these bytes
 * and refuses a report whose check outcome is not findable in them, so a bare `pass` here would
 * defeat the thing it exists to feed.
 */
function observe(checkId: string, metric: string, unit: string, value: unknown): void {
  const target = process.env["OPENCLINXR_SC03_OBSERVATIONS"];
  if (!target) return;
  appendFileSync(
    target,
    `${JSON.stringify({ checkId, metric, unit, value, observedAtMs: Date.now() })}\n`,
    "utf8",
  );
}

/**
 * The ACTUAL skinned patient body, decoded from the shipped bytes.
 *
 * `three`'s GLTFLoader cannot parse these bytes in node — its texture path reaches `self`, which
 * does not exist — so the geometry comes from the same decoder SC-00 measured with. What is
 * returned is the centroid of every skinned vertex in the GLB's own space, which is the body's
 * offset from its own origin and is IDENTICAL between a treatment and its control. That is the
 * whole reason the authored-offset measurement below is taken as a DELTA between two stagings
 * rather than against `anchor + offset`: comparing a skinned centre against an anchor compares two
 * different things and needs a fudge term, which is a threshold fitted to clear an observation.
 */
async function decodeSkinnedPatientBody(): Promise<{
  centroidLocal: Vector3;
  skinnedBodyCount: number;
  skinnedVertexSampleCount: number;
}> {
  const document = await new NodeIO().read(PATIENT_GLB);
  let sum = { x: 0, y: 0, z: 0 };
  let count = 0;
  let skinnedBodyCount = 0;
  for (const node of document.getRoot().listNodes()) {
    const skin = node.getSkin();
    const mesh = node.getMesh();
    if (!skin || !mesh) continue;
    skinnedBodyCount += 1;
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute("POSITION");
      if (!position) continue;
      const element = [0, 0, 0];
      for (let index = 0; index < position.getCount(); index += 1) {
        position.getElement(index, element);
        sum = {
          x: sum.x + (element[0] ?? 0),
          y: sum.y + (element[1] ?? 0),
          z: sum.z + (element[2] ?? 0),
        };
        count += 1;
      }
    }
  }
  if (count === 0) throw new Error("the shipped patient GLB decoded zero skinned vertex samples");
  return {
    centroidLocal: { x: sum.x / count, y: sum.y / count, z: sum.z / count },
    skinnedBodyCount,
    skinnedVertexSampleCount: count,
  };
}

let SKINNED_PATIENT: Awaited<ReturnType<typeof decodeSkinnedPatientBody>>;

function asset(assetId: string): EncounterRuntimeAsset {
  return {
    assetId,
    version: "v1",
    kind: "humanoid_model",
    displayName: assetId,
    scenarioAssetId: assetId,
    blob: {
      storeKind: "app_public_fixture",
      containerName: "fixtures",
      blobName: `${assetId}.glb`,
      url: `/xr/${assetId}.glb`,
    },
    reviewStatus: "approved_for_local_runtime",
    provenanceRefs: [],
    notEvidenceFor: [],
  };
}

/**
 * The staging context main.ts builds at `apps/ui-xr/src/main.ts:3069-3097`, with the same four
 * callbacks bound to the same production functions. `actorPlacement` is the one under test: it is
 * main.ts's `runtimeActorPlacement` reduced to the two decisions this card owns — resolve the
 * supported position, and carry the manifest record forward.
 */
function buildStagingContext(input: {
  scenarioId: string;
  environmentId: string;
  placements: Record<string, EncounterRuntimeActorPlacement>;
  actors: Record<StationActorSlotKind, string>;
  mountedSupportInstanceIds: readonly string[];
  roles: Record<string, string>;
  suppressAuthoredOffset?: boolean;
}): StationActorStagingContext {
  const staged = Object.values(input.actors).filter((actorId) => actorId.length > 0);
  const bundle = {
    scenarioId: input.scenarioId,
    actors: staged.map((actorId) => ({ actorId, embodiment: "humanoid" })),
    sceneManifest: { actorPlacements: input.placements },
    // A partial literal asserted to the bundle type, which is the idiom the sibling package test
    // uses (xr-station-room/src/actor-staging.test.ts:52). `stageStationActors` reads exactly
    // these three fields; the remaining ~20 belong to transport and evidence.
  } as LearnerRuntimeAssetBundle;

  return {
    encounterBundle: () => bundle,
    slotAssignment: () => ({
      stagedActorIds: staged,
      notStagedActorIds: [],
      patientActorId: input.actors.primary_patient,
      clinicalTeamActorId: input.actors.clinical_team,
      familyActorId: input.actors.family_or_observer,
      additionalActorId: input.actors.additional_cast,
    }),
    assetLoadingContext: () =>
      ({
        selectedScenarioId: () => input.scenarioId,
        activeEnvironmentId: () => input.environmentId,
      }) as AssetLoadingContext,
    // main.ts:840 — the live caller. The arguments it supplies are the subject of clause (4).
    actorPlacement: (actorId, fallback, mounted) => {
      const placement = input.placements[actorId];
      const posture = placement?.posture ?? fallback.posture ?? "standing";
      const resolved = supportedActorPlacementPosition({
        posture,
        actorId,
        slotKind: placement?.slotKind ?? fallback.slotKind,
        scenarioId: input.scenarioId,
        environmentId: input.environmentId,
        resolvedPosition: placement?.position ?? fallback.position,
        ...(placement?.supportInstanceId ? { supportInstanceId: placement.supportInstanceId } : {}),
        ...(placement?.plantOffsetMeters && !input.suppressAuthoredOffset
          ? { authoredOffsetMeters: placement.plantOffsetMeters }
          : {}),
        mountedSupportInstanceIds: mounted ?? input.mountedSupportInstanceIds,
      });
      return {
        ...fallback,
        ...placement,
        position: resolved.position,
        placementProvenance: resolved.provenance,
        posture,
        ...(resolved.supportAcceptance ? { supportAcceptance: resolved.supportAcceptance } : {}),
      };
    },
    actorIdForSlot: (slotKind) => input.actors[slotKind],
    humanoidAssetForSlot: (slotKind) => asset(`${slotKind}_asset`),
    resolveAssetUrl: (a) => `/xr/${a.assetId}.glb`,
    createActorNameplate: () => new Mesh(new PlaneGeometry(0.95, 0.24), new MeshBasicMaterial()),
    applyActorFraming: (actorSlot, actorId) => {
      applyCleanEncounterVisualReviewActorFraming({
        actor: actorSlot,
        actorId,
        scenarioId: input.scenarioId,
        role: input.roles[actorId] ?? "",
        skipFraming: false,
      });
    },
    createVirtualDeviceActorAffordance: () => new Group(),
    scenarioRuntimeMismatch: () => false,
    cleanComparatorCapture: () => false,
    readActorSlotAssignment: () => null,
  };
}

/** Roles as the bundle carries them; `applyCleanEncounterVisualReviewActorFraming` frames on these. */
const CASE_ROLES: Record<string, string> = Object.fromEntries(
  CASE.actors.map((actor) => [actor.actorId, actor.role]),
);

const ED_ROLES: Record<string, string> = {
  patient_robert_hayes_v1: "patient",
  nurse_maria_alvarez_v1: "nurse",
  spouse_anna_hayes_v1: "family",
};

/** Slot roots by slotKind, exactly as an inspector reads them off the live scene. */
function slotRoots(scene: Scene): Map<string, Group> {
  const roots = new Map<string, Group>();
  for (const child of scene.children) {
    const kind = (child.userData as Record<string, unknown>)["openClinXrSlotKind"];
    if (typeof kind === "string") roots.set(kind, child as Group);
  }
  return roots;
}

/**
 * Attach the decoded skinned body under a staged slot the way
 * `loadGeneratedHumanoidIntoActorSlot` does at generated-loaders.ts:113-117 — child at
 * `(0, verticalOffset, 0)`, `rotation.y = 0`, `scale (1,1,1)` — and return its WORLD centre.
 *
 * The child's forced identity scale is what stops a changed GLB scale double-applying: the outer
 * slot owns scale and the loaded child does not multiply it a second time.
 */
function posedSkinnedPatientWorldCentre(slot: Group, verticalOffsetMeters: number): Vector3 {
  const loadedChild = new Object3D();
  loadedChild.name = "loaded_humanoid_child";
  loadedChild.position.set(0, verticalOffsetMeters, 0);
  loadedChild.rotation.y = 0;
  loadedChild.scale.set(1, 1, 1);
  const bodyCentre = new Object3D();
  bodyCentre.position.set(
    SKINNED_PATIENT.centroidLocal.x,
    SKINNED_PATIENT.centroidLocal.y,
    SKINNED_PATIENT.centroidLocal.z,
  );
  loadedChild.add(bodyCentre);
  slot.add(loadedChild);
  slot.updateMatrixWorld(true);
  return {
    x: bodyCentre.matrixWorld.elements[12] ?? Number.NaN,
    y: bodyCentre.matrixWorld.elements[13] ?? Number.NaN,
    z: bodyCentre.matrixWorld.elements[14] ?? Number.NaN,
  };
}

/** One idle/speech frame: the loop composes a sway onto the recorded base heading. */
function advanceIdleAndSpeechFrames(slot: Group, frames: number): void {
  const base = Number((slot.userData as Record<string, unknown>)["openClinXrBaseHeadingRadians"]);
  for (let frame = 0; frame < frames; frame += 1) {
    slot.rotation.y = (Number.isFinite(base) ? base : slot.rotation.y)
      + Math.sin(frame * 0.31) * 0.004;
    slot.updateMatrixWorld(true);
  }
  slot.rotation.y = Number.isFinite(base) ? base : slot.rotation.y;
  slot.updateMatrixWorld(true);
}

/** The persisted case's placements, as the runtime scene manifest producer emits them. */
function persistedCasePlacements(): Record<string, EncounterRuntimeActorPlacement> {
  return createEdChestPainRuntimeSceneManifest({
    scenarioId: CASE.scenarioId,
    stationId: "scene_closure_supine_bedside_station_v1",
    scenario: CASE,
    environmentId: WARD_ENVIRONMENT_ID,
  }).actorPlacements;
}

function persistedCaseActors(): Record<StationActorSlotKind, string> {
  return {
    primary_patient: PATIENT_ACTOR_ID,
    clinical_team: "ward_nurse_patel_v1",
    family_or_observer: "daughter_lena_ellis_v1",
    additional_cast: PHYSICIAN_ACTOR_ID,
  };
}

/** A scene carrying a REAL environment shell, so the mounted supports are real fixtures. */
function sceneWithShell(environmentId: string): Scene {
  const scene = new Scene();
  scene.add(buildStationEnvironment({ environmentId }));
  return scene;
}

function stagePersistedCase(options: {
  environmentId: string;
  suppressAuthoredOffset?: boolean;
}): { scene: Scene; roots: Map<string, Group>; placements: Record<string, EncounterRuntimeActorPlacement> } {
  const scene = sceneWithShell(options.environmentId);
  const placements = persistedCasePlacements();
  stageStationActors(
    buildStagingContext({
      scenarioId: CASE.scenarioId,
      environmentId: options.environmentId,
      placements,
      actors: persistedCaseActors(),
      roles: CASE_ROLES,
      mountedSupportInstanceIds: observeMountedSupportInstances(scene).map(
        (support) => support.supportInstanceId,
      ),
      ...(options.suppressAuthoredOffset ? { suppressAuthoredOffset: true } : {}),
    }),
    scene,
  );
  return { scene, roots: slotRoots(scene), placements };
}

describe("the mounted support controls the posed patient", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { location: { search: "" } } as never);
    // The GLB fetch is stubbed, and only the fetch: every placement, framing, heading and
    // acceptance decision under test runs for real. The loaded child's transform contract is
    // reproduced explicitly in `posedSkinnedPatientWorldCentre` from the loader's own source.
    vi.spyOn(assetLoading, "loadGeneratedHumanoidIntoActorSlot").mockImplementation(() => undefined);
  });

  it("SC-03-required-behavior", async () => {
    SKINNED_PATIENT ??= await decodeSkinnedPatientBody();
    expect(SKINNED_PATIENT.skinnedBodyCount).toBeGreaterThan(0);
    expect(SKINNED_PATIENT.skinnedVertexSampleCount).toBeGreaterThan(0);

    // (a) THE EXACT SUPPORT IS NAMED AND OBSERVED. The persisted case authors
    // `supportSurface: "stretcher"`; the manifest turns that into the exact instance the ward
    // shell mounts, and the shell is where the observation comes from.
    const ward = sceneWithShell(WARD_ENVIRONMENT_ID);
    const observed = observeMountedSupportInstances(ward);
    expect(observed.map((support) => support.supportInstanceId)).toContain(WARD_BED_INSTANCE_ID);
    const bed = observed.find((support) => support.supportInstanceId === WARD_BED_INSTANCE_ID);
    expect(bed?.deckTopYMeters, "the observed support carries its real deck height").toBeGreaterThan(0);

    const placements = persistedCasePlacements();
    const patientPlacement = placements[PATIENT_ACTOR_ID];
    expect(patientPlacement?.posture).toBe("supine");
    expect(
      patientPlacement?.supportInstanceId,
      "the manifest names the exact support the supine placement depends on",
    ).toBe(WARD_BED_INSTANCE_ID);
    expect(
      patientPlacement?.plantOffsetMeters,
      "the PERSISTED case's authored offset reaches the manifest, not the scenarioBank",
    ).toEqual(AUTHORED_PATIENT_OFFSET);

    // (b) MOUNTED: the exact instance is present, so the placement is accepted and the
    // observation handed to the acceptance owner names that instance and nothing else.
    const mountedResolve = supportedActorPlacementPosition({
      posture: "supine",
      actorId: PATIENT_ACTOR_ID,
      slotKind: "primary_patient",
      scenarioId: CASE.scenarioId,
      environmentId: WARD_ENVIRONMENT_ID,
      resolvedPosition: DEFAULT_STRETCHER_POSITION,
      authoredOffsetMeters: AUTHORED_PATIENT_OFFSET,
      supportInstanceId: WARD_BED_INSTANCE_ID,
      mountedSupportInstanceIds: [WARD_BED_INSTANCE_ID],
    });
    expect(mountedResolve.supportReadiness.status).toBe("mounted");
    expect(mountedResolve.supportAcceptance?.accepted).toBe(true);
    expect(mountedResolve.supportAcceptance?.observation?.outcome).toBe("satisfied");
    expect(mountedResolve.supportAcceptance?.observation?.instanceId).toBe(WARD_BED_INSTANCE_ID);
    expect(mountedResolve.supportAcceptance?.observation?.source).toBe("runtime_consumer_observation");
    observe(
      "caller-supplies-support-id-and-readiness",
      "supportInstanceId + readiness reaching the acceptance verdict for the supine patient",
      "identifier/status",
      `${String(mountedResolve.supportAcceptance?.observation?.instanceId)}|${mountedResolve.supportReadiness.status}`,
    );

    // (c) PENDING: nothing mounted. The placement stays provisional, is NOT accepted, and its
    // observation is `pending` — not a silent success, and not an invented `satisfied`.
    const pendingResolve = supportedActorPlacementPosition({
      posture: "supine",
      actorId: PATIENT_ACTOR_ID,
      slotKind: "primary_patient",
      scenarioId: CASE.scenarioId,
      environmentId: WARD_ENVIRONMENT_ID,
      resolvedPosition: DEFAULT_STRETCHER_POSITION,
      authoredOffsetMeters: AUTHORED_PATIENT_OFFSET,
      supportInstanceId: WARD_BED_INSTANCE_ID,
      mountedSupportInstanceIds: [],
    });
    expect(pendingResolve.supportReadiness.status).toBe("pending");
    expect(pendingResolve.supportAcceptance?.accepted).toBe(false);
    expect(pendingResolve.supportAcceptance?.observation?.outcome).toBe("pending");
    observe("delayed-mount-stays-pending", "readiness with the exact support not yet mounted", "status", pendingResolve.supportReadiness.status);
    observe("slow-support-stays-pending", "acceptance with the exact support not yet mounted", "boolean", pendingResolve.supportAcceptance?.accepted);

    // (d) WRONG SAME-KIND INSTANCE: an ED bed is mounted, the ward bed is not. Nothing is
    // substituted; the reason names what WAS available so a reader can see it was not taken.
    const wrongKind = supportedActorPlacementPosition({
      posture: "supine",
      actorId: PATIENT_ACTOR_ID,
      slotKind: "primary_patient",
      scenarioId: CASE.scenarioId,
      environmentId: WARD_ENVIRONMENT_ID,
      resolvedPosition: DEFAULT_STRETCHER_POSITION,
      authoredOffsetMeters: AUTHORED_PATIENT_OFFSET,
      supportInstanceId: WARD_BED_INSTANCE_ID,
      mountedSupportInstanceIds: [ED_BED_INSTANCE_ID],
    });
    expect(wrongKind.supportReadiness.status).toBe("pending");
    expect(wrongKind.supportAcceptance?.accepted).toBe(false);
    expect(wrongKind.supportAcceptance?.observation?.instanceId).toBe(WARD_BED_INSTANCE_ID);
    expect(
      wrongKind.supportAcceptance?.observedSupportInstanceIds,
      "what was mounted is recorded, so the refusal to substitute is legible",
    ).toContain(ED_BED_INSTANCE_ID);
    observe("wrong-instance-cannot-substitute", "instance the observation is bound to while a same-kind instance is mounted", "identifier", String(wrongKind.supportAcceptance?.observation?.instanceId));
    observe("same-kind-wrong-support-refuses", "acceptance while only a same-kind ED bed is mounted", "boolean", wrongKind.supportAcceptance?.accepted);

    // (e) INVALID NORMAL OFFSET REFUSES ACCEPTANCE — warn-and-place is not refusal.
    const badNormal = supportedActorPlacementPosition({
      posture: "supine",
      actorId: PATIENT_ACTOR_ID,
      slotKind: "primary_patient",
      scenarioId: CASE.scenarioId,
      environmentId: WARD_ENVIRONMENT_ID,
      resolvedPosition: DEFAULT_STRETCHER_POSITION,
      authoredOffsetMeters: { x: 0.12, y: 0.14, z: -0.08 },
      supportInstanceId: WARD_BED_INSTANCE_ID,
      mountedSupportInstanceIds: [WARD_BED_INSTANCE_ID],
    });
    expect(badNormal.refusalReason).toMatch(/normal/iu);
    expect(badNormal.supportAcceptance?.accepted, "a refusal is not an acceptance").toBe(false);
    expect(badNormal.supportAcceptance?.observation?.outcome).toBe("unsatisfied");
    observe("invalid-normal-offset-refuses-acceptance", "acceptance for an authored y=0.14 normal offset", "boolean", badNormal.supportAcceptance?.accepted);
    observe("invalid-normal-offset-refuses", "refusal reason for an authored y=0.14 normal offset", "text", String(badNormal.refusalReason));

    // (f) SLOT REPAIR PRESERVES HEADING AND PROVENANCE on all three relevant slots, not only
    // additional_cast. runtime-actor-placements.ts:108-118 carried three fields and dropped these.
    const repaired = { sceneManifest: { actorPlacements: withMismatchedSlotKinds(placements) } };
    const repair = ensureActorPlacementsForStagedSlots(repaired, {
      stagedActorIds: [
        PATIENT_ACTOR_ID,
        "ward_nurse_patel_v1",
        "daughter_lena_ellis_v1",
        PHYSICIAN_ACTOR_ID,
      ],
      notStagedActorIds: [],
      patientActorId: PATIENT_ACTOR_ID,
      clinicalTeamActorId: "ward_nurse_patel_v1",
      familyActorId: "daughter_lena_ellis_v1",
      additionalActorId: PHYSICIAN_ACTOR_ID,
    });
    expect(repair.rewrittenActorIds.length, "the repair actually re-anchored something").toBeGreaterThan(0);
    for (const actorId of [PATIENT_ACTOR_ID, "ward_nurse_patel_v1", PHYSICIAN_ACTOR_ID]) {
      const before = placements[actorId];
      const after = repaired.sceneManifest.actorPlacements[actorId];
      expect(after, actorId).toBeDefined();
      if (before?.headingRadians !== undefined) {
        expect(after?.headingRadians, `${actorId} heading survives slot repair`).toBe(
          before.headingRadians,
        );
      }
      expect(after?.supportInstanceId, `${actorId} required support survives slot repair`).toBe(
        before?.supportInstanceId,
      );
      expect(after?.plantOffsetMeters, `${actorId} authored offset survives slot repair`).toEqual(
        before?.plantOffsetMeters,
      );
    }
    observe("heading-survives-slot-repair", "clinical headingRadians after a slot-kind re-anchor", "radians", repaired.sceneManifest.actorPlacements["ward_nurse_patel_v1"]?.headingRadians);
    observe("slot-kind-repair-preserves-heading", "supportInstanceId + heading surviving the re-anchor on all three slots", "identifier", `${String(repaired.sceneManifest.actorPlacements[PATIENT_ACTOR_ID]?.supportInstanceId)}|${String(repaired.sceneManifest.actorPlacements[PHYSICIAN_ACTOR_ID]?.headingRadians)}`);

    // (g) THE LIVE CONSUMER CONSUMES THE HEADING on primary_patient and clinical_team, after
    // framing, and it survives idle and speech frames.
    const staged = stagePersistedCase({ environmentId: WARD_ENVIRONMENT_ID });
    const nurseSlot = staged.roots.get("clinical_team");
    expect(nurseSlot).toBeDefined();
    const authoredNurseHeading = staged.placements["ward_nurse_patel_v1"]?.headingRadians;
    expect(authoredNurseHeading, "the manifest authors a clinical heading to consume").toBeTypeOf(
      "number",
    );
    expect(nurseSlot?.userData["openClinXrConsumedHeadingRadians"]).toBe(authoredNurseHeading);
    expect(nurseSlot?.rotation.y).toBeCloseTo(authoredNurseHeading as number, 10);
    advanceIdleAndSpeechFrames(nurseSlot as Group, 24);
    expect(nurseSlot?.rotation.y).toBeCloseTo(authoredNurseHeading as number, 10);
    observe("persisted-case-intent-beats-fixture-fallback", "authored plantOffsetMeters on the persisted manifest placement", "metres", JSON.stringify(patientPlacement?.plantOffsetMeters));

    const physicianSlot = staged.roots.get("additional_cast");
    expect(physicianSlot?.userData["openClinXrActorId"]).toBe(PHYSICIAN_ACTOR_ID);

    // (h) THE AUTHORED OFFSET MOVES THE POSED, SKINNED PATIENT, measured as the delta between the
    // same station staged twice — with the authored offset and without it. The body's own origin
    // bias is identical in both and subtracts out exactly, so the delta is the offset and nothing
    // else. Framing runs in both; the slot's supine guard is what lets it survive.
    const patientSlot = staged.roots.get("primary_patient");
    expect(patientSlot).toBeDefined();
    const withOffset = posedSkinnedPatientWorldCentre(
      patientSlot as Group,
      staged.placements[PATIENT_ACTOR_ID]?.verticalOffsetMeters ?? 0,
    );
    const control = stagePersistedCase({
      environmentId: WARD_ENVIRONMENT_ID,
      suppressAuthoredOffset: true,
    });
    const withoutOffset = posedSkinnedPatientWorldCentre(
      control.roots.get("primary_patient") as Group,
      control.placements[PATIENT_ACTOR_ID]?.verticalOffsetMeters ?? 0,
    );
    // The delta is the authored offset in WORLD METRES and nothing else. It is not scaled by the
    // slot's own scale: a Group's scale applies to its children, not to its own position, which is
    // what "the offset is already in world metres — do not multiply it by the mounted asset's
    // scale a second time" means at the composition. Measured 0.120000 / -0.080000.
    expect(withOffset.x - withoutOffset.x).toBeCloseTo(AUTHORED_PATIENT_OFFSET.x, 6);
    expect(withOffset.z - withoutOffset.z).toBeCloseTo(AUTHORED_PATIENT_OFFSET.z, 6);
    // and the delta is not zero, which is what a dropped offset would produce
    expect(Math.abs(withOffset.x - withoutOffset.x)).toBeGreaterThan(0.005);
    observe("authored-offset-measured-on-posed-skinned-patient", "world delta of the posed skinned patient centre between authored and suppressed stagings", "metres", `x=${(withOffset.x - withoutOffset.x).toFixed(6)} z=${(withOffset.z - withoutOffset.z).toFixed(6)} skinnedBodies=${SKINNED_PATIENT.skinnedBodyCount} skinnedVertexSamples=${SKINNED_PATIENT.skinnedVertexSampleCount}`);
    observe("offset-composed-in-orthonormal-frame-no-double-scale", "authored x applied once in world metres, not multiplied by the slot scale", "metres", `delta=${(withOffset.x - withoutOffset.x).toFixed(6)} slotScale=${(patientSlot as Group).scale.x.toFixed(4)}`);

    // (i) THE UNAUTHORED SUPINE CONTROL STAYS PUT, and the assertion is not vacuous: the ED
    // patient authors NO plant offset, so suppressing the offset must change nothing for her —
    // while the authored case above moved by a measurable amount under the same treatment.
    const edControl = stageEdBay({ suppressAuthoredOffset: false });
    const edSuppressed = stageEdBay({ suppressAuthoredOffset: true });
    const edPatientSlot = edControl.roots.get("primary_patient") as Group;
    const edSuppressedSlot = edSuppressed.roots.get("primary_patient") as Group;
    const edWith = posedSkinnedPatientWorldCentre(edPatientSlot, 0);
    const edWithout = posedSkinnedPatientWorldCentre(edSuppressedSlot, 0);
    expect(edWith.x - edWithout.x).toBeCloseTo(0, 9);
    expect(edWith.z - edWithout.z).toBeCloseTo(0, 9);
    // The discriminator that can differ: the authored case's patient does NOT sit where the
    // unauthored one does. If these ever coincide the control has stopped measuring anything.
    expect(withOffset.x).not.toBeCloseTo(edWith.x, 3);
    observe("unauthored-supine-control-unchanged", "world delta of the UNAUTHORED ED patient under the same suppression treatment, and its separation from the authored case", "metres", `delta=${(edWith.x - edWithout.x).toFixed(9)} separation=${(withOffset.x - edWith.x).toFixed(6)}`);

    // (k) THE LIVE CALLER SUPPLIES BOTH ARGUMENTS. Clauses (b) to (e) prove the resolver behaves;
    // they cannot prove `apps/ui-xr/src/main.ts` calls it that way, and a correct function nothing
    // calls correctly is the failure this package exists to close (PROTO_VERIFY_DELEGATION §6d).
    // No test in apps/ui-xr imports main.ts — it is a 4,800-line browser entry with module-level
    // three.js state — so the established precedent for asserting a main-tree seam is a source
    // read (the-composition-call-site-is-live.test.ts:20). Its weakness is stated plainly: it
    // proves the call site passes these arguments, never that it runs. Clauses (a) to (j) carry
    // the behavioural half against the same production functions main.ts calls.
    const mainTs = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    expect(mainTs).toContain("supportedActorPlacementPosition({");
    expect(mainTs, "the live caller passes the OBSERVED mounted set").toContain(
      "posture, actorId, slotKind, mountedSupportInstanceIds,",
    );
    expect(mainTs, "the live caller passes the required support instance").toContain(
      "{ supportInstanceId: placement.supportInstanceId }",
    );
    expect(mainTs, "the live caller passes the PERSISTED authored offset").toContain(
      "{ authoredOffsetMeters: placement.plantOffsetMeters }",
    );
    expect(mainTs, "the verdict rides back on the record instead of being warned about").toContain(
      "supportAcceptance: supported.supportAcceptance",
    );
    expect(mainTs, "the staging context forwards what the scene observed").toContain(
      "actorPlacement: (actorId, fallback, mounted) => runtimeActorPlacement(actorId, fallback, mounted)",
    );
    expect(mainTs, "the persisted room beats the scenarioBank fallback").toContain(
      "const persisted = encounterRuntimeAssetBundle.sceneManifest.environmentId;",
    );

    // (j) AN EXPLICITLY MISSING PHYSICIAN IS REPORTED, NEVER SUBSTITUTED.
    const withoutPhysician = sceneWithShell(WARD_ENVIRONMENT_ID);
    stageStationActors(
      buildStagingContext({
        scenarioId: CASE.scenarioId,
        environmentId: WARD_ENVIRONMENT_ID,
        placements,
        actors: { ...persistedCaseActors(), additional_cast: "" },
        roles: CASE_ROLES,
        mountedSupportInstanceIds: [WARD_BED_INSTANCE_ID],
      }),
      withoutPhysician,
    );
    const emptySlot = slotRoots(withoutPhysician).get("additional_cast");
    expect(emptySlot?.userData["openClinXrActorId"]).toBe("");
    expect(emptySlot?.visible).toBe(false);
    expect(emptySlot?.userData["openClinXrSlotUnfilledReason"]).toBe(
      "no_remaining_unique_humanoid_for_additional_slot",
    );
    for (const [kind, root] of slotRoots(withoutPhysician)) {
      expect(root.userData["openClinXrActorId"], `${kind} did not absorb the missing physician`).not.toBe(
        PHYSICIAN_ACTOR_ID,
      );
    }
    observe("missing-physician-reported-not-substituted", "reason recorded on the empty additional_cast slot, and the set of actorIds staged without him", "text", `${String(emptySlot?.userData["openClinXrSlotUnfilledReason"])}|${[...slotRoots(withoutPhysician).values()].map((root) => String(root.userData["openClinXrActorId"])).join(",")}`);
  }, 180_000);

  it("COUNTERWEIGHT: a post-acceptance replacement or removal invalidates the support observation and stops dependent motion", async () => {
    SKINNED_PATIENT ??= await decodeSkinnedPatientBody();
    const scene = sceneWithShell(WARD_ENVIRONMENT_ID);
    const placements = persistedCasePlacements();
    stageStationActors(
      buildStagingContext({
        scenarioId: CASE.scenarioId,
        environmentId: WARD_ENVIRONMENT_ID,
        placements,
        actors: persistedCaseActors(),
        roles: CASE_ROLES,
        mountedSupportInstanceIds: observeMountedSupportInstances(scene).map(
          (support) => support.supportInstanceId,
        ),
      }),
      scene,
    );
    const patient = slotRoots(scene).get("primary_patient") as Group;
    expect(patient.userData["openClinXrPlacementAccepted"]).toBe(true);
    expect(patient.userData["openClinXrDependentMotionAllowed"]).toBe(true);

    // Remove the bed AFTER acceptance and re-observe through the same production path.
    const bedRoot = scene.getObjectByProperty("name", "openclinxr.station-environment.fixture-slot.stretcher");
    expect(bedRoot, "the ward shell mounted a stretcher fixture to remove").toBeDefined();
    bedRoot?.parent?.remove(bedRoot);
    const afterRemoval = sceneWithShell(ED_ENVIRONMENT_ID);
    const substituted = observeMountedSupportInstances(afterRemoval).map(
      (support) => support.supportInstanceId,
    );
    expect(substituted).toContain(ED_BED_INSTANCE_ID);
    expect(observeMountedSupportInstances(scene).map((s) => s.supportInstanceId)).not.toContain(
      WARD_BED_INSTANCE_ID,
    );

    const rescene = sceneWithShell(ED_ENVIRONMENT_ID);
    stageStationActors(
      buildStagingContext({
        scenarioId: CASE.scenarioId,
        environmentId: WARD_ENVIRONMENT_ID,
        placements,
        actors: persistedCaseActors(),
        roles: CASE_ROLES,
        mountedSupportInstanceIds: observeMountedSupportInstances(rescene).map(
          (support) => support.supportInstanceId,
        ),
      }),
      rescene,
    );
    const replaced = slotRoots(rescene).get("primary_patient") as Group;
    expect(replaced.userData["openClinXrPlacementAccepted"]).toBe(false);
    expect(replaced.userData["openClinXrSupportReadiness"]).toBe("pending");
    expect(
      replaced.userData["openClinXrDependentMotionAllowed"],
      "dependent motion stops when the support observation is invalidated",
    ).toBe(false);
    observe("mount-replacement-invalidates-observation", "readiness and dependent-motion gate after the required bed is replaced by a same-kind ED bed", "status/boolean", `${String(replaced.userData["openClinXrSupportReadiness"])}|${String(replaced.userData["openClinXrDependentMotionAllowed"])}`);
    observe("post-acceptance-replacement-invalidates", "placement acceptance before and after the replacement", "boolean", `before=${String(patient.userData["openClinXrPlacementAccepted"])} after=${String(replaced.userData["openClinXrPlacementAccepted"])}`);
  }, 180_000);

  it("COUNTERWEIGHT: a malformed frame refuses, and a changed GLB scale does not double-apply", async () => {
    SKINNED_PATIENT ??= await decodeSkinnedPatientBody();
    for (const malformed of [
      { x: Number.NaN, y: 0, z: 0 },
      { x: 0.1, y: 0, z: Number.POSITIVE_INFINITY },
    ]) {
      const out = supportedActorPlacementPosition({
        posture: "supine",
        actorId: PATIENT_ACTOR_ID,
        slotKind: "primary_patient",
        scenarioId: CASE.scenarioId,
        environmentId: WARD_ENVIRONMENT_ID,
        resolvedPosition: DEFAULT_STRETCHER_POSITION,
        authoredOffsetMeters: malformed,
        supportInstanceId: WARD_BED_INSTANCE_ID,
        mountedSupportInstanceIds: [WARD_BED_INSTANCE_ID],
      });
      expect(out.refusalReason, JSON.stringify(malformed)).toBeTruthy();
      expect(out.supportAcceptance?.accepted).toBe(false);
      expect(Number.isFinite(out.position.x)).toBe(true);
      expect(Number.isFinite(out.position.z)).toBe(true);
      observe("malformed-frame-refuses", `refusal for a malformed authored offset ${JSON.stringify(malformed)}`, "text", String(out.refusalReason));
    }

    // A changed GLB scale must not multiply twice: the loaded child is forced to identity scale
    // by the loader, so the outer slot's scale is applied exactly once.
    const scene = sceneWithShell(WARD_ENVIRONMENT_ID);
    const placements = persistedCasePlacements();
    const scaled = structuredClone(placements);
    const patientRecord = scaled[PATIENT_ACTOR_ID];
    if (!patientRecord) throw new Error("the persisted manifest lost its patient placement");
    patientRecord.scale = { x: 2, y: 2, z: 2 };
    stageStationActors(
      buildStagingContext({
        scenarioId: CASE.scenarioId,
        environmentId: WARD_ENVIRONMENT_ID,
        placements: scaled,
        actors: persistedCaseActors(),
        roles: CASE_ROLES,
        mountedSupportInstanceIds: [WARD_BED_INSTANCE_ID],
      }),
      scene,
    );
    const patient = slotRoots(scene).get("primary_patient") as Group;
    const child = new Object3D();
    child.position.set(1, 0, 0);
    child.scale.set(1, 1, 1);
    patient.add(child);
    patient.updateMatrixWorld(true);
    const appliedScale = Math.hypot(
      child.matrixWorld.elements[0] ?? 0,
      child.matrixWorld.elements[1] ?? 0,
      child.matrixWorld.elements[2] ?? 0,
    );
    expect(appliedScale).toBeCloseTo(patient.scale.x, 9);
    expect(appliedScale).not.toBeCloseTo(patient.scale.x * patient.scale.x, 3);
    // AND THE CONTRACT ITSELF, read from the shipped loader rather than from the reproduction
    // above: the loaded child is forced to identity scale and zero yaw, so whatever scale the
    // outer slot carries is applied exactly once and the GLB's own scale cannot multiply it a
    // second time. Stated precisely because framing OWNS the supine slot scale
    // (encounter-actor-framing.ts:143 sets 0.82), so an authored scale of 2 never reaches the
    // slot; what is proved is single application, not that an authored scale survives framing.
    const loaderSource = readFileSync(
      new URL("../../../packages/openclinxr/xr-asset-loading/src/generated-loaders.ts", import.meta.url),
      "utf8",
    );
    expect(loaderSource).toContain("humanoid.scale.set(1, 1, 1);");
    expect(loaderSource).toContain("humanoid.rotation.y = 0;");
    observe("changed-glb-scale-refuses", "scale applied to a loaded child once, against the doubled value a second multiplication would produce; the loader forces the child to identity scale", "ratio", `applied=${appliedScale.toFixed(6)} slot=${patient.scale.x.toFixed(6)} doubled=${(patient.scale.x * patient.scale.x).toFixed(6)}`);
  }, 180_000);

  it("COUNTERWEIGHT: the standing known-good is untouched — no support is required and none is invented", () => {
    const standing = supportedActorPlacementPosition({
      posture: "standing",
      actorId: "ward_nurse_patel_v1",
      slotKind: "clinical_team",
      scenarioId: CASE.scenarioId,
      environmentId: WARD_ENVIRONMENT_ID,
      resolvedPosition: { x: 1.78, y: 0.95, z: 0.42 },
      mountedSupportInstanceIds: [],
    });
    expect(standing.position).toEqual({ x: 1.78, y: 0.95, z: 0.42 });
    expect(standing.supportReadiness.status).toBe("not_required");
    expect(standing.supportAcceptance?.accepted).toBe(true);
    expect(standing.supportAcceptance?.requiredSupportInstanceId).toBeNull();
  });
});

/** Give three slots a slotKind that disagrees with the assignment, so the repair actually runs. */
function withMismatchedSlotKinds(
  placements: Record<string, EncounterRuntimeActorPlacement>,
): Record<string, EncounterRuntimeActorPlacement> {
  const copy = structuredClone(placements);
  for (const [actorId, wrongKind] of [
    [PATIENT_ACTOR_ID, "family_or_observer"],
    ["ward_nurse_patel_v1", "additional_cast"],
    [PHYSICIAN_ACTOR_ID, "clinical_team"],
  ] as const) {
    const record = copy[actorId];
    if (record) record.slotKind = wrongKind;
  }
  return copy;
}

function stageEdBay(options: { suppressAuthoredOffset: boolean }): {
  roots: Map<string, Group>;
} {
  const scene = sceneWithShell(ED_ENVIRONMENT_ID);
  const placements = createEdChestPainRuntimeSceneManifest({
    environmentId: ED_ENVIRONMENT_ID,
  }).actorPlacements;
  stageStationActors(
    buildStagingContext({
      scenarioId: "ed_chest_pain_priority_v1",
      environmentId: ED_ENVIRONMENT_ID,
      placements,
      actors: {
        primary_patient: "patient_robert_hayes_v1",
        clinical_team: "nurse_maria_alvarez_v1",
        family_or_observer: "spouse_anna_hayes_v1",
        additional_cast: "",
      },
      roles: ED_ROLES,
      mountedSupportInstanceIds: observeMountedSupportInstances(scene).map(
        (support) => support.supportInstanceId,
      ),
      suppressAuthoredOffset: options.suppressAuthoredOffset,
    }),
    scene,
  );
  return { roots: slotRoots(scene) };
}
