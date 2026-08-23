/**
 * #576 pre-fix measurement — runs the CURRENT code paths (resolveScenarioActorCast +
 * buildActorPhenotypeExport + the plant's own band-profile algorithm) against the SHIPPED
 * bytes, before any product edit. One mechanism line per failing row, not only counts.
 *
 * RUN: pnpm -s exec tsx .openclinxr/evidence/issue-576/generate-pre-fix.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import {
  listShippedCastScenarioIds,
  resolveScenarioActorCast,
} from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";
import { buildActorPhenotypeExport } from "../../../packages/openclinxr/scenario-fixtures/src/actor-phenotype-export.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = pathResolve(HERE, "../../..");

const DECLARING_SCENARIO = "peds_asthma_parent_anxiety_v1";
const DECLARING_ACTOR = "parent_tara_johnson_v1";
const UNDECLARED_SCENARIO = "ob_headache_preeclampsia_triage_v1";
const UNDECLARED_ACTOR = "patient_aisha_khan_v1";
const NON_BODY = /hidden|makeclothes|garment|toigo|boot|shoe|scalp|hair|eyelash|eyebrow|teeth|tongue|eyes/iu;
const PROFILE_BANDS = 20;

type Attr = { getCount(): number; getElement(i: number, target: number[]): number[] };
type Body = { assetPath: string; meshName: string; vertexCount: number; statureMeters: number; profile: number[] };

async function measureBody(assetPath: string): Promise<Body> {
  const doc = await new NodeIO().read(join(REPO, assetPath));
  let best: Attr | null = null;
  let bestCount = 0;
  let meshName = "";
  for (const mesh of doc.getRoot().listMeshes()) {
    const mn = mesh.getName() ?? "";
    for (const prim of mesh.listPrimitives()) {
      const matName = prim.getMaterial()?.getName() ?? "";
      if (NON_BODY.test(mn) || NON_BODY.test(matName)) continue;
      const pos = prim.getAttribute("POSITION") as Attr | null;
      if (pos && pos.getCount() > bestCount) { bestCount = pos.getCount(); best = pos; meshName = mn; }
    }
  }
  if (!best) throw new Error(`no body primitive in ${assetPath}`);
  const pts: number[][] = [];
  for (let i = 0; i < best.getCount(); i += 1) pts.push(best.getElement(i, [0, 0, 0]));
  const ys = pts.map((v) => v[1]!);
  const lo = Math.min(...ys);
  const stature = Math.max(...ys) - lo;
  const profile: number[] = [];
  for (let k = 0; k < PROFILE_BANDS; k += 1) {
    const band = pts
      .filter((v) => { const f = (v[1]! - lo) / stature; return f >= k / PROFILE_BANDS && f < (k + 1) / PROFILE_BANDS; })
      .map((v) => Math.abs(v[0]!));
    profile.push(band.length ? (2 * Math.max(...band)) / stature : 0);
  }
  return { assetPath, meshName, vertexCount: bestCount, statureMeters: stature, profile };
}

function castAssetPath(scenarioId: string, actorId: string): string {
  const row = resolveScenarioActorCast(scenarioId).find((c) => c.actorId === actorId);
  if (!row) throw new Error(`${actorId} is not cast in ${scenarioId}`);
  return row.assetPath;
}

const ex = buildActorPhenotypeExport();
const declaringPhenotype = ex.entries[DECLARING_SCENARIO]?.[DECLARING_ACTOR]?.phenotype ?? null;
const undeclaredPhenotype = ex.entries[UNDECLARED_SCENARIO]?.[UNDECLARED_ACTOR]?.phenotype ?? null;

const tara = await measureBody(castAssetPath(DECLARING_SCENARIO, DECLARING_ACTOR));
const aisha = await measureBody(castAssetPath(UNDECLARED_SCENARIO, UNDECLARED_ACTOR));

const WARDROBE_CARVED_BANDS = 1;
const perBandDelta = tara.profile.map((v, i) => Math.abs(v - aisha.profile[i]!));
const maxDeltaAllBands = Math.max(...perBandDelta);
const maxDeltaAboveAnkle = Math.max(...perBandDelta.slice(WARDROBE_CARVED_BANDS));

// Distinct cast-reachable MPFB body meshes — the counterweight baseline.
const paths = new Set<string>();
for (const scenarioId of listShippedCastScenarioIds()) {
  for (const row of resolveScenarioActorCast(scenarioId)) {
    if (/\/mpfb-/u.test(row.assetPath)) paths.add(row.assetPath);
  }
}
const meshNames = new Set<string>();
const statures: Record<string, number> = {};
for (const p of paths) {
  const b = await measureBody(p);
  meshNames.add(b.meshName);
  statures[p] = Number(b.statureMeters.toFixed(6));
}

const out = {
  slice: "issue-576",
  measuredAt: new Date().toISOString(),
  head: "650d66eb (worktree HEAD at measurement)",
  instrument: "same band-profile algorithm as a-declared-body-shape-reaches-the-baked-body.test.ts",
  input: {
    declaringActor: DECLARING_ACTOR,
    declaringScenario: DECLARING_SCENARIO,
    declaringPhenotype,
    undeclaredActor: UNDECLARED_ACTOR,
    undeclaredScenario: UNDECLARED_SCENARIO,
    undeclaredPhenotype,
  },
  bodies: {
    declaring: { assetPath: tara.assetPath, meshName: tara.meshName, vertexCount: tara.vertexCount, statureMeters: tara.statureMeters },
    undeclared: { assetPath: aisha.assetPath, meshName: aisha.meshName, vertexCount: aisha.vertexCount, statureMeters: aisha.statureMeters },
  },
  deltas: {
    maxProfileDeltaAllBands: maxDeltaAllBands,
    maxProfileDeltaAboveAnkle: maxDeltaAboveAnkle,
    statureDelta: Math.abs(tara.statureMeters - aisha.statureMeters),
    perBand: perBandDelta,
  },
  failingRows: [
    {
      row: "(1) tara (declared bmi 24/build average_parent/adult_female_parent/height_cm 166) vs aisha (no phenotype) share a body to six decimals",
      measured: `max profile delta above ankle ${maxDeltaAboveAnkle}; stature delta ${Math.abs(tara.statureMeters - aisha.statureMeters)}; both meshes ${tara.meshName}`,
      mechanism:
        "tara's shipped bake passed no --reference (mpfb-peds-parent-aisha.provenance.json sourceNotes #519 invocation), so materialize_mpfb_humanoid_candidate.py main() took the else branch at :2694: HumanService.create_human(feet_on_ground=True) with macro_detail_dict=None -> MPFB TargetService.get_default_macro_info_dict (gender/age/muscle/weight/proportions all 0.5). derive_macro_dict(:1862) and solve_height_macro(:1971) NEVER RAN on this actor; the manifest's numeric block (height_cm/bmi/build/gender_presentation) is read by nothing on this rail — materialize consumes phenotype only for skin_tone(:170)/fabricPalette(:191)/eye_color(:213). aisha has no manifest at all, so the same default-macro path produced her body. Identical inputs -> identical body.",
    },
  ],
  counterweightBaseline: {
    distinctCastReachableMpfbAssets: paths.size,
    distinctBodyMeshes: meshNames.size,
    statures,
  },
};

mkdirSync(join(REPO, ".openclinxr/evidence/issue-576"), { recursive: true });
const outPath = join(REPO, ".openclinxr/evidence/issue-576/pre-fix.json");
writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.log(`WROTE ${outPath}`);
console.log(`maxDeltaAboveAnkle=${maxDeltaAboveAnkle} maxAllBands=${maxDeltaAllBands} meshes=${meshNames.size}`);
