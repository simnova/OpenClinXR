// #692 component census — is an MPFB humanoid a safe subject for a selected_to_active
// cage bake, or is it the o2-port cross-component contamination class?
//
// The card's falsifier is knowable before baking: position-welded component count and
// largest-component share per asset. Reference points from the TRELLIS rail (trellis-baking
// SKILL.md): pulse-oximeter 16 components / 99.7% largest = safe; o2-port 75 / 51.5% =
// contaminated. An MPFB humanoid is body + garments + hair + eyes + brows + lashes, and its
// share was UNMEASURED — this script produces that number, per asset, plus the per-mesh
// triangle split the done_when asks for.
//
// Instrument: same NodeIO read the contract test uses. Weld positions at 5dp across ALL
// primitives and meshes (the trellis-baking skill records that an unwelded count is wrong by
// orders of magnitude), then union-find over triangle edges. Component size is counted in
// triangles and in vertices.
//
// Output: .openclinxr/evidence/mpfb-bake-question/component-census.json
// Run: pnpm exec tsx tools/openclinxr/evidence/mpfb-component-census.ts

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { NodeIO } from "@gltf-transform/core";

const HERE = new URL(".", import.meta.url).pathname;
const REPO_ROOT = resolve(HERE, "../../..");
const DIR = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");
const OUT = join(REPO_ROOT, ".openclinxr/evidence/mpfb-bake-question/component-census.json");

const io = new NodeIO();

type Prim = {
  tris: number;
  indices: number[];
  positions: number[]; // welded-space vertex ids, parallel to indices
  hasTangent: boolean;
  hasNormalMap: boolean;
};

function triangleCount(prim: { getIndices(): { getCount(): number } | null; getAttribute(name: string): { getCount(): number } | null }): number {
  const idx = prim.getIndices();
  if (idx) return idx.getCount() / 3;
  return (prim.getAttribute("POSITION")?.getCount() ?? 0) / 3;
}

/** Read a GLB into a welded-vertex triangle soup. */
async function readAsset(path: string) {
  const doc = await io.read(path);
  const meshRows: { name: string; tris: number }[] = [];
  let totalTris = 0;
  let hasNormalMap = false;
  let hasTangent = false;
  // welded vertex: quantised position -> global id
  const weld = new Map<string, number>();
  const weldPos: number[][] = []; // global id -> [x, y, z]
  const tris: [number, number, number][] = [];
  const triMesh: number[] = []; // mesh index per triangle (parallel to tris)

  for (const mesh of doc.getRoot().listMeshes()) {
    let meshTris = 0;
    const meshIndex = meshRows.length;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      const idx = prim.getIndices();
      const primTris = triangleCount(prim as never);
      meshTris += primTris;
      totalTris += primTris;
      if (prim.getMaterial()?.getNormalTexture()) hasNormalMap = true;
      if (prim.getAttribute("TANGENT")) hasTangent = true;
      if (!pos) continue;
      const arr = pos.getArray();
      if (!arr) continue;
      const stride = pos.getElementSize();
      const q = (v: number) => Math.round(v * 1e5); // 5dp weld
      const idOf = (i: number): number => {
        const x = arr[i * stride]!;
        const y = arr[i * stride + 1]!;
        const z = arr[i * stride + 2]!;
        const key = `${q(x)},${q(y)},${q(z)}`;
        let id = weld.get(key);
        if (id === undefined) {
          id = weldPos.length;
          weld.set(key, id);
          weldPos.push([x, y, z]);
        }
        return id;
      };
      if (idx) {
        const ia = idx.getArray()!;
        for (let i = 0; i + 2 < ia.length; i += 3) {
          tris.push([idOf(ia[i]!), idOf(ia[i + 1]!), idOf(ia[i + 2]!)]);
          triMesh.push(meshIndex);
        }
      } else {
        for (let i = 0; i + 2 < pos.getCount(); i += 3) {
          tris.push([idOf(i), idOf(i + 1), idOf(i + 2)]);
          triMesh.push(meshIndex);
        }
      }
    }
    meshRows.push({ name: mesh.getName() || "(unnamed)", tris: Math.round(meshTris) });
  }
  return {
    meshRows,
    totalTris: Math.round(totalTris),
    hasNormalMap,
    hasTangent,
    tris,
    triMesh,
    weldPos,
    meshCount: meshRows.length,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  };
}

/** Union-find over welded vertex ids; component sizes in triangles and vertices. */
function components(tris: [number, number, number][], triMesh: number[], vertexCount: number) {
  const parent = new Int32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) parent[i] = i;
  const find = (a: number): number => {
    let x = a;
    while (parent[x] !== x) x = parent[x]!;
    let y = a;
    while (parent[y] !== y) {
      const p = parent[y]!;
      parent[y] = x;
      y = p;
    }
    return x;
  };
  const unite = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (const [a, b, c] of tris) {
    unite(a, b);
    unite(b, c);
    unite(c, a);
  }
  const triSizes = new Map<number, number>();
  const vertSizes = new Map<number, number>();
  for (const [a] of tris) {
    const r = find(a);
    triSizes.set(r, (triSizes.get(r) ?? 0) + 1);
  }
  for (let i = 0; i < vertexCount; i++) {
    const r = find(i);
    vertSizes.set(r, (vertSizes.get(r) ?? 0) + 1);
  }
  const byTris = [...triSizes.entries()].sort((x, y) => y[1] - x[1]);
  const byVerts = [...vertSizes.entries()].sort((x, y) => y[1] - x[1]);
  // Mesh attribution of the largest triangle component: how many of its tris
  // belong to each source mesh.
  const largestRoot = byTris[0]?.[0];
  const meshTris = new Map<number, number>();
  if (largestRoot !== undefined) {
    for (let i = 0; i < tris.length; i++) {
      if (find(tris[i]![0]) === largestRoot) {
        meshTris.set(triMesh[i]!, (meshTris.get(triMesh[i]!) ?? 0) + 1);
      }
    }
  }
  return {
    count: byTris.length,
    largestTris: byTris[0]?.[1] ?? 0,
    byTris,
    byVerts,
    largestMeshTris: [...meshTris.entries()].sort((x, y) => y[1] - x[1]),
  };
}

