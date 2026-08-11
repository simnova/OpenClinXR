import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The Anny rail's gender mapping is INVERTED and COMPRESSED against Anny's own axis.
 *
 * MEASURED 2026-08-11 by rendering both ends of the axis and by `anny.Anthropometry`:
 * **Anny's gender parameter runs 0 = MALE, 1 = FEMALE** — the opposite of the MakeHuman convention the
 * rest of this repo uses (`body-param-cli.ts:112` `BODY_CLASSES` has `adult_lean_female` at
 * `gender: 0.0`). `gender=0.0` renders a flat-chested, broader-shouldered 1.898 m male; `gender=1.0`
 * renders a 1.780 m female with breasts. The parameter names give no hint and both ends measure
 * plausibly, so this is only visible in pixels.
 *
 * `generate_mesh.py:307` maps:
 *
 *     values["gender"] = 0.18 if ("female" in gender_presentation or role == "parent")
 *                        else 0.08 if role == "nurse"
 *                        else 0.35
 *
 * Measured at age=0.5 muscle=0.5 height=0.5 weight=0.5:
 *
 *   label                  | gender | stature | waist
 *   -----------------------|--------|---------|-------
 *   nurse                  |   0.08 |  1.6764 | 0.7679
 *   female / parent        |   0.18 |  1.6643 | 0.7552
 *   default (male)         |   0.35 |  1.6437 | 0.7348
 *   --- true male          |   0.00 |  1.6861 | 0.7784
 *   --- true female        |   1.00 |  1.5683 | 0.6711
 *
 * TWO DEFECTS:
 *
 * 1. **Inverted.** On an axis where higher = more female, "female" maps to 0.18 and the male default
 *    maps to 0.35 — so the MALE default is rendered MORE FEMALE than the female presentation.
 * 2. **Compressed.** The three values actually used span 0.0327 m of stature and 0.0331 m of waist,
 *    against 0.1177 m / 0.1073 m available across the full axis — about 28% of the sexual dimorphism
 *    Anny can express. This is a contributor to the standing "every actor looks like the same person"
 *    problem (#276: six humanoids became one body).
 *
 * THE CHEAP FIX THIS CONTRACT REFUSES: swapping the two constants. That fixes the direction and leaves
 * the compression untouched — female=0.35 / male=0.18 gives |Δstature| = 0.0206 m, identical to today's
 * 0.0206 m because it is the same pair of numbers. Contract (2) refuses it.
 *
 * THRESHOLD DERIVATION (not fitted): contract (2) requires the female/male pair to span at least
 * **half of Anny's own achievable stature dimorphism**, 0.1177 / 2 = 0.0589 m. The reference is the
 * MODEL'S CAPABILITY, measured across the full axis and independent of whatever mapping is chosen — not
 * a fraction of the observed gap, which would pass by construction.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (2) are REDs and fail today. (3) passes today and
 * is a net — a fix must not push macro values outside the model's valid range to buy separation.
 *
 * NOT TESTED: whether Anny's axis direction is itself documented anywhere upstream (it was determined
 * empirically here, from two renders and the anthropometry, not from Anny's documentation); whether the
 * same inversion exists in `automate_blender.py` or the body-param rail, which use their own mappings;
 * and whether 0.5 is the right value for a role with no stated sex, which is a case-authoring question
 * and deliberately not decided by this contract.
 *
 * ## FIXED (#299)
 *
 * `generate_mesh.py:307` now maps the authored presentation onto Anny's own axis:
 *
 *     values["gender"] = 0.85 if "female" in gender_presentation
 *                        else 0.15 if "male" in gender_presentation
 *                        else 0.5
 *
 * Direction fixed — female (0.85) now maps HIGHER than male (0.15). Compression fixed — the pair spans
 * 0.70 of the axis instead of 0.17, and the measured stature delta at age=muscle=height=weight=0.5 is
 * |1.5857 − 1.6679| = 0.0822 m, above the 0.0589 m floor with 1.4× margin. The role special-casing
 * (nurse → 0.08, parent → female) is removed: every authored preset in `orchestrate_character.py` and
 * `rebake_role_wardrobe_blender_only.py` carries an explicit `gender_presentation` marker
 * (`adult_female_parent`, `adult_male_nurse`, `adult_male`, `child`), so no shipped asset changes
 * meaning; a role with no stated sex now gets the neutral 0.5.
 *
 * PROOF-FIX (was "cannot pass as written"): the original `ANNY_DIR` hardcoded the main checkout
 * (`/Volumes/files/src/openclinxr/...`), so re-running this test inside a worker worktree — which is
 * exactly what the contract proof does — kept exercising MAIN's stale mapping and could never turn
 * green from a worktree edit. It is now resolved relative to this test file (`../../..`), the same
 * correction #294 made for the identical defect. All numbers in the measured table above are untouched.
 */

const HERE = resolve(fileURLToPath(import.meta.url), "..");
const REPO_ROOT = resolve(HERE, "../../..");

// Tree-relative so the contract proof re-runs against the WORKTREE it runs in, not
// the main checkout (see ## FIXED (#299) below — same defect #294 fixed).
const ANNY_DIR = `${REPO_ROOT}/tools/openclinxr/asset-pipeline/anny`;

/** Half of Anny's measured full-axis stature dimorphism (0.1177 m). External to the mapping. */
const MIN_SEPARATION_M = 0.0589;

type Row = { gender: number; stature: number };

/** Drive the REAL mapping and the REAL model — no re-implementation of either. */
function measure(): { female: Row; male: Row; nurse: Row } {
  const script = `
import sys, json, warnings
warnings.filterwarnings("ignore")
sys.path.insert(0, ${JSON.stringify(ANNY_DIR)})
import torch, anny
from generate_mesh import normalized_anny_phenotype

m = anny.create_fullbody_model(triangulate_faces=True, extrapolate_phenotypes=True)
a = anny.Anthropometry(m)
labels = list(m.phenotype_labels)

def gender_for(pres, role):
    params = {"role": role, "phenotype": {"gender_presentation": pres, "height_cm": 170, "age": 45}}
    vals = normalized_anny_phenotype(params, labels, torch.float32, "cpu")
    g = vals["gender"]
    return float(g.item() if hasattr(g, "item") else g)

def stature(g):
    out = m.forward(phenotype_kwargs=dict(gender=g, age=0.5, muscle=0.5, height=0.5, weight=0.5))
    return float(a.height(out["rest_vertices"]))

res = {}
for key, pres, role in (("female","female","patient"), ("male","male","patient"), ("nurse","female","nurse")):
    g = gender_for(pres, role)
    res[key] = {"gender": g, "stature": stature(g)}
print("JSON" + json.dumps(res))
`;
  const out = execFileSync("python3", ["-c", script], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const line = out.split("\n").find((l: string) => l.startsWith("JSON"));
  if (!line) throw new Error(`mapping probe produced no JSON line:\n${out.slice(-800)}`);
  return JSON.parse(line.slice(4)) as { female: Row; male: Row; nurse: Row };
}

const measured = measure();

describe("the Anny rail's gender mapping matches Anny's own axis", () => {
  it("(1) RED: a female presentation maps HIGHER than male on Anny's axis, where 1 = female", () => {
    expect(measured.female.gender).toBeGreaterThan(measured.male.gender);
  });

  it(
    "(2) RED COUNTERWEIGHT: female and male bodies differ by at least half Anny's achievable stature dimorphism — swapping the constants does not satisfy this",
    () => {
      expect(Math.abs(measured.female.stature - measured.male.stature)).toBeGreaterThanOrEqual(MIN_SEPARATION_M);
    },
  );

  it("(3) NET: every mapped gender value stays inside the model's valid 0..1 range", () => {
    for (const row of [measured.female, measured.male, measured.nurse]) {
      expect(row.gender).toBeGreaterThanOrEqual(0);
      expect(row.gender).toBeLessThanOrEqual(1);
    }
  });
});
