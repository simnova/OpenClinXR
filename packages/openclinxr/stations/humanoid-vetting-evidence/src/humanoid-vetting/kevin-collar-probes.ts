import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { repoRoot } from "@openclinxr/factory-station-core/runner";
import type { Mesh, Object3D } from "three";
import { PerspectiveCamera, Raycaster, Vector2, Vector3 } from "three";
import { decodePng } from "../../../../../../tools/openclinxr/evidence/decode-png.js";
import type {
  AttrScene,
  PixelProbe,
} from "../../../../../../tools/openclinxr/evidence/humanoid-vetting/kevin-collar-skin-probe.js";
import { probePixel } from "../../../../../../tools/openclinxr/evidence/humanoid-vetting/kevin-collar-skin-probe.js";
import { loadPosedModel } from "../../../../../../tools/openclinxr/evidence/humanoid-vetting/posed-scene.js";
import {
  classifyNurseWaistHit,
  type loadScene,
  sortHitsBruteForceOrder,
} from "../../../../../../tools/openclinxr/evidence/humanoid-vetting/see-through-pixels.js";

export type Pixel = [number, number];
export type Box = [number, number, number, number];
export type View = "front" | "three_quarter";
export type Direction = { label: string; azDeg: number; elDeg: number; r: number };
export type HeldOut = Direction & {
  box: Box;
  site: number;
  shirt: number;
  fill: number[];
  exclusions: { pixels: number[]; tri: string; rule: "a" | "b" }[];
  keepL: { c1Failures: number; gradeFailures: number };
};
export type HeldOutFixture = {
  center: [number, number, number];
  rim: string[];
  directions: HeldOut[];
};

export const root = repoRoot();
const asset = "apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.glb";
export const shippedGlb = join(root, asset);
export const body = "mpfb_peds_nurse_kevin_body";
export const skin = "mpfb_skin_peds_nurse_kevin";
export const uvFloor = 0.5;
export const heldSize = 1024;
export const gradeTie = (4 * 5.19 ** 2) / (0.01 * 2 ** 24);
export const productTie = gradeTie / 10;
export const openBoxes: Record<View, Record<string, Box>> = {
  front: {
    collar: [1910, 1275, 2176, 1328],
    vneck: [1911, 1313, 2170, 1456],
    sleeveL: [1100, 1450, 1500, 1800],
    sleeveR: [2600, 1450, 3000, 1800],
  },
  three_quarter: {
    collar: [2066, 1283, 2269, 1328],
    vneck: [2043, 1313, 2434, 1466],
    sleeveL: [1796, 1608, 1917, 1735],
    sleeveR: [2403, 1523, 2530, 1670],
  },
};
// The C2′ census includes the upper bounds on both axes.
const inclusive = ([x0, y0, x1, y1]: Box): Box => [x0, y0, x1 + 1, y1 + 1];
export const shirtBoxes: Record<View, Box[]> = {
  front: Object.values(openBoxes.front).map(inclusive),
  three_quarter: [...Object.values(openBoxes.three_quarter), [2340, 1350, 2460, 1440] as Box].map(inclusive),
};

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function* pixels([x0, y0, x1, y1]: Box, stride: number): Generator<Pixel> {
  for (let y = y0; y < y1; y += stride) {
    for (let x = x0; x < x1; x += stride) yield [x, y];
  }
}

export function rayHits(model: Object3D, camera: PerspectiveCamera, [x, y]: Pixel, size = 4096) {
  const raycaster = new Raycaster();
  raycaster.near = 0.01;
  raycaster.far = 100;
  raycaster.setFromCamera(new Vector2(((x + 0.5) / size) * 2 - 1, 1 - ((y + 0.5) / size) * 2), camera);
  const hits = raycaster.intersectObject(model, true);
  sortHitsBruteForceOrder(model, hits);
  return { hits, direction: raycaster.ray.direction };
}

export function hitClass(mesh: Object3D | undefined) {
  if (!mesh) return "miss";
  const { matName, alphaMode } = mesh.userData;
  return classifyNurseWaistHit(mesh.name, String(matName ?? ""), String(alphaMode ?? "OPAQUE"));
}

