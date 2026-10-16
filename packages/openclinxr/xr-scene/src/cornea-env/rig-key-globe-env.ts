/**
 * Globe env map built from the PRODUCT rig's own lights (card tsk_fd7dedb8dc543758).
 *
 * The previous source scoped a PMREM of three's generic sample room to the
 * globe material, so the catch-light had no relation to the rig's key light
 * (a square panel over the pupil). This module builds the same kind of source
 * — a small black Scene, PMREM'd with the studio sigma — but the emissive
 * loci come from the rig document itself:
 *
 * - one emissive locus per rig light, at its re-anchored head-relative locus
 *   (Blender frame mapped (x, z, -y), the same mapping the product overlay
 *   uses inline in isolated-subject-rig-variants.ts and in
 *   apps/ui-xr/src/lighting-rig-runtime.ts applyLightingRigOverlay);
 * - area lights as rectangles of the recorded size facing the head;
 * - point and directional lights as small discs;
 * - emitted radiance from the recorded energy: area loci use power over
 *   recorded area (the directional conversion's energy factor has no area in
 *   it, so reusing it here would dim every panel by its own size — the key
 *   would render seven times dimmer than the generic room it replaces, and
 *   the recorded total power would not survive); loci without a recorded
 *   area keep the overlay factor (energy times RIG_ENV_RADIANCE_PER_ENERGY,
 *   capped at RIG_ENV_RADIANCE_MAX — the same numerals as
 *   RIG_ENERGY_TO_THREE / MAX_THREE_INTENSITY in
 *   apps/ui-xr/src/lighting-rig-runtime.ts, restated here so this unreachable
 *   helper keeps zero package imports);
 * - black elsewhere (explicit black background).
 *
 * Key-locus replacement: a variant rigOverride cannot move the product key
 * (applyProductRig never receives the override), so an untagged scene
 * directional placed within REPLACEMENT_RADIUS_M of the re-anchored key
 * locus moves the key locus in the env build to the twin's head-relative
 * locus. The moved locus keeps the key record's size, radiance and colour
 * (the twin marks the probed locus; the energy stays the key's), so the G2
 * probe shifts the reflection without reshaping or recolouring it. Anything
 * farther out is ignored, so the lab base key stays out of the build. The G2
 * probe uses a key-twin directional (same colour and intensity as the scene
 * key) half a metre lateral.
 *
 * Deliberately dependency-free apart from three: importing a reachable
 * package module from here would promote it toward the testInternalImports
 * ceiling once isolated-subject-rig-variants.ts imports this helper. The rig
 * document shape mirrors LightingRigLight in
 * packages/openclinxr/xr-scene/src/lighting-rig-contract.ts without importing
 * it; colour conversion mirrors colorForTemperatureK in
 * apps/ui-xr/src/lighting-rig-runtime.ts without importing it.
 */

import {
  CircleGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  type Texture,
  Vector3,
  type WebGLRenderer,
} from "three";

/** Same PMREM blur the studio path uses (isolated-subject-rig-variants.ts). */
export const RIG_ENV_PMREM_SIGMA = 0.04;

/**
 * Overlay energy factor and cap, restated from
 * apps/ui-xr/src/lighting-rig-runtime.ts so the env radiance matches the
 * scene lighting built from the same record.
 */
export const RIG_ENV_RADIANCE_PER_ENERGY = 0.01;
export const RIG_ENV_RADIANCE_MAX = 5;

/**
 * Disc diameter for loci without a recorded size (point fills, directional
 * spill). Kept under the PMREM blur width at the locus distances in this
 * rig, so they resolve as soft points rather than panels.
 */
export const RIG_ENV_PUNCTUM_DISC_M = 0.05;

/**
 * An untagged scene directional this close to the re-anchored key locus takes
 * the key's place in the build (the G2 lateral-shift probe). The lab base key
 * sits several metres away, so it never falls inside.
 */
export const RIG_ENV_KEY_REPLACEMENT_RADIUS_M = 1.0;

/** Minimal rig-document shape this builder needs (mirrors the contract). */
export type RigEnvDocument = {
  lights: Array<{
    name: string;
    type: "point" | "area" | "directional";
    position: [number, number, number];
    target?: [number, number, number];
    energy: number;
    size: number;
    colorTemperatureK: number;
  }>;
  cast: Array<{ actorId: string; position: [number, number, number] }>;
};

