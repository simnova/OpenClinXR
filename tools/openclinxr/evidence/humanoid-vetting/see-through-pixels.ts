/**
 * HB-07 see-through instrument (attempt-3 camera reconstruction).
 *
 * An exact-background pixel is see-through only when the isolated-grade camera
 * ray through it first-hits a GLB face (any primitive, including alpha-MASK
 * hidden faces). Misses are silhouette gaps (hair/neck, arm/torso) and are
 * not the defect.
 *
 * Camera: candidate-capture.ts PerspectiveCamera(35) + frameCameraForBounds.
 * Geometry: NodeIO world meshes, DoubleSide MeshBasicMaterial (no alphaTest,
 * so MASK hidden faces still count as a hit).
 */
import { readFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Vector2,
  Vector3,
} from "three";
import {
  computeBaseMeshBounds,
  frameCameraForBounds,
} from "../../../../apps/arena/model-vetting-studio/src/candidate-capture-geometry.ts";
import { decodePng, type DecodedPng } from "../decode-png.ts";

export const BG_LUMA = 0.299 * 24 + 0.587 * 33 + 0.114 * 29;
export const PRE_FIX_REV = "63dc2fb2";

export const SITES: Record<string, readonly [number, number, number, number]> = {
  "neckline-square-L": [1840, 1300, 1980, 1400],
  "neckline-square-R": [2120, 1300, 2260, 1400],
  "sleeve-hem-rectangle-L": [1560, 1630, 1920, 1920],
  "sleeve-hem-rectangle-R": [2180, 1630, 2540, 1920],
};
export const CONTROL_C: readonly [number, number, number, number] = [1980, 1180, 2120, 1300];
/** Chest box from the attempt-3 probe — poke-through counterweight. */
export const TORSO: readonly [number, number, number, number] = [1980, 1680, 2120, 1880];
/** Adult-nurse waistband box (collar-test header; garment-fit site, not hide-mask). */
export const NURSE_WAISTBAND: readonly [number, number, number, number] = [1880, 1980, 2220, 2180];

export type SiteCount = {
  subject: number;
  bg: number;
  seeThrough: number;
  miss: number;
  hidden_upper: number;
  /** First-hit hidden (MASK) among all subject pixels when classifySubject is set. */
  hiddenSubject: number;
  visible_skin: number;
  visibleSkinSubject: number;
};

export type SeeThroughReport = {
  sites: Record<string, SiteCount>;
  controlC: SiteCount;
  torso: SiteCount;
};

type GltfNode = {
  getMesh: () => {
    getName: () => string;
    listPrimitives: () => Array<{
      getAttribute: (name: string) => { getArray: () => ArrayLike<number> | null } | null;
      getIndices: () => { getArray: () => ArrayLike<number> | null } | null;
      getMaterial: () => { getName: () => string; getAlphaMode: () => string } | null;
    }>;
  } | null;
  getName: () => string;
  getMatrix: () => number[];
  listChildren: () => unknown[];
};

function classify(name: string, matName: string, alphaMode: string): string {
  const n = `${name} ${matName}`.toLowerCase();
  if (/hidden/.test(n) || (alphaMode === "MASK" && /hidden|openclinxr_hidden/.test(n))) return "hidden_upper";
  if (/t[_-]?shirt/.test(n)) return "t-shirt";
  if (/body|skin|mpfb_peds_patient_child/.test(n) && !/hidden/.test(n) && alphaMode !== "MASK") {
    return "visible_skin";
  }
  return "other";
}

