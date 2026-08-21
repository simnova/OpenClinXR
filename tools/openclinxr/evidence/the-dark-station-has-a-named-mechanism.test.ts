/**
 * #500 — MEASURE ONLY. Name why one of fourteen stations captures as a near-black frame.
 * `reject_measured` closes this successfully. Do not fix anything.
 *
 * MEASURED 2026-08-21 (orchestrator). IMMUTABLE — flip the assertion and append a
 * `## FIXED (#500)` block below; do not rewrite these tables.
 *
 * THE DEFECT, greyscale over the 3D viewport only (y 70:820, x 0:1005; HUD starts ~1020px):
 *
 *   station                              col          median  mean  p90   frame<12
 *   ward_delirium_med_rec_v1             known-good     28.0  58.4  133     18.5%
 *   postop_fever_consult_pressure_v1     known-good     27.0  58.0  151     26.1%
 *   ed_stroke_alert_handoff_v1           TREATMENT       0.0  26.6  132     59.0%
 *
 * p90 is BLIND (133/151/132) — the lit doorway and the actors are as bright in the bad frame.
 * The distribution collapses instead. Holds across three crops (treatment 0-6, known-good >=26).
 *
 * SIX HYPOTHESES OF MINE, ALL DEAD BY MEASUREMENT. Do not spend a turn on any of them:
 *
 *   1. camera outside the room        FALSE  camX -3.162 is inside interiorMin -3.387
 *   2. camera jammed against a wall   TRUE OF ALL THREE  0.230 / 0.203 / 0.225 m
 *   3. cameraInsideRoom flag          CONSTANT true across the pair — discriminates nothing
 *   4. floorVisible flag              CONSTANT false across the pair — discriminates nothing
 *   5. lighting differs               IDENTICAL: 2 lights both rooms, HemisphereLight i=2.2
 *                                     f4f0dc + DirectionalLight i=2.5 ffffff at [3,5,4],
 *                                     totalVisibleIntensity 4.70, bg 101820, no env map
 *   5b. light is on one side, bad camera on the other
 *                                     DEAD: postop camX -3.55 is the SAME side and grades 27
 *   6. the stroke bay's `Circle022` mesh name is anomalous
 *                                     FALSE: Circle.NNN is the convention in EVERY room —
 *                                     inpatient-ward Circle.028, surgical-ward Circle.022,
 *                                     stepdown Circle.070. All four rooms: 4 meshes, white.
 *
 * A SEVENTH GUESS FROM ME IS WORTH NOTHING. Measure the running scene. One unranked observation,
 * offered as a lead and possibly wrong like the six above: at runtime ward's two largest visible
 * meshes are named `bedroom_00exterior` + `bedroom_00wall`, while the stroke bay has
 * `bedroom_01exterior` + `Circle022` — so some runtime pass renamed ward's wall and not this one.
 * That may be cosmetic. It may all be none of these (§6l).
 *
 * MY OWN INSTRUMENT FAILED HERE TOO, disclosed so it is not rebuilt: I tried to find meshes whose
 * world AABB contains the camera and got `camera=[0.18,1.32,3.73]` IDENTICAL for both stations,
 * matching neither manifest position. `scene.traverse(o => o.isCamera)` returns the WRONG camera.
 * Use the capture path's own camera, not the first one in the graph.
 *
 * claimScope: whether a tracked report names a mechanism for the near-black capture.
 * notEvidenceFor: that the mechanism is correct (that is the orchestrator's grade), or that
 *                 anything is fixed. Nothing here asks for a fix.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const REPORT = "tools/openclinxr/evidence/dark-station-mechanism-report.json";
const VERDICTS = ["mechanism_named", "reject_measured", "inconclusive_blocked", "other"] as const;

describe("#500 the near-black station has a named mechanism", () => {
  it("the known-good column is real — both control stations exist in the bank", async () => {
    const c = await import("../../../packages/openclinxr/asset-registry/src/actor-casting.ts");
    const ids = c.listShippedCastScenarioIds() as string[];
    for (const s of ["ward_delirium_med_rec_v1", "postop_fever_consult_pressure_v1", "ed_stroke_alert_handoff_v1"]) {
      expect(ids, `${s} must ship or this contract measures nothing`).toContain(s);
    }
  });

  it.fails("(1) a tracked report names a mechanism, or honestly rejects", () => {
    expect(existsSync(REPORT), `${REPORT} must exist and be TRACKED (#396)`).toBe(true);
    const r = JSON.parse(readFileSync(REPORT, "utf8")) as Record<string, unknown>;

    expect(VERDICTS, `verdict must be one of ${VERDICTS.join("|")}`).toContain(r.verdict);

    // Every verdict, including reject_measured, must carry the SAME evidence — otherwise
    // "reject" becomes the cheap exit rather than an honest one.
    expect(typeof r.mechanism, "mechanism must be prose naming what makes the frame dark").toBe("string");
    expect(String(r.mechanism).length, "one sentence minimum").toBeGreaterThan(60);

    // A locator: a file:line, a mesh name, or a measured quantity — not a story.
    expect(String(r.locator ?? ""), "locator must cite a file:line, a named mesh, or a number").toMatch(/[:\d]/);

    // The known-good column must be re-measured by the worker, not copied from this header.
    const kg = r.knownGood as Record<string, number> | undefined;
    expect(kg, "knownGood must carry re-measured medians for BOTH control stations").toBeTruthy();
    expect(Object.keys(kg ?? {}).length).toBeGreaterThanOrEqual(2);

    // Non-vacuity: the treatment must actually be darker in the worker's own measurement.
    expect(Number(r.treatmentMedian), "treatment median").toBeLessThan(12);
    for (const v of Object.values(kg ?? {})) expect(Number(v), "known-good median").toBeGreaterThan(20);

    expect(String(r.reproducedBy ?? ""), "a command someone else can re-run").toContain("pnpm");
  });
});
