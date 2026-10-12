/**
 * Isolated-subject lab rig variants (extracted from isolated-subject-lab.ts).
 *
 * Variant evaluator light-rig overrides: ambient/hemisphere/directional rigs,
 * the head-relative studio portrait rig, and the PRODUCT room rig. All
 * energy/colour math for the product rig stays inside the PRODUCT overlay;
 * the lab only re-anchors it. No lab-owned lighting math.
 */

import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  type Light,
  NeutralToneMapping,
  NoToneMapping,
  PMREMGenerator,
  type Scene,
  Vector3,
  type WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

/**
 * Product rig lighting bridge (variant evaluator). The lab cannot import from
 * apps/ui-xr, so the apps-side bridge (isolated-subject-product-lighting.ts)
 * stashes the PRODUCT functions on window; the lab calls them and performs no
 * energy/intensity or colour-temperature math of its own. A missing bridge,
 * null rig, unapplied rig, or missing patient cast REFUSES (fail closed).
 */
export type ProductLightingRigFns = {
  configureStationRendererToneMapping: (renderer: { toneMapping: number }) => void;
  loadLightingRig: (environmentId: string) => Promise<{ exposure: number } | null>;
  applyStationInteriorLightingForEnvironment: (input: {
    scene: Scene;
    renderer: WebGLRenderer;
    environmentId: string;
    variantId: "raised_hemisphere_ground";
    ambientLightName: string;
    keyLightName: string;
    keyCastShadow: boolean;
  }) => Promise<{ variantId: string; lights: Light[]; rigApplied: boolean }>;
  loadProductRigCast: (
    environmentId: string,
  ) => Promise<Array<{ actorId: string; position: [number, number, number] }> | null>;
};

export type ProductRigApplied = {
  environmentId: string;
  variantId: string;
  rigApplied: boolean;
  exposure: number;
  castRaw: [number, number, number];
  /** Cast patient locus converted with the PRODUCT mapping (x, z, -y). */
  castThree: [number, number, number];
  /** Rigid translation applied to the overlay rig: framed head centre minus cast. */
  translationDelta: [number, number, number];
};

/** Variant evaluator light-rig override. Positions are absolute unless relativeToHead. */
export type RigOverride = {
  ambient?: { color: string; intensity: number };
  hemisphere?: { skyColor: string; groundColor: string; intensity: number };
  directionals?: Array<{
    color: string;
    intensity: number;
    position: [number, number, number];
    /** When true, position is an offset from the framed head centre (portable across humanoids). */
    relativeToHead?: boolean;
  }>;
  removeDefaultLights?: boolean;
  toneMapping?: "None" | "ACESFilmic" | "AgX" | "Neutral";
  exposure?: number;
  environment?: "room" | null;
  environmentIntensity?: number;
  /**
   * Studio portrait rig (variant evaluator): warm key / cool fill / neutral
   * hemisphere / rear rim, all head-relative at 2 m, ACES, RoomEnvironment.
   * Present => the studio rig owns the whole override (other fields ignored)
   * and the lab defaults are always off.
   */
  studio?: {
    keyAzimuthDeg: number;
    keyElevationDeg: number;
    keyIntensity: number;
    fillIntensity: number;
    hemisphereIntensity: number;
    rimIntensity: number;
    exposure: number;
    environmentIntensity: number;
  };
};

const RIG_TONE_MAPPINGS = {
  None: NoToneMapping,
  ACESFilmic: ACESFilmicToneMapping,
  AgX: AgXToneMapping,
  Neutral: NeutralToneMapping,
} as const;

