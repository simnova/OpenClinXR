/**
 * kevin-collar-skin-probe.ts — per-pixel opening-skin probe for the Kevin collar card (S4).
 *
 * Why this instrument: the S3 collar/sleeve test classifies first-hit MATERIAL
 * (hidden vs skin) through loadScene, whose geometry carries no NORMAL or
 * TEXCOORD attributes. S4 grading showed the S3 fix renders BLACK: a raycast hit
 * on a skin-material triangle can still draw black (untextured UV island,
 * inverted shading normal). This probe loads the same cameras/framing as
 * loadScene (same world-matrix bake, scale, reposition, frameCameraForBounds)
 * but keeps the TRUE POSITION/NORMAL/TEXCOORD_0 attributes, so each pixel maps
 * to its (prim, triangle), geometric winding, interpolated shading normal,
 * material index, interpolated UV and skin-texture texel.
 *
 * NOT a replacement for loadScene: loadScene stays the clause-(a)/(b) census
 * instrument. This module is the clause-C (skin colour) probe.
 */
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
import { acceleratedRaycast, MeshBVH } from "three-mesh-bvh";
import { type DecodedPng, decodePng } from "../decode-png.js";
import { computeBaseMeshBounds, frameCameraForBounds, sortHitsBruteForceOrder } from "./see-through-pixels.js";
import { classifyNurseWaistHit } from "./see-through-pixels.js";

// mirrors FixedCameraView in apps/arena/model-vetting-studio/src/candidate-capture-views.ts
export type ProbeView = "front" | "three_quarter";

type GltfNode = {
  getMesh: () => {
    getName: () => string;
    listPrimitives: () => Array<{
      getAttribute: (name: string) => { getArray: () => ArrayLike<number> | null } | null;
      getIndices: () => { getArray: () => ArrayLike<number> | null } | null;
      getMaterial: () => {
        getName: () => string;
        getAlphaMode: () => string;
        getBaseColorTexture: () => { getImage: () => Uint8Array | null } | null;
      } | null;
    }>;
  } | null;
  getName: () => string;
  getMatrix: () => number[];
  listChildren: () => unknown[];
};

export type PrimInfo = {
  meshName: string;
  primIndex: number;
  matName: string;
  matIndex: number;
  alphaMode: string;
};

export type ProbeSubstitution =
  | { readonly kind: "flipWinding"; readonly prims: ReadonlySet<number> }
  | { readonly kind: "negateNormals"; readonly prims: ReadonlySet<number> }
  | {
      readonly kind: "remapMaterial";
      readonly prims: ReadonlySet<number>;
      readonly matName: string;
      readonly matIndex: number;
      readonly alphaMode: string;
    };

export type AttrScene = {
  camera: PerspectiveCamera;
  model: Group;
  prims: PrimInfo[];
  /** Decoded skin baseColor texture (null when the skin material has none). */
  skin: DecodedPng | null;
  skinMatIndex: number;
  skinMatName: string;
};

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

/**
 * Attribute-preserving scene: identical cameras, world bake, uniform scale and
 * reposition as loadScene, but geometry keeps TRUE NORMAL + TEXCOORD_0 and the
 * per-prim material index. `bodyMeshFilter` restricts loaded meshes (default:
 * all, matching loadScene). `substitutions` applies in-memory counterweight
 * edits (winding flip / normal negation on named prim indices of the BODY
 * mesh) and prints nothing — the caller prints the substitution.
 */
