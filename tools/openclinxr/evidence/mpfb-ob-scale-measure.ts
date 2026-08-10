/**
 * #264 pre-fix measurement — MPFB2 OB patient renders ~2x the height of the Anny actors.
 *
 * INSTRUMENT: glTF-Transform NodeIO over the exported GLBs (same instrument as
 * anny-reference-mpfb-match.ts #221). Measures:
 *   - world-space AABB + height of all three OB cast assets as the runtime loads them
 *     (runtime applies uniform scale 1 at load, main.ts:6931, so world == local),
 *   - the MPFB candidate's LOCAL bounds,
 *   - local AABB of the Anny reference/nurse GLB for the control comparison.
 *
 * The two Anny actors are the control: normal height, textured, scalp mesh.
 * This artifact is written BEFORE any product edit (contract: pre-fix.json).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

type Aabb = { min: [number, number, number]; max: [number, number, number] };

async function aabbForGlb(io: NodeIO, glbPath: string, excludeNames: RegExp[] = []): Promise<Aabb | null> {
  const doc = await io.read(glbPath);
  const min = [Infinity, Infinity, Infinity] as [number, number, number];
  const max = [-Infinity, -Infinity, -Infinity] as [number, number, number];
  let any = false;
  for (const mesh of doc.getRoot().listMeshes()) {
    const name = mesh.getName() || "";
    if (excludeNames.some((re) => re.test(name))) continue;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const arr = pos.getArray();
      if (!arr) continue;
      for (let i = 0; i < pos.getCount(); i++) {
        const x = Number(arr[i * 3]);
        const y = Number(arr[i * 3 + 1]);
        const z = Number(arr[i * 3 + 2]);
        if (x < min[0]) min[0] = x;
        if (y < min[1]) min[1] = y;
        if (z < min[2]) min[2] = z;
        if (x > max[0]) max[0] = x;
        if (y > max[1]) max[1] = y;
        if (z > max[2]) max[2] = z;
        any = true;
      }
    }
  }
  if (!any) return null;
  return { min, max };
}

function heightOf(aabb: Aabb): number {
  return aabb.max[1] - aabb.min[1];
}

const ASSETS = {
  mpfbPatient: path.join(
    REPO_ROOT,
    "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb",
  ),
  mpfbCandidate: path.join(
    REPO_ROOT,
    "apps/ui-xr/public/xr-assets/humanoids/candidates/mpfb-ob-patient-aisha-rigged-candidate.glb",
  ),
  annyNurse: path.join(
    REPO_ROOT,
    "apps/ui-xr/public/generated-humanoids/ed_chest_pain_nurse_adult.glb",
  ),
  annyPartner: path.join(
    REPO_ROOT,
    "apps/ui-xr/public/generated-humanoids/ed_chest_pain_spouse_adult.glb",
  ),
};

const io = new NodeIO();
const out: Record<string, unknown> = {
  schemaVersion: "openclinxr.issue-264.pre-fix.v1",
  measuredBeforeProductEdit: true,
  instrument: "gltf-transform NodeIO over exported GLBs (same instrument as anny-reference-mpfb-match.ts #221)",
  runtimeScaleNote:
    "main.ts:6931 sets humanoid.scale(1,1,1) on load for the default path; no per-rail scale. World height == local height * slot scale.",
  actors: {} as Record<string, unknown>,
  mpfbLocalBounds: {} as Record<string, unknown>,
  annyControl: {} as Record<string, unknown>,
};

async function main(): Promise<void> {
  for (const [key, glbPath] of Object.entries(ASSETS)) {
    const aabb = await aabbForGlb(io, glbPath);
    if (!aabb) {
      (out.actors as Record<string, unknown>)[key] = { error: `no POSITION data in ${glbPath}` };
      continue;
    }
    const record = {
      glbPath: path.relative(REPO_ROOT, glbPath).split(path.sep).join("/"),
      aabbMin: aabb.min,
      aabbMax: aabb.max,
      heightMeters: heightOf(aabb),
      depthMeters: aabb.max[2] - aabb.min[2],
      widthMeters: aabb.max[0] - aabb.min[0],
    };
    if (key === "mpfbPatient" || key === "mpfbCandidate") {
      (out.mpfbLocalBounds as Record<string, unknown>)[key] = record;
      (out.actors as Record<string, unknown>)[key] = record;
    } else {
      (out.annyControl as Record<string, unknown>)[key] = record;
      (out.actors as Record<string, unknown>)[key] = record;
    }
  }

  // Height ratio MPFB vs Anny nurse (the on-screen control).
  const mpfbH = ((out.actors as Record<string, unknown>).mpfbPatient as { heightMeters?: number })?.heightMeters;
  const nurseH = ((out.annyControl as Record<string, unknown>).annyNurse as { heightMeters?: number })?.heightMeters;
  if (typeof mpfbH === "number" && typeof nurseH === "number") {
    out.heightRatioMpfbOverNurse = mpfbH / nurseH;
  }

  const evDir = path.join(REPO_ROOT, ".openclinxr/evidence/issue-264");
  mkdirSync(evDir, { recursive: true });
  const outPath = path.join(evDir, "pre-fix.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
  console.log(`\nWROTE ${outPath}`);
}

void main();
