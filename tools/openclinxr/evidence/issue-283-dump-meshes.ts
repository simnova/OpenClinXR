/**
 * #283 — pre-fix mesh dump for the upper-region band investigation.
 *
 * Extracts the body + upper + lower garment meshes from the two shipped body-param
 * library GLBs (the exact files `garment-covers-its-region.ts` inspects), using the
 * same name classification, and writes them as JSON so the pure-numpy Python analysis
 * can measure the region band contents (issue-283 OPERATIONALIZED measurement).
 *
 * claimScope: mesh geometry of the shipped library figures, for the band measurement.
 * notEvidenceFor: appearance, clinical wardrobe, readiness.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO, type Accessor, type Mesh } from "@gltf-transform/core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../..");
const CANDIDATES_DIR = path.join(REPO_ROOT, "apps/ui-xr/public/xr-assets/humanoids/candidates");
const OUT_DIR = path.join(REPO_ROOT, ".openclinxr/evidence/issue-283/meshes");

const GLB_NAMES = [
  "body-param-adult_lean_female-library.glb",
  "body-param-adult_heavy_male-library.glb",
];

function garmentNameTokens(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean);
}
function isLowerGarmentName(name: string): boolean {
  const t = garmentNameTokens(name);
  return t.some((tok) => tok.includes("pant") || tok.includes("trouser"));
}
function isUpperGarmentName(name: string): boolean {
  const t = garmentNameTokens(name);
  return t.some((tok) => tok === "scrub" || tok === "scrubs" || tok.includes("shirt") || tok === "garment" || tok === "gown");
}

type MeshGeometry = { position: number[]; indices: number[]; triangles: number; name: string };

function meshData(mesh: Mesh): MeshGeometry {
  const position: number[] = [];
  const indices: number[] = [];
  let triangles = 0;
  const tmp: number[] = [0, 0, 0];
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION") as Accessor | null;
    const idx = prim.getIndices();
    if (!pos || !idx) continue;
    const base = position.length / 3;
    for (let i = 0; i < pos.getCount(); i += 1) {
      pos.getElement(i, tmp);
      position.push(tmp[0]!, tmp[1]!, tmp[2]!);
    }
    for (let i = 0; i < idx.getCount(); i += 1) {
      indices.push(idx.getScalar(i) + base);
    }
    triangles += Math.floor(idx.getCount() / 3);
  }
  return { position, indices, triangles, name: mesh.getName() || "" };
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const io = new NodeIO();
  for (const glbName of GLB_NAMES) {
    const glbPath = path.join(CANDIDATES_DIR, glbName);
    const doc = await io.read(glbPath);
    const bodyClassId = glbName.replace(/^body-param-/, "").replace(/-library\.glb$/, "");
    let body: MeshGeometry | null = null;
    let lower: MeshGeometry | null = null;
    let upper: MeshGeometry | null = null;
    const meshNames: string[] = [];
    for (const mesh of doc.getRoot().listMeshes()) {
      const name = mesh.getName() || "";
      if (/basemesh/i.test(name)) {
        meshNames.push(name);
        if (!body) body = meshData(mesh);
      } else if (isLowerGarmentName(name)) {
        meshNames.push(name);
        if (!lower) lower = meshData(mesh);
      } else if (isUpperGarmentName(name)) {
        meshNames.push(name);
        if (!upper) upper = meshData(mesh);
      }
    }
    if (!body) throw new Error(`issue-283-dump: no basemesh in ${glbName}`);
    const payload: Record<string, unknown> = {
      bodyClassId,
      glbName,
      meshNames,
      body,
    };
    if (lower) payload.lower = lower;
    if (upper) payload.upper = upper;
    await writeFile(path.join(OUT_DIR, `${bodyClassId}.json`), JSON.stringify(payload));
    // eslint-disable-next-line no-console
    console.log(
      `${bodyClassId}: body ${body.triangles}t "${body.name}", lower ${lower?.triangles ?? 0}t, upper ${upper?.triangles ?? 0}t`,
    );
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
