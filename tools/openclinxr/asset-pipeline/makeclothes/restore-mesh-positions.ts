/**
 * restore-mesh-positions.ts — copy one mesh's POSITION accessor from a pre-image GLB.
 *
 * For an accessor that a later commit rewrote by accident while every other attribute of
 * that mesh stayed put. First use: c240327c3 (a teeth commit) lowered the parent bob's hair
 * POSITION non-rigidly (mean dy -13.8 mm) with no recorded tool; NORMAL, TEXCOORD_0,
 * JOINTS_0, WEIGHTS_0, indices and morph targets were unchanged, and body skin at the crown
 * ended up above the hair.
 *
 * Refuses unless the matched mesh exists exactly once in both files and every primitive has
 * the same vertex count, the same indices, and identical non-POSITION attributes. So it can
 * only undo a pure position move, never transplant a different fit.
 *
 * Run: tsx tools/openclinxr/asset-pipeline/makeclothes/restore-mesh-positions.ts <glb> --from <pre.glb> --mesh <regex> [--dry]
 */
import { pathToFileURL } from "node:url";
import { NodeIO, type Accessor, type Mesh } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

function only(meshes: Mesh[], re: RegExp, file: string): Mesh {
  const hit = meshes.filter((m) => re.test(m.getName()));
  if (hit.length !== 1) {
    throw new Error(`refusing: ${hit.length} meshes match ${re} in ${file}: ${hit.map((m) => m.getName()).join(", ")}`);
  }
  return hit[0]!;
}

function sameArray(a: Accessor | null, b: Accessor | null): boolean {
  if (!a || !b) return a === b;
  const x = a.getArray();
  const y = b.getArray();
  if (!x || !y || x.length !== y.length || a.getType() !== b.getType()) return false;
  for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return false;
  return true;
}

export async function restoreMeshPositions(
  glb: string,
  from: string,
  mesh: RegExp,
  dry: boolean,
): Promise<{ mesh: string; vertices: number; maxShiftM: number; meanDyM: number }> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(glb);
  const src = await io.read(from);
  const dst = only(doc.getRoot().listMeshes(), mesh, glb);
  const pre = only(src.getRoot().listMeshes(), mesh, from);
  const dp = dst.listPrimitives();
  const sp = pre.listPrimitives();
  if (dp.length !== sp.length) throw new Error(`refusing: primitive count ${dp.length} vs ${sp.length}`);
  let vertices = 0;
  let maxShift = 0;
  let sumDy = 0;
  const writes: Array<() => void> = [];
  for (let k = 0; k < dp.length; k += 1) {
    const d = dp[k]!;
    const s = sp[k]!;
    const dPos = d.getAttribute("POSITION");
    const sPos = s.getAttribute("POSITION");
    if (!dPos || !sPos || dPos.getCount() !== sPos.getCount()) throw new Error(`refusing: primitive ${k} vertex count differs`);
    if (!sameArray(d.getIndices(), s.getIndices())) throw new Error(`refusing: primitive ${k} indices differ`);
    const names = new Set([...d.listSemantics(), ...s.listSemantics()]);
    for (const n of names) {
      if (n === "POSITION") continue;
      if (!sameArray(d.getAttribute(n), s.getAttribute(n))) throw new Error(`refusing: primitive ${k} ${n} differs`);
    }
    const dt = d.listTargets();
    const st = s.listTargets();
    if (dt.length !== st.length) throw new Error(`refusing: primitive ${k} morph target count differs`);
    for (let t = 0; t < dt.length; t += 1) {
      for (const n of new Set([...dt[t]!.listSemantics(), ...st[t]!.listSemantics()])) {
        if (!sameArray(dt[t]!.getAttribute(n), st[t]!.getAttribute(n))) throw new Error(`refusing: primitive ${k} target ${t} ${n} differs`);
      }
    }
    const a = dPos.getArray()!;
    const b = sPos.getArray()!;
    for (let v = 0; v < dPos.getCount(); v += 1) {
      const dx = b[3 * v]! - a[3 * v]!;
      const dy = b[3 * v + 1]! - a[3 * v + 1]!;
      const dz = b[3 * v + 2]! - a[3 * v + 2]!;
      maxShift = Math.max(maxShift, Math.hypot(dx, dy, dz));
      sumDy += dy;
    }
    vertices += dPos.getCount();
    writes.push(() => dPos.setArray(b.slice() as typeof a));
  }
  if (!dry) {
    for (const w of writes) w();
    await io.write(glb, doc);
  }
  return { mesh: dst.getName(), vertices, maxShiftM: maxShift, meanDyM: sumDy / Math.max(vertices, 1) };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const glb = args.find((a, i) => !a.startsWith("--") && !["--from", "--mesh"].includes(args[i - 1] ?? ""));
  const fi = args.indexOf("--from");
  const mi = args.indexOf("--mesh");
  if (!glb || fi < 0 || mi < 0) {
    throw new Error("usage: restore-mesh-positions.ts <glb> --from <pre.glb> --mesh <regex> [--dry]");
  }
  const r = await restoreMeshPositions(glb, args[fi + 1]!, new RegExp(args[mi + 1]!, "i"), args.includes("--dry"));
  process.stdout.write(`${JSON.stringify({ glb, from: args[fi + 1], ...r, dry: args.includes("--dry") })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