export async function loadAttrScene(
  glbPath: string,
  view: ProbeView,
  opts: {
    bodyMeshName?: string;
    skinMatName?: string;
    substitutions?: readonly ProbeSubstitution[];
  } = {},
): Promise<AttrScene> {
  const doc = await new NodeIO().read(glbPath);
  const root = doc.getRoot();
  const nodes = root.listNodes() as unknown as GltfNode[];
  const materials = root.listMaterials() as unknown as Array<{
    getName: () => string;
    getBaseColorTexture: () => { getImage: () => Uint8Array | null } | null;
  }>;

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

  const skinName = opts.skinMatName ?? "mpfb_skin_peds_nurse_kevin";
  let skinMatIndex = -1;
  for (let i = 0; i < materials.length; i++) {
    if (materials[i]?.getName() === skinName) skinMatIndex = i;
  }
  if (skinMatIndex < 0) throw new Error(`kevin-collar-skin-probe: skin material ${skinName} not found`);

  const flip = new Set<number>();
  const negate = new Set<number>();
  const remap = new Map<number, { matName: string; matIndex: number; alphaMode: string }>();
  for (const s of opts.substitutions ?? []) {
    if (s.kind === "flipWinding") for (const p of s.prims) flip.add(p);
    if (s.kind === "negateNormals") for (const p of s.prims) negate.add(p);
    if (s.kind === "remapMaterial")
      for (const p of s.prims) remap.set(p, { matName: s.matName, matIndex: s.matIndex, alphaMode: s.alphaMode });
  }

  const captureModel = new Group();
  const inspection = new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide });
  const prims: PrimInfo[] = [];
  for (const node of nodes) {
    const mesh = node.getMesh();
    if (mesh === null) continue;
    const meshName = mesh.getName() || node.getName() || "mesh";
    if (opts.bodyMeshName !== undefined && meshName !== opts.bodyMeshName) continue;
    const world = worldMatrix(node);
    if (world.length < 16) throw new Error(`kevin-collar-skin-probe: world matrix has ${world.length} elements`);
    const [w0 = 0, w1 = 0, w2 = 0, , w4 = 0, w5 = 0, w6 = 0, , w8 = 0, w9 = 0, w10 = 0, , w12 = 0, w13 = 0, w14 = 0] =
      world;
    // Upper-3x3 column lengths (uniform-scale guard: three.js normal matrix).
    const c0 = Math.hypot(w0, w1, w2) || 1;
    const c1 = Math.hypot(w4, w5, w6) || 1;
    const c2 = Math.hypot(w8, w9, w10) || 1;
    let primI = 0;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      const arr = pos?.getArray();
      if (!arr) {
        primI++;
        continue;
      }
      const n = arr.length / 3;
      const positions = new Float32Array(arr.length);
      for (let i = 0; i < n; i++) {
        const x = Number(arr[i * 3]);
        const y = Number(arr[i * 3 + 1]);
        const z = Number(arr[i * 3 + 2]);
        positions[i * 3] = w0 * x + w4 * y + w8 * z + w12;
        positions[i * 3 + 1] = w1 * x + w5 * y + w9 * z + w13;
        positions[i * 3 + 2] = w2 * x + w6 * y + w10 * z + w14;
      }
      const geom = new BufferGeometry();
      geom.setAttribute("position", new BufferAttribute(positions, 3));
      const nor = prim.getAttribute("NORMAL")?.getArray();
      if (nor && nor.length === arr.length) {
        const normals = new Float32Array(nor.length);
        const doNeg = negate.has(primI) && meshName === (opts.bodyMeshName ?? meshName);
        for (let i = 0; i < n; i++) {
          const nx = Number(nor[i * 3]) / c0;
          const ny = Number(nor[i * 3 + 1]) / c1;
          const nz = Number(nor[i * 3 + 2]) / c2;
          const s = doNeg ? -1 : 1;
          normals[i * 3] = s * nx;
          normals[i * 3 + 1] = s * ny;
          normals[i * 3 + 2] = s * nz;
        }
        geom.setAttribute("normal", new BufferAttribute(normals, 3));
      }
      const uv = prim.getAttribute("TEXCOORD_0")?.getArray();
      if (uv && uv.length === n * 2) {
        const uvs = new Float32Array(uv.length);
        for (let i = 0; i < uv.length; i++) uvs[i] = Number(uv[i]);
        geom.setAttribute("uv", new BufferAttribute(uvs, 2));
      }
      const idx = prim.getIndices()?.getArray();
      if (idx) {
        const list = Array.from(idx, (v) => Number(v));
        if (flip.has(primI) && meshName === (opts.bodyMeshName ?? meshName)) {
          for (let t = 0; t + 2 < list.length; t += 3) {
            const tmp = list[t + 1]!;
            list[t + 1] = list[t + 2]!;
            list[t + 2] = tmp;
          }
        }
        geom.setIndex(list);
      }
      const mat = prim.getMaterial();
      const obj = new Mesh(geom, inspection);
      obj.name = `${meshName}#${primI}`;
      const allMats = root.listMaterials() as unknown as Array<{ getName: () => string }>;
      let matIndex = -1;
      for (let i = 0; i < allMats.length; i++) {
        if (allMats[i]?.getName() === (mat?.getName() ?? "")) {
          matIndex = i;
          break;
        }
      }
      const sub = meshName === (opts.bodyMeshName ?? meshName) ? remap.get(primI) : undefined;
      const effMatName = sub?.matName ?? mat?.getName() ?? "";
      const effMatIndex = sub?.matIndex ?? matIndex;
      const effAlpha = sub?.alphaMode ?? mat?.getAlphaMode() ?? "OPAQUE";
      obj.userData = {
        matName: effMatName,
        matIndex: effMatIndex,
        alphaMode: effAlpha,
        meshName,
        primIndex: primI,
      };
      obj.frustumCulled = false;
      geom.boundsTree = new MeshBVH(geom, { verbose: false, indirect: true });
      obj.raycast = acceleratedRaycast;
      captureModel.add(obj);
      prims.push({
        meshName,
        primIndex: primI,
        matName: mat?.getName() ?? "",
        matIndex,
        alphaMode: mat?.getAlphaMode() ?? "OPAQUE",
      });
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
  frameCameraForBounds(camera, framed, view);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  let skin: DecodedPng | null = null;
  const skinTex = materials[skinMatIndex]?.getBaseColorTexture()?.getImage() ?? null;
  if (skinTex) skin = decodePng(skinTex);
  return { camera, model: captureModel, prims, skin, skinMatIndex, skinMatName: skinName };
}

