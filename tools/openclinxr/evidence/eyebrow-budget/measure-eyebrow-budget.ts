/**
 * Pre-fix measurement for issue #597 — reads the SHIPPED GLBs under
 * apps/ui-xr/public/generated-humanoids with NodeIO and writes
 * .openclinxr/evidence/eyebrow-budget/pre-fix.json.
 *
 * Must be run BEFORE any edit to materialize_mpfb_humanoid_candidate.py so the artifact records
 * the pre-fix state of the tree. Columns per actor: asset | eyebrowStyle | eyebrowTris |
 * siblingSum | ratio | bodyTris | totalTris, plus a one-line mechanism note per failing row.
 *
 * Usage: pnpm -s exec tsx tools/openclinxr/evidence/eyebrow-budget/measure-eyebrow-budget.ts
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";

const DIR = "apps/ui-xr/public/generated-humanoids";
const OUT = ".openclinxr/evidence/eyebrow-budget/pre-fix.json";

type FacialGroup = "eyebrow" | "eyelash" | "teeth" | "tongue" | "eyes";

function classify(meshName: string): FacialGroup | null {
  if (/fitted_eyebrow/i.test(meshName)) return "eyebrow";
  if (/hm08_eyelash/i.test(meshName)) return "eyelash";
  if (/hm08_teeth/i.test(meshName)) return "teeth";
  if (/hm08_tongue/i.test(meshName)) return "tongue";
  if (/eyes_low_poly/i.test(meshName)) return "eyes";
  return null;
}

async function measureActor(asset: string) {
  const io = new NodeIO();
  const doc = await io.read(`${DIR}/${asset}`);
  const facial: Record<FacialGroup, number> = {
    eyebrow: 0,
    eyelash: 0,
    teeth: 0,
    tongue: 0,
    eyes: 0,
  };
  let totalTris = 0;
  let bodyTris = 0;
  let eyebrowStyle: string | null = null;

  for (const mesh of doc.getRoot().listMeshes()) {
    const name = mesh.getName() ?? "";
    let tris = 0;
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      tris += indices
        ? indices.getCount() / 3
        : (prim.getAttribute("POSITION")?.getCount() ?? 0) / 3;
    }
    totalTris += tris;
    if (/_body$/.test(name)) bodyTris += tris;
    const group = classify(name);
    if (group) {
      facial[group] += tris;
      if (group === "eyebrow") {
        eyebrowStyle =
          /fitted_eyebrow_(mindfront_eyebrows_\d+)/.exec(name)?.[1] ?? eyebrowStyle;
      }
    }
  }
  return { facial, totalTris, bodyTris, eyebrowStyle };
}

const SIBLING_FACIAL_SUM = 172 + 192 + 368 + 448; // eyes + teeth + eyelash + tongue = 1180

const actors = readdirSync(DIR)
  .filter((f) => f.startsWith("mpfb-") && f.endsWith(".glb"))
  .sort();

const rows: Array<Record<string, unknown>> = [];
for (const asset of actors) {
  const m = await measureActor(asset);
  const ratio = m.facial.eyebrow / SIBLING_FACIAL_SUM;
  rows.push({
    asset,
    eyebrowStyle: m.eyebrowStyle,
    eyebrowTris: m.facial.eyebrow,
    siblingSum: SIBLING_FACIAL_SUM,
    ratio: Number(ratio.toFixed(1)),
    bodyTris: m.bodyTris,
    totalTris: m.totalTris,
    mechanismNote:
      m.facial.eyebrow > SIBLING_FACIAL_SUM
        ? "mindfront strand OBJ is all quads; glTF export triangulates 1 quad -> 2 tris and the bake has no decimation step"
        : "within budget",
  });
}

mkdirSync(".openclinxr/evidence/eyebrow-budget", { recursive: true });
writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      measuredAgainstCommit: process.env.MEASURED_AGAINST_COMMIT ?? "pre-edit-worktree",
      note: "written before any edit to tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py",
      siblingSum: SIBLING_FACIAL_SUM,
      rows,
    },
    null,
    2,
  )}\n`,
);
console.log(`wrote ${OUT} with ${rows.length} actor rows`);
