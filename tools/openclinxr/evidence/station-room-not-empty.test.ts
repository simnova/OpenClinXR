import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#133/#143) — ten stations render no room props at all after #149, and my own
 * pixel grade of the result was that **the absence of clinical furniture became the dominant
 * impression**. The rooms are also open-topped boxes: there is no ceiling and no fourth wall.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT — the ED bay's stretcher and #140's equipment must not
 * be duplicated or lost. It is `it.fails` only because the module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * A PEER ROUND TALKED ME OUT OF THE SLICE I WAS GOING TO WRITE. THAT CORRECTION IS THE HEADER.
 *
 * I was going to spend this on a parametric DETAIL kit — skirting, cove, window reveals — because
 * #130 measured `ed_exam_bay_v1` at **204 triangles against a 180,000 budget** and that 0.1% figure
 * is striking. The peer's reading, which I accept and which matches my own grade:
 *
 * **Geometry is the unspent TRIANGLE axis. It is not the unspent PRODUCT axis.** A room with
 * mouldings and no bed still grades empty. Support surfaces and equipment are what is missing.
 *
 * So this slice buys the two things that actually change what a learner sees — a closed room and a
 * patient support surface — and deliberately does NOT buy trim.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * MEASURED BY ME — trust these, verify the inferences
 *
 * `station-environment.ts:60-109` builds the ENTIRE room: a floor box, `back-wall`, `left-wall`,
 * `right-wall`, one trim strip, and 0.18³ marker cubes. **There is no ceiling and no front wall.**
 * The file is 156 lines with seven geometry calls.
 *
 * The capture camera sits at `y = 2.05` (`ui-xr-environment-room-capture.ts:520`) inside a 2.65 m
 * room, so the black band across the top of every capture is the **open top**, not the camera being
 * above the walls. I checked this specifically because "add a ceiling" would be the wrong fix if the
 * camera were outside.
 *
 * Fixture slots, enumerated from `environment-descriptors.ts`:
 *
 * | environment | declared slots |
 * |---|---|
 * | `ed_exam_bay_v1` | stretcher, monitor, ecg_cart, learner_start |
 * | `telehealth_home_visit_v1` | patient_chair, laptop_desk, medication_shelf, learner_start |
 * | **the other twelve** | `shell()`'s default: **primary_patient, learner_start** |
 *
 * `isStretcherSlotId` (`station-stretcher.ts:131`) and `isPatientChairSlotId` (`station-chair.ts:85`)
 * are the **only two** slot ids that build real geometry. Everything else renders as a marker cube —
 * `station-environment.ts:111` says so in a comment.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE DOUBLE-BED TRAP. THIS IS WHY #143 SAT UNDISPATCHABLE FOR TWO CYCLES.
 *
 * `primary_patient` is an **actor placement purpose**, not a furniture class. Mapping it blindly to a
 * builder would put a stretcher under a standing ambulatory patient, and would DOUBLE the bed
 * wherever #140's equipment path already mounts one.
 *
 * Measured from the shipped bundles — six stations already declare equipment and it mounts:
 *
 * | station | equipmentPlacements |
 * |---|---|
 * | `postop_fever_consult_pressure_v1` | **`post_op_bed_equipment`**, abdominal_dressing |
 * | `peds_asthma_parent_anxiety_v1` | **`pediatric_stretcher_equipment`**, **`parent_chair_equipment`**, +4 |
 * | `oncology_bad_news_family_v1` | **`chairs_equipment`**, tissue_box |
 * | `clinic_abdominal_pain_interpreter_v1` | **`exam_table_equipment`**, abdominal_exam_zone |
 * | `stepdown_sepsis_nurse_escalation_v1` | monitor, iv_pump — **no bed** |
 * | `ed_stroke_alert_handoff_v1` | wall_clock, bedside_monitor — **no bed** |
 * | `ob_headache_preeclampsia_triage_v1` | fetal_monitor, blood_pressure_cuff — **no bed** |
 *
 * **ONE patient support surface per station, via ONE path.** Check the equipment plan first. Where
 * equipment already mounts a bed/chair, the fixture must NOT add another.
 *
 * And a patient standing beside a bed is a valid clinical scene — an ambulatory patient is not a
 * defect. Do not force a support surface where the station does not want one; declare it per
 * environment.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * ACTORS ARE NOT PLACED FROM FIXTURE SLOTS — verified, and it is the second trap
 *
 * `runtime-actor-placements.ts:29-34` is a hardcoded anchor table. The fixture `primary_patient` sits
 * at roughly `(-0.9, 0, 0.08)`; the actor anchor is `(-0.72, 1.06, -0.12)`. **Adding furniture where
 * a marker cube was can put a deck through a floor-planted actor.** #150 had to solve that for the
 * supine ED patient and the machinery exists (`supine-pose.ts`, `STRETCHER_DECK_TOP_METERS`).
 *
 * Contract (3) exists partly to catch this. If a figure ends up inside new furniture, that is a
 * failure of this slice, not an acceptable side effect.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * BUDGET — DO NOT SPEND THE 180,000
 *
 * `maxVisibleTriangles: 180000` (`asset-registry/src/index.ts:589`) is **registry policy, never
 * validated on hardware**. Nothing here may be read as evidence of Quest viability. Keep the shell
 * addition CHEAP — a ceiling plane and a support surface are tens of triangles, not tens of
 * thousands. If your change adds more than ~5,000 triangles per station, stop and say why.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - **How each environment declares its support surface.** The peer's preference, which I share:
 *    change the twelve descriptors to declare a real slot id (`stretcher` / `patient_chair` / or
 *    none) rather than adding a builder-side switch on `primary_patient`. That reuses the two
 *    existing predicates and makes intent explicit per room. If you disagree, say why and do yours.
 *  - **Which environments get which surface, and which get none.** A ward is not an ED bay and a
 *    consult room is not either. You are choosing clinical staging here — say what you chose per
 *    room and on what basis. If you believe a room needs a third builder (a ward bed that is neither
 *    an ED stretcher nor a clinic chair), SAY SO AND DO NOT BUILD IT — that is a separate slice.
 *  - **Whether the front wall is in scope.** I think a ceiling alone closes the void the captures
 *    show; a fourth wall changes the doorway camera framing every capture depends on. **I lean
 *    ceiling only.** If you add a front wall, the captures are your problem to keep working.
 *  - Whether `learner_start` stays a marker. **It must** — it is a spawn anchor, not furniture.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands stations stop rendering their patient position as a marker cube, and is satisfiable by
 * building geometry for every slot id including `learner_start`. (2) forbids that and requires the
 * room to be closed. (3) is green today and forbids buying either by double-bedding the stations
 * that already mount equipment, or by planting an actor inside new furniture.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectStationRoomNotEmpty()`. What must not
 * change: environments are enumerated from what ships, and geometry is read from the LIVE scene after
 * the render loop advances — a descriptor saying "stretcher" is not a stretcher.
 *
 * CALIBRATION — per-environment rows, written BEFORE any product edit (§8o), to
 * `.openclinxr/evidence/issue-133/pre-fix.json`:
 *
 *   environmentId | scenarioId | declaredSlotIds | builtSlotIds | markerCubeCount | equipmentIds
 *   | hasCeiling | shellTriangles | supportSurfaceCount
 *
 * Pre-fix expectations from my own measurement — **report anything that differs, it is data about my
 * premises**: twelve environments show `[primary_patient, learner_start]`, `hasCeiling: false`
 * everywhere, and `shellTriangles` in the low hundreds.
 *
 * REQUIRED, the observable half: capture **at least four** stations spanning the cases — one that
 * already has a stretcher (`ed_chest_pain_priority_v1`), one that declares a bed via equipment
 * (`postop_fever_consult_pressure_v1`), one with neither (`ward_delirium_med_rec_v1`), and one
 * consult-style (`psych_suicidal_ideation_safety_v1`). Reuse
 * `tools/openclinxr/evidence/ui-xr-environment-room-capture.ts`; do not write another capture script.
 * After the first successful run, re-run twice more with `FORCE_COLOR=1` (§6i).
 *
 * IN-SCOPE VISUAL — answer EVERY line FOR EACH captured station. Do not replace with a sentence:
 *     ceiling:              present | absent
 *     patient_support:      bed | stretcher | chair | none | marker_cube
 *     duplicate_furniture:  none | present
 *     actors_inside_furniture: none | present
 *     room_reads_as:        clinical_space | empty_box | cluttered
 *
 * OUT-OF-SCOPE WRONGNESS you saw and are not fixing: name the object and what it looks like (§6m),
 * even on the same object. Known and not yours: bare feet, flat doll faces, the hm08 candidate.
 *
 * IF SATISFYING A CONTRACT HERE MAKES THE PRODUCT VISIBLY WORSE, SAY SO IN YOUR REPORT — and then
 * satisfy it anyway. A closed ceiling could darken every room; if it does, say so.
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS
 * THE OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT.
 *
 * SCOPE: whether a station's room is closed and whether its patient position is furniture. Says
 * NOTHING about wall trim, window reveals, lighting, materials, Quest viability, or humanoids.
 */

const load = async () => import("./station-room-not-empty.js") as Promise<Record<string, unknown>>;

type RoomFacts = {
  scenarioId: string;
  environmentId: string;
  /** Slot ids the descriptor declares. */
  declaredSlotIds: string[];
  /** Slot ids that produced real geometry in the LIVE scene. */
  builtSlotIds: string[];
  /** Slots still rendering as a 0.18^3 marker. `learner_start` is legitimately here. */
  markerCubeSlotIds: string[];
  /** Equipment ids mounted by #140's path in the live scene. */
  mountedEquipmentIds: string[];
  /** True when a ceiling mesh exists in the shell. */
  hasCeiling: boolean;
  /** Triangles in the room shell only — not actors, not equipment. */
  shellTriangles: number;
  /**
   * Count of things a patient could lie or sit on, from BOTH paths — fixtures and equipment.
   * Exactly 0 or 1. Two means the station double-beds.
   */
  patientSupportSurfaceCount: number;
  /** Actors whose mesh AABB intersects a support surface's volume. Must be empty. */
  actorsIntersectingFurniture: string[];
};

type Inspect = () => Promise<{ rooms: RoomFacts[] }>;

/** Spawn anchors are not furniture and must stay markers. */
const LEGITIMATE_MARKERS = ["learner_start"];

/** Cheap is the point. The 180k budget is unvalidated registry policy, not a hardware fact. */
const MAX_SHELL_TRIANGLES = 5_000;

describe("a station room is closed and its patient position is furniture (#133/#143)", () => {
  it.fails("no station renders its patient position as a marker cube", async () => {
    // shell() defaults twelve environments to [primary_patient, learner_start], and
    // station-environment.ts:111 records that only stretcher and patient_chair build real geometry.
    const mod = await load();
    const inspect = mod["inspectStationRoomNotEmpty"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.rooms.length, "no station was evaluated").toBeGreaterThan(3);

    const offenders: string[] = [];
    for (const r of report.rooms) {
      const illegitimate = r.markerCubeSlotIds.filter((s) => !LEGITIMATE_MARKERS.includes(s));
      for (const s of illegitimate) {
        offenders.push(`${r.scenarioId} (${r.environmentId}): slot "${s}" renders as a marker cube`);
      }
    }
    expect(offenders, `patient positions still rendering as markers:\n${offenders.join("\n")}`)
      .toHaveLength(0);
  }, 1_800_000);

  it.fails("the room is closed and the shell stays cheap", async () => {
    // Kills the cheap satisfaction of the first contract: building geometry for every slot id,
    // including learner_start, while the room is still an open-topped box. The black band across
    // every capture is the missing ceiling, verified against a camera at y=2.05 in a 2.65m room.
    const mod = await load();
    const inspect = mod["inspectStationRoomNotEmpty"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const open = report.rooms.filter((r) => !r.hasCeiling).map((r) => `${r.scenarioId} has no ceiling`);
    expect(open, `open-topped rooms:\n${open.join("\n")}`).toHaveLength(0);

    const bloated = report.rooms
      .filter((r) => r.shellTriangles > MAX_SHELL_TRIANGLES)
      .map((r) => `${r.scenarioId}: shell is ${r.shellTriangles} triangles`);
    expect(bloated, `shells that stopped being cheap:\n${bloated.join("\n")}`).toHaveLength(0);

    // learner_start must survive as a marker — it is a spawn anchor, not furniture.
    const lostAnchor = report.rooms
      .filter((r) => r.declaredSlotIds.includes("learner_start") && !r.markerCubeSlotIds.includes("learner_start"))
      .map((r) => `${r.scenarioId}: learner_start stopped being a marker`);
    expect(lostAnchor, `spawn anchors turned into furniture:\n${lostAnchor.join("\n")}`).toHaveLength(0);
  }, 1_800_000);

  it.fails("no station double-beds and no actor stands inside furniture (COUNTERWEIGHT)", async () => {
    // Two failure modes this slice can introduce, both verified as real risks before dispatch:
    // postop already mounts post_op_bed_equipment and peds asthma mounts pediatric_stretcher, so a
    // fixture bed there would be the second one; and runtime-actor-placements.ts:29-34 is a hardcoded
    // anchor table that never reads fixture slots, so new furniture can appear through an actor.
    const mod = await load();
    const inspect = mod["inspectStationRoomNotEmpty"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();

    const doubled = report.rooms
      .filter((r) => r.patientSupportSurfaceCount > 1)
      .map((r) => `${r.scenarioId}: ${r.patientSupportSurfaceCount} support surfaces (equipment: ${r.mountedEquipmentIds.join(", ")})`);
    expect(doubled, `stations with more than one patient support surface:\n${doubled.join("\n")}`)
      .toHaveLength(0);

    const embedded = report.rooms.flatMap((r) =>
      r.actorsIntersectingFurniture.map((a) => `${r.scenarioId}: ${a} is inside furniture`),
    );
    expect(embedded, `actors planted inside new geometry:\n${embedded.join("\n")}`).toHaveLength(0);

    // The ED bay's existing stretcher must survive untouched.
    const ed = report.rooms.find((r) => r.environmentId === "ed_exam_bay_v1");
    expect(ed, "the ED bay was not evaluated").toBeDefined();
    expect(ed!.builtSlotIds, "the ED bay lost its stretcher").toContain("stretcher");
  }, 1_800_000);
});