export type PixelProbe = {
  cls: string;
  meshName: string;
  primIndex: number;
  matName: string;
  matIndex: number;
  faceIndex: number;
  /** Order-normalized resolved POSITION byte key of the hit triangle. */
  triKey: string;
  /** dot(geometic face normal, ray dir): < 0 means front-facing. */
  dotWind: number;
  /** Interpolated TRUE shading normal (unit). */
  nInterp: [number, number, number];
  /** dot(N_interp, -rayDir): > 0 means the shading normal faces the viewer. */
  dotShade: number;
  uv: [number, number] | null;
  texel: [number, number, number] | null;
};

/** Barycentric interpolation of the first-hit triangle's TRUE attributes. */
export function probePixel(scene: AttrScene, x: number, y: number, W = 4096, H = 4096): PixelProbe | null {
  const raycaster = new Raycaster();
  raycaster.far = 100;
  raycaster.near = 0.01;
  const ndc = new Vector2();
  ndc.set(((x + 0.5) / W) * 2 - 1, -((y + 0.5) / H) * 2 + 1);
  raycaster.setFromCamera(ndc, scene.camera);
  const hits = raycaster.intersectObject(scene.model, true);
  sortHitsBruteForceOrder(scene.model, hits);
  if (hits.length === 0) return null;
  const hit = hits[0]!;
  const mesh = hit.object as Mesh;
  const ud = mesh.userData as Record<string, unknown>;
  const meshName = String(ud["meshName"] ?? mesh.name);
  const primIndex = Number(ud["primIndex"] ?? -1);
  const matName = String(ud["matName"] ?? "");
  const matIndex = Number(ud["matIndex"] ?? -1);
  const alphaMode = String(ud["alphaMode"] ?? "OPAQUE");
  const cls = classifyNurseWaistHit(mesh.name, matName, alphaMode);
  const geom = mesh.geometry as BufferGeometry;
  const face = hit.face;
  if (!face) throw new Error("kevin-collar-skin-probe: hit without face");
  const posAttr = geom.getAttribute("position") as BufferAttribute;
  const a = new Vector3().fromBufferAttribute(posAttr, face.a);
  const b = new Vector3().fromBufferAttribute(posAttr, face.b);
  const c = new Vector3().fromBufferAttribute(posAttr, face.c);
  // World-space triangle (model transform is uniform scale + translation).
  const aw = mesh.localToWorld(a.clone());
  const bw = mesh.localToWorld(b.clone());
  const cw = mesh.localToWorld(c.clone());
  const e1 = bw.clone().sub(aw);
  const e2 = cw.clone().sub(aw);
  const fn = e1.clone().cross(e2).normalize();
  const rayDir = raycaster.ray.direction.clone().normalize();
  const dotWind = fn.dot(rayDir);
  const pw = hit.point.clone();
  const pl = mesh.worldToLocal(pw.clone());
  // Barycentric in local space.
  const v0 = new Vector3().fromBufferAttribute(posAttr, face.a);
  const v1 = new Vector3().fromBufferAttribute(posAttr, face.b);
  const v2 = new Vector3().fromBufferAttribute(posAttr, face.c);
  const d00 = v1.clone().sub(v0);
  const d01 = v2.clone().sub(v0);
  const d02 = pl.clone().sub(v0);
  const d000 = d00.dot(d00);
  const d001 = d00.dot(d01);
  const d011 = d01.dot(d01);
  const d002 = d00.dot(d02);
  const d012 = d01.dot(d02);
  const denom = d000 * d011 - d001 * d001;
  let w1 = 0;
  let w2 = 0;
  if (Math.abs(denom) > 1e-18) {
    w1 = (d011 * d002 - d001 * d012) / denom;
    w2 = (d000 * d012 - d001 * d002) / denom;
  }
  const w0b = 1 - w1 - w2;
  let nInterp: [number, number, number] = [fn.x, fn.y, fn.z];
  const norAttr = geom.getAttribute("normal") as BufferAttribute | undefined;
  if (norAttr) {
    const n0 = new Vector3().fromBufferAttribute(norAttr, face.a);
    const n1 = new Vector3().fromBufferAttribute(norAttr, face.b);
    const n2 = new Vector3().fromBufferAttribute(norAttr, face.c);
    // Model rotation is identity here (world bake + uniform scale), so local
    // normals compare directly against the world ray.
    const ni = new Vector3(
      w0b * n0.x + w1 * n1.x + w2 * n2.x,
      w0b * n0.y + w1 * n1.y + w2 * n2.y,
      w0b * n0.z + w1 * n1.z + w2 * n2.z,
    );
    if (ni.lengthSq() > 1e-18) {
      ni.normalize();
      nInterp = [ni.x, ni.y, ni.z];
    }
  }
  const dotShade = -(nInterp[0] * rayDir.x + nInterp[1] * rayDir.y + nInterp[2] * rayDir.z);
  let uv: [number, number] | null = null;
  let texel: [number, number, number] | null = null;
  const uvAttr = geom.getAttribute("uv") as BufferAttribute | undefined;
  if (uvAttr) {
    const u0 = uvAttr.getX(face.a);
    const v0u = uvAttr.getY(face.a);
    const u1 = uvAttr.getX(face.b);
    const v1u = uvAttr.getY(face.b);
    const u2 = uvAttr.getX(face.c);
    const v2u = uvAttr.getY(face.c);
    const u = w0b * u0 + w1 * u1 + w2 * u2;
    const v = w0b * v0u + w1 * v1u + w2 * v2u;
    uv = [u, v];
    if (scene.skin) {
      // three.js GLTFLoader sets flipY=false (r184 GLTFLoader.js: texture.flipY
      // = false), so v=0 is the PNG top row: yi = v*H.
      const Wpx = scene.skin.w;
      const Hpx = scene.skin.h;
      const xi = Math.min(Math.max(Math.floor(u * Wpx), 0), Wpx - 1);
      const yi = Math.min(Math.max(Math.floor(v * Hpx), 0), Hpx - 1);
      const k = yi * Wpx + xi;
      texel = [scene.skin.r[k] ?? 0, scene.skin.g[k] ?? 0, scene.skin.b[k] ?? 0];
    }
  }
  // Order-normalized POSITION key from LOCAL bytes (model transform is shared,
  // so local equality implies world equality).
  const keyOf = (idx: number): string =>
    `${posAttr.getX(idx).toPrecision(9)},${posAttr.getY(idx).toPrecision(9)},${posAttr.getZ(idx).toPrecision(9)}`;
  const triKey = [keyOf(face.a), keyOf(face.b), keyOf(face.c)].sort().join("|");
  return {
    cls,
    meshName,
    primIndex,
    matName,
    matIndex,
    faceIndex: hit.faceIndex ?? -1,
    triKey,
    dotWind,
    nInterp,
    dotShade,
    uv,
    texel,
  };
}