const ED_STATION = [
  "mpfb-gown-adult-patient",
  "mpfb-clinical-nurse-adult",
  "mpfb-family-partner-adult",
  "mpfb-clinical-physician-adult",
] as const;
const PEDS_STATION = [
  "mpfb-peds-patient-child",
  "mpfb-peds-parent-aisha",
  "mpfb-peds-nurse-kevin",
] as const;

const files = (await import("node:fs")).readdirSync(DIR).filter((f) => f.startsWith("mpfb-") && f.endsWith(".glb")).sort();

const assets: Record<string, unknown>[] = [];
const totals: Record<string, number> = {};
let edTotal = 0;
let pedsTotal = 0;

for (const file of files) {
  const name = file.replace(/\.glb$/, "");
  const a = await readAsset(join(DIR, file));
  const comp = components(a.tris, a.triMesh, a.weldPos.length);
  const largestTris = comp.byTris[0]?.[1] ?? 0;
  const largestShareTris = a.totalTris > 0 ? largestTris / a.totalTris : 0;
  const secondShareTris = a.totalTris > 0 ? (comp.byTris[1]?.[1] ?? 0) / a.totalTris : 0;
  const largestMeshNames = comp.largestMeshTris.map(([mi, n]) => ({ mesh: a.meshRows[mi]!.name, tris: n }));
  totals[name] = a.totalTris;
  if ((ED_STATION as readonly string[]).includes(name)) edTotal += a.totalTris;
  if ((PEDS_STATION as readonly string[]).includes(name)) pedsTotal += a.totalTris;
  assets.push({
    file,
    sha256: a.sha256,
    totalTris: a.totalTris,
    meshCount: a.meshCount,
    hasNormalMap: a.hasNormalMap,
    hasTangent: a.hasTangent,
    weldedVertexCount: a.weldPos.length,
    components: comp.count,
    largestShareTris: Number(largestShareTris.toFixed(4)),
    secondLargestShareTris: Number(secondShareTris.toFixed(4)),
    largestShareVerts: Number((((comp.byVerts[0]?.[1] ?? 0) / a.weldPos.length) || 0).toFixed(4)),
    largestComponentMeshTris: largestMeshNames,
    perMeshTris: a.meshRows.sort((x, y) => y.tris - x.tris),
  });
}

const head = (await import("node:child_process")).execSync("git rev-parse --short HEAD").toString().trim();

const census = {
  schemaVersion: "openclinxr.mpfb-bake-question.component-census.v1",
  generatedAt: new Date().toISOString(),
  head,
  method:
    "NodeIO read (same instrument as the contract test); positions welded at 5dp across ALL primitives and meshes; "
    + "union-find over triangle edges; component sizes in triangles and vertices. Unwelded counts are wrong by "
    + "orders of magnitude on this generator (trellis-baking SKILL.md).",
  referencePoints: {
    pulseOximeterSafe: { components: 16, largestShare: 0.997 },
    o2PortContaminated: { components: 75, largestShare: 0.515 },
    cardBand: ">= ~0.99 largest-component share is the safe class; ~0.50 is the o2-port contamination class",
  },
  stationArithmetic: {
    edFourActorTotalTris: edTotal,
    edBudget: 180_000,
    edOverBy: edTotal - 180_000,
    pedsThreeActorTotalTris: pedsTotal,
    pedsBudget: 180_000,
    pedsOverBy: pedsTotal - 180_000,
  },
  assets,
};

mkdirSync(join(REPO_ROOT, ".openclinxr/evidence/mpfb-bake-question"), { recursive: true });
writeFileSync(OUT, JSON.stringify(census, null, 2) + "\n");

console.log(`head ${head}`);
for (const a of assets as { file: string; totalTris: number; components: number; largestShareTris: number; secondLargestShareTris: number; perMeshTris: { name: string; tris: number }[] }[]) {
  console.log(
    `${a.file}: ${a.totalTris} tris, ${a.components} welded components, largest ${(a.largestShareTris * 100).toFixed(1)}%, 2nd ${(a.secondLargestShareTris * 100).toFixed(1)}%`,
  );
  for (const m of a.perMeshTris) console.log(`    ${m.name}: ${m.tris}`);
}
console.log(`ED four-actor: ${edTotal} (budget 180000, over by ${edTotal - 180_000})`);
console.log(`Peds three-actor: ${pedsTotal} (budget 180000, over by ${pedsTotal - 180_000})`);
console.log(`wrote ${OUT}`);