/** One emissive locus in the head-centred env scene. */
export type RigEnvLocus = {
  name: string;
  /** Head-centred locus (metres, three frame). */
  at: [number, number, number];
  /** Emitting face extent (metres). */
  widthM: number;
  heightM: number;
  /** Linear radiance scale applied to the temperature colour. */
  radiance: number;
  colorTemperatureK: number;
  replacedKey: boolean;
};

export type RigEnvBuilt = {
  loci: RigEnvLocus[];
  keyHeadRelative: [number, number, number];
  keyReplaced: boolean;
  replacementName: string | null;
};

/** Blender (Z-up) to three mapping, same as the product overlay. */
function blenderToThree(p: [number, number, number]): Vector3 {
  return new Vector3(p[0], p[2], -p[1]);
}

/** Temperature colour, same approximation as the product overlay. */
function temperatureToHex(kelvin: number): number {
  const t = Math.min(100, Math.max(10, kelvin / 100));
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g =
    t <= 66
      ? 99.4708025861 * Math.log(t) - 161.1195681661
      : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const clamp = (v: number): number => Math.min(255, Math.max(0, Math.round(v)));
  return (clamp(r) << 16) | (clamp(g) << 8) | clamp(b);
}

function isFiniteTrio(p: unknown): p is [number, number, number] {
  return (
    Array.isArray(p) &&
    p.length === 3 &&
    p.every((v) => typeof v === "number" && Number.isFinite(v))
  );
}

/** Fetch + validate the rig document subset this builder needs. */
export async function fetchRigEnvDocument(url: string): Promise<RigEnvDocument | null> {
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
  const rawLights: unknown = (json as { lights?: unknown }).lights;
  const rawCast: unknown = (json as { cast?: unknown }).cast;
  if (!Array.isArray(rawLights) || !Array.isArray(rawCast)) return null;
  const lights: RigEnvDocument["lights"] = [];
  for (const entry of rawLights) {
    if (typeof entry !== "object" || entry === null) return null;
    const e = entry as Record<string, unknown>;
    if (typeof e.name !== "string") return null;
    if (e.type !== "point" && e.type !== "area" && e.type !== "directional") return null;
    if (!isFiniteTrio(e.position)) return null;
    if (e.target !== undefined && !isFiniteTrio(e.target)) return null;
    for (const k of ["energy", "size", "colorTemperatureK"] as const) {
      if (typeof e[k] !== "number" || !Number.isFinite(e[k] as number)) return null;
    }
    const light: RigEnvDocument["lights"][number] = {
      name: e.name,
      type: e.type,
      position: [e.position[0], e.position[1], e.position[2]],
      energy: e.energy as number,
      size: e.size as number,
      colorTemperatureK: e.colorTemperatureK as number,
    };
    if (e.target !== undefined) light.target = [e.target[0], e.target[1], e.target[2]];
    lights.push(light);
  }
  const cast: RigEnvDocument["cast"] = [];
  for (const entry of rawCast) {
    if (typeof entry !== "object" || entry === null) return null;
    const e = entry as { actorId?: unknown; position?: unknown };
    if (typeof e.actorId !== "string") continue;
    if (!isFiniteTrio(e.position)) continue;
    cast.push({ actorId: e.actorId, position: [e.position[0], e.position[1], e.position[2]] });
  }
  if (lights.length === 0) return null;
  return { lights, cast };
}

/**
 * Scan the live scene for an untagged directional near the re-anchored key
 * locus (a rigOverride twin placed to shift the key). Tagged overlay lights
 * and the lab base key are excluded by construction (tag / distance).
 */
export function findKeyReplacement(
  scene: Scene,
  keyWorld: Vector3,
): { position: Vector3; distanceM: number } | null {
  let best: { position: Vector3; distanceM: number } | null = null;
  scene.traverse((o) => {
    if (!(o instanceof DirectionalLight)) return;
    if (o.userData?.openClinXrLightingRig === true) return;
    const d = o.position.distanceTo(keyWorld);
    if (!(d < RIG_ENV_KEY_REPLACEMENT_RADIUS_M)) return;
    if (best && best.distanceM <= d) return;
    best = { position: o.position.clone(), distanceM: d };
  });
  return best;
}

/**
 * Head-centred emissive loci for the rig document. headCentre is the framed
 * head centre the overlay re-anchors to; castPatientBlender is the rig's raw
 * patient cast entry.
 */
