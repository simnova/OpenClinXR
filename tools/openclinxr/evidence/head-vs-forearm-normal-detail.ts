/**
 * #671 — interior-of-UV-island normal relief, head island vs forearm island.
 *
 * Reads every SHIPPED mpfb cast actor's skin normal map (the baked
 * enhanced_skin dermal + region detail, #369) and computes the spread of the
 * tangent-space R channel over the texels covered by head-family triangles and
 * forearm-family triangles — the atlas gutter excluded by construction, because
 * only texels covered by a classified triangle are sampled.
 *
 * The region assignment is JOINT-based, not coordinate-based: a triangle belongs
 * to the head region when its max-weight joint (across the triangle's three
 * vertices' four skinning slots) is the `head` joint or one of its descendants
 * (jaw, oris*, oculi*, temporalis*, levator*, orbicularis*, risorius*, special*,
 * tongue*, eye*), and to the forearm region when it is a `lowerarm*` /
 * `forearm*` / `lower_arm*` bone. Joint names come from each actor's OWN
 * skeleton, so the assignment is per-actor and pose-independent (weights do not
 * move with the pose). Neck bones are in neither family: the pixel grades that
 * motivated this card distinguish the FACE from the neck, so the neck is not
 * allowed to inflate the head number.
 *
 * The statistic is sd(R) over the sampled texels — the same channel and the same
 * spread shape as `the-skin-normal-map-carries-surface-detail.test.ts`, which is
 * the established instrument for these maps. An internal control: the forearm
 * island of the SAME actor's SAME map is the reference, so a bake that adds noise
 * everywhere moves both terms and buys nothing (#671 cheat table row 1).
 *
 * The report is TRACKED (`head-vs-forearm-normal-detail.json`) — a gitignored
 * deliverable has no land path (#64). Regenerate with:
 *
 *   pnpm exec tsx tools/openclinxr/evidence/head-vs-forearm-normal-detail.ts
 *
 * claimScope: whether the head UV island of a shipped MPFB skin normal map carries
 *   as much surface relief (sd(R), interior texels, gutter excluded) as the
 *   forearm island of the same map, per shipped cast actor.
 * notEvidenceFor: that any face LOOKS right (a spread statistic cannot grade an
 *   appearance); that the albedo head/forearm gap in #510's table is closed; that
 *   the island assignment is anatomically verified — the assignment is a
 *   joint-weight heuristic and nothing here validates it against a render.
 */

import { NodeIO } from "@gltf-transform/core";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { withTreeStamp } from "./lib/measurement-tree-stamp.js";

const REPO = join(import.meta.dirname, "../../..");
const GENERATED = join(REPO, "apps/ui-xr/public/generated-humanoids");
const REPORT_PATH = join(import.meta.dirname, "head-vs-forearm-normal-detail.json");

const io = new NodeIO();

export type HeadVsForearmRow = {
  actor: string;
  headSd: number;
  forearmSd: number;
  headTexels: number;
  forearmTexels: number;
  headTriangles: number;
  forearmTriangles: number;
};

export type HeadVsForearmReport = {
  schemaVersion: "openclinxr.head-vs-forearm-normal-detail.v1";
  kind: "head_vs_forearm_normal_detail";
  generatedAt: string;
  treeStamp: ReturnType<typeof withTreeStamp>["treeStamp"];
  method: {
    statistic: string;
    headFamily: string;
    forearmFamily: string;
    resolution: number;
  };
  rows: HeadVsForearmRow[];
};

/** Shipped cast assets, enumerated from what ships — same filter as the planted contract. */
export function shippedCastActors(dir: string = GENERATED): string[] {
  return readdirSync(dir)
    .filter((f) => f.startsWith("mpfb-") && f.endsWith(".glb") && !f.includes("-inspect"))
    .map((f) => f.replace(/\.glb$/u, ""))
    .sort();
}

/** Minimal PNG decode — same chunk walk and filter reconstruction as the proven in-tree reader. */
type Decoded = { w: number; h: number; chans: number; data: Uint8Array };

function decodePng(bytes: Uint8Array): Decoded | null {
  let w = 0;
  let h = 0;
  let depth = 0;
  let colour = -1;
  const idat: Uint8Array[] = [];
  let off = 8;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (off + 8 <= bytes.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4]!, bytes[off + 5]!, bytes[off + 6]!, bytes[off + 7]!);
    const body = bytes.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = dv.getUint32(off + 8);
      h = dv.getUint32(off + 12);
      depth = bytes[off + 16]!;
      colour = bytes[off + 17]!;
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (depth !== 8 || w === 0 || h === 0) return null;
  const chans = colour === 0 ? 1 : colour === 2 ? 3 : colour === 4 ? 2 : colour === 6 ? 4 : 0;
  if (chans === 0) return null;
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat.map((c) => Buffer.from(c))));
  } catch {
    return null;
  }
  const stride = w * chans;
  if (raw.length < (stride + 1) * h) return null;
  const out = new Uint8Array(stride * h);
  let prev = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++]!;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[p + x]!;
      const a = x >= chans ? cur[x - chans]! : 0;
      const b = prev[x]!;
      const c = x >= chans ? prev[x - chans]! : 0;
      let v: number;
      if (filter === 0) v = rawByte;
      else if (filter === 1) v = rawByte + a;
      else if (filter === 2) v = rawByte + b;
      else if (filter === 3) v = rawByte + ((a + b) >> 1);
      else {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v = rawByte + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
    p += stride;
    prev = cur;
  }
  return { w, h, chans, data: out };
}

