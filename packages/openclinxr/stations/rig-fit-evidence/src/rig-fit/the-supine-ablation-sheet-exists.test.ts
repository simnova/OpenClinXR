import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve as pathResolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Bone, Euler, Object3D, Quaternion } from "three";
import { applySupinePose } from "@openclinxr/xr-pose";

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

/**
 * CI cleanup — CORRECTION (appended as a separate block; historical header above byte-preserved).
 *
 * Post-#495 history: `96b67c6a5` (CI cleanup) rendered the sheet on the original ablation contract;
 * `5d4472938` re-rendered after the #496 rail switch. Current `supine-pose.ts` keeps the #495
 * opt-in seam and makes the default per-rail: `options.applyJointEulers ?? !isMpfb2Rig(jointNames)`
 * — true on the 23-bone Anny rail the 17 eulers were tuned for, false on the 137-joint MPFB2 rail
 * where the graded #495 sheet showed they are the crumple. The committed authentic report
 * (`bodyGlb mpfb-gown-adult-patient.glb`) records `full.appliedJointEulers: false`, which is the
 * correct MPFB2-native product behaviour — not a regression. Clause (1) below therefore asserts the
 * rail-consistent expectation derived from the report's own `bodyGlb` plus the source's
 * `isMpfb2Rig` branch, and clause (2) pins the per-rail default (Anny keeps eulers, MPFB2 skips by
 * default, explicit override wins). Historical header, report bytes, and sheet image are untouched.
 *
 * Path rail: `bodyGlb` is relative to `apps/ui-xr/public`; resolution and containment check run
 * against that public root, not the repo root.
 */

const HERE = join(repoRoot(), "tools/openclinxr/evidence");
const REPO_ROOT = repoRoot();
const SHEET = join(HERE, "stills/supine-ablation-sheet.png");
const PUBLIC_ROOT = join(REPO_ROOT, "apps/ui-xr/public");
const REPORT = join(HERE, "supine-ablation-report.json");
const SUPINE_SRC = join(REPO_ROOT, "packages/openclinxr/xr-pose/src/supine-pose.ts");

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

/** Rail of the sheet, classified from the report's own bodyGlb payload — not its name.
 *
 * Parses the authentic bodyGlb's GLB JSON skin/joint node names into a real three.js
 * Bone/Object3D representative rig, runs the actual default applySupinePose, and derives
 * the expected `applied` flag. Fail-closed on missing/invalid/non-public-root paths or
 * empty joint lists. Report/image bytes untouched.
 */
function reportIsMpfbRail(r: Report): boolean {
  return classifyReportBodyGlbRail(r) === "mpfb";
}

const EXPECTED_ROOT_QUAT = new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, Math.PI / 2, "XYZ"));

