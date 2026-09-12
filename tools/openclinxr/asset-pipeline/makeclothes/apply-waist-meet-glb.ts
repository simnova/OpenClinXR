/**
 * Apply garment_ops.fit_upper_hem_to_waistband to a shipped Y-up GLB.
 *
 * The factory function lives in packages/openclinxr/factory-stations/src/body_param/garment_ops.py
 * and runs in the Z-up Blender stage. This is the same algorithm in the exported Y-up frame the
 * waist-meet instrument reads (atan2(glb_z, glb_x), height = Y). Constants are
 * imported from the ONE contract in
 * tools/openclinxr/evidence/humanoid-vetting/waist-meet-contract.ts — never
 * copied, never retuned here. The Blender bake stage mirrors the same values;
 * the-two-waist-meet-implementations-agree.test.ts fails on any drift.
 *
 * Run:
 *   pnpm exec tsx tools/openclinxr/asset-pipeline/makeclothes/apply-waist-meet-glb.ts \
 *     --in <glb> --out <glb>
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { NodeIO, type Accessor } from "@gltf-transform/core";
import { isUpperGarmentName } from "../../evidence/garment-slot.ts";
import { isPantsName } from "../../evidence/waistband-ring.ts";
import {
  WAIST_BUCKETS,
  WAIST_OVERLAP_MARGIN_M,
  WAIST_RIM_FRACTION,
} from "../../evidence/humanoid-vetting/waist-meet-contract.ts";

type Vec3 = [number, number, number];

function bucketOf(x: number, z: number): number {
  const angle = Math.atan2(z, x);
  return Math.floor(((angle + Math.PI) / (2 * Math.PI)) * WAIST_BUCKETS) % WAIST_BUCKETS;
}

function readVec3(el: Vec3): Vec3 {
  return [el[0] ?? 0, el[1] ?? 0, el[2] ?? 0];
}

function at<T>(arr: T[], i: number, fallback: T): T {
  return arr[i] ?? fallback;
}

export async function applyWaistMeetGlb(inputPath: string, outputPath: string): Promise<{
  pushedVertexCount: number;
  maxDeficitMeters: number;
  upperName: string | null;
  lowerName: string | null;
  note: string;
}> {
  const io = new NodeIO();
  const doc = await io.read(inputPath);
  const shirtVerts: { primPos: Accessor; index: number; v: Vec3 }[] = [];
  const pantsYs: Vec3[] = [];
  let upperName: string | null = null;
  let lowerName: string | null = null;

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const name = prim.getMaterial()?.getName() ?? "";
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const el: Vec3 = [0, 0, 0];
      if (isPantsName(name)) {
        lowerName = name;
        for (let i = 0; i < pos.getCount(); i += 1) {
          pos.getElement(i, el);
          pantsYs.push(readVec3(el));
        }
      } else if (isUpperGarmentName(name)) {
        upperName = name;
        for (let i = 0; i < pos.getCount(); i += 1) {
          pos.getElement(i, el);
          shirtVerts.push({ primPos: pos, index: i, v: readVec3(el) });
        }
      }
    }
  }

  if (shirtVerts.length === 0 || pantsYs.length === 0) {
    throw new Error(`need upper+lower meshes; upper=${upperName} lower=${lowerName}`);
  }

  const shirtY = shirtVerts.map((s) => s.v[1]);
  const gLo = Math.min(...shirtY);
  const gHi = Math.max(...shirtY);
  const bandHi = gLo + (gHi - gLo) * WAIST_RIM_FRACTION;

  const pantsY = pantsYs.map((p) => p[1]);
  const pLo = Math.min(...pantsY);
  const pHi = Math.max(...pantsY);
  const bandLo = pHi - (pHi - pLo) * WAIST_RIM_FRACTION;

  const waist = new Array<number>(WAIST_BUCKETS).fill(-Infinity);
  for (const [x, y, z] of pantsYs) {
    if (y < bandLo) continue;
    const b = bucketOf(x, z);
    if (y > at(waist, b, -Infinity)) waist[b] = y;
  }

  const hem = new Array<number>(WAIST_BUCKETS).fill(Infinity);
  const sel = shirtVerts.filter((s) => s.v[1] <= bandHi);
  for (const s of sel) {
    const b = bucketOf(s.v[0], s.v[2]);
    if (s.v[1] < at(hem, b, Infinity)) hem[b] = s.v[1];
  }

  const deficit = new Array<number>(WAIST_BUCKETS).fill(0);
  let maxDeficit = 0;
  for (let b = 0; b < WAIST_BUCKETS; b += 1) {
    const w = at(waist, b, Number.NaN);
    const h = at(hem, b, Number.NaN);
    if (!Number.isFinite(w) || !Number.isFinite(h)) continue;
    const d = Math.max(0, h - (w - WAIST_OVERLAP_MARGIN_M));
    deficit[b] = d;
    if (d > maxDeficit) maxDeficit = d;
  }

  if (maxDeficit <= 1e-6) {
    return {
      pushedVertexCount: 0,
      maxDeficitMeters: 0,
      upperName,
      lowerName,
      note: "hem already meets waistband at every measured angle",
    };
  }

  const span = hem.map((h) => (Number.isFinite(h) ? bandHi - h : 1));
  let moved = 0;
  for (const s of sel) {
    const b = bucketOf(s.v[0], s.v[2]);
    const sp = Math.max(at(span, b, 1), 1e-9);
    const taper = Math.min(1, Math.max(0, (bandHi - s.v[1]) / sp));
    const push = at(deficit, b, 0) * taper;
    if (push > 1e-6) {
      s.primPos.setElement(s.index, [s.v[0], s.v[1] - push, s.v[2]]);
      moved += 1;
    }
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  await io.write(outputPath, doc);
  return {
    pushedVertexCount: moved,
    maxDeficitMeters: Math.round(maxDeficit * 1e5) / 1e5,
    upperName,
    lowerName,
    note: "hem pushed down to the lower garment waistband rim (issue-320, derived, Y-up GLB)",
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const inIdx = args.indexOf("--in");
  const outIdx = args.indexOf("--out");
  const input = inIdx >= 0 ? args[inIdx + 1] : undefined;
  const output = outIdx >= 0 ? args[outIdx + 1] : undefined;
  if (!input || !output) {
    throw new Error("usage: apply-waist-meet-glb.ts --in <glb> --out <glb>");
  }
  const report = await applyWaistMeetGlb(input, output);
  process.stdout.write(`${JSON.stringify({ enabled: true, ...report }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