function pointInTri(px: number, py: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function regionStats(mask: Uint8Array, png: Decoded, w: number, h: number): { sd: number; texels: number } {
  let n = 0;
  let sum = 0;
  let sumsq = 0;
  for (let y = 0; y < h; y++) {
    const rowOff = y * w;
    for (let x = 0; x < w; x++) {
      if (mask[rowOff + x]! === 0) continue;
      const i = (y * png.w + x) * png.chans;
      const r = png.data[i]!;
      n += 1;
      sum += r;
      sumsq += r * r;
    }
  }
  if (n === 0) return { sd: 0, texels: 0 };
  const mean = sum / n;
  const sd = Math.sqrt(Math.max(sumsq / n - mean * mean, 0));
  return { sd, texels: n };
}

async function measureActor(actor: string): Promise<HeadVsForearmRow> {
  const doc = await io.read(join(GENERATED, `${actor}.glb`));
  const root = doc.getRoot();

  // Joint families from this actor's own skeleton.
  const skinNodes = root.listNodes().filter((n) => n.getSkin());
  if (skinNodes.length === 0) throw new Error(`${actor}: no skinned node`);
  const names = skinNodes[0]!.getSkin()!.listJoints().map((j) => j.getName());
  const headIdx = names.findIndex((n) => n === "head");
  if (headIdx < 0) throw new Error(`${actor}: no "head" joint in skeleton`);
  const headJoint = skinNodes[0]!.getSkin()!.listJoints()[headIdx]!;
  const headFamily = new Set<string>([headJoint.getName()]);
  const stack = [...headJoint.listChildren()];
  while (stack.length) {
    const j = stack.pop()!;
    headFamily.add(j.getName());
    stack.push(...j.listChildren());
  }
  const forearmFamily = new Set<string>(names.filter((n) => /^(lowerarm|forearm|lower_arm)/i.test(n ?? "")));

  let normalPng: Decoded | null = null;
  let resolution = 0;
  let headMaskArr: Uint8Array | null = null;
  let foreMaskArr: Uint8Array | null = null;
  let headTriangles = 0;
  let forearmTriangles = 0;

  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      const matName = mat?.getName() ?? "";
      if (!/^mpfb_skin_/.test(matName)) continue;

      // Normal map image bytes — the pattern the proven whole-map contract uses.
      if (!normalPng) {
        const imgBytes = mat?.getNormalTexture()?.getImage() ?? undefined;
        if (!imgBytes) throw new Error(`${actor}: skin material has no normal texture image`);
        normalPng = decodePng(imgBytes);
        if (!normalPng) throw new Error(`${actor}: normal map is not an 8-bit PNG we can read`);
        resolution = normalPng.w;
        if (normalPng.h !== resolution) throw new Error(`${actor}: normal map is not square`);
        headMaskArr = new Uint8Array(resolution * resolution);
        foreMaskArr = new Uint8Array(resolution * resolution);
      }
      // Both masks are created together with normalPng above; TS cannot see the pairing.
      const headMask = headMaskArr!;
      const foreMask = foreMaskArr!;

      const pos = prim.getAttribute("POSITION");
      const uv = prim.getAttribute("TEXCOORD_0");
      const joints = prim.getAttribute("JOINTS_0");
      const weights = prim.getAttribute("WEIGHTS_0");
      const indices = prim.getIndices();
      if (!pos || !uv || !joints || !weights || !indices) {
        throw new Error(`${actor}: skin primitive missing POSITION/TEXCOORD_0/JOINTS_0/WEIGHTS_0/indices`);
      }

      // Max-weight joint per vertex.
      const vertexJoint = new Int32Array(pos.getCount());
      const vertexJointW = new Float32Array(pos.getCount());
      const jEl: number[] = [];
      const wEl: number[] = [];
      for (let v = 0; v < pos.getCount(); v++) {
        joints.getElement(v, jEl);
        weights.getElement(v, wEl);
        let best = 0;
        let bestW = -1;
        for (let k = 0; k < 4; k++) {
          const w = wEl[k] ?? 0;
          if (w > bestW) {
            bestW = w;
            best = jEl[k] ?? 0;
          }
        }
        vertexJoint[v] = best;
        vertexJointW[v] = bestW;
      }

      const uvEl: number[] = [];
      const triCount = indices.getCount() / 3;
      for (let t = 0; t < triCount; t++) {
        const a = indices.getScalar(t * 3);
        const b = indices.getScalar(t * 3 + 1);
        const c = indices.getScalar(t * 3 + 2);
        // The triangle's joint = the single max-weight joint among its three vertices, so a
        // boundary triangle belongs to whichever region its dominant bone places it in — neck
        // and shoulder triangles stay out of both families.
        let triJoint = vertexJoint[a]!;
        let triJointW = vertexJointW[a]!;
        if (vertexJointW[b]! > triJointW) {
          triJoint = vertexJoint[b]!;
          triJointW = vertexJointW[b]!;
        }
        if (vertexJointW[c]! > triJointW) {
          triJoint = vertexJoint[c]!;
          triJointW = vertexJointW[c]!;
        }
        const triName = names[triJoint] ?? "";
        const triHead = headFamily.has(triName);
        const triFore = forearmFamily.has(triName);
        if (!triHead && !triFore) continue;
        const fam = triHead ? headMask : foreMask;
        if (triHead) headTriangles += 1;
        else forearmTriangles += 1;

        uv.getElement(a, uvEl);
        const au = uvEl[0]!;
        const av = uvEl[1]!;
        uv.getElement(b, uvEl);
        const bu = uvEl[0]!;
        const bv = uvEl[1]!;
        uv.getElement(c, uvEl);
        const cu = uvEl[0]!;
        const cv = uvEl[1]!;

        // Texel-space bounding box (v flips: PNG row 0 is v ≈ 1).
        const minU = Math.min(au, bu, cu);
        const maxU = Math.max(au, bu, cu);
        const minV = Math.min(av, bv, cv);
        const maxV = Math.max(av, bv, cv);
        const x0 = Math.max(0, Math.floor(minU * resolution) - 1);
        const x1 = Math.min(resolution - 1, Math.ceil(maxU * resolution) + 1);
        const yTop = Math.max(0, Math.floor((1 - maxV) * resolution) - 1);
        const yBot = Math.min(resolution - 1, Math.ceil((1 - minV) * resolution) + 1);
        for (let y = yTop; y <= yBot; y++) {
          const cy = (resolution - 0.5 - y) / resolution;
          const rowOff = y * resolution;
          for (let x = x0; x <= x1; x++) {
            if (fam[rowOff + x]! !== 0) continue;
            const cx = (x + 0.5) / resolution;
            if (pointInTri(cx, cy, au, av, bu, bv, cu, cv)) fam[rowOff + x] = 1;
          }
        }
      }
    }
  }

  if (!normalPng || !headMaskArr || !foreMaskArr) throw new Error(`${actor}: no skin material primitive found`);
  const head = regionStats(headMaskArr, normalPng, resolution, resolution);
  const fore = regionStats(foreMaskArr, normalPng, resolution, resolution);
  return {
    actor,
    headSd: head.sd,
    forearmSd: fore.sd,
    headTexels: head.texels,
    forearmTexels: fore.texels,
    headTriangles,
    forearmTriangles,
  };
}