export function paintedFailure(hit: PixelProbe | null, scene: AttrScene) {
  if (!hit) return "miss";
  if (
    hit.cls !== "skin" ||
    hit.meshName !== body ||
    hit.matName !== scene.skinMatName ||
    (hit.matIndex >= 0 && hit.matIndex !== scene.skinMatIndex)
  ) return `material ${hit.cls}`;
  if (!(hit.dotWind < 0)) return "winding";
  if (!(hit.dotShade > 0)) return "normals";
  // Midpoint between unpainted black (0) and the darkest painted texel (20).
  if (!hit.texel || Math.max(...hit.texel) < 10) return "padding";
  return null;
}

export function tri(hit: PixelProbe | null) {
  return hit ? `${hit.primIndex}:${hit.faceIndex}` : "-";
}

export async function posed(path: string, frame: Awaited<ReturnType<typeof loadScene>>) {
  const doc = await new NodeIO().read(path);
  const materials = doc.getRoot().listMaterials();
  const skinMatIndex = materials.findIndex((material) => material.getName() === skin);
  if (materials.some((material, index) => index !== skinMatIndex && material.getName() === skin)) {
    throw new Error(`Ambiguous Kevin skin material ${skin} in ${path}`);
  }
  const image = materials[skinMatIndex]?.getBaseColorTexture()?.getImage();
  const texture = image && decodePng(image);
  if (!texture) throw new Error(`Missing Kevin skin texture in ${path}`);
  const { model } = await loadPosedModel(path);
  model.scale.copy(frame.model.scale);
  model.position.copy(frame.model.position);
  model.updateMatrixWorld(true);
  const scene: AttrScene = { camera: frame.camera, model, prims: [], skin: texture, skinMatIndex, skinMatName: skin };
  return scene;
}

export function uvArea(scene: AttrScene, hit: PixelProbe) {
  const mesh = (scene.model.children as Mesh[]).find(
    (child) => child.userData["meshName"] === body && child.userData["primIndex"] === hit.primIndex,
  );
  const index = mesh?.geometry.getIndex();
  const uv = mesh?.geometry.getAttribute("uv");
  if (!index || !uv || !scene.skin) return 0;
  const a = index.getX(3 * hit.faceIndex);
  const b = index.getX(3 * hit.faceIndex + 1);
  const c = index.getX(3 * hit.faceIndex + 2);
  const abx = uv.getX(b) - uv.getX(a);
  const aby = uv.getY(b) - uv.getY(a);
  const acx = uv.getX(c) - uv.getX(a);
  const acy = uv.getY(c) - uv.getY(a);
  return (Math.abs(abx * acy - aby * acx) / 2) * scene.skin.w * scene.skin.h;
}

export function openingHit(scene: AttrScene, [x, y]: Pixel, size = 4096) {
  const hit = probePixel(scene, x, y, size, size);
  const painted = paintedFailure(hit, scene);
  const failure = painted ?? (hit && uvArea(scene, hit) >= uvFloor ? null : "facet");
  return { hit, failure };
}

export function heldCamera(direction: Direction, center: Vector3) {
  const az = (direction.azDeg * Math.PI) / 180;
  const el = (direction.elDeg * Math.PI) / 180;
  const eye = new Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  const camera = new PerspectiveCamera(35, 1, 0.01, 100);
  camera.position.copy(center).add(eye.multiplyScalar(direction.r));
  camera.lookAt(center);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}

function isScrubShirt(mesh: Object3D) {
  return /scrub_shirt/.test(String(mesh.userData["matName"] ?? ""));
}

export function shirtFailure(scene: AttrScene, px: Pixel, size: number, tie: number) {
  const { hits, direction } = rayHits(scene.model, scene.camera, px, size);
  const first = hits[0];
  if (!first?.face || !isScrubShirt(first.object) || first.face.normal.dot(direction) >= 0) return "scrub shirt not first";
  const near = hits.slice(1).some(({ object, distance }) =>
    object.userData["meshName"] === body && hitClass(object) === "skin" && Math.abs(distance - first.distance) <= tie,
  );
  return near ? "skin tied with shirt" : null;
}

export function isForwardShirt(scene: AttrScene, px: Pixel, size: number) {
  const { hits, direction } = rayHits(scene.model, scene.camera, px, size);
  const first = hits[0];
  return !!first?.face && isScrubShirt(first.object) && first.face.normal.dot(direction) < 0;
}
