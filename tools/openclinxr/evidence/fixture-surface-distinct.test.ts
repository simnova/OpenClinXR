import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#207). Two REDs. Both flip.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT — read from the source, not inferred from pixels
 *
 * `buildFixtureLayoutProp` (apps/ui-xr/src/station-environment.ts:59-105) has exactly THREE branches,
 * selected by SUBSTRING MATCH on the slot id:
 *
 *   monitor | shelf  -> 0.08x1.1x0.08 stand + 0.42x0.32x0.05 panel
 *   desk | laptop    -> 0.7x0.72x0.4 legs  + 0.78x0.04x0.48 top
 *   else             -> "Generic cart / layout block", 0.45x0.55x0.35 body + 0.5x0.05x0.4 top
 *
 * Slot ids declared across the bank: door_leaf, exam_surface, family_chair, learner_start,
 * overbed_surface, patient_chair, stretcher, wall_board, work_surface.
 *
 * Chairs route to `buildPatientChair`; stretchers to `buildPatientStretcher`; `learner_start` is a
 * marker cube; door and board are architecture fixtures. Everything remaining falls to the generic
 * block:
 *
 *   exam_surface     the examination table a learner examines a patient on
 *   overbed_surface  an overbed table
 *   work_surface     a desk — which does NOT contain the substring "desk"
 *
 * Three different clinical objects, one 0.45 m box. `EXAM_TABLE_LENGTH_M = 1.85` already exists at
 * `station-equipment-builders.ts:42` and describes what an exam table actually is.
 *
 * This is a NAME MATCH standing in for a KIND (§7k): the behaviour of a clinical object depends on
 * how its slot happens to be spelled.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE DESIGN IS A PEER ROUND'S, NOT MINE — I proposed something worse
 *
 * My proposal was to route fixture slots into the equipment builder family. REJECTED, and the reason
 * is structural: fixtures are placed by descriptor slots via `buildStationEnvironment`; equipment is
 * placed by a separate mount planner. Emitting these as equipment kinds lets BOTH systems place them
 * — the #133 double-bed class.
 *
 *   DO:      call the PURE builders for geometry only, keep the fixture path, stamp fixture userData.
 *   DO NOT:  emit as equipment kinds, or let the mount planner see them.
 *   DO NOT:  grow `station-equipment-families.ts` — it is at 561 lines against a 600 ceiling and this
 *            is the wrong module for layout surfaces anyway. New code goes in a sibling.
 *   NEVER:   raise a file-size ceiling. Split.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE RISK THAT MAKES THIS BIGGER THAN IT LOOKS — and it is why contract (2) exists
 *
 * A real 1.85 m exam table has a different AABB from a 0.45 m box. THREE landed contracts assert on
 * those AABBs and their baselines are obsolete by construction the moment geometry changes:
 *
 *   actor-prop-intersection      (#183)  standing actor vs non-support prop, XZ overlap >= 0.18
 *   actor-furniture-clearance    (#169)  actor vs support surface
 *   generator-sweep-harness      (#205/#206)  fixture-vs-fixture clearance, allow-list of 2
 *
 * A bigger exam table may collide with something the small box cleared. THAT IS EXPECTED. Re-place
 * the fixture slots so all three stay green — this slice is geometry PLUS placement, or it ships new
 * collisions. Do not weaken any of those assertions, and do not add an allow-list entry to dodge one.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * IF A RED HERE IS AN INSTRUMENT ARTIFACT, say so and stop — that closes the issue successfully.
 * The done_when carries no `changed:<source file>` rule precisely so an honest "nothing to fix" can
 * satisfy every proof (§11j / §11m).
 *
 * THE CAUSE IS NOT A MYSTERY — nothing generates distinct geometry for these three. This is additive
 * work, not a diagnosis. Do not spend turns hunting a bug.
 */

type SurfaceRow = {
  slotId: string;
  meshNames: string[];
  triangleCount: number;
  sizeMeters: { x: number; y: number; z: number };
  signature: string;
};

type Inspect = () => Promise<{ surfaces: SurfaceRow[] }>;

const load = () =>
  import("./fixture-surface-distinct.js") as Promise<Record<string, unknown>>;

describe("a clinical surface is not a generic box (#207)", () => {
  it("exam_surface, overbed_surface and work_surface are three different objects", async () => {
    const mod = await load();
    const inspect = mod["inspectFixtureSurfaceDistinct"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const wanted = ["exam_surface", "overbed_surface", "work_surface"];
    const found = wanted.map((id) => report.surfaces.find((s) => s.slotId === id));
    for (let i = 0; i < wanted.length; i += 1) {
      expect(found[i], `${wanted[i]} was not inspected — enumerate slot ids from the bank`).toBeTruthy();
    }

    // Distinctness by SIGNATURE, not by presence. Three boxes of identical dimensions have identical
    // signatures however many of them there are — that is exactly today's defect.
    const sigs = found.map((s) => s!.signature);
    const dupes: string[] = [];
    for (let i = 0; i < sigs.length; i += 1) {
      for (let j = i + 1; j < sigs.length; j += 1) {
        if (sigs[i] === sigs[j]) dupes.push(`${wanted[i]} and ${wanted[j]} share signature ${sigs[i]}`);
      }
    }
    expect(dupes, `clinical surfaces that are the same object:\n${dupes.join("\n")}`).toEqual([]);
  }, 900_000);

  it("an exam surface is exam-table sized, and nothing shrank to pass (COUNTERWEIGHT)", async () => {
    // The cheap green is to perturb three boxes just enough to differ. `EXAM_TABLE_LENGTH_M = 1.85`
    // is what an exam table is; a 0.45 m box is not one at any signature. Bound the REAL quantity so
    // distinctness cannot be bought with a rounding change (§7a — a threshold sourced from authored
    // data rather than invented by me).
    const mod = await load();
    const inspect = mod["inspectFixtureSurfaceDistinct"] as Inspect;
    const report = await inspect();

    const wrong: string[] = [];
    const exam = report.surfaces.find((s) => s.slotId === "exam_surface");
    if (!exam) {
      wrong.push("exam_surface was not inspected");
    } else {
      const longest = Math.max(exam.sizeMeters.x, exam.sizeMeters.z);
      if (longest < 1.5) {
        wrong.push(`exam_surface longest horizontal is ${longest.toFixed(2)}m — an exam table is 1.85m`);
      }
      if (exam.triangleCount < 24) {
        wrong.push(`exam_surface is ${exam.triangleCount} triangles — a single box is 12`);
      }
    }
    const work = report.surfaces.find((s) => s.slotId === "work_surface");
    if (work && Math.max(work.sizeMeters.x, work.sizeMeters.z) >= 1.5) {
      wrong.push(`work_surface is ${Math.max(work.sizeMeters.x, work.sizeMeters.z).toFixed(2)}m — a desk is not an exam table`);
    }
    expect(wrong, `surfaces that are not what they claim to be:\n${wrong.join("\n")}`).toEqual([]);
  }, 900_000);
});
