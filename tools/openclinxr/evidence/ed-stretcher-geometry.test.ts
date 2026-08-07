import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#97) — the ED bay shows a stretcher standing on its edge, and hides the
 * correctly-shaped one it already has.
 *
 * ALL THREE ARE `it.fails` AND ALL THREE FLIP TO `it(`. They are not all REDs:
 *   (1) and (2) are REDs — behaviour that does not exist.
 *   (3) is a COUNTERWEIGHT — #81's patient chair already builds real geometry and must still do so
 *       after you change the fixture builder. It is `it.fails` only because the module is absent.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * THE DEFECT, MEASURED — do not re-derive this
 *
 * Every node in `ed-exam-bay-shell.glb` has IDENTITY ROTATION, and the bed group scales read:
 *
 *   ed_exam_bay_stretcher_base       0.78 x 1.02 x 0.08     pos y =  0.00
 *   ed_exam_bay_stretcher_mattress   0.72 x 0.95 x 0.12     pos y =  0.00
 *   ed_exam_bay_stretcher_left_rail  0.04 x 0.88 x 0.18     pos y =  0.00
 *   ed_exam_bay_bed_pillow           0.42 x 0.20 x 0.08     pos y = -0.68
 *   ed_exam_bay_bed_wheel_locks      0.10 x 0.10 x 0.05     pos y = +0.82
 *
 * In a Y-up glTF the mattress is 0.72 wide, 0.95 TALL, 0.12 deep — a slab on its edge. That is the
 * large white box dominating every ED capture and occluding the nurse.
 *
 * The giveaway is the small parts: WHEEL LOCKS 0.82 m IN THE AIR, PILLOW 0.68 m UNDERGROUND. Read as
 * Z-up they are correct — locks on the floor, pillow on the deck. **The shell was authored Z-up and
 * exported without the Y-up conversion.** Same class as #67's 90-degree armature rotation, one level
 * up from the humanoids. The mesh list is 41 unit cubes named `Cube.0NN`; only the NODES carry
 * meaning.
 *
 * AND THE RUNTIME ALREADY HAS A CORRECT BED, WHICH IT HIDES. `main.ts:3502-3510`:
 *
 *     const bed = new Mesh(new BoxGeometry(2.35, 0.24, 0.92), …);   // correct proportions
 *     bed.position.set(-0.42, 0.42, -0.08);
 *     } else if (isDynamicGeneratedEncounterSceneMode()) {
 *       bed.visible = false;   // "…generated environment supply encounter context"
 *
 * It is suppressed PRECISELY WHEN the generated environment loads, on the assumption the shell
 * supplies a bed. The shell supplies one standing on edge. **Two stretchers: the working one hidden,
 * the broken one shown.**
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * THE DECISION IS YOURS AND MUST BE NAMED IN THE COMMIT MESSAGE, with what you rejected. Routes,
 * UNRANKED, and possibly none is best:
 *   - build a procedural stretcher on the existing `slotId: "stretcher"`
 *     (`environment-descriptors.ts:263-265`), following #81's `buildPatientChair`
 *     (`station-chair.ts`) — that precedent produced real geometry and passed a pixel grade
 *   - re-export or correct the shell's axis convention so its own stretcher stands correctly
 *   - stop suppressing the existing `main.ts:3502` bed and suppress the shell's stretcher nodes
 *
 * WHATEVER YOU PICK, THERE MUST BE EXACTLY ONE. Contract (2) exists because dual geometry doubles
 * the occlusion that already hides the nurse, and because "I added a good one" while a broken one
 * remains is the most likely way this goes wrong.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * SUPINE POSTURE IS EXPLICITLY OUT OF SCOPE. `supine` is in the posture union
 * (`actor-posture.ts:14-15`) but its clip falls back to standing (`:93-98`), and there is no supine
 * contact measure analogous to #87's pelvis-against-seat. Putting the patient ON the stretcher is a
 * follow-on slice. Do NOT attempt it here — this slice is a readable stretcher.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THE THREE PULL APART. (1) demands a bed-shaped stretcher exists and is satisfiable while the
 * broken one is still in frame. (2) demands only one, and is satisfiable by deleting both. (3) is
 * green today and forbids breaking the chair while editing the fixture builder they share.
 *
 * THE MACHINE HALF IS A FLOOR. "Length exceeds height and the deck sits at plausible bed height" does
 * not mean it looks like a stretcher — a correctly-proportioned box is still a box. **The pixel grade
 * owns that verdict and closes the issue.** Six gates in this repo have passed on the defect they
 * were written to catch; this one is deliberately modest about what it proves.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectStationFixtureGeometry({ environmentId })`.
 * Change the call sites and say why if a different shape is better. What must not change: dimensions
 * come from the BUILT SCENE's world-space bounds, not from the descriptor's declared numbers — the
 * declaration is what is currently right while the render is wrong.
 *
 * NOT DETERMINED, and I have not distinguished between these:
 *   - whether the shell's other 37 nodes are equally axis-broken (wheel locks and pillow say yes, but
 *     I checked only the bed group)
 *   - whether the shell can be re-exported Y-up, or whether its source is gone and suppression is
 *     the only path
 *   - whether anything else consumes those node names and would break if they moved
 * Find out what you need and record what you find, even if it contradicts this header.
 *
 * IN-SCOPE VISUAL VERDICT required: "the stretcher looks like ___". If the nurse becomes visible from
 * the doorway camera once the slab is gone, say so. Separately name any out-of-scope wrongness — the
 * object and what it looks like, not the word "deformed".
 *
 * SCOPE: whether the ED bay renders one bed-shaped stretcher. Says NOTHING about clinical accuracy of
 * a stretcher — that needs a clinician — nor about the other 37 fixtures.
 */

const load = async () =>
  import("./ed-stretcher-geometry.js") as Promise<Record<string, unknown>>;

type FixtureGeometry = {
  fixtureId: string;
  /** World-space bounds of what the built scene actually contains, not declared descriptor numbers. */
  widthMeters: number;
  heightMeters: number;
  lengthMeters: number;
  /** Top surface Y — where a body would rest. */
  deckTopY: number;
  isMarkerCube: boolean;
  visible: boolean;
};
type Inspect = (input: { environmentId: string }) => Promise<{ fixtures: FixtureGeometry[] }>;

const ED = "ed_exam_bay_v1";

const stretchers = (f: FixtureGeometry[]) => f.filter((x) => /stretcher|bed/i.test(x.fixtureId) && x.visible);

describe("the ED bay renders one bed-shaped stretcher (#97)", () => {
  it.fails("the visible stretcher is longer than it is tall and its deck sits at bed height", async () => {
    // The shell's mattress is 0.72 wide x 0.95 TALL x 0.12 deep — a slab on edge. A stretcher is
    // longer than tall, with a deck a body could lie on. Deliberately loose: this is a floor, not a
    // description of a stretcher.
    const mod = await load();
    const inspect = mod["inspectStationFixtureGeometry"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!({ environmentId: ED });
    const visible = stretchers(report.fixtures);
    expect(visible.length, "no visible stretcher in the ED bay").toBeGreaterThan(0);

    for (const s of visible) {
      expect(s.isMarkerCube, `${s.fixtureId} is still a layout marker`).toBe(false);
      expect(
        s.lengthMeters,
        `${s.fixtureId} is ${s.lengthMeters.toFixed(2)}m long and ${s.heightMeters.toFixed(2)}m tall`,
      ).toBeGreaterThan(s.heightMeters);
      expect(s.deckTopY, `${s.fixtureId} deck top is at y=${s.deckTopY.toFixed(2)}`).toBeGreaterThan(0.4);
      expect(s.deckTopY, `${s.fixtureId} deck top is at y=${s.deckTopY.toFixed(2)}`).toBeLessThan(0.95);
    }
  }, 600_000);

  it.fails("exactly one stretcher is visible", async () => {
    // Kills the most likely failure: adding a good stretcher while the broken slab stays in frame.
    // Dual geometry doubles the occlusion that already hides the nurse from the doorway camera.
    const mod = await load();
    const inspect = mod["inspectStationFixtureGeometry"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!({ environmentId: ED });
    const visible = stretchers(report.fixtures);
    expect(
      visible.map((s) => s.fixtureId),
      `${visible.length} stretchers are visible at once`,
    ).toHaveLength(1);
  }, 600_000);

  it.fails("the patient chair still builds real geometry (COUNTERWEIGHT — already true since #81)", async () => {
    // The chair and the stretcher share a fixture builder. A change that gives the stretcher shape
    // must not cost the chair its own — #81 built it and #87 seated a patient on it.
    const mod = await load();
    const inspect = mod["inspectStationFixtureGeometry"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!({ environmentId: "telehealth_consult_room_v1" });
    const chair = report.fixtures.find((f) => /chair/i.test(f.fixtureId));
    expect(chair, "no chair fixture found").toBeDefined();
    expect(chair!.isMarkerCube, "the patient chair regressed to a marker cube").toBe(false);
    expect(chair!.deckTopY, `chair seat is at y=${chair!.deckTopY.toFixed(2)}`).toBeGreaterThan(0.3);
  }, 600_000);
});
