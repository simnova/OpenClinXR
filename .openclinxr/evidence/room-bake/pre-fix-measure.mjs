// One-off pre-fix measurement for issue-345 (room bake). Same instrument as the
// contract test (NodeIO over the shipped GLBs), plus material/UV detail for the
// calibration record. Writes .openclinxr/evidence/room-bake/pre-fix.json.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { NodeIO } from "@gltf-transform/core";

const REPO_ROOT = resolve(".");
const ENV_DIR = join(REPO_ROOT, "apps/ui-xr/public/xr-assets/environment");

const io = new NodeIO();

async function measure(rel) {
  const doc = await io.read(join(REPO_ROOT, rel));
  const root = doc.getRoot();

  let tris = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) tris += (prim.getIndices()?.getCount() ?? 0) / 3;
  }

  const materials = root.listMaterials();
  const textured = materials.filter((m) => m.getBaseColorTexture() !== null);

  let distinct = 1;
  let textureBytes = 0;
  for (const tex of root.listTextures()) textureBytes += tex.getImage()?.byteLength ?? 0;
  const first = textured[0]?.getBaseColorTexture()?.getImage();
  if (first && first.byteLength > 0) {
    const seen = new Set();
    const stride = Math.max(3, Math.floor(first.byteLength / 4096) * 3);
    for (let i = 0; i + 2 < first.byteLength; i += stride) {
      seen.add(`${first[i] >> 4},${first[i + 1] >> 4},${first[i + 2] >> 4}`);
      if (seen.size > 64) break;
    }
    distinct = seen.size;
  }

  let meshesWithUv = 0;
  const meshDetail = [];
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const hasUv = prim.getAttribute("TEXCOORD_0") !== null;
      if (hasUv) meshesWithUv += 1;
      meshDetail.push({
        mesh: mesh.getName(),
        tris: (prim.getIndices()?.getCount() ?? 0) / 3,
        hasUv,
      });
    }
  }

  return {
    file: rel.split("/").pop(),
    path: rel,
    tris,
    meshes: root.listMeshes().length,
    materials: materials.length,
    texturedMaterials: textured.length,
    distinctColours: distinct,
    textureBytes,
    meshesWithUv,
    materialDetail: materials.map((m) => ({
      name: m.getName(),
      baseColor: Array.from(m.getBaseColorFactor() ?? [1, 1, 1, 1]),
      hasBaseColorTexture: m.getBaseColorTexture() !== null,
    })),
    meshDetail,
  };
}

const files = existsSync(ENV_DIR)
  ? readdirSync(ENV_DIR)
      .filter((n) => n.endsWith(".glb"))
      .map((n) => `apps/ui-xr/public/xr-assets/environment/${n}`)
  : [];

const rows = [];
for (const f of files) {
  try {
    rows.push(await measure(f));
  } catch (err) {
    rows.push({ file: f.split("/").pop(), path: f, measureError: String(err) });
  }
}

const offenders = rows
  .filter((r) => !r.measureError && (r.texturedMaterials === 0 || r.distinctColours < 2))
  .map((r) => ({
    file: r.file,
    texturedMaterials: r.texturedMaterials,
    distinctColours: r.distinctColours,
  }));

const report = {
  schemaVersion: "openclinxr.room-bake.pre-fix.v1",
  issue: 345,
  generatedAt: new Date().toISOString(),
  measuredAgainstCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  instrument: "NodeIO @gltf-transform/core (same as a-room-is-lit-and-textured.test.ts)",
  rows,
  offenders,
  summary: {
    totalGlbs: rows.length,
    offenders: offenders.length,
    everyShippedRoomUntextured: rows.every((r) => !r.measureError && r.texturedMaterials === 0),
  },
};

writeFileSync(join(REPO_ROOT, ".openclinxr/evidence/room-bake/pre-fix.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ wrote: ".openclinxr/evidence/room-bake/pre-fix.json", summary: report.summary, offenders }, null, 2));
