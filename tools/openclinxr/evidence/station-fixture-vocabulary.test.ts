import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#186). Three REDs. All three flip.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, MEASURED — trust these numbers, do not re-derive them
 *
 * `packages/openclinxr/asset-registry/src/environment-descriptors.ts` exports
 * `ENVIRONMENT_SHELL_DESCRIPTORS`, the only path all fifteen stations take. Its entire architectural
 * vocabulary across those fifteen rooms is: a stretcher, a chair, a monitor mount, an ECG cart park,
 * a laptop desk, a medication shelf. Enumerated:
 *
 *     ed_exam_bay_v1                      ED_STRETCHER, monitor, ecg_cart, learner_start
 *     telehealth_home_visit_v1            patient_chair, laptop_desk, medication_shelf, learner_start
 *     ed_stroke_bay_v1                    OFFSET_STRETCHER, LEARNER_START
 *     adult_ed_abdominal_bay_v1           OFFSET_STRETCHER, LEARNER_START
 *     pediatric_fever_urgent_care_bay_v1  OFFSET_STRETCHER, LEARNER_START
 *     stepdown_room_v1                    PLANT_ALIGNED_STRETCHER, LEARNER_START
 *     inpatient_ward_room_v1              PLANT_ALIGNED_STRETCHER, LEARNER_START
 *     ob_triage_room_v1                   stretcher, LEARNER_START
 *     behavioral_health_private_room_v1   OFFSET_CHAIR, LEARNER_START
 *     primary_care_clinic_room_v1         OFFSET_CHAIR, LEARNER_START
 *     oncology_consult_room_v1            LEARNER_START
 *     urgent_care_clinic_room_v1          LEARNER_START
 *     surgical_ward_room_v1               LEARNER_START
 *     pediatric_urgent_care_bay_v1        LEARNER_START
 *
 * There is no door, no wall board, no counter, no sink, no curtain, no desk, no second seat, in any
 * room. Four rooms declare exactly one slot and it marks where the LEARNER stands.
 *
 * Everything else a learner sees comes from two channels that both terminate in a box:
 * `roomProp()` at `main.ts:6112` builds `new Mesh(new BoxGeometry(1,1,1), …)` for every prop id, and
 * unknown equipment ids fall to `buildGenericClinicalEquipmentFallback` (base box + cylinder + tray
 * box, 3 meshes / 56 tris). #185 measured the 18 parametric builders collapsing to ~9 silhouettes,
 * so "add more equipment builders" is a proven non-answer.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT I GRADED IN THE PIXELS — the consequence, so you know what "reads as a room" means
 *
 * `oncology_consult_room_v1` (LEARNER_START only): two people in a consultation room with nothing to
 * sit on, and the PATIENT IS WAIST-DEEP INSIDE A GREY PILLAR — torso out of the top, bare feet out of
 * the bottom, a grey slab through his chest. A fixture-less room does not degrade to an empty room;
 * it degrades to actors standing inside props.
 *
 * `behavioral_health_private_room_v1` (OFFSET_CHAIR): descriptor prose promises "safe furniture,
 * visible door, privacy constraints, nurse access for observation". Rendered: one chair-ish object
 * and five untextured coloured slabs. No door.
 *
 * `inpatient_ward_room_v1` (PLANT_ALIGNED_STRETCHER): the bed reads as a bed. Its descriptor names
 * seven objects in prose and declares two ids. **Prose `purpose` strings are not content.**
 *
 * The correlation is exact: recognisable objects per room == declared fixture slots per room.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE CAUSE IS NOT IN DOUBT HERE — this is a missing vocabulary, not a bug to trace. What IS unknown
 * to me is which fixture kinds buy the most identity across the most rooms, and where the ownership
 * rule is best enforced. Those are yours; see the issue for the named unlocked decisions.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SIGNATURE IS YOURS. These read `inspectStationFixtureVocabulary()`. What must not change:
 *  - environments are enumerated DYNAMICALLY from `ENVIRONMENT_SHELL_DESCRIPTORS`, never a literal
 *    list — a hardcoded list is the thing that hid ten un-captured rooms for weeks
 *  - `meshesPerRole` is measured from the RUNNING scene, not from descriptors, because the whole
 *    defect is that declarations and geometry disagree
 *  - geometry facts come from the exported glTF or the live scene graph, never from Blender
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT MUST NOT HAPPEN
 *  - Adding a fixture kind that only `behavioral_health_private_room_v1` uses. That is the psych-only
 *    slice this issue was rewritten to reject, wearing a shell filename. Reject it yourself.
 *  - Raising any file-size ceiling. `station-environment.ts` is 262 lines and will grow — split it.
 *  - New `eslint-disable`, `@ts-expect-error`, `@ts-expect-error` or `OPENCLAW_SKIP_HOOKS` in source paths.
 *    merge-kill fails the land regardless of the comment justifying it.
 *  - Running full `orchestrate_character`. Without the `anny` package it silently writes ~0.8 MB stub
 *    GLBs that pass file checks.
 *
 * IF ANY PROOF HERE CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR
 * ASSERTS THE OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT rather than silently running
 * a corrected version. A broken or vacuous proof is my defect and I need to see it.
 *
 * SCOPE: the shell fixture vocabulary, its builders, and the ownership rule between fixtures and the
 * two prop channels. Says NOTHING about generated assets (#164 measured TRELLIS.2 and Infinigen both
 * `reject_measured`), about humanoid load failures (#187), about garment tearing (#46/#73), or about
 * clinical validity of any staging choice.
 */

import {
  ENVIRONMENT_SHELL_DESCRIPTORS,
} from "../../../packages/openclinxr/asset-registry/src/environment-descriptors.js";

const load = async () =>
  import("./station-fixture-vocabulary.js") as Promise<Record<string, unknown>>;

type EnvironmentRow = {
  environmentId: string;
  /** Slot ids declared by the descriptor, in declaration order. */
  fixtureSlotIds: string[];
  /** Distinct fixture KINDS the builders actually construct for this room. */
  builtFixtureKinds: string[];
  /** Role -> number of rendered meshes claiming that role, across fixtures, equipment and roomProps. */
  meshesPerRole: Record<string, number>;
  /** Roles with more than one rendered mesh — the dual-declaration defect. */
  duplicateRoles: string[];
  /** Prop ids that resolved to the generic 3-mesh fallback or a bare 1x1x1 body cube. */
  undifferentiatedPropIds: string[];
};

type Report = {
  /** MUST be built by enumerating ENVIRONMENT_SHELL_DESCRIPTORS, not a literal list. */
  environments: EnvironmentRow[];
  /** Every fixture kind the builders can construct, across the whole registry. */
  fixtureKindVocabulary: string[];
  claimScope: string;
  notEvidenceFor: string[];
};

type Inspect = () => Promise<Report>;

describe("every station declares the architecture that makes it a room (#186)", () => {
  it("no room ships with only a learner-start marker", async () => {
    // Reads the SHIPPED descriptors, not a module that does not exist yet — so this is RED against
    // the real tree today. oncology, urgent care, surgical ward and paediatric urgent care each
    // declare exactly one slot and it marks where the LEARNER stands. The oncology capture shows
    // what that costs: two people in a consultation room with nothing to sit on, and the patient
    // embedded waist-deep in a grey pillar.
    const entries = Object.entries(ENVIRONMENT_SHELL_DESCRIPTORS);
    expect(entries.length, "fewer than 14 environments — enumerate dynamically, never a literal list")
      .toBeGreaterThanOrEqual(14);

    const bare = entries
      .filter(([, d]) => d.fixtureSlots.filter((s) => !/learner[_-]?start/iu.test(s.slotId)).length === 0)
      .map(([id]) => id);
    expect(bare, "rooms whose only fixture marks where the learner stands").toEqual([]);
  }, 900_000);

  it("the vocabulary can express architecture, not only furniture", async () => {
    // The whole registry offers: stretcher, chair, monitor mount, ecg cart park, laptop desk,
    // medication shelf. No room can declare a door, a board, or a work surface — so no room has one.
    // RED against the shipped descriptors today.
    const entries = Object.entries(ENVIRONMENT_SHELL_DESCRIPTORS);
    const declaredSlotIds = entries.flatMap(([, d]) => d.fixtureSlots.map((s) => s.slotId.toLowerCase()));

    for (const required of ["door", "board", "surface"] as const) {
      expect(
        declaredSlotIds.some((s) => s.includes(required)),
        `no room declares a slot expressing "${required}" — declared ids are [${[...new Set(declaredSlotIds)].join(", ")}]`,
      ).toBe(true);
    }

    // A kind declared by exactly one room is the psych-only slice in disguise.
    const roomsPerKind = new Map<string, number>();
    for (const [, d] of entries) {
      for (const slot of new Set(d.fixtureSlots.map((s) => s.slotId.toLowerCase()))) {
        for (const kind of ["door", "board", "surface"]) {
          if (slot.includes(kind)) roomsPerKind.set(kind, (roomsPerKind.get(kind) ?? 0) + 1);
        }
      }
    }
    const singletons = [...roomsPerKind.entries()].filter(([, n]) => n === 1).map(([k]) => k);
    expect(singletons, "identity fixture kinds declared by exactly one room — the point fix this issue rejects")
      .toEqual([]);
  }, 900_000);

  it("one role renders one object, and identity objects are not generic (COUNTERWEIGHT)", async () => {
    // The cheap greens: declare a door slot that builds the same 1x1x1 cube; or add fixtures while
    // leaving the prop channels drawing a second chair beside every fixture chair. Psych declares its
    // chair and its observation station in BOTH channels today, so the room renders each concept
    // twice as two different boxes.
    const mod = await load();
    const inspect = mod["inspectStationFixtureVocabulary"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();

    const dupes = report.environments
      .filter((e) => e.duplicateRoles.length > 0)
      .map((e) => `${e.environmentId}: ${e.duplicateRoles.join(", ")}`);
    expect(dupes, "roles rendering more than one mesh — fixture and prop channels both drawing").toEqual([]);

    // Identity fixtures must not resolve to the generic fallback or a bare body cube.
    const generic = report.environments
      .filter((e) => e.undifferentiatedPropIds.some((id) => /door|board|chair|desk|counter/iu.test(id)))
      .map((e) => `${e.environmentId}: ${e.undifferentiatedPropIds.join(", ")}`);
    expect(generic, "identity objects resolving to the generic fallback or a 1x1x1 cube").toEqual([]);

    expect(report.notEvidenceFor.join(" ").toLowerCase()).toContain("clinical");
  }, 900_000);
});
