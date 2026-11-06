import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

const REPO_ROOT = repoRoot();
const REDUCER = join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/makeclothes/eyebrow_strand_reduction.py",
);
const MAT = join(
  REPO_ROOT,
  "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py",
);

/** Resolve every effective brow budget at the real call site via AST proof.
 * The helper execs python3 stdlib ast.parse on the materializer (no import,
 * no Blender). It requires exactly one reduce_eyebrow_mesh call, carrying
 * budget_tris=_eyebrow_budget; exactly one `_eyebrow_budget = args.eyebrow_tris_budget
 * if args.eyebrow_tris_budget is not None else _actor_eyebrow_budget` resolution;
 * exactly one parser.add_argument('--eyebrow-tris-budget') whose default is None
 * (absent flag = actor table); and the module-level actor table
 * EYEBROW_STYLE_AND_BUDGET_BY_REFERENCE whose (style, budget) budgets are int
 * literals or DEFAULT_EYEBROW_BUDGET_TRIS (an int literal). Returns every table
 * budget: these are the budgets a default bake spends. */
function browBudgets(matPath: string): number[] {
  const py = [
    "import ast, json",
    `src = open(${JSON.stringify(matPath)}, encoding="utf8").read()`,
    "tree = ast.parse(src)",
    "calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == 'reduce_eyebrow_mesh']",
    "good = [c for c in calls for kw in c.keywords if kw.arg == 'budget_tris' and isinstance(kw.value, ast.Name) and kw.value.id == '_eyebrow_budget']",
    "res = [n for n in ast.walk(tree) if isinstance(n, ast.Assign) and len(n.targets) == 1 and isinstance(n.targets[0], ast.Name) and n.targets[0].id == '_eyebrow_budget' and isinstance(n.value, ast.IfExp) and isinstance(n.value.body, ast.Attribute) and n.value.body.attr == 'eyebrow_tris_budget' and isinstance(n.value.orelse, ast.Name) and n.value.orelse.id == '_actor_eyebrow_budget']",
    "decls = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and isinstance(n.func.value, ast.Name) and n.func.value.id == 'parser' and n.func.attr == 'add_argument' and n.args and isinstance(n.args[0], ast.Constant) and n.args[0].value == '--eyebrow-tris-budget']",
    "none_default = [n for n in decls for kw in n.keywords if kw.arg == 'default' and isinstance(kw.value, ast.Constant) and kw.value.value is None]",
    "mod = {t.id: n.value for n in tree.body if isinstance(n, ast.Assign) for t in n.targets if isinstance(t, ast.Name)}",
    "dflt = mod.get('DEFAULT_EYEBROW_BUDGET_TRIS')",
    "dval = dflt.value if isinstance(dflt, ast.Constant) and isinstance(dflt.value, int) and not isinstance(dflt.value, bool) else None",
    "table = mod.get('EYEBROW_STYLE_AND_BUDGET_BY_REFERENCE')",
    "rows = table.values if isinstance(table, ast.Dict) else []",
    "budgets = [(v.elts[1].value if isinstance(v.elts[1], ast.Constant) and isinstance(v.elts[1].value, int) and not isinstance(v.elts[1].value, bool) else dval if isinstance(v.elts[1], ast.Name) and v.elts[1].id == 'DEFAULT_EYEBROW_BUDGET_TRIS' else None) for v in rows if isinstance(v, ast.Tuple) and len(v.elts) == 2]",
    "print(json.dumps({'total': len(calls), 'calls': len(good), 'res': len(res), 'decls': len(decls), 'noneDefault': len(none_default), 'rows': len(rows), 'budgets': budgets}))",
  ].join("\n");
  const out = JSON.parse(execFileSync("python3", ["-c", py], { encoding: "utf8" }).trim()) as {
    total: number;
    calls: number;
    res: number;
    decls: number;
    noneDefault: number;
    rows: number;
    budgets: (number | null)[];
  };
  expect(out.total, "exactly one reduce_eyebrow_mesh call total").toBe(1);
  expect(out.calls, "the single call threads budget_tris=_eyebrow_budget").toBe(1);
  expect(out.res, "_eyebrow_budget resolves flag-else-actor-table exactly once").toBe(1);
  expect(out.decls, "exactly one parser.add_argument('--eyebrow-tris-budget') declaration").toBe(1);
  expect(out.noneDefault, "the flag defaults to None so the actor table decides").toBe(1);
  expect(out.rows, "the actor table has rows").toBeGreaterThan(0);
  expect(out.budgets.length, "every table row is a (style, budget) pair").toBe(out.rows);
  const budgets = out.budgets.filter((b): b is number => typeof b === "number");
  expect(budgets.length, "every table budget is an int literal or the int default").toBe(out.rows);
  return budgets;
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
      Math.min(...browBudgets(MAT)),
      "every actor's brow budget raised above the 3600 dusting floor",
    ).toBeGreaterThan(3600);
  });

  it("(2) COUNTERWEIGHT: the raised budget stays far below the 21k speckle", () => {
    expect(
      Math.max(...browBudgets(MAT)),
      "no actor's brow budget may replay the 21k-speckle treatment",
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

/**
 * ## MIGRATED 2026-11-05 — per-actor brow budget (st-vitbrowdense r5, 30ef764a4)
 *
 * The budget moved from the --eyebrow-tris-budget argparse default into the
 * actor table EYEBROW_STYLE_AND_BUDGET_BY_REFERENCE (flag default None; spouse
 * 9400). browBudgets now proves the call threads _eyebrow_budget, that it
 * resolves flag-else-table, and applies both bounds to every table budget.
 */
