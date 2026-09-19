/**
 * teeth-rest-clearance.ts — deterministic z-translate of the teeth mesh in a shipped GLB.
 *
 * #738: the 192-triangle teeth slab renders forward of the lip contour when the mouth opens,
 * because the mouth-open morph retracts the lips (skin median z drops ~2.5 mm at the runtime
 * weight) and the teeth carry no morph targets to follow. The measured fix is rest clearance:
 * translating the teeth mesh back (negative z) increases the rest gap so the slab stays behind
 * the deformed skin median at MOUTH_OPEN_CAP.
 *
 * The factory now fits CC0 `teeth_base` as `openclinxr_fitted_teeth_mpfb_<subject>_mesh`
 * (materialize_mpfb_humanoid_candidate.py), so the station matches any mesh whose name
 * contains `teeth` — covering both the legacy `hm08_teeth` slab and the fitted CC0 mesh —
 * and refuses when zero or more than one teeth mesh is present.
 *
 * Run: tsx tools/openclinxr/asset-pipeline/makeclothes/teeth-rest-clearance.ts <glb> [--delta 0.003] [--dry] [--probe]
 *
 * Matches any mesh whose name contains `teeth`, translates every POSITION vertex by -delta
 * on z, and rewrites the GLB. Dry-run prints the report without writing. Probe prints the
 * #739 band measurement (teeth AABB y/x, skin median at MOUTH_OPEN_CAP read from
 * `packages/openclinxr/xr-dialogue/src/viseme-morph-apply.ts`) without writing.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { NodeIO } from "@gltf-transform/core";

const CAP_SOURCE = "packages/openclinxr/xr-dialogue/src/viseme-morph-apply.ts";
const TEETH_RE = /teeth/i;

function runtimeCap(): number {
  const m = /MOUTH_OPEN_CAP\s*=\s*([0-9.]+)/.exec(readFileSync(CAP_SOURCE, "utf8"));
  if (!m) throw new Error(`MOUTH_OPEN_CAP not found in ${CAP_SOURCE}`);
  return Number(m[1]);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const glb = args.find((a) => !a.startsWith("--"));
  if (!glb) throw new Error("usage: teeth-rest-clearance.ts <glb> [--delta 0.003] [--dry] [--probe]");
  const di = args.indexOf("--delta");
  const delta = di >= 0 ? Number(args[di + 1]) : 0.003;
  const dry = args.includes("--dry");
  const probe = args.includes("--probe");

  const io = new NodeIO();
  const doc = await io.read(glb);
  const meshes = doc.getRoot().listMeshes();
  const teethMeshes = meshes.filter((m) => TEETH_RE.test(m.getName()));
  if (teethMeshes.length === 0) throw new Error(`no teeth mesh found in ${glb}`);
  if (teethMeshes.length > 1) {
    throw new Error(`refusing: ${teethMeshes.length} teeth meshes in ${glb}: ${teethMeshes.map((m) => m.getName()).join(", ")}`);
  }
  const teeth = teethMeshes[0]!;

  if (probe) {
    const v = [0, 0, 0];
    let beforeMaxZ = -Infinity, yLo = Infinity, yHi = -Infinity, xHalf = 0;
    let verts = 0, tris = 0, skinned = true;
    for (const pr of teeth.listPrimitives()) {
      if (!pr.getAttribute("JOINTS_0") || !pr.getAttribute("WEIGHTS_0")) skinned = false;
      const p = pr.getAttribute("POSITION")!;
      verts += p.getCount();
      const idx = pr.getIndices();
      tris += idx ? idx.getCount() / 3 : p.getCount() / 3;
      for (let i = 0; i < p.getCount(); i++) {
        p.getElement(i, v);
        if (v[2] > beforeMaxZ) beforeMaxZ = v[2];
        if (v[1] < yLo) yLo = v[1];
        if (v[1] > yHi) yHi = v[1];
        if (Math.abs(v[0]) > xHalf) xHalf = Math.abs(v[0]);
      }
    }
    const tongue = meshes.find((m) => /tongue/i.test(m.getName()));
    let tongueMaxZ = -Infinity;
    if (tongue) for (const pr of tongue.listPrimitives()) {
      const p = pr.getAttribute("POSITION")!;
      for (let i = 0; i < p.getCount(); i++) { p.getElement(i, v); if (v[2] > tongueMaxZ) tongueMaxZ = v[2]; }
    }
    const body = meshes.find((m) => /_body(\.\d+)?$/.test(m.getName()));
    if (!body) throw new Error(`no *_body mesh found in ${glb}`);
    const names = (body.getExtras()?.targetNames as string[] | undefined) ?? [];
    const mi = names.indexOf("mouth-open");
    const prim = body.listPrimitives().find((pr) => /skin/i.test(pr.getMaterial()?.getName() ?? ""))
      ?? body.listPrimitives()[0]!;
    const pos = prim.getAttribute("POSITION")!;
    const mdelta = mi >= 0 ? prim.listTargets()[mi]?.getAttribute("POSITION") : undefined;
    const median = (w: number): number => {
      const zs: number[] = [];
      const d = [0, 0, 0];
      for (let k = 0; k < pos.getCount(); k++) {
        pos.getElement(k, v);
        if (mdelta) mdelta.getElement(k, d); else { d[0] = 0; d[1] = 0; d[2] = 0; }
        const y = v[1] + w * d[1];
        if (y < yLo || y > yHi) continue;
        if (Math.abs(v[0] + w * d[0]) > xHalf) continue;
        zs.push(v[2] + w * d[2]);
      }
      zs.sort((a, b) => a - b);
      return zs[Math.floor(zs.length / 2)]!;
    };
    const cap = runtimeCap();
    process.stdout.write(JSON.stringify({
      mesh: teeth.getName(),
      verts,
      tris,
      beforeMaxZ,
      marginAtCap: median(cap) - beforeMaxZ,
      marginAtRest: median(0) - beforeMaxZ,
      tongueGap: tongueMaxZ > -Infinity ? beforeMaxZ - tongueMaxZ : Number.NaN,
      skinned,
    }, null, 2) + "\n");
    return;
  }

  const v = [0, 0, 0];
  const touched: { mesh: string; verts: number; beforeMaxZ: number; afterMaxZ: number }[] = [];

  for (const prim of teeth.listPrimitives()) {
    const pos = prim.getAttribute("POSITION");
    if (!pos) continue;
    let beforeMaxZ = -Infinity;
    let afterMaxZ = -Infinity;
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      if (v[2] > beforeMaxZ) beforeMaxZ = v[2];
      if (!dry) {
        pos.setElement(i, [v[0], v[1], v[2] - delta]);
        if (v[2] - delta > afterMaxZ) afterMaxZ = v[2] - delta;
      }
    }
    touched.push({
      mesh: teeth.getName(),
      verts: pos.getCount(),
      beforeMaxZ,
      afterMaxZ: dry ? beforeMaxZ - delta : afterMaxZ,
    });
  }

  if (touched.length === 0) throw new Error(`no teeth mesh found in ${glb}`);
  if (!dry) {
    await io.write(glb, doc);
  }
  const report = {
    schemaVersion: "openclinxr.teeth-rest-clearance.v1",
    glb,
    deltaZ: -delta,
    action: dry ? "dry-run (no write)" : `translated teeth back by ${delta} m on z`,
    meshes: touched,
    notEvidenceFor: ["clinical_validity", "production_asset_readiness"],
  };
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