export function collectRigEnvLoci(input: {
  rig: RigEnvDocument;
  castPatientBlender: [number, number, number];
  headCentre: Vector3;
  replacement: { position: Vector3; distanceM: number } | null;
}): RigEnvBuilt {
  const castThree = blenderToThree(input.castPatientBlender);
  const loci: RigEnvLocus[] = [];
  let keyHeadRelative: [number, number, number] = [0, 0, 0];
  let keyReplaced = false;
  for (const light of input.rig.lights) {
    const at = blenderToThree(light.position).sub(castThree);
    const area = light.size * light.size;
    const radiance =
      light.type === "area" && area > 0
        ? light.energy / area
        : Math.min(RIG_ENV_RADIANCE_MAX, light.energy * RIG_ENV_RADIANCE_PER_ENERGY);
    const isKey = light.name === "key";
    if (isKey) {
      keyHeadRelative = [at.x, at.y, at.z];
      if (input.replacement) {
        const rel = input.replacement.position.clone().sub(input.headCentre);
        loci.push({
          name: "key+override",
          at: [rel.x, rel.y, rel.z],
          widthM: light.size,
          heightM: light.size,
          radiance,
          colorTemperatureK: light.colorTemperatureK,
          replacedKey: true,
        });
        keyReplaced = true;
        continue;
      }
    }
    if (light.type === "area") {
      loci.push({
        name: light.name,
        at: [at.x, at.y, at.z],
        widthM: light.size,
        heightM: light.size,
        radiance,
        colorTemperatureK: light.colorTemperatureK,
        replacedKey: false,
      });
    } else {
      loci.push({
        name: light.name,
        at: [at.x, at.y, at.z],
        widthM: RIG_ENV_PUNCTUM_DISC_M,
        heightM: RIG_ENV_PUNCTUM_DISC_M,
        radiance,
        colorTemperatureK: light.colorTemperatureK,
        replacedKey: false,
      });
    }
  }
  return {
    loci,
    keyHeadRelative,
    keyReplaced,
    replacementName: keyReplaced ? "key+override" : null,
  };
}

/** PMREM the head-centred loci (black elsewhere) with the studio blur. */
export function pmremEnvFromLoci(
  renderer: WebGLRenderer,
  loci: RigEnvLocus[],
): Texture {
  const envScene = new Scene();
  envScene.background = new Color(0, 0, 0);
  const origin = new Vector3(0, 0, 0);
  for (const locus of loci) {
    const colour = new Color(temperatureToHex(locus.colorTemperatureK)).multiplyScalar(
      Math.max(locus.radiance, 0),
    );
    const mat = new MeshBasicMaterial({ color: colour, side: DoubleSide });
    const isPanel = locus.widthM !== RIG_ENV_PUNCTUM_DISC_M;
    const geo = isPanel
      ? new PlaneGeometry(locus.widthM, locus.heightM)
      : new CircleGeometry(RIG_ENV_PUNCTUM_DISC_M / 2, 24);
    const mesh = new Mesh(geo, mat);
    mesh.position.set(locus.at[0], locus.at[1], locus.at[2]);
    mesh.lookAt(origin);
    envScene.add(mesh);
  }
  const pmrem = new PMREMGenerator(renderer);
  const texture = pmrem.fromScene(envScene, RIG_ENV_PMREM_SIGMA).texture;
  pmrem.dispose();
  return texture;
}

/**
 * Full build for the applyProductRig call site: fetch the rig, resolve the
 * head-relative loci (with key replacement from the live scene), PMREM them.
 * Fail closed (null) when the rig is missing or has no patient cast entry —
 * the caller refuses rather than falling back to a generic room.
 */
export async function buildProductRigGlobeEnvMap(input: {
  renderer: WebGLRenderer;
  rigUrl: string;
  scene: Scene;
  headCentre: Vector3;
}): Promise<{ texture: Texture; built: RigEnvBuilt } | null> {
  const rig = await fetchRigEnvDocument(input.rigUrl);
  if (!rig) return null;
  const patient = rig.cast.find((c) => c.actorId === "patient");
  if (!patient) return null;
  const keyLight = rig.lights.find((l) => l.name === "key");
  const keyBlender = keyLight?.position ?? patient.position;
  const delta = new Vector3().subVectors(input.headCentre, blenderToThree(patient.position));
  const keyWorld = blenderToThree(keyBlender).add(delta);
  const replacement = findKeyReplacement(input.scene, keyWorld);
  const built = collectRigEnvLoci({
    rig,
    castPatientBlender: patient.position,
    headCentre: input.headCentre,
    replacement,
  });
  return { texture: pmremEnvFromLoci(input.renderer, built.loci), built };
}
