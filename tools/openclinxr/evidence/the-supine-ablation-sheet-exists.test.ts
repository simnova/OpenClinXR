import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #492 — ABLATION, not another fix. Superagent-directed after four landings failed to make the
 * patient a person.
 *
 * ## THE RECORD THAT MAKES THIS A DIAGNOSTIC — IMMUTABLE
 *
 *   1  "the gown skin tears under the supine transform"   DISPROVEN
 *   2  "the supine map binds 3 of 17 bones"               FALSE — 17/17 via resolvePoseBone (#306)
 *   3  (#493) "a quantity differs"                        TRUE, partial
 *   4  (#494) "the body floats 668 mm"                    TRUE, FIXED — and NOT the defect
 *
 * `#494` moved the treatment from `aabb.minY` 1.218 to **0.570** against a 0.55 m deck. Verified in
 * the regenerated dump. Then the pixel grade: the patient sits ON the mattress instead of hovering,
 * and is **still a crumpled teal mass.** Four measured improvements, still not a human.
 *
 * **So this slice does not fix anything.** It splits the pose into its two mechanisms and renders
 * each, so the next fix is aimed at a located cause instead of a fifth guess.
 *
 * ## THE SEAM, MEASURED
 *
 * `applySupinePose(humanoidRoot)` (`supine-pose.ts:106`) does exactly two things:
 *
 *   `:118`  humanoidRoot.quaternion.copy(SUPINE_ROOT_QUAT)   <- the on-back ROOT BASIS
 *           SUPINE_ROOT_EULER = Euler(-PI/2, 0, PI/2, "XYZ")
 *   `:124`  resolveRotationMap(SUPINE_BONE_EULERS, ...) then traverse+applyEuler  <- the 17 JOINT EULERS
 *
 * Those separate cleanly. Three cells:
 *
 *   | cell            | what runs                                  |
 *   |-----------------|--------------------------------------------|
 *   | `standing`      | no supine call at all                      |
 *   | `root_only`     | the root quaternion, NO joint eulers        |
 *   | `full`          | today's behaviour — root + all 17 eulers    |
 *
 * ## WHAT THE SHEET MUST DISTINGUISH (SS10t) — and the branch is pre-committed
 *
 * > **Is `root_only` a stiff but recognisable person lying down, or already a wad?**
 *
 *   `root_only` = a person  ->  the 17 Anny-tuned eulers ARE the crumple. Next slice authors an
 *                               MPFB-native euler table.
 *   `root_only` = a wad     ->  the eulers are NOT the crumple. The root basis or the MPFB rest
 *                               pose is, and the next slice re-authors `SUPINE_ROOT_QUAT`.
 *
 * Either answer closes this successfully. **There is no failing outcome except an unrenderable
 * sheet.**
 *
 * ## THE GRADE IS THE ORCHESTRATOR'S AND IT IS THE REAL GATE
 *
 * This contract can only assert the sheet was RENDERED FROM THE RUNTIME PATH with three labelled
 * cells. It cannot assert "looks like a person" — no contract can, which is exactly how `#491` and
 * `#494` both landed green over a broken figure. **A green result here means the sheet is gradeable,
 * nothing more.**
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                       | (1) sheet | (2) default | (3) map intact | result
 *   ------------------------------------------------|-----------|-------------|----------------|--------
 *   a) today — no sheet                              | **FAIL**  |    pass     |     pass       | REFUSED
 *   b) change what applySupinePose does by default    |   pass    |  **FAIL**   |     pass       | REFUSED
 *   c) delete eulers to make root_only the new normal |   pass    |    pass     |   **FAIL**     | REFUSED
 *   d) additive opt-in seam, three cells, no retune   |   pass    |    pass     |     pass       | ALL PASS
 *
 * **(b) is the one to watch.** The ablation must be OPT-IN. A default-changing edit turns a
 * diagnostic into an unreviewed product change, and four stations are already broken.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1) is the sole RED.** (2) and (3) pass today and pin
 * this to a diagnostic. (4) is a vacuity guard.
 *
 * NOT TESTED: any cause. Deliberately — four have been offered and none held. Whether an MPFB-native
 * map or a re-authored root basis would work; the sheet tells us which to try, not that it works.
 * `Mesh2Motion` (#70, approved and unused) as a clip-driven alternative — a read-only inventory runs
 * in parallel and touches nothing here.
 *
 * ## FIXED (#495)
 *
 * `applySupinePose` gained an opt-in `ApplySupinePoseOptions` (default `{}`) with
 * `applyJointEulers?: boolean` (default true), and `applyAndPlantSupineOnDeck` threads it through —
 * existing callers are untouched. The isolated lab reads a `supineRootOnly` spec flag and records a
 * per-cell `__openClinXrSubjectAabb` plus `ranSupineCall` / `appliedJointEulers` on the supine dump.
 * `supine-ablation-sheet.ts` renders standing (glb) / root_only (runtime_posture,
 * applyJointEulers=false) / full (runtime_posture) and writes the tracked sheet + report. Clause (1)
 * flipped `it.fails` -> `it`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const SHEET = join(HERE, "stills/supine-ablation-sheet.png");
const REPORT = join(HERE, "supine-ablation-report.json");
const SUPINE_SRC = join(REPO_ROOT, "apps/ui-xr/src/supine-pose.ts");

const CELLS = ["standing", "root_only", "full"] as const;
/** The 17 authored keys. Clause (3) pins every one. */
const MAP_BONES = [
  "pelvis", "spine", "chest", "thighL", "thighR", "shinL", "shinR", "footL", "footR",
  "upper_armL", "upper_armR", "forearmL", "forearmR", "handL", "handR", "neck", "head",
] as const;

type Report = {
  schemaVersion: string;
  bodyGlb: string;
  renderer: string;
  cells: { cell: string; ranSupineCall: boolean; appliedJointEulers: boolean;
           posedMeshAabb: { min: { y: number }; max: { y: number } } }[];
};

function requireReport(): Report {
  expect(existsSync(REPORT), `${REPORT} must exist`).toBe(true);
  return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
}

describe("the supine ablation sheet exists and is gradeable", () => {
  it("(1) RED: a three-cell ablation sheet was rendered from the runtime path", () => {
    expect(existsSync(SHEET), `${SHEET} must exist — the orchestrator grades this image`).toBe(true);
    // A byte floor teaches "the capture ran" (SS8n), so it is paired with the per-cell record below
    // rather than standing alone.
    expect(statSync(SHEET).size, "a three-cell lit sheet is not a stub").toBeGreaterThan(60_000);
    const r = requireReport();
    expect(r.cells.map((c) => c.cell).sort(), `cells must be exactly ${CELLS.join(", ")}`)
      .toEqual([...CELLS].sort());
    expect(
      /isolated-subject-lab|applySupinePose/.test(r.renderer ?? ""),
      `renderer must name the product path; got ${JSON.stringify(r.renderer)}`,
    ).toBe(true);
    // The ablation is only real if the cells actually differ in what ran.
    const byCell = Object.fromEntries(r.cells.map((c) => [c.cell, c]));
    expect(byCell["standing"]!.ranSupineCall, "standing runs no supine call").toBe(false);
    expect(byCell["root_only"]!.ranSupineCall, "root_only runs the supine call").toBe(true);
    expect(byCell["root_only"]!.appliedJointEulers, "root_only applies NO joint eulers").toBe(false);
    expect(byCell["full"]!.appliedJointEulers, "full applies the joint eulers").toBe(true);
  });

  it("(2) COUNTERWEIGHT: applySupinePose's DEFAULT behaviour is unchanged", () => {
    // Refuses (b). The ablation must be opt-in; a default-changing edit turns a diagnostic into an
    // unreviewed product change while four stations are already broken.
    const src = readFileSync(SUPINE_SRC, "utf8");
    expect(src.includes("humanoidRoot.quaternion.copy(SUPINE_ROOT_QUAT)"), "root basis still applied")
      .toBe(true);
    expect(src.includes("resolveRotationMap(SUPINE_BONE_EULERS"), "eulers still resolved by default")
      .toBe(true);
    expect(
      /export function applySupinePose\(humanoidRoot: Object3D(,\s*[^)]*=\s*\{[^)]*\})?\)/.test(src),
      "any new parameter must be OPTIONAL with a default, so existing callers are untouched",
    ).toBe(true);
  });

  it("(3) COUNTERWEIGHT: all 17 authored eulers survive", () => {
    // Refuses (c). Deleting entries makes root_only the de-facto product and poses nothing.
    const src = readFileSync(SUPINE_SRC, "utf8");
    for (const b of MAP_BONES) {
      expect(src.includes(`["${b}"`), `SUPINE_BONE_EULERS must still author "${b}"`).toBe(true);
    }
  });

  it("(4) VACUITY GUARD: the three cells are not the same render", () => {
    // If all three cells produced identical geometry the sheet would be gradeable and meaningless.
    if (!existsSync(REPORT)) return;
    const r = requireReport();
    const heights = r.cells.map((c) => +(c.posedMeshAabb.max.y - c.posedMeshAabb.min.y).toFixed(3));
    expect(new Set(heights).size, `cell heights ${heights.join(", ")} — standing must differ from lying`)
      .toBeGreaterThan(1);
  });
});