export function measureAll(actors: string[] = shippedCastActors()): Promise<HeadVsForearmRow[]> {
  return Promise.all(actors.map((a) => measureActor(a)));
}

export async function buildReport(rows?: HeadVsForearmRow[]): Promise<HeadVsForearmReport> {
  const measured = rows ?? (await measureAll());
  const payload: Omit<HeadVsForearmReport, "treeStamp"> = {
    schemaVersion: "openclinxr.head-vs-forearm-normal-detail.v1",
    kind: "head_vs_forearm_normal_detail",
    generatedAt: new Date().toISOString(),
    method: {
      statistic: "sd(R) over interior texels of the region's UV coverage, atlas gutter excluded",
      headFamily: "head joint + all descendants (jaw, oris*, oculi*, temporalis*, levator*, orbicularis*, risorius*, special*, tongue*, eye*)",
      forearmFamily: "lowerarm* / forearm* / lower_arm* bones",
      resolution: 1024,
    },
    rows: measured,
  };
  return withTreeStamp(payload);
}

export function writeReport(report: HeadVsForearmReport): void {
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`WROTE ${REPORT_PATH} rows=${report.rows.length}`);
}

// Direct invocation: pnpm exec tsx tools/openclinxr/evidence/head-vs-forearm-normal-detail.ts
const isDirect = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isDirect) {
  const rows = await measureAll();
  for (const r of rows) {
    console.log(
      `${r.actor}: head sd ${r.headSd.toFixed(3)} (${r.headTexels} texels, ${r.headTriangles} tris) | `
        + `forearm sd ${r.forearmSd.toFixed(3)} (${r.forearmTexels} texels, ${r.forearmTriangles} tris) | `
        + `${r.headSd >= r.forearmSd ? "head >= forearm" : "HEAD < FOREARM (inversion holds)"}`,
    );
  }
  writeReport(await buildReport(rows));
}
