/**
 * replace-garment-primitive.ts — take one garment's fitted primitive from a station bake of the
 * SAME body and put it into a shipped GLB, leaving every other mesh, the rig, the clips and the
 * textures as shipped.
 *
 * First use (mesh-defects 2026-10-31): the shipped street-adult-male jeans were fitted while the
 * post-fit cloth_offset snap still ran (bake e59925fc6); 0f460d098 removed the snap. A current
 * materializer bake of the same reference also changes the body from 26,756 to 107,024 tris,
 * swaps the hm08 teeth/tongue for the fitted pair and carries one clip instead of three, so it
 * cannot ship whole without re-deciding those. This stage takes only the jeans from it.
 *
 * Refuses unless: exactly one mesh matches in each file; each has exactly one primitive; the
 * primitives use materials of the same name; the two skins list the same joint names in the
 * same order (JOINTS_0 indexes that list); and the bake's body surface lies within
 * --body-tol-m (default 0.003) of the shipped body at p95 (nearest-vertex), so the garment was
 * fitted to the same body.
 *
 * Copies POSITION, NORMAL, TEXCOORD_n, JOINTS_0, WEIGHTS_0 and indices; keeps the shipped
 * material, node and mesh name. Morph targets: refuses if either primitive has any.
 *
 * Run: tsx tools/openclinxr/asset-pipeline/makeclothes/replace-garment-primitive.ts <glb> --from <bake.glb> --mesh <regex> [--body <regex>] [--body-tol-m 0.003] [--dry]
 */
import { pathToFileURL } from "node:url";
import { type Document, type Mesh, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

function only(doc: Document, re: RegExp, file: string): Mesh {
  const hit = doc.getRoot().listMeshes().filter((m) => re.test(m.getName()));
  if (hit.length !== 1) {
    throw new Error(`refusing: ${hit.length} meshes match ${re} in ${file}: ${hit.map((m) => m.getName()).join(", ")}`);
  }
  return hit[0]!;
}

function jointNames(doc: Document): string[] {
  const skins = doc.getRoot().listSkins();
  if (skins.length !== 1) throw new Error(`refusing: expected one skin, found ${skins.length}`);
  return skins[0]!.listJoints().map((j) => j.getName());
}

function positions(mesh: Mesh): Float32Array {
  const out: number[] = [];
  for (const p of mesh.listPrimitives()) {
    const a = p.getAttribute("POSITION")?.getArray();
    if (a) out.push(...a);
  }
  return Float32Array.from(out);
}

/** p95 of nearest-vertex distance from each shipped body vertex to the bake's body, via a 1 cm grid. */
function bodyP95(shipped: Float32Array, bake: Float32Array): number {
  const cell = 0.01;
  const key = (x: number, y: number, z: number): string => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  const grid = new Map<string, number[]>();
  for (let i = 0; i < bake.length; i += 3) {
    const k = key(bake[i]!, bake[i + 1]!, bake[i + 2]!);
    const l = grid.get(k);
    if (l) l.push(i);
    else grid.set(k, [i]);
  }
  const d: number[] = [];
  for (let i = 0; i < shipped.length; i += 3) {
    const x = shipped[i]!, y = shipped[i + 1]!, z = shipped[i + 2]!;
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    let best = Infinity;
    for (let dx = -1; dx <= 1; dx += 1)
      for (let dy = -1; dy <= 1; dy += 1)
        for (let dz = -1; dz <= 1; dz += 1)
          for (const j of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            best = Math.min(best, Math.hypot(x - bake[j]!, y - bake[j + 1]!, z - bake[j + 2]!));
          }
    d.push(best);
  }
  d.sort((a, b) => a - b);
  return d[Math.floor(0.95 * (d.length - 1))]!;
}

export async function replaceGarmentPrimitive(opts: {
  glb: string;
  from: string;
  mesh: RegExp;
  body: RegExp;
  bodyTolM: number;
  dry: boolean;
}): Promise<{ mesh: string; verticesBefore: number; verticesAfter: number; tris: number; bodyP95M: number }> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(opts.glb);
  const src = await io.read(opts.from);
  const dst = only(doc, opts.mesh, opts.glb);
  const pre = only(src, opts.mesh, opts.from);
  const [dp] = dst.listPrimitives();
  const [sp] = pre.listPrimitives();
  if (!dp || !sp || dst.listPrimitives().length !== 1 || pre.listPrimitives().length !== 1) {
    throw new Error("refusing: garment meshes must have exactly one primitive each");
  }
  if (dp.listTargets().length || sp.listTargets().length) throw new Error("refusing: garment primitive carries morph targets");
  const dm = dp.getMaterial()?.getName() ?? "";
  const sm = sp.getMaterial()?.getName() ?? "";
  if (dm !== sm) throw new Error(`refusing: material ${dm} vs ${sm}`);
  const dj = jointNames(doc);
  const sj = jointNames(src);
  if (dj.length !== sj.length || dj.some((n, i) => n !== sj[i])) throw new Error("refusing: skin joint lists differ");
  const p95 = bodyP95(positions(only(doc, opts.body, opts.glb)), positions(only(src, opts.body, opts.from)));
  if (!(p95 <= opts.bodyTolM)) throw new Error(`refusing: body p95 ${p95.toFixed(5)} m > ${opts.bodyTolM} m (not the same body)`);

  const verticesBefore = dp.getAttribute("POSITION")?.getCount() ?? 0;
  const buffer = doc.getRoot().listBuffers()[0]!;
  for (const n of dp.listSemantics()) dp.setAttribute(n, null);
  for (const n of sp.listSemantics()) {
    const a = sp.getAttribute(n)!;
    dp.setAttribute(
      n,
      doc
        .createAccessor()
        .setType(a.getType())
        .setArray(a.getArray()!.slice())
        .setNormalized(a.getNormalized())
        .setBuffer(buffer),
    );
  }
  const si = sp.getIndices()!;
  dp.setIndices(doc.createAccessor().setType("SCALAR").setArray(si.getArray()!.slice()).setBuffer(buffer));
  const verticesAfter = dp.getAttribute("POSITION")!.getCount();
  const tris = si.getCount() / 3;
  if (!opts.dry) await io.write(opts.glb, doc);
  return { mesh: dst.getName(), verticesBefore, verticesAfter, tris, bodyP95M: p95 };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const val = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const valued = new Set(["--from", "--mesh", "--body", "--body-tol-m"]);
  const glb = args.find((a, i) => !a.startsWith("--") && !valued.has(args[i - 1] ?? ""));
  const from = val("--from");
  const mesh = val("--mesh");
  if (!glb || !from || !mesh) {
    throw new Error("usage: replace-garment-primitive.ts <glb> --from <bake.glb> --mesh <regex> [--body <regex>] [--body-tol-m 0.003] [--dry]");
  }
  const r = await replaceGarmentPrimitive({
    glb,
    from,
    mesh: new RegExp(mesh, "i"),
    body: new RegExp(val("--body") ?? "_body$", "i"),
    bodyTolM: Number(val("--body-tol-m") ?? 0.003),
    dry: args.includes("--dry"),
  });
  process.stdout.write(`${JSON.stringify({ glb, from, ...r, dry: args.includes("--dry") })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
