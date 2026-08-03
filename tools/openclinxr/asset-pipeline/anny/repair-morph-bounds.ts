/**
 * repair-morph-bounds.ts — neutralize corrupt/exploding morph-target deltas in a GLB.
 *
 * Some generated humanoid GLBs carry garbage morph targets whose POSITION deltas grow
 * exponentially (e.g. one vertex at X≈27,165). three.js expands the mesh bounding box by
 * morph extremes, so the model's bbox blows up to ~100km, framing frames empty space and
 * the humanoid renders as a sub-pixel speck (peds_patient_child scored realism 0.05 for
 * exactly this). A morph delta that large is never a real facial/body morph — this zeroes
 * any morph-target vertex delta with |component| > threshold (default 5m), which fully
 * neutralizes the corrupt targets without removing targets/indices/animation channels.
 *
 * Reusable across the generated-humanoid set (this is a pipeline export bug, not a one-off).
 *
 * Run: tsx tools/openclinxr/asset-pipeline/anny/repair-morph-bounds.ts <glb> [--threshold 5] [--dry]
 */
import { cp } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { NodeIO } from "@gltf-transform/core";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const glb = args.find((a) => !a.startsWith("--"));
  if (!glb) throw new Error("usage: repair-morph-bounds.ts <glb> [--threshold 5] [--dry]");
  const ti = args.indexOf("--threshold");
  const threshold = ti >= 0 ? Number(args[ti + 1]) : 5;
  const dry = args.includes("--dry");

  const io = new NodeIO();
  const doc = await io.read(glb);
  const el: number[] = [0, 0, 0];
  let clampedVerts = 0;
  let corruptTargets = 0;

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const target of prim.listTargets()) {
        const pos = target.getAttribute("POSITION");
        if (!pos) continue;
        const n = pos.getCount();
        let targetHit = false;
        for (let i = 0; i < n; i++) {
          pos.getElement(i, el);
          if (Math.abs(el[0]!) > threshold || Math.abs(el[1]!) > threshold || Math.abs(el[2]!) > threshold) {
            if (!dry) pos.setElement(i, [0, 0, 0]);
            clampedVerts++;
            targetHit = true;
          }
        }
        if (targetHit) corruptTargets++;
      }
    }
  }

  const report = {
    schemaVersion: "openclinxr.repair-morph-bounds.v1",
    glb,
    threshold,
    corruptMorphTargets: corruptTargets,
    clampedVertexDeltas: clampedVerts,
    action: dry ? "dry-run (no write)" : "clamped-to-zero",
    notEvidenceFor: ["clinical_validity", "production_asset_readiness"],
  };
  if (clampedVerts > 0 && !dry) {
    await cp(glb, glb.replace(/\.glb$/, `.pre-morph-repair-${new Date().toISOString().slice(0, 10)}.glb`));
    await io.write(glb, doc);
  }
  console.log(JSON.stringify(report));
  if (clampedVerts === 0) console.log(`  ${path.basename(glb)}: clean (no morph deltas > ${threshold}m)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
