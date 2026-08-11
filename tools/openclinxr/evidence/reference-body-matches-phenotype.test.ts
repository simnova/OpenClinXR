import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { extractLandmarks } from "./anny-mpfb-landmark-compare.ts";

/**
 * A tracked Anny reference is supposed to BE its actor's authored phenotype. Two of them are not —
 * they are somebody else's body, shared.
 *
 * MEASURED 2026-08-11. Content hashes of the seven tracked `.anny_base.obj` references collapse to
 * **three distinct bodies**:
 *
 *   46a6ca8fa552  x4  adult_male_street_casual, ed_chest_pain_adult_cast,
 *                     ed_chest_pain_nurse_adult, peds_nurse_kevin
 *   f704763db502  x2  ed_chest_pain_spouse_adult, peds_anxious_parent
 *   d235a2ec923f  x1  peds_patient_child            <- the only genuinely distinct one
 *
 * CAUSE, located and deliberate: `rebake_role_wardrobe_blender_only.py` hardcodes a role->base map
 * (`:138`, `:203`, `:267`, `:393`, `:459`) — its own docstring says so. It was a shortcut taken when
 * `import anny` failed. **That precondition expired 2026-08-11 when anny 0.6.0 was installed.**
 *
 * WHY THIS CONTRACT ASSERTS ON WAIST AND NOT ON STATURE OR HASHES. Three candidate assertions were
 * measured first and all three are VACUOUS — they pass on the broken tree:
 *
 *   - stature: shipped references are ALREADY exact (176.0 / 166.0 / 125.0 cm vs authored)
 *   - cross-pair girth: the two shared bodies already differ from each other (0.7347 vs 0.7167)
 *   - "seven distinct hashes": cannot pass, only four of seven actors have a preset to generate from
 *
 * The one axis that separates a correct body from a borrowed one is whether the body matches ITS OWN
 * actor's phenotype:
 *
 *   actor                 | shipped waist | phenotype predicts | delta   | band +/-0.02
 *   ----------------------|---------------|--------------------|---------|-------------
 *   peds_anxious_parent   |    0.7167     |       0.6840       | +0.0327 | **OUTSIDE**
 *   peds_nurse_kevin      |    0.7347     |       0.7493       | -0.0146 | inside
 *
 * So (1) is a genuine RED and (2) is a genuine known-good column that passes today — the nurse's shared
 * body happens to sit within tolerance of her own phenotype, the parent's does not. A fix must move the
 * parent without pushing the nurse out.
 *
 * THE CHEAP FIX THIS CONTRACT REFUSES: scaling the parent's mesh until the waist number lands, without
 * generating from phenotype.
 *
 * **My first counterweight was a hash comparison and the probe DEFEATED it.** A lateral scale of 0.954
 * hits the waist target AND changes the file hash, so a "must not be byte-identical to the spouse"
 * assertion passes on a mesh that is still a tuned copy. Any perturbation satisfies a hash check.
 *
 * The replacement asserts on THREE landmarks at once, which a uniform scale cannot satisfy — measured:
 *
 *   parent          | chest  | waist  | hip
 *   ----------------|--------|--------|--------
 *   anny predicts   | 0.7984 | 0.6692 | 0.9067
 *   shipped         | 0.8598 | 0.7167 | 0.8856
 *   lateral scale   | 0.8205 | 0.6840 | 0.8451   <- the cheap fix
 *   scaled vs pred  | 0.0222 | 0.0147 | 0.0615   <- chest and hip OUTSIDE the 0.02 band
 *
 * A uniform scale shrinks everything together, but the real phenotype wants a SMALLER chest and a
 * LARGER hip. The scale therefore lands waist and pushes hip out by 6.2 cm. Note also that the shipped
 * body is 2.1 cm off on hip in the OPPOSITE direction from its waist error — further evidence it is a
 * borrowed body rather than a mis-tuned one.
 *
 * BAND: +/-2 cm, MADR 0051 section 5 — ordinary between-observer tape tolerance. An external floor, not
 * fitted to the observed 3.3 cm gap.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (3) are REDs and fail today. (2) passes today and is
 * the known-good column.
 *
 * REQUIRES `anny` installed (MADR 0052 dependency, satisfied 2026-08-11), because the predicted waist
 * comes from the model rather than a pinned constant — pinned float constants have already produced one
 * false red in this repo (#302 close).
 *
 * NOT TESTED: the other four duplicated actors (`adult_male_street_casual`, `ed_chest_pain_adult_cast`,
 * `ed_chest_pain_nurse_adult`, `ed_chest_pain_spouse_adult`) have **no preset**, so there is nothing to
 * generate them from — that is #293's authoring gap, not this contract's business. Nothing here claims
 * the parent's authored phenotype is clinically right, only that her body should match it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const GEN = `${REPO_ROOT}/apps/ui-xr/public/generated-humanoids`;
const ANNY_DIR = `${REPO_ROOT}/tools/openclinxr/asset-pipeline/anny`;

/** MADR 0051 §5 — tape-measurement tolerance, external to this measurement. */
const BAND_M = 0.02;

type Torso = { chest: number; waist: number; hip: number };

function shippedTorso(name: string): Torso {
  const L = extractLandmarks(name, readFileSync(`${GEN}/${name}.anny_base.obj`, "utf8")) as unknown as Record<string, number>;
  return { chest: L["chestGirthMeters"]!, waist: L["waistGirthMeters"]!, hip: L["hipGirthMeters"]! };
}

