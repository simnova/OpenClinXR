import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **Every child phenotype in the bank is unbuildable on the Anny rail. Every adult builds.**
 *
 * Measured 2026-08-14 against `generate_mesh.build_source_body({"phenotype": ...})`, all four
 * exported phenotypes:
 *
 *   actor                     | authored | result   | body hash
 *   --------------------------|---------:|----------|-------------
 *   patient_maya_johnson_v1   |   125 cm | REFUSED  | -
 *   patient_noah_chen_v1      |   125 cm | REFUSED  | -
 *   parent_tara_johnson_v1    |   166 cm | BUILDS   | b203a3a97db2
 *   nurse_kevin_lee_v1        |   176 cm | BUILDS   | 6e926cada2b8
 *
 * The refusal is #302's height-macro guard, and it is loud and correct in form:
 *
 *   > REFUSE (issue-302): authored height_cm 125 cm is outside the reachable band
 *   > **[57.2, 115.7] cm** on Anny's height macro (0..1) for this age/gender/build.
 *
 * **The band tops out at 115.7 cm for an 8-year-old and the authored value is 125.** There is no
 * value a school-age child can take that both reaches the macro and stays plausible, so this is not
 * an authoring error — the reachable range does not contain the case.
 *
 * ## THE KNOWN-GOOD IS THE OTHER RAIL, MEASURED ON THE SAME PHENOTYPES (SS9h)
 *
 * `solve_height_macro_from_stature` (`body_param_stage.py:2008`, #329) solves the identical authored
 * values against MPFB:
 *
 *   nurse  176.0 -> 175.56  (0.44 cm)   band [136.85, 242.59]
 *   parent 166.0 -> 165.99  (**0.01 cm**) band [123.38, 228.61]
 *   child  125.0 -> 124.82  (0.18 cm)   band [**82.54, 162.95**]
 *
 * So the target is not exotic and the tolerance is not invented: **a sibling rail in this repo hits
 * all three to under half a centimetre, and its band contains the case by 38 cm.** The 2 cm bound in
 * clause (1) is 4.5x looser than the worst MPFB error, chosen so this contract cannot be satisfied
 * only by matching MPFB's precision.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                          | (1) child builds | (2) authored kept | (3) adults intact | result
 *   ----------------------------------------------------|------------------|-------------------|-------------------|--------
 *   a) today                                           |    **FAIL**      |       pass        |       pass        | REFUSED
 *   b) lower authored height_cm to fit the band        |      pass        |     **FAIL**      |       pass        | REFUSED
 *   c) drop the refusal and ship whatever the macro gives |   pass        |       pass        |     **FAIL**      | REFUSED
 *   d) make 125 cm reachable on the solve              |      pass        |       pass        |       pass        | ALL PASS
 *
 * **(b) is the one to watch, and the refusal message itself proposes it** — *"Author a reachable
 * height_cm"*. Shortening a patient to fit a generator falsifies the phenotype to satisfy the tool.
 * It is SS7a in its worst form: the quantity being bent is a patient's stature. Clause (2) pins the
 * authored values.
 *
 * **(c) is why clause (1) asserts a MEASURED stature and not merely "did not refuse".** Deleting the
 * guard makes `build_source_body` return a body for any input, and #302 exists precisely because the
 * silent alternative was shipping a short child. A presence check would grade that as fixed.
 *
 * **(3) keeps the two adults building byte-identically**, so the band cannot be widened by moving the
 * whole macro mapping.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the sole RED and fails today on both children.
 * (2) and (3) pass today. They are independent of what (1) measures — reaching a child's stature
 * cannot rewrite an authored fixture or move an adult's body hash unless done by (b) or (c).
 *
 * NOT TESTED:
 *   - **Why the band tops out at 115.7 cm.** I read the refusal, not the solve. It may be a macro
 *     clamp, an anthropometry table, or a unit error, and I did not look. If it turns out to be
 *     unreachable by construction, say so and STOP — that is a finding, not a failure.
 *   - **BMI.** Only stature is asserted. A waist-girth proxy previously returned an anatomically
 *     impossible result and no BMI claim is made here either way.
 *   - **That the Anny child SHOULD be fixed rather than routed to MPFB.** D11 splits the rails by job
 *     and MPFB already builds this body. This contract measures a gap; it does not argue the gap must
 *     be closed on this rail.
 *   - **Any clinical claim.** 125 cm is the authored value in the fixture. This asserts it is
 *     unreachable, never that it is the correct stature for an 8-year-old.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const ANNY_DIR = `${REPO_ROOT}/tools/openclinxr/asset-pipeline/anny`;
/** Overridable so a destructive probe can point the same logic at a doctored export. */
const EXPORT =
  process.env.OPENCLINXR_ANNY_PROBE_EXPORT ??
  "packages/openclinxr/scenario-fixtures/generated/actor-phenotype.v1.json";

/** 4.5x looser than MPFB's worst error on the same three phenotypes. */
const MAX_STATURE_ERROR_CM = 2.0;