function classifyReportBodyGlbRail(r: Report): "mpfb" | "anny" {
  const rel = (r.bodyGlb ?? "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  if (!rel) throw new Error("report bodyGlb is empty");
  const abs = pathResolve(PUBLIC_ROOT, rel);
  const rootSlash = pathResolve(PUBLIC_ROOT, ".") + "/";
  if (abs !== rootSlash.slice(0, -1) && !abs.startsWith(rootSlash)) {
    throw new Error(`bodyGlb escapes the public root: ${r.bodyGlb}`);
  }
  if (!existsSync(abs)) throw new Error(`bodyGlb missing: ${abs}`);
  const bytes = readFileSync(abs);
  if (bytes.length < 12 || bytes.readUInt32LE(0) !== 0x46546c67) {
    throw new Error(`bodyGlb is not a GLB container: ${abs}`);
  }
  const jsonLen = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLen).toString("utf8")) as {
    nodes?: { name?: string }[];
    skins?: { joints?: number[] }[];
  };
  const jointNames: string[] = [];
  for (const skin of json.skins ?? []) {
    for (const j of skin.joints ?? []) {
      const n = json.nodes?.[j]?.name;
      if (typeof n === "string" && n) jointNames.push(n);
    }
  }
  if (jointNames.length === 0) throw new Error(`bodyGlb has no skin joints: ${abs}`);
  // Representative rig: real three.js Bone nodes carrying the authentic joint names.
  const rig = new Object3D();
  for (const n of jointNames) {
    const b = new Bone();
    b.name = n;
    rig.add(b);
  }
  // Actual default applySupinePose classifies the payload; expected flag follows.
  const res = applySupinePose(rig);
  // Non-vacuous root-basis pin on the classified rig.
  expect(rig.quaternion.length()).toBeCloseTo(1, 5);
  expect(rig.quaternion.angleTo(EXPECTED_ROOT_QUAT)).toBeCloseTo(0, 5);
  return res.applied ? "anny" : "mpfb";
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
    // #496 rail semantics: the full cell applies the 17 eulers on the Anny rail and skips them by
    // default on the MPFB2 rail. The rail comes from the report's own bodyGlb.
    const expectFullEulers = !reportIsMpfbRail(r);
    expect(
      byCell["full"]!.appliedJointEulers,
      `full cell on ${reportIsMpfbRail(r) ? "MPFB2" : "Anny"} rail (${r.bodyGlb}) must ${expectFullEulers ? "apply" : "skip"} the joint eulers by default`,
    ).toBe(expectFullEulers);
  });

  it("(2) COUNTERWEIGHT: applySupinePose keeps the 17-euler map with a per-rail default", () => {
    // Refuses (b) in rail-aware form: legacy/Anny callers keep the eulers by default, the MPFB2
    // rail skips them by default, and an explicit option still overrides either rail.
    const src = readFileSync(SUPINE_SRC, "utf8");
    expect(src.includes("humanoidRoot.quaternion.copy(SUPINE_ROOT_QUAT)"), "root basis still applied")
      .toBe(true);
    expect(src.includes("resolveRotationMap(SUPINE_BONE_EULERS"), "eulers still resolved by default")
      .toBe(true);
    expect(
      /export function applySupinePose\(humanoidRoot: Object3D(,\s*[^)]*=\s*\{[^)]*\})?\)/.test(src),
      "any new parameter must be OPTIONAL with a default, so existing callers are untouched",
    ).toBe(true);
    expect(src.includes("isMpfb2Rig"), "per-rail default must branch on isMpfb2Rig").toBe(true);
    expect(
      src.includes("options.applyJointEulers ?? !isMpfb2Rig(jointNames)"),
      "default must be Anny-true / MPFB2-false unless explicitly overridden",
    ).toBe(true);
  });

  it("(3) COUNTERWEIGHT: all 17 authored eulers survive", () => {
    // Refuses (c). Deleting entries makes root_only the de-facto product and poses nothing.
    const src = readFileSync(SUPINE_SRC, "utf8");
    for (const b of MAP_BONES) {
      expect(src.includes(`["${b}"`), `SUPINE_BONE_EULERS must still author "${b}"`).toBe(true);
    }
    // Exact 17: a 16-entry map passes every per-key guard above and still drops a bone.
    const entries = src.match(/\["(pelvis|spine|chest|thigh[LR]|shin[LR]|foot[LR]|upper_arm[LR]|forearm[LR]|hand[LR]|neck|head)", \{/g) ?? [];
    expect(new Set(entries).size, `map must author exactly 17 keys; got ${entries.length}`).toBe(17);
  });

  it("(4) VACUITY GUARD: the three cells are not the same render", () => {
    // If all three cells produced identical geometry the sheet would be gradeable and meaningless.
    if (!existsSync(REPORT)) throw new Error("missing artifact");
    const r = requireReport();
    const heights = r.cells.map((c) => +(c.posedMeshAabb.max.y - c.posedMeshAabb.min.y).toFixed(3));
    expect(new Set(heights).size, `cell heights ${heights.join(", ")} — standing must differ from lying`)
      .toBeGreaterThan(1);
  });
});
