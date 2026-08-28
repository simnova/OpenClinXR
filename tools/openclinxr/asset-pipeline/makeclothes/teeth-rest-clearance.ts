/**
 * teeth-rest-clearance.ts — deterministic z-translate of the hm08 teeth mesh in a shipped GLB.
 *
 * #738: the 192-triangle teeth slab renders forward of the lip contour when the mouth opens,
 * because the mouth-open morph retracts the lips (skin median z drops ~2.5 mm at the runtime
 * weight) and the teeth carry no morph targets to follow. The measured fix is rest clearance:
 * translating the teeth mesh back (negative z) increases the rest gap so the slab stays behind
 * the deformed skin median at MOUTH_OPEN_CAP.
 *
 * Run: tsx tools/openclinxr/asset-pipeline/makeclothes/teeth-rest-clearance.ts <glb> [--delta 0.003] [--dry]
 *
 * Matches any mesh whose name contains `hm08_teeth`, translates every POSITION vertex by -delta
 * on z, and rewrites the GLB. Dry-run prints the report without writing.
 */
import { pathToFileURL } from "node:url";
import { NodeIO } from "@gltf-transform/core";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const glb = args.find((a) => !a.startsWith("--"));
  if (!glb) throw new Error("usage: teeth-rest-clearance.ts <glb> [--delta 0.003] [--dry]");
  const di = args.indexOf("--delta");
  const delta = di >= 0 ? Number(args[di + 1]) : 0.003;
  const dry = args.includes("--dry");

  const io = new NodeIO();
  const doc = await io.read(glb);
  const v = [0, 0, 0];
  const touched: { mesh: string; verts: number; beforeMaxZ: number; afterMaxZ: number }[] = [];

  for (const mesh of doc.getRoot().listMeshes()) {
    const name = mesh.getName();
    if (!/hm08_teeth/i.test(name)) continue;
    for (const prim of mesh.listPrimitives()) {
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
        mesh: name,
        verts: pos.getCount(),
        beforeMaxZ,
        afterMaxZ: dry ? beforeMaxZ - delta : afterMaxZ,
      });
    }
  }

  if (touched.length === 0) throw new Error(`no hm08_teeth mesh found in ${glb}`);
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
