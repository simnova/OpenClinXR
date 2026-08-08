import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#223). Three REDs. All flip.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE MEASUREMENT THAT REFRAMED THIS ISSUE — I filed it wrong and the scan corrected me
 *
 * I filed #223 as "13 of 17 declared roomProps have no builder arm — write the missing builders".
 * Then I enumerated every declared `roomProps[].propId` across ALL shipped scene manifests and
 * intersected them against the `case "<id>"` arms in `station-equipment-builders.ts`:
 *
 *     builder arms:                          35
 *     distinct declared roomProp ids:        40   (across 54 manifest files)
 *     builder-backed:                         1   — `monitor`
 *     builder-less:                          39
 *
 * And 28 OF THOSE 39 ARE THE SAME FOUR THINGS, REPEATED PER STATION:
 *
 *     <station>-communication-cue      <station>-objective-cue
 *     <station>-primary-context        <station>-review-cue
 *
 * for ward_delirium_med_rec, ob_headache_preeclampsia_triage, oncology_bad_news_family,
 * postop_fever_consult_pressure, stepdown_sepsis_nurse_escalation, ed_stroke_alert_handoff, and
 * clinic_abdominal_pain_interpreter. Seven stations x four cue kinds.
 *
 * THESE ARE NOT OBJECTS. Read one, verbatim from a shipped manifest:
 *
 *     { "propId": "ward-delirium-med-rec-review-cue",
 *       "label": "Faculty review evidence cue",
 *       "colorHex": "#f3e8ff", "accentColorHex": "#7c3aed",
 *       "position": { "x": 1.5, "y": 0.7, "z": 0.65 },
 *       "scale":    { "x": 0.7, "y": 0.18, "z": 0.42 },
 *       "affordanceCueIds": ["ward-delirium-med-rec-review-cue:scenario_context_cue"],
 *       "interactionTags": ["scenario_context", "ward_delirium_med_rec_v1"] }
 *
 * A pale lavender slab, 70cm x 18cm x 42cm, floating at y=0.7, whose label is a FACULTY REVIEW
 * CONCEPT. `roomProp()` renders every declared prop as a scaled `BoxGeometry(1,1,1)`, so each of
 * these becomes a grey-lavender box in the room.
 *
 * **This is the slab problem.** I have graded "flat slabs intersecting actors" (#173), "rooms read as
 * slabs" (#185), and "props read as boxes" repeatedly, and reached for better geometry every time.
 * The rooms are not under-modelled. They are full of boxes representing abstract pedagogical
 * concepts that were never furniture.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SO THE FIX IS NOT "WRITE 39 BUILDERS" — writing furniture for "Faculty review evidence cue" would
 * be absurd, and writing it with an LLM is directive D1's anti-pattern by name.
 *
 * The genuinely PHYSICAL builder-less ids are a short list, and they are the ones that deserve
 * geometry:
 *
 *     safe-room-soft-chair        a chair
 *     safety-plan-whiteboard      a whiteboard
 *     telehealth-tablet-stand     a stand
 *     ekg-leads-on-bed            leads (appears in 2 stations)
 *
 * AMBIGUOUS — you classify, and RECORD the classification with a reason. I am not deciding these for
 * you because I do not know the product intent: `observer-station`, `glucometer-log-review`,
 * `plain-language-plan-card`, `monitor-vitals-badge`, `monitor-waveform-card`,
 * `ligature-risk-cleared-zone`, `cost-access-barrier-cue`.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE MECHANISM ALREADY EXISTS — do not invent a new one
 *
 * `shouldRenderRoomPropInVisualReview(prop)` already filters on `prop.semanticRole !==
 * "environmental_detail"` (pinned in `static-assets.test.ts:1168-1169`). There is a semantic-role
 * channel; the cue props are simply not using it. Whether the right move is a new role value, a
 * different render treatment, or dropping them from the 3D manifest entirely is YOURS TO DECIDE —
 * name the decision and the rejected alternatives in your report.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE COUNTERWEIGHT THAT MAKES THIS SAFE — cues are load-bearing for something
 *
 * Each cue prop carries `affordanceCueIds` and `interactionTags`, and `roomProp()` writes
 * `openClinXrRuntimeSceneManifestAffordanceCueIds` plus `openClinXrEquipmentId` onto the group.
 * #209's `declared-equipment-mounted` unions roomProps into its declared set and reads those tags.
 *
 * Making a cue stop being a BOX must not make it stop being a CUE. Contract (2) requires every
 * affordance cue id that is registered today to still be registered afterwards. If you cannot keep
 * both, say so and stop — that is a real finding, not a failure.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * FOLDED IN: #228, because it is the same file and the same assertion
 *
 * `room-prop-uses-real-builder` contract (3) currently reads `preFixRenderedPropIds` from
 * `.openclinxr/evidence/issue-185/pre-fix.json` — a GITIGNORED artifact — so it fails on a clean
 * clone with "no pre-fix prop list". Main is red on it right now and that defect is mine.
 *
 * That contract's job ("the XOR must not be satisfied by emptying the room") is real and must NOT be
 * weakened or deleted. But its baseline must come from the TRACKED scene manifests, not a snapshot.
 * This slice necessarily changes what renders, so it owns that fix. Do NOT touch the other modules
 * in #217's class.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SCOPE
 *
 *   DO:     classify all 40 declared prop ids; stop rendering non-object cues as furniture; give the
 *           genuinely physical ones real parametric geometry via the existing builder factory.
 *   DO NOT: write a builder for a cue. If the classification says "not an object", the answer is a
 *           render/semantic-role change, not geometry.
 *   DO NOT: delete affordance cue ids, interaction tags, or trace registration. Contract (2) checks.
 *   DO NOT: touch the asset pipeline, humanoid GLBs, or `tools/openclinxr/evidence/infinigen-*` —
 *           a second worker holds the Infinigen shell measure this cycle.
 *   DO NOT: weaken or delete `room-prop-uses-real-builder` contract (3). Re-base it, do not remove it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE CAUSE IS KNOWN (the scan above is reproducible — enumerate manifests, intersect with case arms).
 * What is NOT known to me: whether the cue props are consumed by any faculty-review or trace surface
 * that would notice them vanishing from the 3D scene; whether `semanticRole` is authored anywhere in
 * the bank today or is always absent; and whether #209's inspector counts a suppressed prop as an
 * unmounted declared equipment id. MEASURE THOSE BEFORE CHANGING RENDER BEHAVIOUR. Several of my
 * diagnoses here have been withdrawn — take nothing beyond the scan as fact.
 *
 * If any proof in the brief CANNOT PASS as written, OR passes trivially against the ambient range,
 * OR is a regression net rather than load-bearing, SAY SO AT THE MOMENT YOU FIND IT. I am asking
 * about all three cases explicitly because the general instruction has under-fired three times.
 */

type PropClass = "physical_object" | "cue_or_overlay";

type ClassifiedProp = {
  propId: string;
  scenarioIds: string[];
  /** Your classification, with a reason recorded in the report. */
  classification: PropClass;
  classificationReason: string;
  /** True when the prop renders a scaled unit-box body in the LIVE scene. */
  rendersAsScaledBox: boolean;
  /** Real builder geometry, when the prop is a physical object. */
  bodyMeshCount: number;
  triangleCount: number;
  /** Affordance cue ids reachable in the live scene for this prop. */
  affordanceCueIdsInScene: string[];
};

type Inspect = () => Promise<{
  props: ClassifiedProp[];
  /** Every affordance cue id registered in the live scene, across all inspected stations. */
  affordanceCueIdsBefore: string[];
  affordanceCueIdsAfter: string[];
  /** Prop ids the TRACKED scene manifests declare and expect to render — not a snapshot. */
  manifestDeclaredRenderableIds: string[];
  manifestSource: string;
}>;

const load = () =>
  import("./cue-props-are-not-furniture.js") as Promise<Record<string, unknown>>;

describe("a pedagogical cue is not furniture (#223)", () => {
  it("no cue or overlay renders as a scaled box in the room", async () => {
    const mod = await load();
    const inspect = mod["inspectCuePropsAreNotFurniture"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(
      report.props.length,
      "fewer than 20 declared prop ids classified — the scan found 40 across the bank",
    ).toBeGreaterThan(19);

    const cues = report.props.filter((p) => p.classification === "cue_or_overlay");
    expect(
      cues.length,
      "no prop classified as a cue — 28 of 39 builder-less ids are per-station cue quadruplets",
    ).toBeGreaterThan(9);

    const slabs: string[] = [];
    for (const p of cues) {
      if (p.rendersAsScaledBox) {
        slabs.push(
          `${p.propId}: still a scaled box in the scene — "${p.classificationReason}" is not furniture`,
        );
      }
      if (!p.classificationReason || p.classificationReason.length < 8) {
        slabs.push(`${p.propId}: classified with no recorded reason`);
      }
    }
    expect(slabs, `pedagogical concepts still rendering as furniture:\n${slabs.join("\n")}`).toEqual([]);
  }, 1_800_000);

  it("every affordance cue id still reaches the scene (COUNTERWEIGHT)", async () => {
    // Cues carry affordanceCueIds and interactionTags, and #209's declared-equipment inspector
    // unions roomProps into its declared set. Making a cue stop being a BOX must not make it stop
    // being a CUE. If both cannot hold, say so and stop — that is a finding, not a failure.
    const mod = await load();
    const inspect = mod["inspectCuePropsAreNotFurniture"] as Inspect;
    const report = await inspect();

    expect(
      report.affordanceCueIdsBefore.length,
      "no affordance cue ids measured before — the counterweight cannot see what it protects",
    ).toBeGreaterThan(0);

    const after = new Set(report.affordanceCueIdsAfter);
    const lost = report.affordanceCueIdsBefore.filter((id) => !after.has(id));
    expect(
      lost,
      `affordance cue ids that stopped reaching the scene:\n${lost.join("\n")}`,
    ).toEqual([]);
  }, 1_800_000);

  it("physical props gained real geometry, and the baseline is TRACKED (COUNTERWEIGHT — folds #228)", async () => {
    // Two things. Physical objects must get real parametric geometry, not keep the box — otherwise
    // this slice is pure deletion. And the "did the room get emptier" baseline must come from the
    // tracked scene manifests: room-prop-uses-real-builder contract (3) currently reads a gitignored
    // pre-fix artifact and so cannot pass on a clean clone. Re-base it; do not weaken or delete it.
    const mod = await load();
    const inspect = mod["inspectCuePropsAreNotFurniture"] as Inspect;
    const report = await inspect();

    expect(
      report.manifestSource,
      "the renderable baseline must come from tracked manifests, not .openclinxr/evidence",
    ).not.toMatch(/\.openclinxr[/\\]evidence/);
    expect(
      report.manifestDeclaredRenderableIds.length,
      "no declared renderable ids read from the tracked manifests",
    ).toBeGreaterThan(0);

    const physical = report.props.filter((p) => p.classification === "physical_object");
    expect(
      physical.length,
      "nothing classified as a physical object — safe-room-soft-chair, safety-plan-whiteboard, "
      + "telehealth-tablet-stand and ekg-leads-on-bed are objects a learner can look at",
    ).toBeGreaterThan(2);

    const broken: string[] = [];
    for (const p of physical) {
      if (p.rendersAsScaledBox) {
        broken.push(`${p.propId}: a physical object still rendering as a unit box`);
      }
      if (p.triangleCount < 12 || p.bodyMeshCount < 1) {
        broken.push(`${p.propId}: ${p.triangleCount} triangles in ${p.bodyMeshCount} mesh(es) — no geometry`);
      }
    }
    expect(broken, `physical props without real geometry:\n${broken.join("\n")}`).toEqual([]);
  }, 1_800_000);
});