function multiply(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (a[k * 4 + row] ?? 0) * (b[col * 4 + k] ?? 0);
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

export async function loadScene(glbPath: string): Promise<{ camera: PerspectiveCamera; model: Group }> {
  const doc = await new NodeIO().read(glbPath);
  const root = doc.getRoot();
  const nodes = root.listNodes() as unknown as GltfNode[];

  function parentOf(child: GltfNode): GltfNode | null {
    for (const node of nodes) {
      if ((node.listChildren() as unknown[]).includes(child)) return node;
    }
    return null;
  }
  function worldMatrix(node: GltfNode): number[] {
    const local = [...node.getMatrix()];
    const parent = parentOf(node);
    return parent === null ? local : multiply(worldMatrix(parent), local);
  }

  const captureModel = new Group();
  const inspection = new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide });
  for (const node of nodes) {
    const mesh = node.getMesh();
    if (mesh === null) continue;
    const world = worldMatrix(node);
    let primI = 0;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      const arr = pos?.getArray();
      if (!arr) continue;
      const geom = new BufferGeometry();
      const positions = new Float32Array(arr.length);
      for (let i = 0; i < arr.length; i += 3) {
        const x = Number(arr[i]);
        const y = Number(arr[i + 1]);
        const z = Number(arr[i + 2]);
        positions[i] = world[0]! * x + world[4]! * y + world[8]! * z + world[12]!;
        positions[i + 1] = world[1]! * x + world[5]! * y + world[9]! * z + world[13]!;
        positions[i + 2] = world[2]! * x + world[6]! * y + world[10]! * z + world[14]!;
      }
      geom.setAttribute("position", new BufferAttribute(positions, 3));
      const idx = prim.getIndices()?.getArray();
      if (idx) geom.setIndex(Array.from(idx, (v) => Number(v)));
      geom.computeVertexNormals();
      const mat = prim.getMaterial();
      const obj = new Mesh(geom, inspection);
      obj.name = `${mesh.getName() || node.getName() || "mesh"}#${primI}`;
      obj.userData = { matName: mat?.getName() ?? "", alphaMode: mat?.getAlphaMode() ?? "OPAQUE" };
      obj.frustumCulled = false;
      captureModel.add(obj);
      primI++;
    }
  }
  captureModel.updateMatrixWorld(true);
  const initialBounds = computeBaseMeshBounds(captureModel);
  const initialSize = initialBounds.getSize(new Vector3());
  const baseScale = 2.2 / Math.max(initialSize.y, 0.001);
  captureModel.scale.setScalar(baseScale);
  captureModel.updateMatrixWorld(true);
  const bounds = computeBaseMeshBounds(captureModel);
  const center = bounds.getCenter(new Vector3());
  captureModel.position.set(-center.x, -bounds.min.y, -center.z);
  captureModel.updateMatrixWorld(true);
  const framed = computeBaseMeshBounds(captureModel);
  const camera = new PerspectiveCamera(35, 1, 0.01, 100);
  frameCameraForBounds(camera, framed, "front");
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return { camera, model: captureModel };
}

function empty(): SiteCount {
  return {
    subject: 0,
    bg: 0,
    seeThrough: 0,
    miss: 0,
    hidden_upper: 0,
    hiddenSubject: 0,
    visible_skin: 0,
    visibleSkinSubject: 0,
  };
}

function sampleBox(
  lit: DecodedPng,
  struct: DecodedPng,
  scene: { camera: PerspectiveCamera; model: Group },
  box: readonly number[],
  mode: "bg-only" | "subject",
  classifySubject = false,
): SiteCount {
  const out = empty();
  const W = lit.w;
  const raycaster = new Raycaster();
  raycaster.far = 100;
  raycaster.near = 0.01;
  const ndc = new Vector2();
  for (let y = box[1]!; y < box[3]!; y++) {
    for (let x = box[0]!; x < box[2]!; x++) {
      const i = y * W + x;
      if (struct.lum[i]! <= 40) continue;
      out.subject++;
      const isBg = Math.abs(lit.lum[i]! - BG_LUMA) < 0.01;
      if (mode === "bg-only" && !isBg && !classifySubject) continue;
      if (isBg) out.bg++;
      ndc.set(((x + 0.5) / W) * 2 - 1, -((y + 0.5) / lit.h) * 2 + 1);
      raycaster.setFromCamera(ndc, scene.camera);
      const hits = raycaster.intersectObject(scene.model, true);
      if (hits.length === 0) {
        if (isBg) out.miss++;
        continue;
      }
      if (isBg) out.seeThrough++;
      const mesh = hits[0]!.object as Mesh;
      const cls = classify(
        mesh.name,
        String(mesh.userData.matName ?? ""),
        String(mesh.userData.alphaMode ?? "OPAQUE"),
      );
      if (cls === "hidden_upper") {
        if (isBg) out.hidden_upper++;
        out.hiddenSubject++;
      }
      if (cls === "visible_skin") {
        if (isBg) out.visible_skin++;
        out.visibleSkinSubject++;
      }
    }
  }
  return out;
}

