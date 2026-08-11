/**
 * #317 face-morph census — every humanoid GLB the runtime resolves, one row each.
 *
 * CLAUSE (2) of issue #317: `.openclinxr/evidence/face-morph-census/face-morph-census.json`
 * covering every humanoid the runtime resolves (>= 9 rails), each row carrying
 * `assetPath`, `bodyVerts`, `usableMouth`. Issue #316 needs this to size its own harm
 * (the Anny rail's whole-body "face" morphs); before this script existed the only way to
 * get these numbers was to write the scan by hand, which the orchestrator did three times
 * while filing #316 and #317.
 *
 * RAILS are enumerated from `apps/ui-xr/src/humanoid-runtime-asset-url.ts` — the paths
 * `resolveHumanoidVariantOrCastPath` / `resolveLocalHumanoidRuntimeAssetUrl` can return for
 * shipped scenarios: the seven Anny cast GLBs under /generated-humanoids/, the two
 * body-param MakeClothes library GLBs under /xr-assets/humanoids/candidates/, and the
 * MPFB2 cast `mpfb-ob-patient-aisha.glb`. Ten rails total. If the runtime resolves a new
 * GLB, add it here and regenerate the artifact.
 *
 * SELECTOR — the largest primitive that CARRIES MORPH TARGETS, not the largest primitive
 * (a clothed humanoid can out-vertex its own body: `makeclothes_library_civilian_shirt_adult`
 * is 34,568 verts and carries no morphs) and not the first primitive (garment meshes carry
 * zero-delta targets to keep the morph index aligned). Both wrong readings measured while
 * planting the contract — see the test header.
 *
 * FACE / MOUTH naming — MPFB FACS-family names (`mouth-open`, `eye-left-closure`, ...) and
 * the runtime's `openclinxr_*` names both count. `$md-*` macro-detail dials are BODY-SHAPE
 * controls and are excluded from face clauses (see the contract's third measurement error).
 *
 * RUN:  pnpm exec tsx tools/openclinxr/evidence/face-morph-census.ts
 * Writes: .openclinxr/evidence/face-morph-census/face-morph-census.json (force-added)
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const PUBLIC = `${REPO_ROOT}/apps/ui-xr/public`;

const MOVED_EPSILON_M = 1e-5;
const MAX_MOVED_FRACTION = 0.5;
const FACE_NAME = /mouth|lip|jaw|viseme|brow|eye|smile|frown|cheek|squint|blink|nose|chin|forehead/i;
const MOUTH_NAME = /mouth|lip|jaw|viseme/i;

/**
 * Runtime rails, mirrored from apps/ui-xr/src/humanoid-runtime-asset-url.ts.
 * Order matters for readability only; the contract checks >= 9 rows and named coverage.
 */
const RAILS: ReadonlyArray<{ id: string; rel: string }> = [
  { id: "ed_chest_pain_adult_cast", rel: "generated-humanoids/ed_chest_pain_adult_cast.glb" },
  { id: "ed_chest_pain_nurse_adult", rel: "generated-humanoids/ed_chest_pain_nurse_adult.glb" },
  { id: "ed_chest_pain_spouse_adult", rel: "generated-humanoids/ed_chest_pain_spouse_adult.glb" },
  { id: "peds_anxious_parent", rel: "generated-humanoids/peds_anxious_parent.glb" },
  { id: "peds_nurse_kevin", rel: "generated-humanoids/peds_nurse_kevin.glb" },
  { id: "peds_patient_child", rel: "generated-humanoids/peds_patient_child.glb" },
  { id: "adult_male_street_casual", rel: "generated-humanoids/adult_male_street_casual.glb" },
  { id: "mpfb_ob_patient_aisha", rel: "generated-humanoids/mpfb-ob-patient-aisha.glb" },
  {
    id: "body_param_adult_lean_female_library",
    rel: "xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb",
  },
  {
    id: "body_param_adult_heavy_male_library",
    rel: "xr-assets/humanoids/candidates/body-param-adult_heavy_male-library.glb",
  },
] as const;

