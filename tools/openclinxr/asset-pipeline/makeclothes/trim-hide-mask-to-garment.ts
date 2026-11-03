/**
 * trim-hide-mask-to-garment.ts — post-export mask-fit stage: derive each body
 * hide-mask region from the worn garment footprint, minus an inset.
 *
 * The bake-time mask (garment_coverage.body_hide_mask + RENDER_TRUTH_REHIDE in
 * tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py) is
 * sized for the garments fitted at bake time. A later garment swap (street male
 * c099c2de2: trousers -> straight-leg jeans, pants top now 1.0640 m while the
 * lower hide-mask .001 still tops out at 1.0760 m) leaves the mask sized for the
 * old garment: 12.0 mm over-reach against the 6 mm waistband bound. A full
 * rebake churns the body (26,756 -> 107,024 tris), teeth/tongue and clips, so
 * the fix is a post-export micro-surgery that moves only the over-reaching
 * hide-mask triangles back to skin.
 *
 * Provenance, not invention:
 * - garment channels via the ONE shared classifier
 *   (tools/openclinxr/evidence/lib/garment-mesh-class.ts) — the same predicates
 *   the waistband and footprint evidence tests drive, never private literals;
 * - footprint clip mirrors packages/openclinxr/factory-stations/src/body_param/garment_ops.py
 *   clip_hide_mask_to_garment_footprint (polygon-level AABB + HIDE_MASK_FOOTPRINT_SLACK_M);
 * - waistband rim inset mirrors the waist-meet margin scale (several millimetres):
 *   the lower mask tops out INSET_M below the trouser rim, the upper mask starts
 *   INSET_M above the shirt hem, so the restored skin band stays under the
 *   measured shirt/trouser overlap (35.7 mm on the street male).
 *
 * Size discipline: the shipped skin primitive is NEVER rewritten — its morph
 * targets are sparse-encoded and a dense rewrite doubles the file. Moved
 * triangles land in one small new skin-material primitive (dozens of triangles),
 * and only the small hidden primitives are rebuilt. Morph-aware throughout:
 * moved triangles copy every semantic plus every morph-target POSITION/NORMAL.
 *
 * Run:
 *   pnpm exec tsx tools/openclinxr/asset-pipeline/makeclothes/trim-hide-mask-to-garment.ts \
 *     --in <glb> --out <glb> [--inset-m 0.002] [--slack-m 0.0015] [--dry]
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { NodeIO, type Accessor, type Primitive } from "@gltf-transform/core";
import { prune } from "@gltf-transform/functions";
import {
  classifyGarmentMeshName,
  isTrouserMeshName,
  isUpperMeshName,
} from "../../evidence/lib/garment-mesh-class.js";

type Vec3 = [number, number, number];

/** Bake-time footprint slack, garment_ops.py HIDE_MASK_FOOTPRINT_SLACK_M. */
const FOOTPRINT_SLACK_M = 0.0015;
/** Waistband rim inset: the mask stops this far inside the garment rim. */
const RIM_INSET_M = 0.002;

const HIDDEN_RE = /hidden/i;
const SLOT_RE = /hidden_(upper|lower|foot|orphan)/i;

type Slot = "upper" | "lower" | "foot" | "orphan";

type Box = { min: Vec3; max: Vec3 };

function at<T>(arr: ArrayLike<T>, i: number, fallback: T): T {
  const v: T | undefined = (arr as readonly T[])[i];
  return v === undefined ? fallback : v;
}

function slotOf(materialName: string): Slot {
  const m = materialName.match(SLOT_RE);
  const s = m !== null ? (m[1] ?? "") : "";
  if (s === "upper") return "upper";
  if (s === "lower") return "lower";
  if (s === "foot") return "foot";
  return "orphan";
}

function boxOf(points: Vec3[]): Box | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    const x = at(p, 0, 0);
    const y = at(p, 1, 0);
    const z = at(p, 2, 0);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

function mergeBox(a: Box | null, b: Box): Box {
  if (a === null) return b;
  return {
    min: [
      Math.min(at(a.min, 0, 0), at(b.min, 0, 0)),
      Math.min(at(a.min, 1, 0), at(b.min, 1, 0)),
      Math.min(at(a.min, 2, 0), at(b.min, 2, 0)),
    ],
    max: [
      Math.max(at(a.max, 0, 0), at(b.max, 0, 0)),
      Math.max(at(a.max, 1, 0), at(b.max, 1, 0)),
      Math.max(at(a.max, 2, 0), at(b.max, 2, 0)),
    ],
  };
}

