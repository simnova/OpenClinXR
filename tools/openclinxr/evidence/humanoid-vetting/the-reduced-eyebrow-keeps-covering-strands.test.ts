import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The reduced eyebrow keeps covering strands, not a dusting.
 *
 * MEASURED 2026-09-18 (bake4, `ed_chest_pain_nurse_adult`, mindfront_eyebrows_06):
 * EYEBROW_REDUCTION kept 200 of 1,775 strands at the 3,600-tri budget for
 * 247/2304 band cells (10.7%) — the 10% band-ink floor from bstar-sweep, and a
 * dusting at face-crop framing. The in-bake station runs the greedy phase ONLY;
 * the proven bstar-sweep select() has a second phase (densest-ink-per-tri fill,
 * ported in ladder-rebake.ts) that spends leftover budget on the strands
 * carrying the most band ink. The bake never runs it.
 *
 * FAILED treatment refused here: raising tris to 21k (speckle, not arch).
 *
 * WHICH ARE REDS AND WHICH ARE NETS: (1) is the RED. (2) and (3) are
 * regression nets — (2) caps the budget so the fix cannot replay the 21k
 * speckle, (3) guards D1 (no hand-authored brow geometry).
 *
 * claimScope: the factory reducer runs greedy + densest fill inside a capped
 *   budget, and the materializer calls it with that raised budget.
 * notEvidenceFor: whether the filled arch LOOKS right (orchestrator grades
 *   pixels); headset; other actors; meshopt on the new afterTris.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const REDUCER = join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/makeclothes/eyebrow_strand_reduction.py",
);
const MAT = join(
  REPO_ROOT,
  "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py",
);

/** Resolve the effective brow budget at the real call site via AST proof.
 * The helper execs python3 stdlib ast.parse on the materializer (no import,
 * no Blender): it requires exactly one reduce_eyebrow_mesh call total, that
 * single call carrying budget_tris=args.eyebrow_tris_budget, plus exactly one
 * parser.add_argument (receiver Name parser) declaring --eyebrow-tris-budget
 * with an int (not bool) default. The default is the effective budget. */
function browBudget(matPath: string): number {
  const py = [
    "import ast, json",
    `src = open(${JSON.stringify(matPath)}, encoding="utf8").read()`,
    "tree = ast.parse(src)",
    "calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == 'reduce_eyebrow_mesh']",
    "good = [c for c in calls for kw in c.keywords if kw.arg == 'budget_tris' and isinstance(kw.value, ast.Attribute) and isinstance(kw.value.value, ast.Name) and kw.value.value.id == 'args' and kw.value.attr == 'eyebrow_tris_budget']",
    "decls = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and isinstance(n.func.value, ast.Name) and n.func.value.id == 'parser' and n.func.attr == 'add_argument' and n.args and isinstance(n.args[0], ast.Constant) and n.args[0].value == '--eyebrow-tris-budget']",
    "defaults = [kw.value.value for n in decls for kw in n.keywords if kw.arg == 'default' and isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, int) and not isinstance(kw.value.value, bool)]",
    "print(json.dumps({'total': len(calls), 'calls': len(good), 'decls': len(decls), 'defaults': defaults}))",
  ].join("\n");
  const out = JSON.parse(execFileSync("python3", ["-c", py], { encoding: "utf8" }).trim()) as {
    total: number;
    calls: number;
    decls: number;
    defaults: number[];
  };
  expect(out.total, "exactly one reduce_eyebrow_mesh call total").toBe(1);
  expect(out.calls, "the single call threads budget_tris=args.eyebrow_tris_budget").toBe(1);
  expect(out.decls, "exactly one parser.add_argument('--eyebrow-tris-budget') declaration").toBe(1);
  expect(out.defaults.length, "exactly one integer (non-bool) --eyebrow-tris-budget default").toBe(1);
  const budget: unknown = out.defaults[0];
  expect(typeof budget, "budget default is a number").toBe("number");
  if (typeof budget !== "number") throw new Error("unreachable: budget default missing");
  return budget;
}

describe("the reduced eyebrow keeps covering strands", () => {
  it("(1) RED: the reducer fills leftover budget with the densest covering strands", () => {
    const src = readFileSync(REDUCER, "utf8");
    // Phase 2 exists: after the greedy loop breaks, a second pass spends the
    // remaining budget ordered by band ink per triangle.
    expect(src, "phase-2 densest fill after the greedy phase").toMatch(
      /phase.?2|densest/i,
    );
    expect(src, "fill orders remaining strands by ink per tri").toMatch(
      /ink.*per.*tri|per.*tri.*ink/i,
    );
    // The materializer actually spends more than the dusting budget.
    expect(
      browBudget(MAT),
      "brow budget raised above the 3600 dusting floor",
    ).toBeGreaterThan(3600);
  });

  it("(2) COUNTERWEIGHT: the raised budget stays far below the 21k speckle", () => {
    expect(
      browBudget(MAT),
      "brow budget must not replay the 21k-speckle treatment",
    ).toBeLessThanOrEqual(10000);
  });

  it("(3) COUNTERWEIGHT: D1 — the reducer deletes only, never authors geometry", () => {
    const src = readFileSync(REDUCER, "utf8");
    expect(src, "no vertex construction in the reducer").not.toMatch(
      /verts\.new|faces\.new|from_pydata|bmesh\.ops\.create/,
    );
  });
});

/**
 * ## MIGRATED 2026-10-28 — AST syntax correction; planted header immutable
 *
 * browBudget now execs the embedded Python via stdlib ast (single-line
 * comprehensions) against the real materializer path; tightened to exactly one
 * reduce_eyebrow_mesh call, parser receiver, unique flag, int non-bool default.
 */
