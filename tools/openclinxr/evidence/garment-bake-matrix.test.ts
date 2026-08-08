import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#195). Three REDs. All three flip.
 *
 * Operator scope directive 2026-08-08: procedurally generated humans, clothing, rooms and equipment,
 * **all in test harnesses**. #194 landed the in-process half (equipment + rooms, 1.52 s). This is the
 * Blender half — separate because forcing a sub-second three.js builder and a multi-minute bake
 * through one harness pays the slowest tax on every sweep.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THE CLOTHING GENERATOR IS — verified, do not re-derive
 *
 * **Not free-standing.** `apply_role_clothing_material_regions` is called at
 * `automate_blender.py:3860` from inside the humanoid bake; `_build_body_surface_derived_garment` at
 * `:3077` from inside that, taking the body `mesh_obj` as its first argument. **Clothing is a
 * parameter of the human bake.** This harness bakes a body and varies the garment, never the reverse.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE PARAMETER SURFACE — every shell parameter is a hardcoded coefficient times a body landmark
 *
 *   sleeve_along      = arm_len * 0.72   (gown)      :2968
 *                     = arm_len * 0.92   (cardigan)  :2979
 *   bot_y             = body_min_y + body_height * 0.32  :2971
 *                     = body_min_y + body_height * 0.31  :2982
 *   sleeve_r0         = max(body_depth * 0.22, r_base * 0.42)  :2969
 *   front_opening_rad = 0.95 (cardigan) / 0.0 (all else)  :2960, :2985
 *   cloth_offset      = (0.010 + 0.012 * radial_rank) * (1.02 if gown)  :3070
 *   neck_y            = body_min_y + body_height * 0.84  :3071
 *
 * Ten declared kinds. Seven hardcoded coefficients. **None has ever been rendered as a range.**
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * ONE COEFFICIENT IS A TEST-FIXTURE ARTIFACT — and I am the one who put it there
 *
 * `bot_y = body_height * 0.31` for the cardigan came from a `hemHeightRatio: 0.31` I invented as an
 * ILLUSTRATIVE value in a planted anti-cheat fixture for #46. The worker that implemented it said so
 * unprompted:
 *
 *   "Cardigan bot_y = body_height * 0.31 — guess, steered by the planted anti-cheat fixture's
 *    hemHeightRatio: 0.31 — not measured from clothing... The planted table's 0.31 example was a
 *    stronger magnet than real garments."
 *
 * So a hem length in the shipping generator is a number I made up to make a test look plausible.
 * Nobody can tell whether it is right because nobody has seen 0.25 or 0.40 beside it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * I AM NOT SPECIFYING TARGET VALUES. A threshold in a contract becomes a design target for the thing
 * being measured — that is exactly how 0.31 got in. The sweep supplies evidence; I choose from the
 * sheet afterwards. Contracts here assert the LEDGER; the orchestrator grades the SHEET.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * TRAPS, ALREADY PAID FOR ELSEWHERE — do not re-pay them
 *
 *  - **Stub trap.** Full `orchestrate_character` without the `anny` package silently writes ~0.8 MB
 *    stub GLBs that pass file checks. Use the Blender-only re-bake on existing tracked bases. One
 *    slice paid ~40 turns learning this.
 *  - **Export-continuity trap.** SOLIDIFY rim geometry re-splits into 4-vertex micro-islands on glTF
 *    export, so Blender reports one component and the file reports several. Measure continuity FROM
 *    THE EXPORTED glTF, never from the Blender script. **Budget: at most TWO rebakes chasing any
 *    disagreement between what Blender reports and what the export contains** — that cap is on the
 *    CLASS, not on one modifier. Then stop and report.
 *  - **Hem-cut trap (#124).** The hem is a planar bisect AFTER the normal offset, not a Y-threshold
 *    vertex delete; a far-lateral delete near the hem punched side holes that face-disconnected the
 *    lower torso.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SIGNATURE IS YOURS. These read `inspectGarmentBakeMatrix()`. What must not change:
 *  - the body is a FIXED tracked base, not regenerated per variant — isolates the variable
 *  - geometry read from the EXPORTED glTF, never from Blender (#60), and continuity measured after
 *    merging vertices by position
 *  - the real bake runs; a TypeScript re-implementation would grade something the pipeline does not
 *    produce
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT MUST NOT HAPPEN
 *
 * **Do not change any shipping coefficient.** This slice measures the space. Changing 0.31 destroys
 * the before-column and pre-empts a decision that is mine to make from the sheet. Contract 3 catches it.
 *
 * No new `eslint-disable`, `@ts-ignore`, `@ts-expect-error` or `OPENCLAW_SKIP_HOOKS` in source paths.
 * Never raise a file-size ceiling; split instead.
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS THE
 * OPPOSITE DIRECTION FROM THE DEFECT — say so IN THE FIRST REPORT YOU WRITE, at the moment you find
 * it, BEFORE running a corrected version.
 *
 * SCOPE: the garment shell parameter space on one fixed body. Says NOTHING about body generation,
 * about the runtime app, about equipment or rooms (#194), or about whether any garment looks
 * clinically right — that needs a clinician.
 */

const load = async () =>
  import("./garment-bake-matrix.js") as Promise<Record<string, unknown>>;

type VariantRow = {
  variantId: string;
  /** Which coefficient was swept and to what value. */
  param: string;
  value: number;
  garmentKind: string;
  triangles: number;
  worldAabb: { min: [number, number, number]; max: [number, number, number] };
  /** Lowest Y of the garment shell, in metres — the hem. */
  hemY: number;
  /** Furthest extent of the sleeve along the arm, in metres. */
  sleeveExtent: number;
  /** After merging vertices by position — index counts split on material (#121). */
  connectedComponents: number;
  /** Measured from the exported glTF: does the shell enclose the body it was built from? */
  enclosesBody: boolean;
};

type Report = {
  /** The fixed body every variant was baked onto. */
  bodyBase: string;
  /** Current shipped value of each coefficient, and what it produces on this body. */
  shippedCoefficients: { name: string; value: number; producedHemY?: number; producedSleeveExtent?: number }[];
  variants: VariantRow[];
  sweeps: { param: string; values: number[] }[];
  contactSheetPaths: string[];
  /** Rebakes spent chasing Blender-vs-export disagreement. Capped at 2. */
  continuityRebakesSpent: number;
  claimScope: string;
  notEvidenceFor: string[];
};

type Inspect = () => Promise<Report>;

describe("the garment parameter space is swept in a bake harness (#195)", () => {
  it("a garment parameter sweep bakes real variants and records a ledger", async () => {
    const mod = await load();
    const inspect = mod["inspectGarmentBakeMatrix"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.bodyBase, "no fixed body base recorded").toBeTruthy();
    expect(report.sweeps.length, "no coefficient was swept").toBeGreaterThanOrEqual(2);

    for (const sweep of report.sweeps) {
      expect(sweep.values.length, `sweep of ${sweep.param} has fewer than 4 values`)
        .toBeGreaterThanOrEqual(4);

      const rows = report.variants.filter((v) => v.param === sweep.param);
      expect(rows.length, `no variants baked for the ${sweep.param} sweep`)
        .toBeGreaterThanOrEqual(sweep.values.length);

      // A sweep that does not move geometry is one bake repeated — or a parameter that never
      // reaches the mesh, which is itself the finding and must be reported, not hidden.
      const signature = (v: VariantRow) => `${v.triangles}|${v.hemY.toFixed(4)}|${v.sleeveExtent.toFixed(4)}`;
      const distinct = new Set(rows.map(signature));
      expect(
        distinct.size,
        `sweeping ${sweep.param} produced ${distinct.size} distinct geometries across ${rows.length} `
        + `variants — the coefficient does not reach the mesh`,
      ).toBeGreaterThan(1);
    }

    expect(report.continuityRebakesSpent, "continuity rebake budget of 2 exceeded")
      .toBeLessThanOrEqual(2);
  }, 3_600_000);

  it("every variant's shell encloses the body", async () => {
    // A hem sweep that produces a floating band is not a garment. Measured from the exported glTF,
    // because Blender's own topology report is not a claim about the file it writes (#121).
    const mod = await load();
    const inspect = mod["inspectGarmentBakeMatrix"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const detached = report.variants
      .filter((v) => !v.enclosesBody)
      .map((v) => `${v.variantId} (${v.param}=${v.value}, hemY=${v.hemY.toFixed(3)})`);
    expect(detached, "variants whose shell does not enclose the body").toEqual([]);
  }, 3_600_000);

  it("the shipping coefficients are unchanged (COUNTERWEIGHT)", async () => {
    // The cheap green is to "improve" 0.31 while measuring. That destroys the before-column and
    // pre-empts a choice that belongs to whoever grades the sheet.
    const mod = await load();
    const inspect = mod["inspectGarmentBakeMatrix"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const byName = new Map(report.shippedCoefficients.map((c) => [c.name, c.value]));

    // These are the values on main at plant time. If a sweep changed the source, this fails.
    for (const [name, expected] of [
      ["cardigan_bot_y_fraction", 0.31],
      ["gown_bot_y_fraction", 0.32],
      ["cardigan_sleeve_along_fraction", 0.92],
      ["gown_sleeve_along_fraction", 0.72],
      ["cardigan_front_opening_rad", 0.95],
    ] as const) {
      const actual = byName.get(name);
      expect(actual, `coefficient ${name} not recorded in the ledger`).toBeTypeOf("number");
      expect(
        Math.abs((actual as number) - expected),
        `shipping coefficient ${name} changed from ${expected} to ${actual} — this slice measures, it does not tune`,
      ).toBeLessThan(1e-6);
    }

    expect(report.contactSheetPaths.length, "no contact sheet produced for the orchestrator to grade")
      .toBeGreaterThanOrEqual(2);
    expect(report.notEvidenceFor.join(" ").toLowerCase()).toContain("clinical");
  }, 3_600_000);
});