/** YCbCr (BT.601) channels of an sRGB texel. */
export function ycbcr(px: readonly [number, number, number]): [number, number, number] {
  const [r, g, b] = px;
  return [0.299 * r + 0.587 * g + 0.114 * b, 128 - 0.168736 * r - 0.331264 * g + 0.5 * b, 128 + 0.5 * r - 0.418688 * g - 0.081312 * b];
}

export type SkinBand = { y: [number, number]; cb: [number, number]; cr: [number, number]; n: number };

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return (sorted[lo] ?? 0) * (hi - pos) + (sorted[hi] ?? 0) * (pos - lo);
}

/** p2..p98 per YCbCr channel over sampled texels. */
export function computeBand(texels: Array<[number, number, number]>): SkinBand {
  const ys: number[] = [];
  const cbs: number[] = [];
  const crs: number[] = [];
  for (const t of texels) {
    const [y, cb, cr] = ycbcr(t);
    ys.push(y);
    cbs.push(cb);
    crs.push(cr);
  }
  ys.sort((a, b) => a - b);
  cbs.sort((a, b) => a - b);
  crs.sort((a, b) => a - b);
  return {
    y: [quantile(ys, 0.02), quantile(ys, 0.98)],
    cb: [quantile(cbs, 0.02), quantile(cbs, 0.98)],
    cr: [quantile(crs, 0.02), quantile(crs, 0.98)],
    n: texels.length,
  };
}

