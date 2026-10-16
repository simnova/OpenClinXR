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
  DataTexture,
  DirectionalLight,
  HemisphereLight,
  type Light,
  Mesh,
  NeutralToneMapping,
  NoToneMapping,
  PMREMGenerator,
  type Scene,
  Vector3,
  type WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { buildProductRigGlobeEnvMap } from "./cornea-env/rig-key-globe-env.js";

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
  resolveLightingRigPublicPath: (environmentId: string) => string;
};

/**
 * Fetch + validate a lighting-rig cast JSON from a public URL (null when
 * missing or malformed). Internal to this module: the lab calls it directly
 * with the URL from the bridge's resolveLightingRigPublicPath, so the app
 * side stays wiring-only and the package surface does not grow for it.
 */
async function loadProductRigCastFromUrl(url: string): Promise<Array<{
  actorId: string;
  position: [number, number, number];
}> | null> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null) return null;
  const cast: unknown = (json as { cast?: unknown }).cast;
  if (!Array.isArray(cast)) return null;
  const out: Array<{ actorId: string; position: [number, number, number] }> = [];
  for (const entry of cast) {
    if (typeof entry !== "object" || entry === null) return null;
    const actorId: unknown = (entry as { actorId?: unknown }).actorId;
    if (typeof actorId !== "string") continue;
    const p: unknown = (entry as { position?: unknown }).position;
    if (
      !Array.isArray(p) ||
      p.length !== 3 ||
      !p.every((v) => typeof v === "number" && Number.isFinite(v))
    ) {
      continue;
    }
    out.push({ actorId, position: [p[0] as number, p[1] as number, p[2] as number] });
  }
  return out;
}

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
  /**
   * Cornea catch-light readback: globe (eye) materials that received the
   * scoped env map, and whether any did. The variant JSON records this, so
   * CW2 (globe envMap non-null) is proved by readback, not by source.
   * roughnessDisc pins the procedural iris-disc roughness map (h1): inner /
   * outer texels and radii, or null when no globe material matched.
   */
  globeEnvMap: {
    matched: string[];
    envMapSet: boolean;
    roughnessDisc: { inner: number; outer: number; radiusUv: number; featherUv: number } | null;
  };
  /**
   * Rig-built globe env readback (tsk_fd7dedb8dc543758): the emissive loci
   * the globe map was PMREM'd from, the re-anchored key locus, and whether a
   * rigOverride twin replaced the key. Recorded so the catchlight-key gate
   * test asserts the key relation from live readback, not source.
   */
  rigEnv: {
    sourceCount: number;
    sourceNames: string[];
    keyHeadRelative: [number, number, number];
    keyReplaced: boolean;
    replacementName: string | null;
  } | null;
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
 * Globe (eye) material filter for the scoped product-path env map. Mirrors
 * the lab eye-channel regex (isolated-subject-focus.ts EYE_MESH_RE) but on
 * MATERIAL names: the shipped MPFB eye node is renamed by GLTFLoader to
 * `mpfb_*_body_mesh.low-poly`, so the mesh name never matches — the
 * materialize script names the globe material `mat_makeclothes_library_eyes_*`
 * on every MPFB actor. Eyelash/eyebrow materials (`..._eyelashes_...`,
 * `..._eyebrow_...`) contain no `eyes|iris|cornea|sclera` substring and are
 * never matched.
 */
const GLOBE_MATERIAL_RE = /eyes|iris|cornea|sclera/i;

/**
 * h1 iris-disc UV numerals (v=0 at image top, the flipY=false glTF
 * convention — the same numerals eye-parallax.ts samples with).
 * Duplicated here, NOT imported from ./eye-shader/eye-parallax.js: that
 * module is currently entrypoint-unreachable, and importing it from this
 * (reachable) module would promote it — pushing xr-scene testInternalImports
 * 10 -> 11 via its gate test's direct import. Source of truth stays
 * eye-parallax.ts (EYE_IRIS_CENTER_L_UV/R_UV, EYE_IRIS_RADIUS_UV,
 * EYE_LIMBUS_WIDTH_UV); the cornea gate test pins these literals in both
 * files by text.
 */
const IRIS_CENTER_L_UV: readonly [number, number] = [299.55 / 1024, 300.0 / 1024];
const IRIS_CENTER_R_UV: readonly [number, number] = [724.65 / 1024, 721.28 / 1024];
const IRIS_RADIUS_UV = 135 / 1024;
const LIMBUS_WIDTH_UV = 30 / 1024;

/**
 * h1 iris-disc roughness texel inside the disc (effective roughness =
 * globe scalar x texel). The globe scalar stays 0.5 (sclera unchanged);
 * the disc drops to 0.06 so the PMREM env resolves to a specular spot
 * instead of a flat lift.
 */
const ROUGH_DISC_INNER = 0.12;