function shippedWaist(name: string): number {
  return shippedTorso(name).waist;
}

function fileHash(name: string): string {
  return createHash("sha256").update(readFileSync(`${GEN}/${name}.anny_base.obj`)).digest("hex").slice(0, 12);
}

/** Ask anny what this actor's phenotype should produce — the model, not a pinned constant. */
function predictedWaist(actorId: string): number {
  const script = `
import sys, json, warnings
warnings.filterwarnings("ignore")
sys.path.insert(0, ${JSON.stringify(ANNY_DIR)})
import torch, anny
from generate_mesh import normalized_anny_phenotype
from orchestrate_character import CASE_ACTOR_PRESETS
m = anny.create_fullbody_model(triangulate_faces=True, extrapolate_phenotypes=True)
a = anny.Anthropometry(m); labels = list(m.phenotype_labels)
for k, p in CASE_ACTOR_PRESETS.items():
    if k.split(":")[-1] != ${JSON.stringify(actorId)}: continue
    v = normalized_anny_phenotype(dict(p["params"]), labels, torch.float32, "cpu")
    kw = {x: (float(y.item()) if hasattr(y, "item") else float(y)) for x, y in v.items()}
    print("JSON" + json.dumps({"waist": float(a.waist_circumference(m.forward(phenotype_kwargs=kw)["rest_vertices"]))}))
    break
`;
  const out = execFileSync("python3", ["-c", script], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const line = out.split("\n").find((l: string) => l.startsWith("JSON"));
  if (!line) throw new Error(`no prediction for ${actorId}:\n${out.slice(-600)}`);
  return (JSON.parse(line.slice(4)) as { waist: number }).waist;
}

/** Chest/waist/hip anny predicts for this actor, measured through the same instrument as the shipped body. */
function predictedTorso(actorId: string): Torso {
  const script = `
import sys, json, warnings, numpy as np
warnings.filterwarnings("ignore")
sys.path.insert(0, ${JSON.stringify(ANNY_DIR)})
import torch, anny
from generate_mesh import normalized_anny_phenotype
from orchestrate_character import CASE_ACTOR_PRESETS
m = anny.create_fullbody_model(triangulate_faces=True, extrapolate_phenotypes=True)
labels = list(m.phenotype_labels)
for k, p in CASE_ACTOR_PRESETS.items():
    if k.split(":")[-1] != ${JSON.stringify(actorId)}: continue
    v = normalized_anny_phenotype(dict(p["params"]), labels, torch.float32, "cpu")
    kw = {x: (float(y.item()) if hasattr(y, "item") else float(y)) for x, y in v.items()}
    V = m.forward(phenotype_kwargs=kw)["rest_vertices"].detach().cpu().numpy().squeeze()
    R = np.array([[1,0,0],[0,0,1],[0,-1,0]], float); Vy = V @ R.T; Vy[:,1] -= Vy[:,1].min()
    F = m.faces.detach().cpu().numpy() if hasattr(m.faces, "detach") else np.asarray(m.faces)
    with open("/tmp/_pred_torso.obj", "w") as f:
        for a2,b2,c2 in Vy: f.write("v %.6f %.6f %.6f\\n" % (a2,b2,c2))
        for t in F: f.write("f %d %d %d\\n" % (t[0]+1, t[1]+1, t[2]+1))
    print("JSONOK")
    break
`;
  execFileSync("python3", ["-c", script], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const L = extractLandmarks("pred", readFileSync("/tmp/_pred_torso.obj", "utf8")) as unknown as Record<string, number>;
  return { chest: L["chestGirthMeters"]!, waist: L["waistGirthMeters"]!, hip: L["hipGirthMeters"]! };
}

describe("a tracked Anny reference matches its own actor's phenotype", () => {
  it("(1) RED: peds_anxious_parent's waist is within 2 cm of what her phenotype predicts", () => {
    const got = shippedWaist("peds_anxious_parent");
    const want = predictedWaist("parent_tara_johnson_v1");
    expect(Math.abs(got - want), `shipped ${got.toFixed(4)} vs predicted ${want.toFixed(4)}`)
      .toBeLessThanOrEqual(BAND_M);
  });

  it("(2) NET known-good: peds_nurse_kevin is already within 2 cm — a fix must not push him out", () => {
    const got = shippedWaist("peds_nurse_kevin");
    const want = predictedWaist("nurse_kevin_lee_v1");
    expect(Math.abs(got - want), `shipped ${got.toFixed(4)} vs predicted ${want.toFixed(4)}`)
      .toBeLessThanOrEqual(BAND_M);
  });

  it(
    "(3) RED COUNTERWEIGHT: chest AND hip also match the phenotype — a uniform scale that lands the waist pushes hip out by 6.2 cm",
    () => {
      const pred = predictedTorso("parent_tara_johnson_v1");
      const got = shippedTorso("peds_anxious_parent");
      for (const k of ["chest", "hip"] as const) {
        expect(Math.abs(got[k] - pred[k]), `${k}: shipped ${got[k].toFixed(4)} vs predicted ${pred[k].toFixed(4)}`)
          .toBeLessThanOrEqual(BAND_M);
      }
      // and it must genuinely stop being the spouse's mesh
      expect(fileHash("peds_anxious_parent")).not.toBe(fileHash("ed_chest_pain_spouse_adult"));
    },
  );
});