export function bandContains(band: SkinBand, px: readonly [number, number, number]): boolean {
  const [y, cb, cr] = ycbcr(px);
  return y >= band.y[0] && y <= band.y[1] && cb >= band.cb[0] && cb <= band.cb[1] && cr >= band.cr[0] && cr <= band.cr[1];
}

/** A glTF triangle by body-mesh primitive + three.js face (triangle) ordinal. */
export type TriRef = { primIndex: number; faceIndex: number };

/**
 * UV area of glTF triangles in skin-texel² (cap39 R-B clause C2 instrument).
 *
 * A moved triangle covering under one texel renders one flat colour
 * (S4 v3-soup pinned 133 moved tris degenerate to a single texel each: the
 * facet patchwork). UV area = |cross(uv)|/2 * W * H with W/H from the
 * skin baseColor image. Reads the GLB directly through gltf-transform, so
 * the areas are independent of the raycast scene.
 */
export async function triUvAreasTexelsSq(
  glbPath: string,
  meshName: string,
  skinMatName: string,
  refs: readonly TriRef[],
): Promise<{ areas: number[]; w: number; h: number }> {
  const doc = await new NodeIO().read(glbPath);
  const root = doc.getRoot();
  const mat = root.listMaterials().find((m) => m.getName() === skinMatName);
  if (!mat) throw new Error(`triUvAreas: skin material ${skinMatName} not found in ${glbPath}`);
  const imgBytes = mat.getBaseColorTexture()?.getImage();
  if (!imgBytes) throw new Error(`triUvAreas: skin material ${skinMatName} has no baseColor image`);
  const skin = decodePng(imgBytes);
  if (!skin) throw new Error(`triUvAreas: skin baseColor image of ${skinMatName} does not decode`);
  const mesh = root.listMeshes().find((m) => m.getName() === meshName);
  if (!mesh) throw new Error(`triUvAreas: mesh ${meshName} not found in ${glbPath}`);
  const prims = mesh.listPrimitives();
  const areas: number[] = [];
  for (const ref of refs) {
    const prim = prims[ref.primIndex];
    if (!prim) throw new Error(`triUvAreas: ${meshName} has no prim ${ref.primIndex}`);
    const uv = prim.getAttribute("TEXCOORD_0")?.getArray();
    if (!uv) throw new Error(`triUvAreas: ${meshName}#${ref.primIndex} carries no TEXCOORD_0`);
    const idx = prim.getIndices()?.getArray();
    const at = (v: number): [number, number] => [Number(uv[v * 2]), Number(uv[v * 2 + 1])];
    let a: number;
    let b: number;
    let c: number;
    if (idx) {
      a = Number(idx[ref.faceIndex * 3]);
      b = Number(idx[ref.faceIndex * 3 + 1]);
      c = Number(idx[ref.faceIndex * 3 + 2]);
    } else {
      a = ref.faceIndex * 3;
      b = ref.faceIndex * 3 + 1;
      c = ref.faceIndex * 3 + 2;
    }
    const [u0, v0] = at(a);
    const [u1, v1] = at(b);
    const [u2, v2] = at(c);
    const areaUv = Math.abs((u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0)) / 2;
    areas.push(areaUv * skin.w * skin.h);
  }
  return { areas, w: skin.w, h: skin.h };
}

/** UV areas of every triangle of the listed body-mesh primitives. */
export async function primTriUvAreasTexelsSq(
  glbPath: string,
  meshName: string,
  skinMatName: string,
  primIndices: readonly number[],
): Promise<{ areas: number[]; w: number; h: number; counts: number[] }> {
  const doc = await new NodeIO().read(glbPath);
  const root = doc.getRoot();
  const mesh = root.listMeshes().find((m) => m.getName() === meshName);
  if (!mesh) throw new Error(`primTriUvAreas: mesh ${meshName} not found in ${glbPath}`);
  const prims = mesh.listPrimitives();
  const refs: TriRef[] = [];
  const counts: number[] = [];
  for (const pi of primIndices) {
    const prim = prims[pi];
    if (!prim) throw new Error(`primTriUvAreas: ${meshName} has no prim ${pi}`);
    const idx = prim.getIndices()?.getArray();
    let n: number;
    if (idx) {
      n = Math.floor(idx.length / 3);
    } else {
      const pos = prim.getAttribute("POSITION")?.getArray();
      if (!pos) throw new Error(`primTriUvAreas: ${meshName}#${pi} has no POSITION`);
      n = Math.floor(pos.length / 9);
    }
    counts.push(n);
    for (let f = 0; f < n; f++) refs.push({ primIndex: pi, faceIndex: f });
  }
  const { areas, w, h } = await triUvAreasTexelsSq(glbPath, meshName, skinMatName, refs);
  return { areas, w, h, counts };
}