/** Procedural map size (px); the iris disc spans ~2x135/1024 of it. */
const ROUGH_MAP_SIZE = 256;

/**
 * h1: procedural iris-disc roughness map for the scoped globe material.
 * White (1.0) outside the iris keeps the authored scalar (sclera: 0.5);
 * the iris disc multiplies down to glossy (0.06 effective) with a
 * limbus-width smoothstep feather so no ring shows. UV convention follows
 * the glTF colour map (flipY=false, v=0 at image top — the same numerals
 * eye-parallax.ts cites), and the DataTexture keeps the default flipY=false
 * so both maps sample the same texel. Generated in memory: no iris-texture
 * edit, no new mesh, skin untouched. The shipped eye material carries no
 * authored roughnessMap (baseColor only), so nothing is overwritten.
 */
function buildIrisDiscRoughnessMap(): DataTexture {
  const S = ROUGH_MAP_SIZE;
  const data = new Uint8Array(S * S);
  const centres = [IRIS_CENTER_L_UV, IRIS_CENTER_R_UV];
  const rFull = IRIS_RADIUS_UV;
  const rOut = IRIS_RADIUS_UV + LIMBUS_WIDTH_UV;
  for (let y = 0; y < S; y += 1) {
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x += 1) {
      const u = (x + 0.5) / S;
      let g = 1;
      for (const c of centres) {
        const r = Math.hypot(u - c[0], v - c[1]);
        if (r < rOut) {
          const t = Math.min(Math.max((r - rFull) / Math.max(rOut - rFull, 1e-9), 0), 1);
          const s = t * t * (3 - 2 * t);
          g = Math.min(g, ROUGH_DISC_INNER + (1 - ROUGH_DISC_INNER) * s);
        }
      }
      data[y * S + x] = Math.round(g * 255);
    }
  }
  const tex = new DataTexture(data, S, S);
  tex.needsUpdate = true;
  return tex;
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
  // Cornea catch-light: scope the product-path environment to the GLOBE
  // material (material.envMap), not scene.environment. Two measured reasons:
  // (1) three r184 refreshes the envMapIntensity shader uniform only when
  // material.envMap is set (WebGLMaterials refreshUniformsStandard), so a
  // scene.environment alone leaves the globe intensity stuck at 1.0 and
  // 0.6-vs-0.0 renders bit-identical; (2) scene.environment lights every PBR
  // material (600k px moved on the Aisha product portrait, cheek mean +~20
  // levels), while the scoped map leaves skin pixel-identical. The map source
  // is tsk_fd7dedb8dc543758 rig-key-globe-env.ts: a PMREM (same sigma 0.04)
  // of a black scene holding one emissive locus per rig light at its
  // re-anchored head-relative locus — so the reflection sits where the rig's
  // lights reflect instead of a generic-room panel over the pupil. No
  // generic-room source on this path (the studio path above keeps its own).
  // h1: the globe also gets a procedural iris-disc roughnessMap (same
  // traverse): the 0.5 scalar blurs the env to a flat lift, so the disc
  // multiplies down to 0.06 effective while the sclera stays 0.5.
  const rigGlobe = await buildProductRigGlobeEnvMap({
    renderer,
    rigUrl: fns.resolveLightingRigPublicPath(environmentId),
    scene,
    headCentre,
  });
  if (!rigGlobe) {
    throw new Error(
      `product rig ${environmentId} globe env refused — no globe map without the rig's own lights`,
    );
  }
  const globeEnv = rigGlobe.texture;
  const globeMatched: string[] = [];
  const roughDisc = buildIrisDiscRoughnessMap();
  scene.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      const std = m as unknown as { envMapIntensity?: unknown; envMap?: unknown; roughnessMap?: unknown };
      if (typeof std.envMapIntensity !== "number") continue;
      if (!GLOBE_MATERIAL_RE.test(m.name)) continue;
      std.envMap = globeEnv;
      std.roughnessMap = roughDisc;
      globeMatched.push(`${o.name}|${m.name}`);
    }
  });
  if (globeMatched.length === 0) {
    globeEnv.dispose();
    roughDisc.dispose();
  }
  const cast = await loadProductRigCastFromUrl(fns.resolveLightingRigPublicPath(environmentId));
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
    globeEnvMap: {
      matched: globeMatched,
      envMapSet: globeMatched.length > 0,
      roughnessDisc:
        globeMatched.length > 0
          ? { inner: ROUGH_DISC_INNER, outer: 1, radiusUv: IRIS_RADIUS_UV, featherUv: LIMBUS_WIDTH_UV }
          : null,
    },
    rigEnv: {
      sourceCount: rigGlobe.built.loci.length,
      sourceNames: rigGlobe.built.loci.map((l) => l.name),
      keyHeadRelative: rigGlobe.built.keyHeadRelative,
      keyReplaced: rigGlobe.built.keyReplaced,
      replacementName: rigGlobe.built.replacementName,
    },
  };
}
