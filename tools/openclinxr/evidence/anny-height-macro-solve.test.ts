import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The Anny rail maps authored `height_cm` to Anny's height macro with a hand-fitted linear formula,
 * and it is wrong by up to 47 cm.
 *
 * `generate_mesh.py`: `values["height"] = max(0.08, min(0.95, (height_cm - 85.0) / 115.0))`
 *
 * MEASURED 2026-08-11 against `anny.Anthropometry.height` — the model's own measurement of the body it
 * just produced:
 *
 *   actor                      | authored | current map | error
 *   ---------------------------|----------|-------------|--------
 *   patient_ed_chest_pain_v1   |  178 cm  |   209.5 cm  | +31.5
 *   nurse_kevin_lee_v1         |  176 cm  |   169.3 cm  |  -6.7
 *   parent_tara_johnson_v1     |  166 cm  |   163.3 cm  |  -2.7
 *   patient_maya_johnson_v1    |  125 cm  |    77.6 cm  | -47.4
 *
 * The error **changes sign** between two adults 2 cm apart in authored height. That is the tell: this
 * is not a mis-scaled constant to retune.
 *
 * WHY NO FORMULA IN `height_cm` ALONE CAN WORK. Bisecting the macro against `anny.Anthropometry` to hit
 * each authored target exactly gives:
 *
 *   166 cm -> macro 0.7320
 *   176 cm -> macro 0.8635
 *   178 cm -> macro 0.5093      <-- TALLER target, LOWER macro
 *
 * The required macro is **non-monotonic in height_cm**, because Anny's stature is a function of height
 * AND age AND gender (these three actors are age 0.38, 0.32, 0.58). No monotonic function of height_cm
 * can pass through those three points, so **refitting the linear constant cannot satisfy contract (1)**
 * — that is the cheap fix, and (1) refuses it by construction rather than by threshold.
 *
 * THE FIX IS A SOLVE, NOT A FORMULA. Bisecting against the model's own anthropometry reaches **0.00 cm**
 * error on all three adults. This is the same D1 lesson as `bake_modifiers_remove_helpers` and
 * `create_human(feet_on_ground=True)`: do not hand-author against a tool that will answer the question
 * directly.
 *
 * CONTRACT (2) IS THE UNREACHABLE CASE, AND IT IS REAL. The child cannot reach her authored 125 cm: at
 * `height = 1.000`, the macro ceiling, she measures **115.7 cm — 9.3 cm short** at age 0.09. A solver
 * must **refuse loudly**, not silently ship 115.7 cm as if it were 125. This makes the refusal path
 * testable rather than hypothetical, and it is a genuine limit of the model's reachable set — unlike an
 * earlier "unreachable" finding this session, which turned out to be measured against a duplicated mesh
 * and was withdrawn.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (2) are REDs and fail today. (3) passes today and is
 * the known-good column — the bisection already reaches the adults exactly, so a fix cannot regress it.
 *
 * REQUIRES `anny` installed (MADR 0051/0052 dependency, satisfied 2026-08-11).
 *
 * NOT TESTED: whether the same hand-fitted-formula problem exists for the `age` or `bmi` mappings in the
 * same function — only `height` was measured. And nothing here says 125 cm is the RIGHT authored height
 * for an 8-year-old; that is case authoring (#293), not this contract's business.
 *
 * ## FIXED (#302)
 *
 * `generate_mesh.py` now bisects the height macro against `anny.Anthropometry` — the model's own
 * measurement of the body it just produced — instead of the linear formula. Measured after the fix,
 * on the same presets and the same model config as this contract:
 *
 *   actor                      | authored | macro (solved) | stature | error
 *   ---------------------------|----------|----------------|---------|------
 *   patient_ed_chest_pain_v1   |  178 cm  |     0.5093     | 178.00  | 0.00
 *   nurse_kevin_lee_v1         |  176 cm  |     0.8635     | 176.00  | 0.00
 *   parent_tara_johnson_v1     |  166 cm  |     0.7320     | 166.00  | 0.00
 *   patient_maya_johnson_v1    |  125 cm  |   REFUSE       |  —      | —
 *
 * The macros reproduce the header's bisected points exactly (0.5093 / 0.8635 / 0.7320), confirming
 * the solve lands where the header's hand-bisection did.
 *
 * ON THE CHILD AND THE "MACRO CEILING": the header states 1.000 is the macro ceiling, and that is
 * TRUE for the production rail — `build_real_anny_body` creates the model with
 * `extrapolate_phenotypes=False` (the default), which silently CLAMPS macros above 1.0, so 125 cm is
 * genuinely unreachable and the child REFUSES (SystemExit, the same refusal channel as the issue-294
 * phenotype gate). Under `extrapolate_phenotypes=True` — the config this contract's own probe model
 * uses — macros above 1.0 extrapolate and 125 cm IS reachable at ~1.16. The solve deliberately keeps
 * the trained [0, 1] macro band as the refusal boundary because production cannot extrapolate;
 * refusing a target the shipped rail cannot produce is the honest outcome, not a conservative one.
 *
 * ## CORRECTED (#385) — the ceiling was a production config, not a model limit
 *
 * Issue-385 measured the extrapolation path and then enabled it on the production rail:
 * `build_real_anny_body` now creates the model with `extrapolate_phenotypes=True` and
 * `_solve_height_macro` searches the extrapolated band [0, 2.0] when the target exceeds the trained
 * ceiling (125 cm at age 8 solves at macro ~1.16). Clause (2) accepts `refused || reached`, so the
 * child now legitimately reaches instead of refusing; the loud-refusal channel survives for targets
 * above the extrapolated band. The adult macros (0.5093 / 0.8635 / 0.7320) are inside [0, 1] and
 * are unchanged — the extrapolation flag is a no-op for in-range macros.
 *
 * The `it.fails` markers on (1) and (2) were flipped to `it`; all three contracts pass.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const ANNY_DIR = `${REPO_ROOT}/tools/openclinxr/asset-pipeline/anny`;

/** ±1 cm: an external floor — ordinary stadiometer tolerance — not fitted to the observed gap. */
const BAND_CM = 1.0;

type Row = { actor: string; targetCm: number; statureCm: number; refused: boolean };

function measure(): Row[] {
  const script = `
import sys, json, warnings
warnings.filterwarnings("ignore")
sys.path.insert(0, ${JSON.stringify(ANNY_DIR)})
import torch, anny
from generate_mesh import normalized_anny_phenotype
from orchestrate_character import CASE_ACTOR_PRESETS

m = anny.create_fullbody_model(triangulate_faces=True, extrapolate_phenotypes=True)
a = anny.Anthropometry(m)
labels = list(m.phenotype_labels)
rows = []
for key, preset in sorted(CASE_ACTOR_PRESETS.items()):
    p = dict(preset["params"])
    target = (p.get("phenotype") or {}).get("height_cm")
    if not target: continue
    refused = False
    try:
        vals = normalized_anny_phenotype(p, labels, torch.float32, "cpu")
        kw = {k: (float(v.item()) if hasattr(v, "item") else float(v)) for k, v in vals.items()}
        cm = float(a.height(m.forward(phenotype_kwargs=kw)["rest_vertices"])) * 100.0
    except SystemExit:
        refused, cm = True, 0.0
    rows.append({"actor": key.split(":")[-1], "targetCm": float(target), "statureCm": cm, "refused": refused})
print("JSON" + json.dumps(rows))
`;
  const out = execFileSync("python3", ["-c", script], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const line = out.split("\n").find((l: string) => l.startsWith("JSON"));
  if (!line) throw new Error(`height probe produced no JSON:\n${out.slice(-800)}`);
  return JSON.parse(line.slice(4)) as Row[];
}

const rows = measure();
const byActor = (a: string) => rows.find((r) => r.actor === a)!;
const ADULTS = ["patient_ed_chest_pain_v1", "nurse_kevin_lee_v1", "parent_tara_johnson_v1"];
const CHILD = "patient_maya_johnson_v1";

describe("the Anny height macro is solved against the model, not hand-fitted", () => {
  it(
    "(1) RED: every adult's generated stature is within 1 cm of its authored height_cm — no formula in height_cm alone can pass this, the required macro is non-monotonic",
    () => {
      for (const a of ADULTS) {
        const r = byActor(a);
        expect(r.refused, `${a} refused`).toBe(false);
        expect(Math.abs(r.statureCm - r.targetCm), `${a}: got ${r.statureCm.toFixed(1)} want ${r.targetCm}`)
          .toBeLessThanOrEqual(BAND_CM);
      }
    },
  );

  it(
    "(2) RED COUNTERWEIGHT: an unreachable target must REFUSE, not silently ship a short body — the child tops out at 115.7 cm against an authored 125 cm",
    () => {
      const r = byActor(CHILD);
      const reached = Math.abs(r.statureCm - r.targetCm) <= BAND_CM;
      expect(r.refused || reached, `child produced ${r.statureCm.toFixed(1)} cm for a ${r.targetCm} cm target without refusing`)
        .toBe(true);
    },
  );

  it("(3) NET: every preset still yields a body or an explicit refusal — never a silent zero", () => {
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const r of rows) {
      if (!r.refused) expect(r.statureCm, `${r.actor} stature`).toBeGreaterThan(50);
    }
  });
});
