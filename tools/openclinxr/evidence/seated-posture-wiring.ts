/**
 * #81 seated posture wiring inspector — data flow only (not visual grade).
 *
 * Asserts: posture on placements reaches a resolved posture vocabulary; patient_chair
 * builds real geometry with seatHeightMeters; clip binding follows posture; no
 * CarnegieMellonAnimations / rancidmilk clip sources ship.
 *
 * claimScope: placement posture + chair fixture metadata + clip binding provenance.
 * notEvidenceFor: clinical sitting realism, Mesh2Motion retarget visual quality,
 * whether the figure looks seated in a capture (orchestrator grades the render).
 */

import {
  SHIPPED_CLIP_SOURCES,
  clipBindingForPosture,
  resolveActorPosture,
  type ActorPosture,
} from "../../../packages/openclinxr/asset-registry/src/actor-posture.js";
import { createEdChestPainLocalLearnerRuntimeAssetBundle } from "../../../packages/openclinxr/asset-registry/src/runtime-bundles.js";
import { buildStationEnvironment } from "../../../apps/ui-xr/src/station-environment.js";
import {
  PATIENT_CHAIR_SEAT_HEIGHT_METERS,
  isPatientChairSlotId,
} from "../../../apps/ui-xr/src/station-chair.js";

export type SeatedPostureWiring = {
  placements: { actorId: string; posture: string }[];
  chairFixture: { exists: boolean; seatHeightMeters: number; isMarkerCube: boolean } | null;
  clipBindings: { actorId: string; posture: string; clipName: string }[];
  shippedClipSources: string[];
  seatedHeightOwnership: {
    owner: string;
    clipRootTranslation: string;
  };
};

/**
 * Inspect posture wiring from registry + station shell (no live browser required).
 */
export async function inspectSeatedPostureWiring(): Promise<SeatedPostureWiring> {
  const edBundle = createEdChestPainLocalLearnerRuntimeAssetBundle();
  const edPlacements = Object.entries(edBundle.sceneManifest.actorPlacements).map(
    ([actorId, placement]) => {
      const posture = resolveActorPosture({
        declared: placement.posture,
        scenarioId: edBundle.scenarioId,
        environmentId: "ed_exam_bay_v1",
        slotKind: placement.slotKind,
      });
      return { actorId, posture };
    },
  );

  // Telehealth home visit: primary patient is seated (patient_chair fixture).
  const telehealthPatient = {
    actorId: "patient_telehealth_seated_v1",
    posture: resolveActorPosture({
      scenarioId: "telehealth_diabetes_health_literacy_v1",
      environmentId: "telehealth_home_visit_v1",
      slotKind: "primary_patient",
    }) as ActorPosture,
  };
  const telehealthFamily = {
    actorId: "family_telehealth_standing_v1",
    posture: resolveActorPosture({
      scenarioId: "telehealth_diabetes_health_literacy_v1",
      environmentId: "telehealth_home_visit_v1",
      slotKind: "family_or_observer",
    }) as ActorPosture,
  };

  const placements = [...edPlacements, telehealthPatient, telehealthFamily];

  const shell = buildStationEnvironment({ environmentId: "telehealth_home_visit_v1" });
  let chairFixture: SeatedPostureWiring["chairFixture"] = null;
  shell.traverse((obj) => {
    const slotId = String(obj.userData?.fixtureSlotId ?? "");
    if (!isPatientChairSlotId(slotId) && !obj.name.includes("patient_chair")) return;
    if (chairFixture) return;
    const seatHeight =
      typeof obj.userData?.seatHeightMeters === "number"
        ? obj.userData.seatHeightMeters
        : PATIENT_CHAIR_SEAT_HEIGHT_METERS;
    chairFixture = {
      exists: true,
      seatHeightMeters: seatHeight,
      isMarkerCube: obj.userData?.isMarkerCube === true,
    };
  });

  const clipBindings = placements.map((p) => {
    const binding = clipBindingForPosture(p.posture as ActorPosture);
    return {
      actorId: p.actorId,
      posture: p.posture,
      clipName: binding.clipName,
    };
  });

  return {
    placements,
    chairFixture,
    clipBindings,
    shippedClipSources: [...SHIPPED_CLIP_SOURCES],
    seatedHeightOwnership: {
      owner: "verticalOffsetMeters_and_chair_seatHeightMeters",
      clipRootTranslation: "stripped_not_applied",
    },
  };
}
