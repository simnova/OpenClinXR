/**
 * Pre-fix measurement for issue-349 (rooms carry albedo, no baked occlusion).
 *
 * Reads the two shipped environment GLBs with NodeIO (same instrument as
 * a-room-has-contact-shadows.test.ts) and emits, per room and per material:
 *   - material name
 *   - has base-colour texture
 *   - has occlusion texture
 *   - UV sets present on the primitives using the material
 *   - triangle count using the material
 * plus the room aggregate. Writes .openclinxr/evidence/rooms-ao/pre-fix.json.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { NodeIO } from "@gltf-transform/core";

const io = new NodeIO();
const ENV_DIR = "apps/ui-xr/public/xr-assets/environment";

type MaterialRow = {
  name: string;
  hasBaseColorTexture: boolean;
  hasOcclusionTexture: boolean;
  uvSets: string[];
  tris: number;
};

type RoomRow = {
  file: string;
  path: string;
  tris: number;
  meshes: number;
  materials: number;
  materialsWithBaseColorTexture: number;
  materialsWithOcclusion: number;
  roughnessValues: number[];
  materialDetail: MaterialRow[];
};

const UV_NAMES = ["TEXCOORD_0", "TEXCOORD_1", "TEXCOORD_2", "TEXCOORD_3"];

async function measureRoom(file: string): Promise<RoomRow> {
  const abs = path.resolve(ENV_DIR, file);
  const doc = await io.read(abs);
  const root = doc.getRoot();

  const materialTris = new Map<string, number>();
  const materialUvs = new Map<string, Set<string>>();
  let tris = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const count = (prim.getIndices()?.getCount() ?? 0) / 3;
      tris += count;
      const mat = prim.getMaterial();
      const matName = mat?.getName() ?? "<none>";
      materialTris.set(matName, (materialTris.get(matName) ?? 0) + count);
      const uvSet = materialUvs.get(matName) ?? new Set<string>();
      for (const uvName of UV_NAMES) {
        if (prim.getAttribute(uvName)) uvSet.add(uvName);
      }
      materialUvs.set(matName, uvSet);
    }
  }

  const materials = root.listMaterials();
  let materialsWithBaseColorTexture = 0;
  let materialsWithOcclusion = 0;
  const roughnessValues: number[] = [];
  const materialDetail: MaterialRow[] = [];
  for (const m of materials) {
    const hasBase = m.getBaseColorTexture() !== null;
    const hasOcc = m.getOcclusionTexture() !== null;
    if (hasBase) materialsWithBaseColorTexture++;
    if (hasOcc) materialsWithOcclusion++;
    const rough = m.getRoughnessFactor();
    if (rough !== undefined) roughnessValues.push(rough);
    materialDetail.push({
      name: m.getName(),
      hasBaseColorTexture: hasBase,
      hasOcclusionTexture: hasOcc,
      uvSets: [...(materialUvs.get(m.getName()) ?? [])].sort(),
      tris: materialTris.get(m.getName()) ?? 0,
    });
  }
  return {
    file,
    path: `${ENV_DIR}/${file}`,
    tris,
    meshes: root.listMeshes().length,
    materials: materials.length,
    materialsWithBaseColorTexture,
    materialsWithOcclusion,
    roughnessValues,
    materialDetail,
  };
}

function commitSha(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

const files = readdirSync(ENV_DIR).filter((n: string) => n.endsWith(".glb"));
const rows = await Promise.all(files.map((f: string) => measureRoom(f)));
const out = {
  schemaVersion: "openclinxr.rooms-ao.pre-fix.v1",
  issue: 349,
  generatedAt: new Date().toISOString(),
  measuredAgainstCommit: commitSha(),
  instrument: "NodeIO @gltf-transform/core (same as a-room-has-contact-shadows.test.ts)",
  rooms: rows,
};
const target = ".openclinxr/evidence/rooms-ao/pre-fix.json";
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
process.stdout.write(`wrote ${target}\n`);
for (const r of rows) {
  process.stdout.write(
    `${r.file}: tris=${r.tris} materials=${r.materials} baseColorTex=${r.materialsWithBaseColorTexture} occlusion=${r.materialsWithOcclusion}\n`,
  );
}
