import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#178). Main is RED because a pre-fix calibration guard hard-throws forever.
 *
 * `hm08-upright-export.ts:362-370` compares a LIVE measurement against three inlined constants and
 * aborts the whole module:
 *
 *     if (Math.abs(row.meshW - 0.995) > 0.02 || Math.abs(row.meshH - 0.436) > 0.02
 *         || Math.abs(row.meshD - 1.695) > 0.02) {
 *       throw new Error("CALIBRATION MISMATCH vs orchestrator W=0.995 H=0.436 D=1.695 …
 *                        STOP before product edit.");
 *     }
 *
 * `H` and `D` are swapped: the constants describe the asset LYING DOWN, and the live measure is now
 * UPRIGHT. All three tests in `hm08-upright-export.test.ts` die on this before asserting anything.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT and is `it.fails` only because the module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * MY FIRST DIAGNOSIS WAS HALF WRONG — disclosed so you do not inherit it
 *
 * I filed this as "#156 fixed the asset and the guard still points at the broken numbers." The guard
 * IS wrong to throw forever. But that is not why the live measurement moved.
 *
 * **The preserved lying anchor was destroyed.** Verified by hash:
 *
 *     1f7416e51a4f0656  .openclinxr/evidence/issue-134/hm08-rig-carry-candidate.glb
 *     1f7416e51a4f0656  .openclinxr/evidence/issue-156/hm08-rig-carry-candidate-upright.glb
 *
 * **Byte-identical.** `hm08-upright-export.ts:31` calls the first one "the original #134 candidate
 * preserved for calibration"; on disk it is the upright product.
 *
 * Traced mechanism, and you should confirm it rather than take it from me: #156 changed the SHARED
 * `hm08_rig_carry_stage.py` defaults to `export_yup=true, force_z_up=true`, and #134's cagematch
 * (`hm08-rig-carry-cagematch.ts`) still writes to the SAME `CANDIDATE_GLB` under `issue-134/` without
 * passing those flags — so it inherits the new defaults. Any re-run of #134 overwrites the control
 * with product.
 *
 * A file described as "preserved" that a later run can silently overwrite is not preserved.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE WRITTEN ARTIFACT IS INTACT AND IS THE REAL BEFORE-COLUMN
 *
 * `.openclinxr/evidence/issue-156/pre-fix.json` — 5 rows, first row `meshW 0.995, meshH 0.436,
 * meshD 1.695, meshLongestAxis "z", verdict "FAIL_lying_or_misaligned"`, plus the PASS row for
 * `force_z_up_plus_export_yup_true` at H=1.695.
 *
 * It is **gitignored**, so a clean clone has no before-column at all. That is a second hole and it is
 * in scope: whatever carries the historical row must survive a fresh checkout.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * MY PROPOSED FIX WAS TOO SOFT — the correction, and it is not optional
 *
 * I proposed "compare and report, never abort". A peer round pushed back and it is right: that is fine
 * for drift of the anchor, and the PRODUCT assertions must still hard-fail on uprightness.
 *
 * The shape:
 *
 *     if the artifact is absent:  measure the anchor, write it
 *     if the artifact is present: do NOT require the live product to match the historical broken row
 *     always:                     the three product `it`s assert uprightness and hard-fail
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE COLD-PATH TRAP — this is the part that is easy to miss
 *
 * `hm08-upright-export.ts:430` re-measures `ORIGINAL_CANDIDATE` as the treatment-table BASELINE when
 * the cache is absent. With the anchor now upright, a cold run would record a **PASS control row**,
 * and the four-column treatment table would silently stop being evidence of the #67 trap class —
 * where `export_yup=True` alone produces an upright MESH over a skeleton still lying on its side, and
 * every single-column check passes on it.
 *
 * The cache is hiding that today. Fixing the throw without restoring or freezing a genuine lying
 * control trades one silent failure for another.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - **How the historical lying row survives a clean clone.** A tracked seed JSON, a tracked lying
 *    GLB under a path #134 cannot write, or regenerating it on demand from the stage with the old
 *    flags. Each has a different failure mode.
 *  - **Whether #134's cagematch stops writing to the shared path**, or the anchor moves out of its
 *    reach. Fixing the collision at either end is defensible; leaving it is not.
 *  - **What `ensurePreFix` does when the artifact is present and the live anchor disagrees.** Record a
 *    delta, warn, or ignore. It must not abort, and it must not silently pretend the anchor is intact.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT MUST NOT HAPPEN
 *
 * Deleting `ensurePreFix`, deleting the constants, or deleting any of the three product `it`s in
 * `hm08-upright-export.test.ts` are all forbidden and the counterweight below is written to catch
 * them. The guard caught a real class; it is calibrated against a control that no longer exists.
 *
 * No new `eslint-disable`, `@ts-ignore`, `@ts-expect-error` or `OPENCLAW_SKIP_HOOKS` in source paths —
 * merge-kill fails the land regardless of the comment justifying it.
 *
 * SIGNATURE IS YOURS. These read `inspectHm08CalibrationAnchor()`. What must not change: the anchor
 * and the historical row are read from FILES rather than recomputed from the live product, and
 * geometry comes from the exported glTF.
 *
 * IN-SCOPE REPORT — answer EVERY line. Do not replace with a sentence:
 *     hm08_upright_suite_green:   yes | no
 *     historical_row_survives:    tracked | gitignored_only | lost
 *     anchor_collision_fixed:     yes | no | not_applicable:<why>
 *     cold_path_control_lies:     yes | no | not_checked
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS THE
 * OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT rather than silently running a corrected
 * version. A broken proof is my defect and I need to see it.
 *
 * SCOPE: one evidence module's calibration guard and the anchor it depends on. Says NOTHING about the
 * pre-fix ORDERING problem (#177 — a `done_when` can check existence, not when a file was written),
 * about hm08's suitability as a humanoid, or about any other evidence module.
 */

const load = async () =>
  import("./hm08-calibration-anchor.js") as Promise<Record<string, unknown>>;

type AnchorFile = {
  path: string;
  exists: boolean;
  sha256: string | null;
  /** Measured from the exported glTF, world AABB. */
  meshW: number | null;
  meshH: number | null;
  meshD: number | null;
  longestAxis: string | null;
};

type Report = {
  /** The historical pre-fix row, read from whatever now carries it. */
  historicalRow: {
    source: string;
    trackedInGit: boolean;
    meshW: number;
    meshH: number;
    meshD: number;
    longestAxis: string;
    verdict: string;
  } | null;
  /** The #134 path and the #156 path, measured independently. */
  anchors: AnchorFile[];
  /** True when the two paths hold the same bytes — the collision this slice exists for. */
  anchorsCollide: boolean;
  /** Every treatment row the module records, so the trap class can be asserted. */
  treatmentRows: {
    label: string;
    meshLongestAxis: string;
    jointLongestAxis: string;
    verdict: string;
  }[];
  /** Result of calling ensurePreFix with the artifact present and the live anchor upright. */
  ensurePreFixThrewOnUprightAnchor: boolean;
  claimScope: string;
  notEvidenceFor: string[];
};

type Inspect = () => Promise<Report>;

describe("the hm08 calibration anchor survives its own fix (#178)", () => {
  it("the pre-fix guard does not abort once the product is upright", async () => {
    // The whole red. ensurePreFix re-measures a live anchor on every run and throws unless it is
    // still the broken shape — which freezes the PRODUCT to the defect so the GATE stays green.
    const mod = await load();
    const inspect = mod["inspectHm08CalibrationAnchor"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(
      report.ensurePreFixThrewOnUprightAnchor,
      "ensurePreFix still aborts when the live anchor is upright — the guard requires the defect to persist",
    ).toBe(false);
  }, 600_000);

  it("the historical lying row survives a clean checkout", async () => {
    // The written artifact holds the honest before-column and is gitignored, so a fresh clone has no
    // calibration at all. And the GLB that was described as "preserved for calibration" is now
    // byte-identical to the upright product — a preserved file that a later run can overwrite is not
    // preserved.
    const mod = await load();
    const inspect = mod["inspectHm08CalibrationAnchor"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.historicalRow, "no historical pre-fix row is reachable at all").toBeTruthy();
    expect(
      report.historicalRow!.trackedInGit,
      `the historical row lives only at ${report.historicalRow!.source}, which a clean clone does not have`,
    ).toBe(true);

    // It must still describe the asset LYING DOWN. A "historical" row that matches today's upright
    // product is not a before-column.
    expect(Math.abs(report.historicalRow!.meshH - 0.436)).toBeLessThan(0.02);
    expect(Math.abs(report.historicalRow!.meshD - 1.695)).toBeLessThan(0.02);
    expect(report.historicalRow!.longestAxis).toBe("z");
  }, 600_000);

  it("the trap class is still recorded and nothing was deleted (COUNTERWEIGHT)", async () => {
    // The cheap way to green this is to delete ensurePreFix, delete the constants, or delete the three
    // product its. All three are forbidden. #67 shipped six head-down humanoids because a single
    // column looked right — the four-column table is the evidence of that class and it must survive.
    const mod = await load();
    const inspect = mod["inspectHm08CalibrationAnchor"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();

    // At least one row must record the #67 trap: an upright MESH over joints still lying down.
    const trapRows = report.treatmentRows.filter(
      (r) => r.meshLongestAxis === "y" && r.jointLongestAxis !== "y" && /fail/iu.test(r.verdict),
    );
    expect(
      trapRows.length,
      `no treatment row records the #67 trap class (mesh upright, joints not) — rows: `
      + report.treatmentRows.map((r) => `${r.label}:${r.meshLongestAxis}/${r.jointLongestAxis}`).join(", "),
    ).toBeGreaterThan(0);

    // And at least one row must pass every column, so the table shows a real winner rather than only
    // failures.
    const passRows = report.treatmentRows.filter((r) => !/fail/iu.test(r.verdict));
    expect(passRows.length, "no treatment row passes — the chosen treatment is not recorded")
      .toBeGreaterThan(0);

    // The collision itself must be resolved or explicitly declared not applicable.
    expect(report.anchors.length, "fewer than two anchor paths measured").toBeGreaterThanOrEqual(2);

    expect(report.notEvidenceFor.join(" ").toLowerCase()).toContain("clinical");
  }, 600_000);
});
