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

  it("every equipment id is accounted for — own silhouette, named family, or GLB (#202)", async () => {
    // #198 left FOURTEEN ids resolving to the identical 56-triangle grey pole, and five parametric
    // ids colliding in pairs or triples: exam_table / post_op_bed / pediatric_stretcher all at 48
    // triangles, iv_pump / fetal_monitor both at 84.
    //
    // THE CHEAP GREEN is fourteen unique builders. The #198 worker named it: "do NOT make all
    // fourteen unique; that is the exam-table collapse again with more code." Families are the
    // answer, so this contract requires every id to be ACCOUNTED FOR — own geometry, a NAMED family,
    // or a GLB — and forbids members of one family sharing a silhouette with each other.
    const mod = await load();
    const inspect = mod["inspectGeneratorSweep"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const equipment = report.ledger.filter((r) => r.subjectFamily === "equipment");

    // 1. Nothing is silently a pole. Every id declares how it resolved.
    const unaccounted = equipment
      .filter((r) => r.resolvedToFallback && !(r as { family?: string }).family)
      .map((r) => r.subjectId);
    expect(unaccounted, "ids still resolving to the generic fallback with no declared family").toEqual([]);

    // 2. silhouetteKey uses an EXTENT per axis, never a single-sided max (§10o).
    const keyOf = (r: typeof equipment[number]) =>
      `${r.meshCount}|${r.triangles}|${[0, 1, 2]
        .map((i) => (r.worldAabb.max[i]! - r.worldAabb.min[i]!).toFixed(2))
        .join(",")}`;

    const byKey = new Map<string, string[]>();
    for (const row of equipment) {
      const k = keyOf(row);
      byKey.set(k, [...(byKey.get(k) ?? []), row.subjectId]);
    }
    const collisions = [...byKey.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([k, ids]) => `${ids.join(" == ")} (${k})`);
    expect(collisions, "distinct equipment ids sharing one silhouette").toEqual([]);

    // 3. #198's support surfaces must not regress when post_op_bed and pediatric_stretcher route
    //    to them. Routing means reuse, not redesign.
    for (const id of ["hospital_bed_equipment", "stretcher_equipment", "side_rails_equipment"]) {
      const row = equipment.find((r) => r.subjectId === id);
      expect(row, `${id} vanished from the ledger`).toBeTruthy();
      expect(row!.resolvedToFallback, `${id} regressed to the generic fallback`).toBe(false);
    }

    expect(report.contactSheetPaths.length, "no contact sheet for the orchestrator to grade")
      .toBeGreaterThanOrEqual(2);
    expect(report.notEvidenceFor.join(" ").toLowerCase()).toContain("clinical");
  }, 900_000);

  it("the clinical support surfaces have their own silhouettes (#198)", async () => {
    // #194 measured 19 of 37 ids resolving to buildGenericClinicalEquipmentFallback — base box +
    // upright cylinder + tray box, 3 meshes, 56 triangles, an identical grey pole for all of them.
    // A hospital bed, a stretcher and bed side rails were among them.
    //
    // #198 flips this from "the gap is measured" to "the support surfaces are built". THE CHEAP GREEN
    // is three more clones of the exam-table deck — #194 already measured that 18 parametric kinds
    // collapse to ~8 triangle signatures, so having a builder is not having a silhouette. The
    // collision check below is what catches it.
    const mod = await load();
    const inspect = mod["inspectGeneratorSweep"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const equipment = report.ledger.filter((r) => r.subjectFamily === "equipment");

    const SUPPORT = ["hospital_bed_equipment", "stretcher_equipment", "side_rails_equipment"] as const;
    for (const id of SUPPORT) {
      const row = equipment.find((r) => r.subjectId === id);
      expect(row, `${id} is not in the ledger at all`).toBeTruthy();
      expect(
        row!.resolvedToFallback,
        `${id} still resolves to the generic fallback — 3 meshes, 56 triangles, a grey pole`,
      ).toBe(false);
    }

    // silhouetteKey is partCount|triangles|footprintExtent — an EXTENT, not a single-sided max (§10o).
    const keyOf = (r: typeof equipment[number]) => {
      const e = [0, 1, 2].map((i) => (r.worldAabb.max[i]! - r.worldAabb.min[i]!).toFixed(2));
      return `${r.meshCount}|${r.triangles}|${e.join(",")}`;
    };
    const TABLE_FAMILY = ["exam_table_equipment", "post_op_bed_equipment", "pediatric_stretcher_equipment"];
    const collisions: string[] = [];
    for (const id of SUPPORT) {
      const row = equipment.find((r) => r.subjectId === id);
      if (!row) continue;
      for (const other of equipment) {
        if (other.subjectId === id) continue;
        const comparable = SUPPORT.includes(other.subjectId as never) || TABLE_FAMILY.includes(other.subjectId);
        if (comparable && keyOf(other) === keyOf(row)) {
          collisions.push(`${id} shares a silhouette with ${other.subjectId} (${keyOf(row)})`);
        }
      }
    }
    expect(collisions, "support surfaces sharing a silhouette — clones of one deck, not distinct objects")
      .toEqual([]);

    // The REST must stay fallback. This slice fixes the support surfaces; absorbing the other
    // fourteen into a generic improvement destroys the before-column.
    const stillFallback = equipment.filter((r) => r.resolvedToFallback);
    expect(
      new Set(stillFallback.map((r) => r.subjectId)).size,
      "fewer than 12 ids still resolve to the fallback — did this slice quietly fix more than the support surfaces?",
    ).toBeGreaterThanOrEqual(12);
    for (const row of stillFallback) {
      expect(row.meshCount, `${row.subjectId} is marked fallback but has ${row.meshCount} meshes`)
        .toBeLessThanOrEqual(4);
    }

    expect(report.contactSheetPaths.length, "no contact sheet was produced for the orchestrator to grade")
      .toBeGreaterThanOrEqual(2);
    expect(report.notEvidenceFor.join(" ").toLowerCase()).toContain("clinical");
  }, 900_000);
});
