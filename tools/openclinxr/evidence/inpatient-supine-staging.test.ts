import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#179). Three inpatient stations render a standing patient beside a bed.
 *
 * `ward_delirium_med_rec_v1`, `stepdown_sepsis_nurse_escalation_v1` and
 * `postop_fever_consult_pressure_v1` all ship a patient who is on their feet. In postop the patient
 * stands barefoot beside an empty bed. A learner walking in cannot tell that these are inpatients.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT and is `it.fails` only because the module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * MY PREMISE WAS WRONG IN THREE PLACES. All three verified in the tree — do not inherit my version.
 *
 * I filed this as "three stations have no bed, build one." A peer round killed it:
 *
 * **1. Ward and stepdown already have a support surface.** #133/#169 measured `built=[stretcher]
 * support=1` for both. `environment-descriptors.ts:295-296` says *"Ward bed via **stretcher proxy**
 * (third builder deferred)"* — I read "third builder deferred" as "no bed"; it means the bed is a
 * stretcher wearing a ward's name. Postop is different again: no fixture bed at all, its bed is
 * `post_op_bed_equipment` on the EQUIPMENT path.
 *
 * **2. `slotId: "ward_bed"` selects nothing new.** `station-stretcher.ts:289-298`:
 *
 *     export function isStretcherSlotId(slotId: string): boolean {
 *       const id = slotId.toLowerCase();
 *       return id === "stretcher" || id.includes("stretcher")
 *         || id === "patient_bed" || id.endsWith("_bed") || id === "bed";
 *     }
 *
 * `ward_bed` ends with `_bed`, so it already routes to `buildPatientStretcher`.
 *
 * **3. THE LOAD-BEARING ONE — none of those patients is declared supine.**
 * `actor-posture.ts:55-75` returns `seated` for telehealth, `supine` for **`ed_chest_pain` only**, and
 * `standing` for everyone else. Its own comment says auto-supining every station with furniture is
 * deliberately avoided.
 *
 * **So a prettier bed changes nothing a learner sees.** Geometry-first would have been the ninth
 * correct-and-inert slice in this project. The visible half is POSTURE.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * POSTOP IS NOT THE SAME CHANGE AS WARD AND STEPDOWN
 *
 * Ward and stepdown have a fixture stretcher to plant on. Postop's support is equipment, and #133
 * asserts **exactly one** patient support surface per station. Adding a fixture bed to postop without
 * demoting `post_op_bed_equipment` gives two and reds #133 immediately.
 *
 * That is a real decision and it is yours: demote the equipment bed, plant on it as it stands, or move
 * postop onto the fixture path and remove the equipment entry. Name what you rejected.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * #171 JUST LANDED ON THIS EXACT MECHANISM. DO NOT FIGHT IT.
 *
 * It wired `inclineDegrees` from the fixture slot through `station-environment.ts` into
 * `buildPatientStretcher`, made the plant read the live stretcher, and split the plant into
 * `supine-deck-plant.ts`. Reuse that path; do not write a second plant.
 *
 * **Its counterweight will break if you give any non-ED station a non-zero incline.** It currently
 * asserts *"13 other bank stations read 0"*. If your staging includes semi-Fowler for these three, the
 * fix is to retune that assertion to **"undeclared incline = 0"** rather than "everything non-ED = 0".
 * Say explicitly in your report which you did.
 *
 * **`findProceduralStretcher` matches only `openClinXrStretcherKind === "procedural_patient_stretcher"`.**
 * A new kind string without updating the finder leaves the supine plant blind to its own deck.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE UNLOCKED DECISION I MUST NAME: WHERE POSTURE COMES FROM
 *
 * `defaultPostureForEnvironmentSlot` gates on scenario-id substrings today. For three more stations
 * you may: add them to that substring list; add a `patientPosture` field to the environment
 * descriptor; or derive it from a care-setting class. **The substring list is the fourth hardcoded
 * source of its kind in this repo and I am wary of it** — but it is also the smallest change and the
 * pattern already exists. Pick one, say what you rejected, and if you pick the substring list say why
 * a descriptor field was not worth it.
 *
 * A patient who is inpatient is not automatically recumbent — an ambulatory postop patient sitting on
 * the edge of the bed is clinically ordinary. **Supine is a staging choice, not a clinical claim**, and
 * `claimScope` must stay staging.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE BED SKIN IS COSMETIC AND OPTIONAL IN V1
 *
 * Articulation is head-of-bed only and that is all v1 needs — no knee gatch, no hi-lo height, both of
 * which would redo the plant constants. A ward frame skin (headboard, footboard, full-length rails) on
 * the shared deck is welcome if it fits, and **it is not what makes this slice visible**. If you run
 * out of room, ship posture and say the skin is deferred.
 *
 * `station-stretcher.ts` was 340/600 lines before #171 and #171 added to it. Check the budget and
 * **split rather than raise a ceiling** if a skin does not fit.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * CALIBRATION — `.openclinxr/evidence/issue-179/pre-fix.json` BEFORE any product edit: for every bank
 * station, the primary patient's resolved posture, the support-surface count and kind, and whether the
 * support is a fixture or equipment. Expected shape: ED supine, telehealth seated, **everything else
 * standing**; ward and stepdown `support=1 fixture`, postop `support=1 equipment`. Record the
 * mechanism per row, not only the value.
 *
 * SIGNATURE IS YOURS. These read `inspectInpatientSupineStaging()`. What must not change: posture and
 * support are read from the LIVE scene, stations are enumerated from what ships, and the clearance
 * metric is the same one `supine-patient-on-deck` uses.
 *
 * REQUIRED, the observable half: re-capture all three rooms. A learner must see a patient on a bed,
 * and I will grade those images.
 *
 * IN-SCOPE VISUAL — answer EVERY line, for EACH of the three stations. Do not replace with a sentence:
 *     patient_on_support:     yes | no | not_visible
 *     reads_as_inpatient:     yes | no | not_visible
 *     bed_reads_as_bed:       yes | stretcher | unrecognisable | not_visible
 *     body_intact:            yes | torn | not_visible
 *     support_count_visible:  1 | 2+ | not_visible
 *
 * IF SATISFYING A CONTRACT HERE WILL MAKE THE PRODUCT VISIBLY WORSE, SAY SO — AND THEN SATISFY IT
 * ANYWAY. IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, SAY SO
 * IN YOUR REPORT rather than silently running a corrected version.
 *
 * No new `eslint-disable`, `@ts-expect-error`, `@ts-expect-error` or `OPENCLAW_SKIP_HOOKS` in source paths —
 * merge-kill fails the land regardless of the comment justifying it.
 *
 * SCOPE: three inpatient stations stage their patient on the support surface that already exists.
 * Says NOTHING about clinical positioning correctness, about which patients SHOULD be recumbent, about
 * the ED bay, or about sourcing a hospital-bed asset — no CC0 or CC-BY articulating bed exists and
 * that is why this is built rather than bought.
 */

const load = async () =>
  import("./inpatient-supine-staging.js") as Promise<Record<string, unknown>>;

type StationStagingRow = {
  scenarioId: string;
  environmentId: string;
  patientActorId: string;
  /** As the live runtime resolves it. */
  posture: string;
  /** How many patient support surfaces the station builds. */
  supportSurfaceCount: number;
  supportKind: string | null;
  /** "fixture" | "equipment" | null */
  supportSource: string | null;
  /** Same metric supine-patient-on-deck uses. Null when the patient is not supine. */
  clearanceAboveDeckMeters: number | null;
  /** One line naming why this patient is not on a support surface, or null when they are. */
  notStagedMechanism: string | null;
};

type Report = {
  rows: StationStagingRow[];
  /** Stations this slice declares should stage a recumbent patient. */
  declaredInpatientScenarioIds: string[];
  /** Where the posture decision now comes from, so the next reader does not have to grep. */
  postureSource: string;
  claimScope: string;
  notEvidenceFor: string[];
};

type Inspect = () => Promise<Report>;

const TARGETS = [
  "ward_delirium_med_rec_v1",
  "stepdown_sepsis_nurse_escalation_v1",
  "postop_fever_consult_pressure_v1",
];
const ED_CHEST_PAIN = "ed_chest_pain_priority_v1";
const TELEHEALTH = "telehealth_diabetes_health_literacy_v1";
/** #171's live gate. A body sunk 0.19 m through the seat must still fail. */
const MAX_PENETRATION_METERS = 0.05;

describe("inpatient stations stage their patient on a bed (#179)", () => {
  it("all three inpatient patients are recumbent on a support surface", async () => {
    // ## FIXED (#179)
    // Posture: actor-posture INPATIENT_RECUMBENT_SCENARIO_MARKERS → supine for the three.
    // Support: plant-aligned fixture stretcher (ward/stepdown); post_op_bed equipment
    // repositioned + tagged procedural_patient_stretcher for plant (no double-bed).
    // The visible half. actor-posture.ts returns "standing" for everything that is not ED chest pain
    // or telehealth, so these three patients are on their feet beside beds that already exist.
    const mod = await load();
    const inspect = mod["inspectInpatientSupineStaging"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    for (const scenarioId of TARGETS) {
      const row = report.rows.find((r) => r.scenarioId === scenarioId);
      expect(row, `${scenarioId} was not measured`).toBeTruthy();
      expect(
        row!.posture,
        `${scenarioId} patient is "${row!.posture}" — ${row!.notStagedMechanism ?? "no mechanism recorded"}`,
      ).toBe("supine");
      expect(
        row!.clearanceAboveDeckMeters,
        `${scenarioId} is supine but its clearance was never measured`,
      ).not.toBeNull();
      expect(
        row!.clearanceAboveDeckMeters!,
        `${scenarioId} patient sinks ${(-row!.clearanceAboveDeckMeters!).toFixed(3)}m through its support`,
      ).toBeGreaterThan(-MAX_PENETRATION_METERS);
    }
    expect(report.postureSource.length, "the posture decision source is not recorded").toBeGreaterThan(0);
    expect(report.claimScope.toLowerCase()).toContain("staging");
  }, 900_000);

  it("every station still builds exactly one patient support surface", async () => {
    // ## FIXED (#179)
    // Postop stays on equipment path only — no fixture bed added to surgical_ward.
    // Postop's bed is EQUIPMENT, not a fixture. Adding a fixture bed without demoting it gives two
    // support surfaces and reds #133 — which is green today and must stay green. This is the half that
    // makes postop a different change from ward and stepdown.
    const mod = await load();
    const inspect = mod["inspectInpatientSupineStaging"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.rows.length, "fewer stations enumerated than the bank ships").toBeGreaterThanOrEqual(14);

    const doubled = report.rows
      .filter((r) => r.supportSurfaceCount > 1)
      .map((r) => `${r.scenarioId}: ${r.supportSurfaceCount} (${r.supportSource})`);
    expect(doubled, `stations with more than one patient support surface:\n${doubled.join("\n")}`)
      .toHaveLength(0);

    // Each target must actually have a support to lie on, and its source must be recorded.
    for (const scenarioId of TARGETS) {
      const row = report.rows.find((r) => r.scenarioId === scenarioId)!;
      expect(row.supportSurfaceCount, `${scenarioId} has no patient support surface`).toBe(1);
      expect(row.supportSource, `${scenarioId} support source not recorded`).toBeTruthy();
    }
  }, 900_000);

  it("standing and seated stations are untouched (COUNTERWEIGHT)", async () => {
    // ## FIXED (#179)
    // Scenario-id markers only — ambulatory stations remain standing; telehealth seated.
    // The cheap way to satisfy contract (1) is to make everyone supine. Ambulatory patients in clinic
    // and urgent care belong on their feet, telehealth belongs in a chair, and ED already works.
    // Supine is a STAGING choice per station, never a default.
    const mod = await load();
    const inspect = mod["inspectInpatientSupineStaging"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();

    const declared = new Set(report.declaredInpatientScenarioIds);
    for (const scenarioId of TARGETS) {
      expect(declared.has(scenarioId), `${scenarioId} is not in the declared inpatient list`).toBe(true);
    }

    // ED stays supine, telehealth stays seated — neither is this slice's business.
    expect(report.rows.find((r) => r.scenarioId === ED_CHEST_PAIN)?.posture).toBe("supine");
    expect(report.rows.find((r) => r.scenarioId === TELEHEALTH)?.posture).toBe("seated");

    // Everything not declared inpatient, not ED and not telehealth must still be standing.
    const wronglyRecumbent = report.rows
      .filter((r) => r.scenarioId !== ED_CHEST_PAIN && r.scenarioId !== TELEHEALTH)
      .filter((r) => !declared.has(r.scenarioId))
      .filter((r) => r.posture !== "standing")
      .map((r) => `${r.scenarioId}: ${r.posture}`);
    expect(
      wronglyRecumbent,
      `stations laid down without being declared inpatient:\n${wronglyRecumbent.join("\n")}`,
    ).toHaveLength(0);

    expect(report.notEvidenceFor.join(" ").toLowerCase()).toContain("clinical");
  }, 900_000);
});
