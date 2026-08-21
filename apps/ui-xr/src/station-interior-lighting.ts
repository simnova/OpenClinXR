/**
 * #525 — station interior lighting variants (product path).
 *
 * Mechanism only: named candidates the orchestrator grades from a labelled sheet.
 * Default remains `control` until that grade picks — no intensity/colour/HDRI here is "the answer".
 *
 * claimScope: learner-runtime + capture share the same lights (key always on; only shadows are
 * capture-gated via createCaptureKeyLight).
 * notEvidenceFor: clinical staging, Quest readiness, which variant should ship permanently.
 */
import {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  type Light,
  PMREMGenerator,
  type Scene,
  type WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createCaptureKeyLight } from "./capture-shadow-map.js";

export const STATION_INTERIOR_LIGHTING_VARIANT_IDS = [
  "control",
  "lab_ambient_fill",
  "raised_hemisphere_ground",
  "room_environment_ibl",
] as const;

export type StationInteriorLightingVariantId =
  (typeof STATION_INTERIOR_LIGHTING_VARIANT_IDS)[number];

export type StationInteriorLightingApplyResult = {
  variantId: StationInteriorLightingVariantId;
  lights: Light[];
};

/** Resolve URL/query id; unknown or absent → control (do not invent a shipped pick). */
export function resolveStationInteriorLightingVariantId(
  raw: string | null | undefined,
): StationInteriorLightingVariantId {
  const id = (raw ?? "").trim();
  if ((STATION_INTERIOR_LIGHTING_VARIANT_IDS as readonly string[]).includes(id)) {
    return id as StationInteriorLightingVariantId;
  }
  return "control";
}

/**
 * Apply one named interior lighting variant on the product scene.
 * Clears prior lights tagged `openClinXrStationInteriorLighting` so evidence sweeps can re-apply.
 */
export function applyStationInteriorLighting(input: {
  scene: Scene;
  renderer: WebGLRenderer;
  variantId: StationInteriorLightingVariantId;
  ambientLightName: string;
  keyLightName: string;
  keyCastShadow: boolean;
}): StationInteriorLightingApplyResult {
  clearStationInteriorLighting(input.scene);

  const lights: Light[] = [];
  const tag = (light: Light, role: string): Light => {
    light.userData.openClinXrStationInteriorLighting = true;
    light.userData.openClinXrStationInteriorLightingVariant = input.variantId;
    light.userData.openClinXrStationInteriorLightingRole = role;
    lights.push(light);
    return light;
  };

  if (input.variantId === "control") {
    const ambient = new HemisphereLight(0xf4f0dc, 0x223042, 2.2);
    ambient.name = input.ambientLightName;
    tag(ambient, "hemisphere");
    input.scene.add(ambient);
    const key = createCaptureKeyLight({
      name: input.keyLightName,
      scene: input.scene,
      active: input.keyCastShadow,
    });
    tag(key, "key");
    return { variantId: input.variantId, lights };
  }

  if (input.variantId === "lab_ambient_fill") {
    // D1 known-good from isolated-subject-lab.ts:408-415 — candidate, not the decision.
    const ambient = new AmbientLight(0xdceee6, 1.45);
    ambient.name = input.ambientLightName;
    tag(ambient, "ambient");
    input.scene.add(ambient);
    const key = new DirectionalLight(0xffffff, 2.2);
    key.name = input.keyLightName;
    key.position.set(3.2, 5.2, 4.1);
    if (input.keyCastShadow) {
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.camera.left = -6;
      key.shadow.camera.right = 6;
      key.shadow.camera.top = 6;
      key.shadow.camera.bottom = -6;
      key.shadow.camera.near = 1;
      key.shadow.camera.far = 25;
      key.shadow.bias = -0.0005;
      key.shadow.normalBias = 0.02;
      input.scene.add(key.target);
    }
    tag(key, "key");
    input.scene.add(key);
    const fill = new DirectionalLight(0xb6d8ca, 1.1);
    fill.name = `${input.keyLightName}.fill`;
    fill.position.set(-3.5, 2.8, -2.2);
    tag(fill, "fill");
    input.scene.add(fill);
    return { variantId: input.variantId, lights };
  }

  if (input.variantId === "raised_hemisphere_ground") {
    // Same sky/intensity; ground lifted so inward wall normals are not near-black.
    const ambient = new HemisphereLight(0xf4f0dc, 0xc8d0dc, 2.2);
    ambient.name = input.ambientLightName;
    tag(ambient, "hemisphere");
    input.scene.add(ambient);
    const key = createCaptureKeyLight({
      name: input.keyLightName,
      scene: input.scene,
      active: input.keyCastShadow,
    });
    tag(key, "key");
    return { variantId: input.variantId, lights };
  }

  // room_environment_ibl — control hemisphere+key plus RoomEnvironment PMREM fill.
  const ambient = new HemisphereLight(0xf4f0dc, 0x223042, 2.2);
  ambient.name = input.ambientLightName;
  tag(ambient, "hemisphere");
  input.scene.add(ambient);
  const key = createCaptureKeyLight({
    name: input.keyLightName,
    scene: input.scene,
    active: input.keyCastShadow,
  });
  tag(key, "key");
  const pmrem = new PMREMGenerator(input.renderer);
  const envScene = new RoomEnvironment();
  const envMap = pmrem.fromScene(envScene, 0.04).texture;
  input.scene.environment = envMap;
  input.scene.userData.openClinXrStationInteriorLighting = {
    variantId: input.variantId,
    hasEnvironmentMap: true,
  };
  pmrem.dispose();
  return { variantId: input.variantId, lights };
}

function clearStationInteriorLighting(scene: Scene): void {
  const remove: Light[] = [];
  scene.traverse((obj) => {
    const light = obj as Light;
    if (light.isLight === true && light.userData?.openClinXrStationInteriorLighting === true) {
      remove.push(light);
    }
  });
  for (const light of remove) {
    scene.remove(light);
  }
  if (scene.environment) {
    scene.environment.dispose();
    scene.environment = null;
  }
  if (scene.userData.openClinXrStationInteriorLighting) {
    delete scene.userData.openClinXrStationInteriorLighting;
  }
}
