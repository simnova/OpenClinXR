/**
 * apply-gravid-treatment.ts — bake-chain station re-applying the recorded
 * #581/#509 gravid treatment to the OB patient's shipped GLB.
 *
 * The case fixture (packages/openclinxr/scenario-fixtures/src/ob-preeclampsia.ts)
 * declares "34 weeks pregnant". The treatment was baked once via
 * --pregnancy-weeks 34 (pregnancy_target.py, weight 0.85) and wiped by the
 * 4b151efbe WIP rebake; this station re-applies the RECORDED displacement
 * field (recorded-gravid-treatment.json, derived from the #581 bytes by
 * derive-gravid-treatment.ts) to already-baked bytes, preserving every later
 * pinned change (HB-02 albedo, teeth, walk, chest anchors, garment extras).
 * Future full materializer rebakes of the OB patient must pass
 * --pregnancy-weeks 34 instead; this station is the repair path for shipped
 * bytes, and the pregnancy contract
 * (tools/openclinxr/evidence/the-case-declared-pregnancy-reaches-a-vertex.test.ts)
 * guards the result.
 *
 * The station refuses when the target's body/garment topology differs from the
 * recorded topology (a rebake changes vertex counts): re-derive the artifact,
 * do not force it.
 *
 * Run: tsx tools/openclinxr/asset-pipeline/makeclothes/apply-gravid-treatment.ts <glb> [--dry] [--probe]
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const ARTIFACT = new URL("./recorded-gravid-treatment.json", import.meta.url);

interface Entry { m: string; p: number; i: number; d: [number, number, number]; n: [number, number, number] }
interface Artifact {
  schemaVersion: string;
  target: string;
  topology: Record<string, number[]>;
  entries: Entry[];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const glb = args.find((a) => !a.startsWith("--"));
  if (!glb) throw new Error("usage: apply-gravid-treatment.ts <glb> [--dry] [--probe]");
  const dry = args.includes("--dry");
  const probe = args.includes("--probe");
  const artifact = JSON.parse(readFileSync(ARTIFACT, "utf8")) as Artifact;
  if (artifact.schemaVersion !== "openclinxr.recorded-gravid-treatment.v1") {
    throw new Error(`unsupported artifact schema: ${artifact.schemaVersion}`);
  }

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(glb);

  // Topology guard: every recorded mesh/prim must match exactly.
  for (const [name, counts] of Object.entries(artifact.topology)) {
    const mesh = doc.getRoot().listMeshes().find((m) => (m.getName() ?? "?") === name);
    if (!mesh) throw new Error(`refusing: mesh ${name} absent from ${glb} — re-derive the artifact`);
    const prims = mesh.listPrimitives();
    if (prims.length !== counts.length) {
      throw new Error(`refusing: mesh ${name} has ${prims.length} prims, artifact records ${counts.length}`);
    }
    prims.forEach((p, k) => {
      const n = p.getAttribute("POSITION")!.getCount();
      if (n !== counts[k]) {
        throw new Error(`refusing: mesh ${name} prim ${k} has ${n} verts, artifact records ${counts[k]} — re-derive the artifact`);
      }
    });
  }
  if (probe) {
    const per: Record<string, number> = {};
    let maxMm = 0;
    for (const e of artifact.entries) {
      per[e.m] = (per[e.m] ?? 0) + 1;
      const m = Math.sqrt(e.d[0] ** 2 + e.d[1] ** 2 + e.d[2] ** 2);
      if (m > maxMm) maxMm = m;
    }
    process.stdout.write(JSON.stringify({
      glb, artifact: ARTIFACT.toString(), entries: artifact.entries.length,
      perMesh: per, maxDeltaMm: Math.round(maxMm * 1000 * 10) / 10, topology: "match",
    }, null, 2) + "\n");
    return;
  }

  let applied = 0;
  for (const e of artifact.entries) {
    const mesh = doc.getRoot().listMeshes().find((m) => (m.getName() ?? "?") === e.m)!;
    const prim = mesh.listPrimitives()[e.p]!;
    const pos = prim.getAttribute("POSITION")!;
    const nor = prim.getAttribute("NORMAL")!;
    const v = [0, 0, 0];
    pos.getElement(e.i, v);
    if (!dry) {
      pos.setElement(e.i, [v[0] + e.d[0], v[1] + e.d[1], v[2] + e.d[2]]);
      nor.setElement(e.i, e.n);
    }
    applied++;
  }
  if (!dry) await io.write(glb, doc);
  process.stdout.write(JSON.stringify({
    schemaVersion: "openclinxr.apply-gravid-treatment.v1",
    glb,
    action: dry ? "dry-run (no write)" : `applied ${applied} recorded displacements (positions + normals)`,
    entries: applied,
  }, null, 2) + "\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