type PrimData = {
  prim: Primitive;
  pos: number[][];
  nor: number[][];
  uv: number[][];
  joints: number[][];
  weights: number[][];
  indices: number[];
  morphPos: number[][][];
  morphNor: number[][][];
  jointsArray: Uint8Array | Uint16Array | Uint32Array;
  indexArray: Uint16Array | Uint32Array;
};

function toFloatRows(accessor: Accessor, size: number): number[][] {
  const src = accessor.getArray();
  const out: number[][] = [];
  if (src === null || src === undefined) return out;
  const values: number[] = Array.from(src);
  const n = accessor.getCount();
  for (let i = 0; i < n; i += 1) {
    const row: number[] = [];
    for (let k = 0; k < size; k += 1) row.push(at(values, i * size + k, 0));
    out.push(row);
  }
  return out;
}

function readPrim(prim: Primitive): PrimData | null {
  const posA = prim.getAttribute("POSITION");
  const norA = prim.getAttribute("NORMAL");
  const uvA = prim.getAttribute("TEXCOORD_0");
  const jA = prim.getAttribute("JOINTS_0");
  const wA = prim.getAttribute("WEIGHTS_0");
  const idxA = prim.getIndices();
  if (!posA || !norA || !uvA || !jA || !wA || !idxA) return null;
  const jArr = jA.getArray();
  const idxArr = idxA.getArray();
  if (!(jArr instanceof Uint8Array || jArr instanceof Uint16Array || jArr instanceof Uint32Array)) return null;
  if (!(idxArr instanceof Uint16Array || idxArr instanceof Uint32Array)) return null;
  const targets = prim.listTargets();
  const morphPos: number[][][] = [];
  const morphNor: number[][][] = [];
  for (const t of targets) {
    const mp = t.getAttribute("POSITION");
    const mn = t.getAttribute("NORMAL");
    if (!mp || !mn) return null;
    morphPos.push(toFloatRows(mp, 3));
    morphNor.push(toFloatRows(mn, 3));
  }
  return {
    prim,
    pos: toFloatRows(posA, 3),
    nor: toFloatRows(norA, 3),
    uv: toFloatRows(uvA, 2),
    joints: toFloatRows(jA, 4).map((r) => r.map((v) => Math.round(v))),
    weights: toFloatRows(wA, 4),
    indices: Array.from(idxArr),
    morphPos,
    morphNor,
    jointsArray: jArr,
    indexArray: idxArr,
  };
}

function triVerdict(
  pa: number[],
  pb: number[],
  pc: number[],
  slot: Slot,
  chan: Box,
  insetM: number,
  slackM: number,
): boolean {
  const triMaxY = Math.max(at(pa, 1, 0), at(pb, 1, 0), at(pc, 1, 0));
  const triMinY = Math.min(at(pa, 1, 0), at(pb, 1, 0), at(pc, 1, 0));
  for (const p of [pa, pb, pc]) {
    const x = at(p, 0, 0);
    const y = at(p, 1, 0);
    const z = at(p, 2, 0);
    if (
      x < at(chan.min, 0, 0) - slackM ||
      x > at(chan.max, 0, 0) + slackM ||
      y < at(chan.min, 1, 0) - slackM ||
      y > at(chan.max, 1, 0) + slackM ||
      z < at(chan.min, 2, 0) - slackM ||
      z > at(chan.max, 2, 0) + slackM
    ) {
      return true;
    }
  }
  if (slot === "lower" && triMaxY > at(chan.max, 1, 0) - insetM) return true;
  if (slot === "upper" && triMinY < at(chan.min, 1, 0) + insetM) return true;
  return false;
}