/** Variant evaluator: add rig lights / tone mapping / environment. Head-relative offsets resolve against headCentre. */
export function applyRigOverride(
  scene: Scene,
  renderer: WebGLRenderer,
  override: RigOverride,
  headCentre: Vector3,
): void {
  if (override.studio) {
    // Studio portrait rig owns the whole override: no lab defaults (enforced
    // at the call site too), other rigOverride fields ignored.
    const st = override.studio;
    for (const [k, v] of Object.entries(st)) {
      if (typeof v !== "number" || !Number.isFinite(v)) {
        throw new Error(`rigOverride.studio.${k} must be a finite number`);
      }
    }
    const R = 2;
    const rad = (d: number): number => (d * Math.PI) / 180;
    const place = (azDeg: number, elDeg: number): Vector3 =>
      new Vector3(
        headCentre.x + Math.sin(rad(azDeg)) * Math.cos(rad(elDeg)) * R,
        headCentre.y + Math.sin(rad(elDeg)) * R,
        headCentre.z + Math.cos(rad(azDeg)) * Math.cos(rad(elDeg)) * R,
      );
    const hemi = new HemisphereLight("#ffffff", "#8a8a8a", st.hemisphereIntensity);
    hemi.name = "studio_hemisphere";
    scene.add(hemi);
    const key = new DirectionalLight("#fff1e0", st.keyIntensity);
    key.name = "studio_key";
    key.position.copy(place(st.keyAzimuthDeg, st.keyElevationDeg));
    scene.add(key);
    const fill = new DirectionalLight("#dfe8ff", st.fillIntensity);
    fill.name = "studio_fill";
    fill.position.copy(place(-st.keyAzimuthDeg, 10));
    scene.add(fill);
    const rim = new DirectionalLight("#ffffff", st.rimIntensity);
    rim.name = "studio_rim";
    rim.position.copy(place(180, 40));
    scene.add(rim);
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = st.exposure;
    const pmrem = new PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    (scene as unknown as { environmentIntensity?: number }).environmentIntensity = st.environmentIntensity;
    return;
  }
  if (override.ambient) {
    scene.add(new AmbientLight(override.ambient.color, override.ambient.intensity));
  }
  if (override.hemisphere) {
    scene.add(new HemisphereLight(
      override.hemisphere.skyColor,
      override.hemisphere.groundColor,
      override.hemisphere.intensity,
    ));
  }
  for (const d of override.directionals ?? []) {
    const light = new DirectionalLight(d.color, d.intensity);
    const base = d.relativeToHead === true ? headCentre : new Vector3(0, 0, 0);
    light.position.set(base.x + d.position[0], base.y + d.position[1], base.z + d.position[2]);
    scene.add(light);
  }
  if (override.toneMapping) {
    renderer.toneMapping = RIG_TONE_MAPPINGS[override.toneMapping];
  }
  if (override.exposure != null && Number.isFinite(override.exposure)) {
    renderer.toneMappingExposure = override.exposure;
  }
  if (override.environment === "room") {
    const pmrem = new PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }
  if (override.environmentIntensity != null && Number.isFinite(override.environmentIntensity)) {
    (scene as unknown as { environmentIntensity?: number }).environmentIntensity = override.environmentIntensity;
  }
}

/**
 * Product rig lighting (variant evaluator): ACES + base + overlay through the
 * PRODUCT functions, then a rigid re-anchor of the OVERLAY rig so the
 * patient locus sits on the framed head centre. Base hemisphere/key stay
 * room-generic. All energy/colour math stays inside the product overlay.
 */
export async function applyProductRig(
  scene: Scene,
  renderer: WebGLRenderer,
  environmentId: string,
  headCentre: Vector3,
): Promise<ProductRigApplied> {
  const fns = (window as unknown as { __openClinXrProductLightingRigFns?: ProductLightingRigFns })
    .__openClinXrProductLightingRigFns;
  if (!fns) {
    throw new Error(
      "productEnvironmentId requested but the apps-side product-lighting bridge is absent — refusing rather than inventing a rig",
    );
  }
  const rig = await fns.loadLightingRig(environmentId);
  if (!rig) {
    throw new Error(`product rig ${environmentId} missing or malformed — refusing rather than falling back`);
  }
  const applied = await fns.applyStationInteriorLightingForEnvironment({
    scene,
    renderer,
    environmentId,
    variantId: "raised_hemisphere_ground",
    ambientLightName: "isolated_station_ambient",
    keyLightName: "isolated_station_key",
    keyCastShadow: false,
  });
  if (!applied.rigApplied) {
    throw new Error(`product rig ${environmentId} did not apply — refusing rather than grading a fallback`);
  }
  const cast = await fns.loadProductRigCast(environmentId);
  const patient = cast?.find((c) => c.actorId === "patient");
  if (!patient) {
    throw new Error(`product rig ${environmentId} has no patient cast entry — refusing rather than misplacing the rig`);
  }
  // Same Blender->three conversion the product overlay uses inline (x, z, -y):
  // the rig bbox runs Z 0..2.65, so it is Z-up Blender frame.
  const castThree = new Vector3(patient.position[0], patient.position[2], -patient.position[1]);
  const delta = new Vector3().subVectors(headCentre, castThree);
  for (const light of applied.lights) {
    if (light.userData?.openClinXrLightingRig !== true) continue;
    light.position.add(delta);
    if (light instanceof DirectionalLight) light.target.position.add(delta);
  }
  scene.updateMatrixWorld(true);
  return {
    environmentId,
    variantId: applied.variantId,
    rigApplied: applied.rigApplied,
    exposure: rig.exposure,
    castRaw: [...patient.position] as [number, number, number],
    castThree: [castThree.x, castThree.y, castThree.z],
    translationDelta: [delta.x, delta.y, delta.z],
  };
}
