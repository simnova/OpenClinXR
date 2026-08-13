// #180 pre-fix measurement: per-cast-actor garment asset ids + base colours, read
// from the shipped GLBs with the SAME instrument the contract test uses (NodeIO).
// Mirrors the classify regexes in a-station-cast-is-visually-separable.test.ts.
import { join, resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";

const HERE = new URL(".", import.meta.url).pathname;
const REPO_ROOT = resolve(HERE, "../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";

const CAST = [
  { role: "patient_maya_johnson_v1", clinician: false, file: "mpfb-peds-patient-child.glb" },
  { role: "parent_tara_johnson_v1", clinician: false, file: "mpfb-ob-patient-aisha.glb" },
  { role: "nurse_kevin_lee_v1", clinician: true, file: "mpfb-peds-nurse-kevin.glb" },
] as const;

const io = new NodeIO();

function kindOf(name: string): string {
  return name.replace(/^.*?library_/, "").replace(/_mpfb[_-].*$/, "");
}

const out = [];
for (const entry of CAST) {
  const doc = await io.read(join(REPO_ROOT, GENERATED, entry.file));
  const row = { file: entry.file, role: entry.role, clinician: entry.clinician, materials: [] as unknown[] };
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      if (!mat) continue;
      const name = mesh.getName();
      const c = mat.getBaseColorFactor() ?? [0, 0, 0, 1];
      const slot = /t_shirt|scrub|shirt|gown|top/i.test(name)
        ? "upper"
        : /pants|trouser/i.test(name)
          ? "lower"
          : /footwear|shoe|boot/i.test(name)
            ? "footwear"
            : "other";
      row.materials.push({
        mesh: name,
        slot,
        kind: slot === "other" ? null : kindOf(name),
        rgb: [c[0]!, c[1]!, c[2]!].map((v) => Number(v.toFixed(3))),
      });
    }
  }
  out.push(row);
}

writeFileSync(
  join(HERE, "glb-colours.json"),
  JSON.stringify({ measuredAt: new Date().toISOString(), cast: out }, null, 2),
);
console.log(JSON.stringify(out, null, 2));
