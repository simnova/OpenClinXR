/**
 * tongue-forward-place.ts — deterministic z-translate of the tongue mesh in a shipped GLB.
 *
 * The tongue mesh needs a small forward (positive z) translation so it projects
 * through the open-jaw aperture at the "aa" viseme without the tongue tip
 * catching on the back of the upper teeth row. The measured fix is forward
 * placement: translating the tongue mesh forward (positive z) by a small delta.
 *
 * The station matches any mesh whose name contains `tongue` — covering both
 * the legacy `hm08_tongue` slab and the fitted CC0 mesh — and refuses when
 * zero or more than one tongue mesh is present.
 *
 * Run: tsx tools/openclinxr/asset-pipeline/makeclothes/tongue-forward-place.ts <glb> [--delta 0.004] [--dry]
 *
 * Matches any mesh whose name contains `tongue`, translates every POSITION vertex
 * by +delta on z, and rewrites the GLB. Dry-run prints the report without writing.
 */
import { pathToFileURL } from "node:url";
import { NodeIO } from "@gltf-transform/core";

const TONGUE_RE = /tongue/i;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const glb = args.find((a) => !a.startsWith("--"));
  if (!glb) throw new Error("usage: tongue-forward-place.ts <glb> [--delta 0.004] [--dry]");
  const di = args.indexOf("--delta");
  const delta = di >= 0 ? Number(args[di + 1]) : 0.004;
  const dry = args.includes("--dry");

  const io = new NodeIO();
  const doc = await io.read(glb);
  const meshes = doc.getRoot().listMeshes();
  const tongueMeshes = meshes.filter((m) => TONGUE_RE.test(m.getName()));
  if (tongueMeshes.length === 0) throw new Error(`no tongue mesh found in ${glb}`);
  if (tongueMeshes.length > 1) {
    throw new Error(`refusing: ${tongueMeshes.length} tongue meshes in ${glb}: ${tongueMeshes.map((m) => m.getName()).join(", ")}`);
  }
  const tongue = tongueMeshes[0];

  const v = [0, 0, 0];
  const touched: { mesh: string; verts: number; beforeMaxZ: number; afterMaxZ: number }[] = [];

  for (const prim of tongue.listPrimitives()) {
    const pos = prim.getAttribute("POSITION");
    if (!pos) continue;
    let beforeMaxZ = -Infinity;
    let afterMaxZ = -Infinity;
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      if (v[2] > beforeMaxZ) beforeMaxZ = v[2];
      if (!dry) {
        pos.setElement(i, [v[0], v[1], v[2] + delta]);
        if (v[2] + delta > afterMaxZ) afterMaxZ = v[2] + delta;
      }
    }
    touched.push({
      mesh: tongue.getName(),
      verts: pos.getCount(),
      beforeMaxZ,
      afterMaxZ: dry ? beforeMaxZ + delta : afterMaxZ,
    });
  }

  if (touched.length === 0) throw new Error(`no tongue mesh found in ${glb}`);
  if (!dry) {
    await io.write(glb, doc);
  }
  const report = {
    schemaVersion: "openclinxr.tongue-forward-place.v1",
    glb,
    deltaZ: delta,
    action: dry ? "dry-run (no write)" : `translated tongue forward by ${delta} m on z`,
    meshes: touched,
    notEvidenceFor: ["clinical_validity", "production_asset_readiness"],
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}