type Row = {
  railId: string;
  assetPath: string;
  bodyVerts: number;
  targetCount: number;
  faceTargets: string[];
  usableMouth: string[];
  emptyFaceTargets: string[];
  wholeBodyFaceTargets: string[];
  sha256: string;
};

const io = new NodeIO();

function sha256Of(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

async function censusOne(rel: string): Promise<Row> {
  const doc = await io.read(`${PUBLIC}/${rel}`);
  let bodyVerts = 0;
  let out: Row = {
    railId: "",
    assetPath: `/generated-humanoids/${rel.split("/").pop()}`,
    bodyVerts: 0,
    targetCount: 0,
    faceTargets: [],
    usableMouth: [],
    emptyFaceTargets: [],
    wholeBodyFaceTargets: [],
    sha256: sha256Of(`${PUBLIC}/${rel}`),
  };

  for (const mesh of doc.getRoot().listMeshes()) {
    const targetNames = ((mesh.getExtras() as Record<string, unknown>)?.targetNames as string[]) ?? [];
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos || prim.listTargets().length === 0 || pos.getCount() <= bodyVerts) continue;

      bodyVerts = pos.getCount();
      const next: Row = { ...out, bodyVerts, targetCount: prim.listTargets().length };
      const el: [number, number, number] = [0, 0, 0];

      prim.listTargets().forEach((target, index) => {
        const name = targetNames[index] ?? `#${index}`;
        const delta = target.getAttribute("POSITION");
        let moved = 0;
        if (delta) {
          for (let i = 0; i < delta.getCount(); i += 1) {
            const [dx, dy, dz] = delta.getElement(i, el);
            if (Math.hypot(dx!, dy!, dz!) > MOVED_EPSILON_M) moved += 1;
          }
        }
        const isFace = FACE_NAME.test(name);
        if (moved === 0) {
          if (isFace) next.emptyFaceTargets.push(name);
          return;
        }
        if (moved / bodyVerts >= MAX_MOVED_FRACTION) {
          if (isFace) next.wholeBodyFaceTargets.push(name);
          return;
        }
        if (isFace) next.faceTargets.push(name);
        if (MOUTH_NAME.test(name)) next.usableMouth.push(name);
      });
      out = next;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const rows: Row[] = [];
  for (const rail of RAILS) {
    const row = await censusOne(rail.rel);
    row.railId = rail.id;
    row.assetPath = `/${rail.rel}`;
    rows.push(row);
  }

  const artifact = {
    schemaVersion: "openclinxr.face-morph-census.v1",
    generatedAt: new Date().toISOString(),
    selector:
      "largest primitive that carries morph targets; face clauses exclude $md-* macro-detail body dials",
    usableDefinition:
      "displaces at least one vertex AND displaces fewer than half of the body's vertices (per rail bodyVerts)",
    rails: rows.map((r) => ({
      railId: r.railId,
      assetPath: r.assetPath,
      bodyVerts: r.bodyVerts,
      targetCount: r.targetCount,
      faceTargets: r.faceTargets.length,
      usableMouth: r.usableMouth.length,
      usableMouthNames: r.usableMouth,
      emptyFaceTargets: r.emptyFaceTargets,
      wholeBodyFaceTargets: r.wholeBodyFaceTargets,
      sha256: r.sha256,
    })),
  };

  const outPath = `${REPO_ROOT}/.openclinxr/evidence/face-morph-census/face-morph-census.json`;
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(`CENSUS ${outPath}`);
  for (const r of artifact.rails) {
    console.log(
      `${r.railId.padEnd(34)} verts=${String(r.bodyVerts).padStart(6)} face=${String(r.faceTargets).padStart(2)} usableMouth=${String(r.usableMouth).padStart(2)}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
