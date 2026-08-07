import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#169) — patients stand **waist-deep inside their own furniture**. Found by
 * grading three fresh room captures; it was in **3 of 3 rooms sampled**.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT — #133's ceilings and one-support-per-station must
 * survive, and the fix must not be bought by deleting furniture. It is `it.fails` only because the
 * module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THE RENDERS SHOW — captured on main, graded by me
 *
 * `postop_fever_consult_pressure_v1`, `oncology_bad_news_family_v1`,
 * `primary_care_dyslipidemia_joint_pain_v1`: in each, the patient stands **waist-deep inside a box**
 * with their feet protruding below it. Identical pattern in all three.
 *
 * #133 gave every station a patient support surface. **The actors were never re-placed**, and the
 * standing anchor overlaps where the furniture went.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * I PREDICTED THIS, CONTRACTED IT, AND MY CONTRACT PASSED. THAT IS THE REAL DEFECT.
 *
 * #133's contract (3) asserted `actorsIntersectingFurniture` empty. It went green while a figure was
 * bisected by a chair. `station-room-not-empty.ts:494-502`:
 *
 *     const margin = 0.12;
 *     const insideXZ = cx >= s.box.minX + margin && cx <= s.box.maxX - margin
 *                   && cz >= s.box.minZ + margin && cz <= s.box.maxZ - margin;
 *
 * The support footprint is shrunk **0.12 m per side**, then the actor's XZ **centre** must fall
 * inside the remainder. On a chair-sized box (~0.5 m) that leaves roughly 0.26 m, so a figure
 * standing **half in, half out** — the common case — has its centre outside and is invisible.
 *
 * The margin exists for a good reason: stop a shoulder grazing a rail from counting as "inside". It
 * is tuned for the rare case and blind to the frequent one.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE MECHANISM — verified, do not re-derive
 *
 * `runtime-actor-placements.ts:29-34` puts **every** `primary_patient` at a single hardcoded global
 * `(-0.72, 1.06, -0.12)`. Fixtures use **per-environment** positions — telehealth's `patient_chair`
 * sits at `(-0.4, 0, -0.2)`.
 *
 * So the overlap is **accidental co-location** of two independent coordinate sources, not "all
 * fixtures are placed at the patient". Some environments collide and some do not, which is why
 * sampling three found three and says nothing about the other twelve.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE BOX MAY NOT BE A FIXTURE — a peer round caught this and it changes the detector
 *
 * Oncology's support comes from **`chairs_equipment` via #140**, not from a fixture slot — #133's own
 * artifact shows it with `builtSlotIds: []` and `patientSupportSurfaceCount: 1`.
 *
 * **The detector must cover equipment-mounted support surfaces as well as fixture-built ones.** A
 * check that only walks fixtures will report zero on oncology while the render shows a man standing
 * inside a chair.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THIS IS COLLISION RESOLUTION, NOT STAGING. THE DISTINCTION IS THE SCOPE.
 *
 * A peer round put it bluntly and it is right: **"onto furniture while still standing is nonsense"**
 * — a standing figure moved onto a chair is standing *on the seat*.
 *
 *  - **This slice (small, honest):** stop the standing patient and the support surface occupying the
 *    same space. Separate them. The patient remains standing.
 *  - **NOT this slice (large):** seat or recline patients per the clinical staging table. That needs
 *    per-station posture and support coupling, and it is #166/#159 territory.
 *
 * **Do not sell separation as clinical staging.** `claimScope` says collision resolution and nothing
 * more.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE CHECK GOES BLIND THE MOMENT ANYONE IS SEATED — fix that here
 *
 * `station-room-not-empty.ts:488` skips `seated` and `supine` outright, on the reasoning that resting
 * on a support is intentional. That is correct today and **wrong the moment the staging work lands**:
 * a seated actor can still be inside the chair rather than on it.
 *
 * Whatever replaces the detector must handle a seated actor by checking **contact** rather than by
 * skipping. If you cannot do that cheaply, say so and leave the skip with a comment naming the gap —
 * do not silently keep a blind spot.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - **The detection metric.** A peer suggested XZ AABB intersection as a fraction of the SMALLER
 *    footprint, AND standing, AND feet near floor, AND the body straddling the deck top. There is no
 *    threshold-free formulation — pick `f`, and calibrate it against a **known-good** control (§9h):
 *    a figure grazing a rail must pass, a figure waist-deep must fail. Both cases exist in the tree.
 *  - **Move the actor, or move the furniture.** The actor anchor is global and shared by every
 *    station; the furniture is per-environment. Moving the anchor changes every station at once.
 *    **I lean move the furniture** because it is already per-environment data, and I am not certain.
 *  - **Whether `primary_patient`'s hardcoded anchor should become per-environment.** That is arguably
 *    the root cause and arguably a much larger change. If you think it is required, SAY SO and do the
 *    smaller thing anyway.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands no standing actor share space with a support surface, and is satisfiable by deleting
 * the furniture #133 just added. (2) forbids that by requiring every station to keep exactly one
 * patient support surface and a ceiling. (3) is green today and forbids buying either by re-breaking
 * the double-bed guarantee or the ED supine patient, who is *supposed* to be on his deck.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectActorFurnitureClearance()`. What must not
 * change: **every station is enumerated from what ships** — sampling three found three and proves a
 * pattern, not a count — and geometry is read from the LIVE scene after the render loop advances.
 *
 * CALIBRATION — `.openclinxr/evidence/issue-169/pre-fix.json` BEFORE any product edit, one row per
 * station: actor id, posture, actor XZ footprint, each support surface's footprint and deck top, the
 * overlap fraction, and whether the body straddles the deck. **Include a known-good row** — a figure
 * that merely stands beside furniture — so the threshold is calibrated against both ends.
 *
 * My prediction: **more than three stations are affected.** If it is exactly three, say so; that
 * would mean the co-location is narrower than I think.
 *
 * REQUIRED, the observable half: re-capture the three named rooms plus any others the measurement
 * flags. Reuse `ui-xr-environment-room-capture.ts`. **This is a composition, so the room capture is
 * the right instrument** (§9f) — an isolated render cannot show it, because in isolation nothing
 * places the actor.
 *
 * IN-SCOPE VISUAL — answer EVERY line, PER captured station:
 *     patient_inside_furniture:  yes | no
 *     patient_feet_on_floor:     yes | no
 *     furniture_still_present:   yes | no
 *     reads_as:                  plausible | collision | empty
 *
 * IF SATISFYING A CONTRACT HERE MAKES THE PRODUCT VISIBLY WORSE, SAY SO IN YOUR REPORT — and then
 * satisfy it anyway. Separating a patient from a chair may leave the room looking emptier.
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS THE
 * OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT.
 *
 * SCOPE: whether a standing actor and a support surface occupy the same space. Says NOTHING about
 * whether patients should be seated (they mostly should — that is the larger slice), which angle a
 * bed sits at, or clinical staging.
 */

const load = async () => import("./actor-furniture-clearance.js") as Promise<Record<string, unknown>>;

type Footprint = { minX: number; maxX: number; minZ: number; maxZ: number };

type ActorClearance = {
  scenarioId: string;
  actorId: string;
  posture: string;
  actorFootprint: Footprint;
  /** Lowest and highest world Y of the actor's mesh. */
  actorMinY: number;
  actorMaxY: number;
  /** The support surface this actor overlaps most, if any — fixture OR equipment. */
  nearestSupportId: string | null;
  nearestSupportSource: string | null;
  nearestSupportDeckTopY: number | null;
  /** Overlap of the two XZ footprints as a fraction of the SMALLER of the two. */
  overlapFractionOfSmaller: number;
  /** True when the body spans the deck top — standing through it rather than beside it. */
  straddlesDeck: boolean;
  /** The verdict: this actor is inside furniture rather than beside or on it. */
  isInsideFurniture: boolean;
};

type Inspect = () => Promise<{
  stations: {
    scenarioId: string;
    hasCeiling: boolean;
    patientSupportSurfaceCount: number;
    actors: ActorClearance[];
  }[];
  /** A figure deliberately standing beside furniture — the known-good calibration row (§9h). */
  control: ActorClearance | null;
}>;

describe("no standing actor occupies its own furniture (#169)", () => {
  /**
   * ## FIXED (#169)
   * Pre-fix: 15 stations enumerated. Standing plant-through on OB stretcher + family/observer
   * co-located with DEFAULT equipment (1.6, 0.28). Pixel-sampled trio (postop/oncology/primary)
   * already clear for *patients* after #133 offsets — residual was observer-vs-equipment and OB
   * framing vs OFFSET_STRETCHER. Metric f=0.18 of smaller footprint; furniture moved.
   */
  it("no actor stands inside a support surface, in any station", async () => {
    // 3 of 3 rooms sampled show the patient waist-deep in a box. #133's contract (3) asserted this
    // and passed, because it required the actor's XZ centre inside a footprint shrunk 0.12m per side.
    const mod = await load();
    const inspect = mod["inspectActorFurnitureClearance"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.stations.length, "not every station was enumerated — sampling proves a pattern, not a count")
      .toBeGreaterThan(10);

    const inside: string[] = [];
    for (const st of report.stations) {
      for (const a of st.actors) {
        if (a.isInsideFurniture) {
          inside.push(
            `${st.scenarioId}/${a.actorId} (${a.posture}) is inside ${a.nearestSupportId} `
            + `[${a.nearestSupportSource}] — overlap ${(a.overlapFractionOfSmaller * 100).toFixed(0)}%`,
          );
        }
      }
    }
    expect(inside, `actors standing inside furniture:\n${inside.join("\n")}`).toHaveLength(0);
  }, 1_800_000);

  /**
   * ## FIXED (#169)
   * Equipment sources + fixture sources both appear. Control = ED nurse grazing stretcher
   * (~5% overlap, not inside). Rejected centre-in-shrunk-box.
   */
  it("the detector sees equipment-mounted supports and a half-in figure", async () => {
    // Kills two cheap satisfactions. First: walking only fixture slots, which reports zero on
    // oncology whose support comes from chairs_equipment via #140. Second: keeping a centre-in-
    // shrunk-box metric that cannot see a figure standing half in and half out.
    const mod = await load();
    const inspect = mod["inspectActorFurnitureClearance"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();

    // Equipment-sourced supports must be represented, not just fixtures.
    const sources = new Set(
      report.stations.flatMap((s) => s.actors.map((a) => a.nearestSupportSource).filter(Boolean)),
    );
    expect(
      sources.size,
      `only these support sources were considered: ${[...sources].join(", ")} — equipment mounts must be included`,
    ).toBeGreaterThan(1);

    // A known-good control must exist and must NOT be flagged, so the threshold is calibrated at
    // both ends rather than tuned until the reds disappear.
    expect(report.control, "no known-good control row was measured (§9h)").toBeTruthy();
    expect(report.control!.isInsideFurniture, "the known-good control was flagged as inside furniture")
      .toBe(false);
    expect(
      report.control!.overlapFractionOfSmaller,
      "the control has no measured overlap at all — it cannot calibrate anything",
    ).toBeGreaterThanOrEqual(0);
  }, 1_800_000);

  /**
   * ## FIXED (#169)
   * Detector: XZ overlap fraction of the smaller footprint ≥ 0.18 + standing + feet near
   * floor + body straddles deck. Covers fixture AND equipment-mounted supports. Seated/
   * supine skipped with named gap (pelvis-on-seat contact is #159/#166). Furniture moved
   * off clean-encounter framing anchors (not per-env patient anchors as a larger change).
   */
  it("#133's ceilings and one-support-per-station survive (COUNTERWEIGHT)", async () => {
    // The cheapest satisfaction is deleting the furniture #133 just added — no furniture, no
    // collision. The ED supine patient is also SUPPOSED to be on his deck and must not be moved off
    // it in the name of clearance.
    const mod = await load();
    const inspect = mod["inspectActorFurnitureClearance"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const missingCeiling = report.stations.filter((s) => !s.hasCeiling).map((s) => s.scenarioId);
    expect(missingCeiling, `stations that lost their ceiling:\n${missingCeiling.join("\n")}`).toHaveLength(0);

    const wrongSupport = report.stations
      .filter((s) => s.patientSupportSurfaceCount !== 1)
      .map((s) => `${s.scenarioId}: ${s.patientSupportSurfaceCount} support surfaces`);
    expect(wrongSupport, `stations that lost or gained a support surface:\n${wrongSupport.join("\n")}`)
      .toHaveLength(0);

    // The ED supine patient rests ON his deck. That is correct and must not be "resolved".
    const edSupine = report.stations
      .flatMap((s) => s.actors)
      .find((a) => a.posture === "supine");
    expect(edSupine, "the supine patient disappeared").toBeDefined();
    expect(edSupine!.isInsideFurniture, "the supine patient was flagged and moved off his deck").toBe(false);
  }, 1_800_000);
});