/** Slot-safe first-hit class for the adult-nurse waistband (scrub_pants is pants, not shirt). */
export function classifyNurseWaistHit(name: string, matName: string, alphaMode: string): string {
  const n = `${name} ${matName}`.toLowerCase();
  if (/hidden/.test(n) || (alphaMode === "MASK" && /hidden|openclinxr_hidden/.test(n))) return "hidden";
  if (/pants|trouser|cargo/.test(n)) return "pants";
  if (/scrub_shirt|t[_-]?shirt|lab_coat/.test(n)) return "shirt";
  if (/body|skin/.test(n)) return "skin";
  return "other";
}

export async function countFirstHitsInBox(opts: {
  glbPath: string;
  litPath: string;
  structPath: string;
  box: readonly [number, number, number, number];
  classifyHit: (name: string, matName: string, alphaMode: string) => string;
}): Promise<{ subject: number; counts: Record<string, number>; skinRowCount: number }> {
  const scene = await loadScene(opts.glbPath);
  const lit = decodePng(new Uint8Array(readFileSync(opts.litPath)));
  const struct = decodePng(new Uint8Array(readFileSync(opts.structPath)));
  if (lit === null || struct === null) throw new Error("PNG decode failed");
  const counts: Record<string, number> = {};
  let subject = 0;
  const skinRows = new Set<number>();
  const raycaster = new Raycaster();
  raycaster.far = 100;
  raycaster.near = 0.01;
  const ndc = new Vector2();
  const box = opts.box;
  for (let y = box[1]; y < box[3]; y++) {
    for (let x = box[0]; x < box[2]; x++) {
      const i = y * lit.w + x;
      if (struct.lum[i]! <= 40) continue;
      subject++;
      ndc.set(((x + 0.5) / lit.w) * 2 - 1, -((y + 0.5) / lit.h) * 2 + 1);
      raycaster.setFromCamera(ndc, scene.camera);
      const hits = raycaster.intersectObject(scene.model, true);
      if (hits.length === 0) continue;
      const mesh = hits[0]!.object as Mesh;
      const cls = opts.classifyHit(
        mesh.name,
        String(mesh.userData.matName ?? ""),
        String(mesh.userData.alphaMode ?? "OPAQUE"),
      );
      counts[cls] = (counts[cls] ?? 0) + 1;
      if (cls === "skin") skinRows.add(y);
    }
  }
  return { subject, counts, skinRowCount: skinRows.size };
}

export async function countSeeThrough(opts: {
  glbPath: string;
  litPath: string;
  structPath: string;
  /** Raycast every subject pixel (not only exact-bg). Needed to count hiddenSubject. */
  classifySubject?: boolean;
}): Promise<SeeThroughReport> {
  const scene = await loadScene(opts.glbPath);
  const lit = decodePng(new Uint8Array(readFileSync(opts.litPath)));
  const struct = decodePng(new Uint8Array(readFileSync(opts.structPath)));
  if (lit === null || struct === null) throw new Error("PNG decode failed");
  const classifySubject = opts.classifySubject === true;
  const sites: Record<string, SiteCount> = {};
  for (const [id, box] of Object.entries(SITES)) {
    sites[id] = sampleBox(lit, struct, scene, box, "bg-only", classifySubject);
  }
  return {
    sites,
    controlC: sampleBox(lit, struct, scene, CONTROL_C, "bg-only", classifySubject),
    torso: sampleBox(lit, struct, scene, TORSO, "subject", classifySubject),
  };
}