export async function trimHideMaskToGarment(opts: {
  input: string;
  output: string;
  insetM: number;
  slackM: number;
  dry: boolean;
}): Promise<{
  movedTriangles: number;
  movedVertices: number;
  perSlot: Record<string, number>;
  pantsTop: number | null;
  maskTopBefore: number | null;
  maskTopAfter: number | null;
}> {
  const io = new NodeIO();
  const doc = await io.read(opts.input);
  const el: Vec3 = [0, 0, 0];

  const garmentPoints = (pred: (name: string) => boolean): Vec3[] => {
    const out: Vec3[] = [];
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const matName = prim.getMaterial()?.getName() ?? "";
        const key = `${mesh.getName()}/${matName}`;
        if (HIDDEN_RE.test(matName)) continue;
        if (!pred(key)) continue;
        const pos = prim.getAttribute("POSITION");
        if (!pos) continue;
        for (let i = 0; i < pos.getCount(); i += 1) {
          pos.getElement(i, el);
          out.push([at(el, 0, 0), at(el, 1, 0), at(el, 2, 0)]);
        }
      }
    }
    return out;
  };

  const upperBox = boxOf(garmentPoints((n) => isUpperMeshName(n)));
  const lowerBox = boxOf(garmentPoints((n) => isTrouserMeshName(n)));
  const footwearBox = boxOf(garmentPoints((n) => classifyGarmentMeshName(n) === "footwear"));

  let unionBox: Box | null = null;
  if (upperBox) unionBox = mergeBox(unionBox, upperBox);
  if (lowerBox) unionBox = mergeBox(unionBox, lowerBox);
  if (footwearBox) unionBox = mergeBox(unionBox, footwearBox);

  const channelBox = (slot: Slot): Box | null => {
    if (slot === "upper") return upperBox;
    if (slot === "lower") return lowerBox;
    if (slot === "foot") return footwearBox;
    return unionBox;
  };

  const bodyMeshes = doc.getRoot().listMeshes().filter((m) =>
    m.listPrimitives().some((p) => HIDDEN_RE.test(p.getMaterial()?.getName() ?? "")),
  );
  if (bodyMeshes.length !== 1) {
    throw new Error(`refusing: expected one body mesh with hidden prims, found ${bodyMeshes.length}`);
  }
  const bodyMesh = bodyMeshes[0];
  if (!bodyMesh) throw new Error("refusing: missing body mesh");

  const skinPrim = bodyMesh
    .listPrimitives()
    .find((p) => !HIDDEN_RE.test(p.getMaterial()?.getName() ?? ""));
  if (!skinPrim) throw new Error("refusing: body mesh has no skin primitive");
  const skinMaterial = skinPrim.getMaterial();
  if (!skinMaterial) throw new Error("refusing: skin primitive has no material");
  const targetCount = skinPrim.listTargets().length;

  const pantsTop = lowerBox ? at(lowerBox.max, 1, 0) : null;
  let maskTopBefore: number | null = null;
  for (const prim of bodyMesh.listPrimitives()) {
    const matName = prim.getMaterial()?.getName() ?? "";
    if (!HIDDEN_RE.test(matName) || slotOf(matName) !== "lower") continue;
    const pos = prim.getAttribute("POSITION");
    if (!pos) continue;
    for (let i = 0; i < pos.getCount(); i += 1) {
      pos.getElement(i, el);
      const y = at(el, 1, 0);
      if (maskTopBefore === null || y > maskTopBefore) maskTopBefore = y;
    }
  }

  const perSlot: Record<string, number> = {};
  let movedTriangles = 0;

  // New skin-prim accumulation (small): moved triangles land here, never in the
  // shipped skin primitive (sparse-morph size discipline).
  const nPos: number[][] = [];
  const nNor: number[][] = [];
  const nUv: number[][] = [];
  const nJ: number[][] = [];
  const nW: number[][] = [];
  const hiddenDatas: { data: PrimData; keep: number[] }[] = [];
  let morphDepth = 0;
  const nMorphP: number[][][] = [];
  const nMorphN: number[][][] = [];

  for (const prim of [...bodyMesh.listPrimitives()]) {
    const matName = prim.getMaterial()?.getName() ?? "";
    if (!HIDDEN_RE.test(matName)) continue;
    const slot = slotOf(matName);
    const chan = channelBox(slot);
    if (!chan) throw new Error(`refusing: ${slot} mask has no matching garment channel`);
    const data = readPrim(prim);
    if (!data) throw new Error(`refusing: hidden primitive ${matName} lacks required attributes`);
    if (morphDepth === 0) {
      morphDepth = data.morphPos.length;
      for (let m = 0; m < morphDepth; m += 1) {
        nMorphP.push([]);
        nMorphN.push([]);
      }
    } else if (data.morphPos.length !== morphDepth) {
      throw new Error(`refusing: morph depth ${data.morphPos.length} != ${morphDepth} in ${matName}`);
    }
    const triCount = Math.floor(data.indices.length / 3);
    const keep: number[] = [];
    for (let t = 0; t < triCount; t += 1) {
      const a = at(data.indices, t * 3, -1);
      const b = at(data.indices, t * 3 + 1, -1);
      const c = at(data.indices, t * 3 + 2, -1);
      if (a < 0 || b < 0 || c < 0) continue;
      const pa = at(data.pos, a, [0, 0, 0]);
      const pb = at(data.pos, b, [0, 0, 0]);
      const pc = at(data.pos, c, [0, 0, 0]);
      if (triVerdict(pa, pb, pc, slot, chan, opts.insetM, opts.slackM)) {
        perSlot[slot] = (perSlot[slot] ?? 0) + 1;
        movedTriangles += 1;
        if (!opts.dry) {
          for (const vi of [a, b, c]) {
            nPos.push([...at(data.pos, vi, [0, 0, 0])]);
            nNor.push([...at(data.nor, vi, [0, 0, 0])]);
            nUv.push([...at(data.uv, vi, [0, 0])]);
            nJ.push([...at(data.joints, vi, [0, 0, 0, 0])]);
            nW.push([...at(data.weights, vi, [0, 0, 0, 0])]);
            for (let m = 0; m < morphDepth; m += 1) {
              const dP = at(nMorphP, m, []);
              dP.push([...at(at(data.morphPos, m, []), vi, [0, 0, 0])]);
              const dN = at(nMorphN, m, []);
              dN.push([...at(at(data.morphNor, m, []), vi, [0, 0, 0])]);
            }
          }
        }
      } else {
        keep.push(t);
      }
    }
    hiddenDatas.push({ data, keep });
  }

  let maskTopAfter = maskTopBefore;
  if (!opts.dry && movedTriangles > 0) {
    if (morphDepth !== targetCount) {
      throw new Error(`refusing: hidden morph depth ${morphDepth} != skin target count ${targetCount}`);
    }
    const buffer = doc.getRoot().listBuffers()[0];
    if (!buffer) throw new Error("refusing: GLB has no buffer");
    const flat = (rows: number[][]): Float32Array<ArrayBuffer> => {
      const width = rows[0]?.length ?? 0;
      const out = new Float32Array(new ArrayBuffer(rows.length * width * 4));
      rows.forEach((r, i) => r.forEach((v, k) => {
        out[i * width + k] = v;
      }));
      return out;
    };
    // Rebuild each hidden primitive with kept triangles only (compact vertices).
    for (const entry of hiddenDatas) {
      const data = entry.data;
      const keepTris = entry.keep;
      const total = Math.floor(data.indices.length / 3);
      if (keepTris.length === total) continue;
      if (keepTris.length === 0) {
        throw new Error(`refusing: trim would empty hidden primitive ${data.prim.getMaterial()?.getName() ?? "?"}`);
      }
      const used = new Map<number, number>();
      const kPos: number[][] = [];
      const kNor: number[][] = [];
      const kUv: number[][] = [];
      const kJ: number[][] = [];
      const kW: number[][] = [];
      const kMP: number[][][] = data.morphPos.map(() => []);
      const kMN: number[][][] = data.morphNor.map(() => []);
      const kIdx: number[] = [];
      for (const t of keepTris) {
        for (let k = 0; k < 3; k += 1) {
          const vi = at(data.indices, t * 3 + k, -1);
          if (vi < 0) continue;
          let ni = used.get(vi);
          if (ni === undefined) {
            ni = kPos.length;
            used.set(vi, ni);
            kPos.push([...at(data.pos, vi, [0, 0, 0])]);
            kNor.push([...at(data.nor, vi, [0, 0, 0])]);
            kUv.push([...at(data.uv, vi, [0, 0])]);
            kJ.push([...at(data.joints, vi, [0, 0, 0, 0])]);
            kW.push([...at(data.weights, vi, [0, 0, 0, 0])]);
            for (let m = 0; m < morphDepth; m += 1) {
              const dP = at(kMP, m, []);
              dP.push([...at(at(data.morphPos, m, []), vi, [0, 0, 0])]);
              const dN = at(kMN, m, []);
              dN.push([...at(at(data.morphNor, m, []), vi, [0, 0, 0])]);
            }
          }
          kIdx.push(ni);
        }
      }
      data.prim.setAttribute(
        "POSITION",
        doc.createAccessor().setType("VEC3").setArray(flat(kPos)).setBuffer(buffer),
      );
      data.prim.setAttribute(
        "NORMAL",
        doc.createAccessor().setType("VEC3").setArray(flat(kNor)).setBuffer(buffer),
      );
      data.prim.setAttribute(
        "TEXCOORD_0",
        doc.createAccessor().setType("VEC2").setArray(flat(kUv)).setBuffer(buffer),
      );
      const jArr =
        data.jointsArray instanceof Uint8Array
          ? Uint8Array.from(kJ.flat())
          : data.jointsArray instanceof Uint32Array
            ? Uint32Array.from(kJ.flat())
            : Uint16Array.from(kJ.flat());
      data.prim.setAttribute("JOINTS_0", doc.createAccessor().setType("VEC4").setArray(jArr).setBuffer(buffer));
      data.prim.setAttribute(
        "WEIGHTS_0",
        doc.createAccessor().setType("VEC4").setArray(Float32Array.from(kW.flat())).setBuffer(buffer),
      );
      const idxArr =
        data.indexArray instanceof Uint32Array || kPos.length > 65535
          ? Uint32Array.from(kIdx)
          : Uint16Array.from(kIdx);
      data.prim.setIndices(doc.createAccessor().setType("SCALAR").setArray(idxArr).setBuffer(buffer));
      data.prim.listTargets().forEach((t, m) => {
        const mp = at(kMP, m, []);
        const mn = at(kMN, m, []);
        t.setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(flat(mp)).setBuffer(buffer));
        t.setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(flat(mn)).setBuffer(buffer));
      });
    }
    // One small new skin primitive with the moved triangles.
    const fresh = doc.createPrimitive();
    fresh.setMaterial(skinMaterial);
    fresh.setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(flat(nPos)).setBuffer(buffer));
    fresh.setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(flat(nNor)).setBuffer(buffer));
    fresh.setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(flat(nUv)).setBuffer(buffer));
    const sampleJoints = hiddenDatas[0]?.data.jointsArray;
    const freshJ =
      sampleJoints instanceof Uint8Array
        ? Uint8Array.from(nJ.flat())
        : sampleJoints instanceof Uint32Array
          ? Uint32Array.from(nJ.flat())
          : Uint16Array.from(nJ.flat());
    fresh.setAttribute("JOINTS_0", doc.createAccessor().setType("VEC4").setArray(freshJ).setBuffer(buffer));
    fresh.setAttribute(
      "WEIGHTS_0",
      doc.createAccessor().setType("VEC4").setArray(Float32Array.from(nW.flat())).setBuffer(buffer),
    );
    const nIdx = nPos.map((_, i) => i);
    fresh.setIndices(
      doc.createAccessor().setType("SCALAR").setArray(Uint32Array.from(nIdx)).setBuffer(buffer),
    );
    for (let m = 0; m < morphDepth; m += 1) {
      const t = doc.createPrimitiveTarget();
      const mp = at(nMorphP, m, []);
      const mn = at(nMorphN, m, []);
      t.setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(flat(mp)).setBuffer(buffer));
      t.setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(flat(mn)).setBuffer(buffer));
      fresh.addTarget(t);
    }
    bodyMesh.addPrimitive(fresh);
    mkdirSync(dirname(opts.output), { recursive: true });
    // Drop the replaced accessors' orphaned buffer data (precedent:
    // tools/openclinxr/asset-pipeline/equipment/finalize-equipment-glb.ts
    // dedup/prune; prune-only here so no referenced geometry is merged).
    await doc.transform(prune());
    await io.write(opts.output, doc);
    maskTopAfter = null;
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const matName = prim.getMaterial()?.getName() ?? "";
        if (!HIDDEN_RE.test(matName) || slotOf(matName) !== "lower") continue;
        const pos = prim.getAttribute("POSITION");
        if (!pos) continue;
        for (let i = 0; i < pos.getCount(); i += 1) {
          pos.getElement(i, el);
          const y = at(el, 1, 0);
          if (maskTopAfter === null || y > maskTopAfter) maskTopAfter = y;
        }
      }
    }
  }

  return {
    movedTriangles,
    movedVertices: movedTriangles * 3,
    perSlot,
    pantsTop,
    maskTopBefore,
    maskTopAfter,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const val = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    if (i < 0) return undefined;
    return at(args, i + 1, "");
  };
  const input = val("--in");
  const output = val("--out");
  if (!input || !output) {
    throw new Error("usage: trim-hide-mask-to-garment.ts --in <glb> --out <glb> [--inset-m 0.002] [--slack-m 0.0015] [--dry]");
  }
  const report = await trimHideMaskToGarment({
    input,
    output,
    insetM: Number(val("--inset-m") ?? `${RIM_INSET_M}`),
    slackM: Number(val("--slack-m") ?? `${FOOTPRINT_SLACK_M}`),
    dry: args.includes("--dry"),
  });
  process.stdout.write(`${JSON.stringify({ input, output, ...report, dry: args.includes("--dry") }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
