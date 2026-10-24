/**
 * Isolated-subject lab assembly (extracted from isolated-subject-lab.ts).
 *
 * Subject-root construction: GLB load, furniture builders, runtime-posture
 * plant. Framing and rendering stay in isolated-subject-lab.ts.
 */

import { Group, Mesh, type Object3D, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { computeMeshBounds } from "./camera-fit-to-bounds.js";
import { rebindHeadLockedTeeth } from "./humanoid-load-guard.js";
import { removeFittedHair } from "./isolated-subject-material-variants.js";
import {
  buildDeclaredEquipmentGeometry,
  buildPatientChair,
  buildPatientStretcher,
  STRETCHER_DECK_TOP_METERS,
  STRETCHER_LENGTH_METERS,
} from "@openclinxr/xr-station";
import { applyAndPlantSupineOnDeck } from "@openclinxr/xr-pose";
import type { IsolatedSubjectSpec } from "./isolated-subject-lab.js";

async function loadHumanoid(bodyGlb: string): Promise<Object3D> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const url = bodyGlb.startsWith("/") ? bodyGlb : `/${bodyGlb.replace(/^\.\//, "")}`;
  const gltf = await loader.loadAsync(url);
  const root = gltf.scene; rebindHeadLockedTeeth(root);
  root.name = "isolated_subject_humanoid";
  root.userData["openClinXrIsolatedSubject"] = true;
  return root;
}

function buildFurniture(
  builder: "patient_stretcher" | "patient_chair",
  inclineDegrees?: number,
): Group {
  if (builder === "patient_chair") {
    return buildPatientChair({
      slotId: "isolated_patient_chair",
      purpose: "isolated subject harness",
      position: { x: 0, y: 0, z: 0 },
      trimColor: 0x6b4f2a,
    });
  }
  return buildPatientStretcher({
    slotId: "isolated_ed_stretcher",
    purpose: "isolated subject harness",
    position: { x: 0, y: 0, z: 0 },
    trimColor: 0x3a7ca5,
    inclineDegrees: inclineDegrees ?? 0,
  });
}

export async function buildSubjectRoot(spec: IsolatedSubjectSpec): Promise<{
  root: Object3D;
  meshCount: number;
  humanoid: Object3D | null;
  hairHidden: boolean;
  hiddenHairMeshes: string[];
} > {
  const container = new Group();
  container.name = `isolated_subject.${spec.subjectId}`;
  const incline = spec.inclineDegrees ?? 0;
  let humanoid: Object3D | null = null;

  if (spec.subjectKind === "furniture_builder") {
    const builder = spec.builder ?? "patient_stretcher";
    container.add(buildFurniture(builder, incline));
  } else if (spec.subjectKind === "runtime_posture" || spec.subjectKind === "posture_on_furniture") {
    const bodyGlb = spec.bodyGlb ?? "generated-humanoids/mpfb-gown-adult-patient.glb";
    humanoid = await loadHumanoid(bodyGlb);
    let stretcher: Group | null = null;
    if (spec.subjectKind === "posture_on_furniture" || spec.builder === "patient_stretcher") {
      // Deck leads: incline on the stretcher builder, not a body-only tip.
      stretcher = buildFurniture("patient_stretcher", incline);
      container.add(stretcher);
    }
    const pillowWorldX = -STRETCHER_LENGTH_METERS * 0.38;
    applyAndPlantSupineOnDeck(humanoid, {
      deckTopWorldY: STRETCHER_DECK_TOP_METERS,
      deckCenter: { x: 0, z: 0 },
      pillowWorldX,
      ...(stretcher ? { stretcher } : { inclineDegrees: incline }),
      ...(spec.supineRootOnly === true ? { applyJointEulers: false } : {}),
    });
    humanoid.updateMatrixWorld(true);
    // Framing: lateral (Z) recenter only. X recenter after hinge tip slides the body along
    // the long axis and reopens the back-plane gap (gap ∝ sinθ offset) — plant owns X.
    const hb = computeMeshBounds(humanoid);
    const hc = hb.getCenter(new Vector3());
    humanoid.position.z -= hc.z;
    if (Math.abs(incline) < 1e-3) {
      humanoid.position.x -= hc.x;
    }
    humanoid.updateMatrixWorld(true);
    container.add(humanoid);
  } else if (spec.subjectKind === "equipment_builder") {
    const equipmentId = spec.equipmentId;
    if (!equipmentId) {
      throw new Error("equipment_builder requires equipmentId");
    }
    container.add(buildDeclaredEquipmentGeometry(equipmentId));
  } else if (spec.subjectKind === "glb") {
    const bodyGlb = spec.bodyGlb ?? "generated-humanoids/mpfb-gown-adult-patient.glb";
    container.add(await loadHumanoid(bodyGlb));
  } else {
    throw new Error(`Unsupported subjectKind: ${spec.subjectKind}`);
  }

  let hiddenHairMeshes: string[] = [];
  if (spec.hideHair === true) {
    hiddenHairMeshes = removeFittedHair(container);
    container.updateMatrixWorld(true);
  }

  let meshCount = 0;
  container.traverse((o) => {
    if (o instanceof Mesh) meshCount += 1;
  });
  return { root: container, meshCount, humanoid, hairHidden: spec.hideHair === true, hiddenHairMeshes };
}