/** Authored values that must survive. Bending these is treatment (b). */
const AUTHORED: Record<string, number> = {
  patient_maya_johnson_v1: 125,
  patient_noah_chen_v1: 125,
  parent_tara_johnson_v1: 166,
  nurse_kevin_lee_v1: 176,
};
/** Adults that build today, with the hashes clause (3) pins. */
const ADULT_HASHES: Record<string, string> = {
  parent_tara_johnson_v1: "b203a3a97db2",
  nurse_kevin_lee_v1: "6e926cada2b8",
};
const CHILDREN = ["patient_maya_johnson_v1", "patient_noah_chen_v1"];

type Row = {
  actorId: string;
  authoredHeightCm: number | null;
  refused: boolean;
  hash: string | null;
  statureCm: number | null;
};

function buildAll(): Row[] {
  const script = `
import sys, json, hashlib
sys.path.insert(0, ${JSON.stringify(ANNY_DIR)})
import generate_mesh as gm
exp = json.load(open(${JSON.stringify(EXPORT)}))
rows = []
for scenario, actors in exp.get("entries", {}).items():
    for actor, body in actors.items():
        ph = body.get("phenotype")
        if not ph:
            continue
        row = {"actorId": actor, "authoredHeightCm": ph.get("height_cm"),
               "refused": False, "hash": None, "statureCm": None}
        try:
            mesh = gm.build_source_body({"phenotype": ph})
            row["hash"] = hashlib.sha256(repr(mesh).encode()).hexdigest()[:12]
            ys = None
            for attr in ("vertices", "verts", "co"):
                if hasattr(mesh, attr):
                    ys = [v[1] for v in getattr(mesh, attr)]
                    break
            if ys:
                row["statureCm"] = (max(ys) - min(ys)) * 100.0
        except SystemExit:
            row["refused"] = True
        rows.append(row)
print(json.dumps(rows))
`;
  const out = execFileSync("python3", ["-c", script], { cwd: REPO_ROOT, encoding: "utf8" });
  return JSON.parse(out.trim().split("\n").pop()!) as Row[];
}

const rows = buildAll();
const byId = new Map(rows.map((r) => [r.actorId, r]));

/**
 * An empty enumeration must FAIL, never pass vacuously (SS7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireMeasured(): void {
  expect(rows.length, `exported phenotypes run through build_source_body (4 measured 2026-08-14)`)
    .toBeGreaterThanOrEqual(4);
  for (const id of CHILDREN) expect(byId.has(id), `${id} present in ${EXPORT}`).toBe(true);
}

describe("the Anny rail builds a school-age child", () => {
  it.fails("(1) RED: every authored child phenotype produces a body at its authored stature", () => {
    requireMeasured();
    const failures: string[] = [];
    for (const id of CHILDREN) {
      const r = byId.get(id)!;
      if (r.refused) {
        failures.push(`${id}: REFUSED — authored ${r.authoredHeightCm} cm is outside Anny's reachable band [57.2, 115.7] for this age/gender/build (#302). MPFB solves the same phenotype to 0.18 cm.`);
        continue;
      }
      // Not merely "did not refuse" — treatment (c) deletes the guard and ships a short body.
      if (r.statureCm === null) {
        failures.push(`${id}: built but no stature could be measured — a body that cannot be measured cannot be claimed`);
      } else if (Math.abs(r.statureCm - (r.authoredHeightCm ?? 0)) > MAX_STATURE_ERROR_CM) {
        failures.push(`${id}: built at ${r.statureCm.toFixed(1)} cm against authored ${r.authoredHeightCm} cm — beyond ${MAX_STATURE_ERROR_CM} cm. Removing the refusal without fixing the solve is exactly what #302 exists to prevent.`);
      }
    }
    expect(failures, "authored child phenotypes that do not build at their authored stature").toEqual([]);
  });

  it("(2) COUNTERWEIGHT: the authored height_cm values are not lowered to fit the generator", () => {
    // Refuses (b), which the refusal message itself proposes ("Author a reachable height_cm").
    // Shortening a patient to satisfy a tool is SS7a with a patient's stature as the bent quantity.
    requireMeasured();
    const drift: string[] = [];
    for (const [id, cm] of Object.entries(AUTHORED)) {
      const r = byId.get(id);
      if (!r) continue;
      if (r.authoredHeightCm !== cm) {
        drift.push(`${id}.height_cm is ${r.authoredHeightCm}, authored value was ${cm}`);
      }
    }
    expect(drift, "authored stature rewritten to fit the reachable band").toEqual([]);
  });

  it("(3) COUNTERWEIGHT: the two adults that build today keep building, byte-identically", () => {
    // Refuses widening the band by moving the whole macro mapping, and refuses (c) — deleting the
    // guard would also change what the adults produce.
    requireMeasured();
    const moved: string[] = [];
    for (const [id, hash] of Object.entries(ADULT_HASHES)) {
      const r = byId.get(id);
      if (!r) { moved.push(`${id} missing from the export`); continue; }
      if (r.refused) moved.push(`${id} now REFUSES — it built before`);
      else if (r.hash !== hash) moved.push(`${id} body hash ${r.hash}, was ${hash}`);
    }
    expect(moved, "adult bodies changed while reaching for the child's stature").toEqual([]);
  });
});
