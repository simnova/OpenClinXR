import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#122) — the runtime stages three fixed ED-shaped slots and resolves each one
 * through hardcoded ED actor ids with positional fallbacks. When a station has fewer actors than
 * slots, two slots land on the SAME person. When a role is not on an allow-list, that person is
 * silently dropped.
 *
 * This supersedes #112 (three slots vs four actors) and #118 (an actor mounted twice). They are one
 * defect and I filed them separately before I had traced it.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT — the ED bay stages three distinct people today and
 * must keep doing so. It is `it.fails` only because the module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, TRACED — verified against the tree, do not re-derive
 *
 * `main.ts:779-798` — three resolvers, each a chain:
 *
 *     runtimePatientActorId()      = ED id 'patient_robert_hayes_v1' ?? role[patient] ?? actors[0]
 *     runtimeClinicalTeamActorId() = ED id 'nurse_maria_alvarez_v1'  ?? role[nurse, respiratory_therapist,
 *                                    nurse_observer, consultant] ?? actors[1] ?? runtimePatientActorId()
 *     runtimeFamilyActorId()       = ED id 'spouse_anna_hayes_v1'    ?? role[spouse, parent, family,
 *                                    consultant] ?? actors[2] ?? actors[1] ?? runtimePatientActorId()
 *
 * `main.ts:3654, 3686, 3724` mount three slots unconditionally. **There is no "already used" set** —
 * `openClinXrActorId` is assigned three times (`:3653, :3685, :3723`) with nothing comparing them.
 *
 * Shipped casts and what the chain does with them:
 *
 *   oncology    patient=david_miller, family=sister_rachel_miller
 *               clinical slot finds no nurse-ish role -> actors[1] = sister_rachel_miller
 *               family slot matches role 'family'     -> sister_rachel_miller
 *               => TWO SLOTS, ONE PERSON
 *
 *   telehealth  patient=luis_martinez, family=daughter_elena_martinez   => same shape
 *
 *   ward        patient, family, nurse, physician
 *               'physician' is NOT in the clinical allow-list (`:788`)
 *               => senior_resident_ward_v1 gets NO slot and a learner never sees them
 *
 * I MEASURED THE DUPLICATE LIVE before tracing it: in a posture dump, `sister_rachel_miller_v1` and
 * `daughter_elena_martinez_v1` each produced TWO rows per side where every other actor produced one.
 * The trace explains that measurement exactly.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THREE SLOTS IS NOT A QUEST BUDGET LAW — I hedged on this and a peer round corrected me
 *
 * `asset-registry/src/index.ts:595` sets `maxVisibleTriangles: 180000` per station and `:589` sets
 * `maxTriangles: 60000` per asset. A shipped humanoid is ~28,000 triangles. **Four humanoids is
 * ~112,000, comfortably under the station ceiling** before room geometry.
 *
 * So three slots is the ED cast scaffold — the scene objects are still named for Robert, Maria and
 * Anna — not a budget-forced cap. Whether to add a fourth is a real design decision and it is YOURS;
 * what is not acceptable is silently dropping a declared actor or cloning one to fill a slot.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - Whether a fourth slot is added, or three are kept and filled by clinical priority. Both are
 *    defensible; the budget permits four. If you keep three, ward's senior resident must appear in the
 *    residual, not vanish.
 *  - How priority is decided when a station declares more humanoids than there are slots. Patient
 *    first is obvious; after that it is a judgement about what the encounter is for.
 *  - Whether an unfilled slot is hidden or removed. Oncology has two people; the third slot should
 *    not stage anyone.
 *  - Whether the ED-id-first lookups (`patient_robert_hayes_v1` etc.) are deleted now that casting is
 *    bank-derived, or left as a fast path. They are the same hardcoded-ED pattern that #106, #107 and
 *    #114 each removed from a different surface.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands no person is staged twice, and is satisfiable by hiding the second root — leaving a
 * wasted slot and a missing clinician. (2) demands every declared humanoid is either staged OR named
 * in a machine-readable residual with a reason, which hiding cannot satisfy. (3) is green today and
 * forbids buying either by breaking the ED bay, which stages three distinct people correctly.
 *
 * Note (2) deliberately does NOT require every actor to be staged. If a station declares more people
 * than the runtime can stage, saying so explicitly is a valid answer — silence is not.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectActorSlotAssignment()`. What must not
 * change: stations are enumerated from what ships, and the staged ids are read from the LIVE scene's
 * `userData.openClinXrActorId` rather than from the resolver functions in isolation — the resolvers
 * are what is suspect.
 *
 * REQUIRED, the observable half: re-capture oncology and ward delirium and say who is in each room.
 *
 * IN-SCOPE VISUAL, as separate slots you must fill:
 *     IN-SCOPE VISUAL: oncology ___ ; ward ___ ; anyone duplicated or missing ___
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS THE
 * OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT.
 *
 * SCOPE: which person each humanoid slot stages. Says NOTHING about how they look, what they wear, or
 * where they stand.
 */

const load = async () => import("./actor-slot-assignment.js") as Promise<Record<string, unknown>>;

type StationStaging = {
  scenarioId: string;
  /** Humanoid actor ids the bank/bundle declares, excluding virtual devices and voice-only roles. */
  declaredHumanoidActorIds: string[];
  /** actorId on each live scene root, in slot order. Empty string for an unfilled slot. */
  stagedActorIds: string[];
  /** Declared humanoids deliberately not staged, with a reason. Empty is fine when all are staged. */
  notStagedActorIds: { actorId: string; reason: string }[];
};
type Inspect = () => Promise<{ stations: StationStaging[] }>;

const ED = "ed_chest_pain_priority_v1";
const filled = (ids: string[]) => ids.filter((id) => id.trim().length > 0);

describe("each humanoid slot stages a different person (#122)", () => {
  // ## FIXED (#122)
  // Unique role-class assignment + optional fourth `additional_cast` slot.
  // Unfilled slots keep empty openClinXrActorId (hidden). Residual publishes
  // window.__openClinXrActorSlotAssignment.notStagedActorIds when capacity is exceeded.
  // Decisions: fourth slot ON (budget ~112k/180k); priority patient→clinical→family→bank;
  // unfilled hidden (not removed); ED-id-first lookups deleted.
  it("no station stages the same person twice", async () => {
    // oncology and telehealth each mount their family actor into two slots, because the clinical-team
    // resolver falls through to actors[1] when no nurse-ish role exists. Measured live before traced.
    const mod = await load();
    const inspect = mod["inspectActorSlotAssignment"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.stations.length, `only ${report.stations.length} stations enumerated`).toBeGreaterThan(8);

    const duplicated: string[] = [];
    for (const s of report.stations) {
      const staged = filled(s.stagedActorIds);
      const seen = new Set<string>();
      for (const id of staged) {
        if (seen.has(id)) duplicated.push(`${s.scenarioId}: ${id} staged in more than one slot`);
        seen.add(id);
      }
    }
    expect(duplicated, `people staged twice:\n${duplicated.join("\n")}`).toHaveLength(0);
  }, 900_000);

  // ## FIXED (#122) — see header above.
  it("every declared humanoid is staged or explicitly recorded as not staged", async () => {
    // Kills the cheap satisfaction of the first contract: hiding the duplicate root removes the clone
    // and leaves the clinician missing with nothing saying so. Ward's senior resident is dropped today
    // because 'physician' is not on the clinical allow-list.
    const mod = await load();
    const inspect = mod["inspectActorSlotAssignment"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const unaccounted: string[] = [];
    for (const s of report.stations) {
      const staged = new Set(filled(s.stagedActorIds));
      const excused = new Set(s.notStagedActorIds.map((n) => n.actorId));
      for (const id of s.declaredHumanoidActorIds) {
        if (!staged.has(id) && !excused.has(id)) {
          unaccounted.push(`${s.scenarioId}: ${id} is neither staged nor recorded as not staged`);
        }
      }
      for (const n of s.notStagedActorIds) {
        expect(n.reason.trim().length, `${s.scenarioId}: ${n.actorId} excused with no reason`).toBeGreaterThan(0);
      }
    }
    expect(unaccounted, `declared people who silently vanish:\n${unaccounted.join("\n")}`).toHaveLength(0);
  }, 900_000);

  // ## FIXED (#122) — counterweight held after rewrite.
  it("the ED bay still stages three distinct people (COUNTERWEIGHT — green today)", async () => {
    // The ED bay is the one station whose cast matches the hardcoded scaffold. A rewrite of the
    // resolvers must not cost it.
    const mod = await load();
    const inspect = mod["inspectActorSlotAssignment"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const ed = report.stations.find((s) => s.scenarioId === ED);
    expect(ed, "the ED bay was not enumerated").toBeDefined();

    const staged = filled(ed!.stagedActorIds);
    expect(staged.length, "the ED bay stopped staging three people").toBe(3);
    expect(new Set(staged).size, "the ED bay staged someone twice").toBe(3);
  }, 900_000);
});
