import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#194). Three REDs. All three flip.
 *
 * Operator scope directive 2026-08-08: procedurally generated humans, clothing, rooms and equipment,
 * **all in test harnesses**. This is the fast half — the two generators that run in-process.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * MEASURED — trust these, do not re-derive
 *
 * 29 equipment ids are declared across the shipped bank. 19 resolve to a real or parametric builder.
 * TEN fall to `buildGenericClinicalEquipmentFallback` — base box + upright cylinder + tray box,
 * 3 meshes, 56 triangles:
 *
 *   hospital_bed_equipment      stretcher_equipment            side_rails_equipment
 *   safe_room_chair_equipment   observation_station_equipment
 *   ehr_screen_equipment        lab_results_panel_equipment
 *   digital_thermometer_equipment  glucometer_review_equipment  tablet_visit_equipment
 *
 * A hospital bed, a stretcher and bed side rails are among them.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * TWO CORRECTIONS THAT SHAPED THIS SLICE — both verified against the tree
 *
 * 1. **Clothing is not a free-standing generator.** `apply_role_clothing_material_regions` is called
 *    at `automate_blender.py:3860` from inside the humanoid bake, and
 *    `_build_body_surface_derived_garment` at `:3077` from inside that, taking the body `mesh_obj` as
 *    its first argument. Clothing is a PARAMETER of the human bake, not a peer of it. A `garment`
 *    subject kind would invent a seam the tree does not have.
 *
 * 2. **These two builders are pure in-process functions.** `buildDeclaredEquipmentGeometry(id): Group`
 *    (`station-equipment.ts:495`) and `buildStationEnvironment(input): Group`
 *    (`station-environment.ts:109`) return three.js Groups and import only `three` plus one local
 *    module. **No Vite, no Playwright, no ui-xr app boot.** That is why they are this slice and the
 *    Blender-baked subjects are not — forcing a sub-second builder and a multi-minute bake through
 *    one harness pays the slowest tax on every sweep.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY A LEDGER AND NOT PIXELS
 *
 * Six geometric gates in this repo have passed on output a human graded as wrong, and `min-bytes:` on
 * a PNG proves only that a renderer ran. So: **contracts assert the LEDGER; the orchestrator grades
 * the SHEET.** Never assert that something looks right. The sheet is not a worker's done-signal.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SIGNATURE IS YOURS. These read `inspectGeneratorSweep()`. What must not change:
 *  - subjects enumerated DYNAMICALLY from what ships, never a literal list — a hardcoded list is what
 *    hid ten unrendered rooms for weeks
 *  - the builders are CALLED, not re-implemented. A harness that renders through its own code path
 *    grades something the pipeline does not produce
 *  - geometry read from the returned Group or the exported glTF; never from Blender (#60)
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT MUST NOT HAPPEN
 *
 * **Do not write a builder for any of the ten fallback ids.** This slice MEASURES the gap. A worker
 * that "fixes" `hospital_bed_equipment` has changed the thing under measurement and destroyed the
 * before-column. Contract 3 catches it.
 *
 * Do not extend `isolated-subject-harness.ts`'s subjectKind union — that module (#163) is a
 * product-renderer lab by its own header, not a factory. Reusing its contact-sheet helper is fine.
 *
 * Do not start the Blender half. Garment and human bake matrices are a separate slice.
 *
 * No new `eslint-disable`, `@ts-ignore`, `@ts-expect-error` or `OPENCLAW_SKIP_HOOKS` in source paths.
 * Never raise a file-size ceiling; split instead.
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS THE
 * OPPOSITE DIRECTION FROM THE DEFECT — say so IN THE FIRST REPORT YOU WRITE, at the moment you find
 * it, BEFORE running a corrected version. Running a corrected version afterwards is fine.
 *
 * SCOPE: the two in-process generators and the harness that sweeps them. Says NOTHING about garment
 * or body generation (Blender, separate slice), about the runtime app, or about whether any generated
 * thing looks clinically right — that needs a clinician.
 */

const load = async () =>
  import("./generator-sweep-harness.js") as Promise<Record<string, unknown>>;

type LedgerRow = {
  subjectId: string;
  subjectFamily: "equipment" | "room";
  /** Parameter set that produced this variant; {} for a single-shot subject. */
  params: Record<string, number | string | boolean>;
  meshCount: number;
  triangles: number;
  partNames: string[];
  worldAabb: { min: [number, number, number]; max: [number, number, number] };
  distinctMaterialColors: number;
  /** After merging vertices by position — index-based counts split on material (#121/§6t). */
  connectedComponents: number;
  /** True when the id resolved to buildGenericClinicalEquipmentFallback. */
  resolvedToFallback: boolean;
};

type Report = {
  /** Every declared equipment id and every environment, enumerated from what ships. */
  ledger: LedgerRow[];
  /** Sweeps performed: subject family -> parameter name -> values rendered. */
  sweeps: { subjectId: string; param: string; values: (number | string)[] }[];
  contactSheetPaths: string[];
  claimScope: string;
  notEvidenceFor: string[];
};

type Inspect = () => Promise<Report>;

describe("the in-process generators are swept in a harness (#194)", () => {
  it("every declared equipment id and environment is swept, enumerated from what ships", async () => {
    const mod = await load();
    const inspect = mod["inspectGeneratorSweep"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const equipment = report.ledger.filter((r) => r.subjectFamily === "equipment");
    const rooms = report.ledger.filter((r) => r.subjectFamily === "room");

    expect(
      new Set(equipment.map((r) => r.subjectId)).size,
      "fewer than 29 distinct equipment ids — is the list hardcoded?",
    ).toBeGreaterThanOrEqual(29);
    expect(
      new Set(rooms.map((r) => r.subjectId)).size,
      "fewer than 14 environments swept",
    ).toBeGreaterThanOrEqual(14);

    // Every row must carry real geometry facts, not placeholders.
    for (const row of report.ledger) {
      expect(row.triangles, `${row.subjectId} reports zero triangles`).toBeGreaterThan(0);
      expect(row.partNames.length, `${row.subjectId} reports no part names`).toBeGreaterThan(0);
    }
  }, 900_000);

  it("a parameter sweep produces measurably distinct geometry per variant", async () => {
    // The cheap green is calling each builder once and calling it a sweep. A sweep whose variants are
    // geometrically identical is one render repeated.
    const mod = await load();
    const inspect = mod["inspectGeneratorSweep"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.sweeps.length, "no parameter sweep was performed").toBeGreaterThan(0);

    for (const sweep of report.sweeps) {
      expect(sweep.values.length, `sweep of ${sweep.param} has fewer than 3 values`)
        .toBeGreaterThanOrEqual(3);

      const rows = report.ledger.filter((r) => r.subjectId === sweep.subjectId && sweep.param in r.params);
      expect(rows.length, `no ledger rows recorded for the ${sweep.param} sweep`)
        .toBeGreaterThanOrEqual(sweep.values.length);

      const signature = (r: LedgerRow) =>
        `${r.triangles}|${r.worldAabb.max.map((v) => v.toFixed(3)).join(",")}`;
      const distinct = new Set(rows.map(signature));
      expect(
        distinct.size,
        `sweeping ${sweep.param} on ${sweep.subjectId} produced ${distinct.size} distinct geometries `
        + `across ${rows.length} variants — the parameter does not reach geometry`,
      ).toBeGreaterThan(1);
    }
  }, 900_000);

  it("the fallback ids are measured, not fixed (COUNTERWEIGHT)", async () => {
    // Ten ids resolve to a 3-mesh / 56-triangle box. This slice measures that gap; it does not close
    // it. A worker that writes a hospital-bed builder has changed the thing under measurement.
    const mod = await load();
    const inspect = mod["inspectGeneratorSweep"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const fallback = report.ledger.filter((r) => r.subjectFamily === "equipment" && r.resolvedToFallback);

    expect(
      new Set(fallback.map((r) => r.subjectId)).size,
      "fewer than 10 ids resolve to the fallback — did this slice write builders instead of measuring?",
    ).toBeGreaterThanOrEqual(10);

    // And the fallback must still BE the fallback: 3 meshes, small triangle count.
    for (const row of fallback) {
      expect(row.meshCount, `${row.subjectId} is marked fallback but has ${row.meshCount} meshes`)
        .toBeLessThanOrEqual(4);
    }

    expect(report.contactSheetPaths.length, "no contact sheet was produced for the orchestrator to grade")
      .toBeGreaterThanOrEqual(2);
    expect(report.notEvidenceFor.join(" ").toLowerCase()).toContain("clinical");
  }, 900_000);
});
