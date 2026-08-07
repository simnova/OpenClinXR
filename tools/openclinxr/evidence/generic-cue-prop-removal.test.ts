import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#139) — ten of fifteen stations render four floating cubes each, labelled with
 * the scoring objective, a raw trace tag and "Faculty review evidence cue". The labels never render.
 * The cubes always do.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT — the ED bay's environmental props and the
 * hand-authored psych / telehealth / peds props must survive. It is `it.fails` only because the
 * module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE FIX IS TO STOP EMITTING THEM, NOT TO MAKE THEM WORK
 *
 * A peer round settled this and corrected me twice on the way.
 *
 * `main.ts:2465-2470` populates `activePropIds` from a **closed allow-list of literal ED propIds**
 * gated on ED trace tags. `main.ts:6096-6103` gates nameplate visibility on `active`. So a generic
 * cue prop can never activate and its label never renders — but **`roomProp` builds the body mesh
 * unconditionally** (`:6131`), so the cube is there regardless.
 *
 * **Making them activate would be worse than leaving them.** The labels are
 * `scenario.clinicalObjectives[0]`, `scenario.requiredTraceTags[0]` and a faculty-facing string.
 * Rendering them would resurrect in the room exactly what #127 removed from the chart. The inert
 * state is accidentally protecting the learner, which is not a reason to keep four boxes.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT IS LOST — CHECKED, NOT ASSUMED
 *
 * `semanticRole`, `evidenceCue` and `affordanceCueIds` are written by the factory at
 * `generated-ed-station-runtime-bundle.ts:1374-1384`. **No review-packet consumer reads these prop
 * fields as chart content.** If you find one, STOP and say so — that changes the answer.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SCOPE IS THE GENERIC QUARTET ONLY
 *
 * `generated-ed-station-runtime-bundle.ts:629-634` — the four props the generic preset emits:
 * `<slug>-primary-context`, `-objective-cue`, `-communication-cue`, `-review-cue`.
 *
 * **Do NOT touch:**
 *   - the ED bay's environmental props (`monitor-waveform-card`, `ekg-leads-on-bed`, …) — these DO
 *     activate and are the only reactive scenery that works
 *   - the hand-authored psych / telehealth / peds props ("Safe room chair", "Observer station",
 *     "Glucometer log review") — real names, worth keeping as static set dressing
 *   - anything on #140's equipment path
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - Whether the factory stops emitting them, or the runtime stops rendering them. Stopping at the
 *    factory is cleaner and changes the shipped manifests; stopping at the runtime leaves the data
 *    and is reversible. I lean factory and I am not certain.
 *  - Whether a station left with zero room props is acceptable, or whether something should take
 *    their place. **Nothing is an honest answer** — ten stations currently have four boxes that mean
 *    nothing, and an empty room is more truthful than a wrong one. If you disagree, say so and delete
 *    them anyway.
 *  - Whether `semanticRole` / `evidenceCue` should survive on the remaining props. They are trace
 *    plumbing and this issue is about learner-visible geometry.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands the metadata-labelled quartet stop reaching the scene, and is satisfiable by removing
 * every room prop from every station. (2) forbids that by requiring the ED bay's reactive props and
 * the hand-authored ones to survive. (3) is green today and forbids buying either by breaking
 * #140's equipment mounting, which shares the room.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectGenericCuePropRemoval()`. What must not
 * change: stations are enumerated from the SHIPPED manifests under
 * `apps/ui-xr/public/xr-assets/generated/`, and rendered props are read from the LIVE scene.
 *
 * REQUIRED, the observable half: re-capture `stepdown_sepsis_nurse_escalation_v1` and
 * `oncology_bad_news_family_v1` — both currently ship the full quartet. Reuse
 * `tools/openclinxr/evidence/ui-xr-environment-room-capture.ts`; do not write a fourth capture
 * script. After the first successful run, re-run it twice more with `FORCE_COLOR=1`.
 *
 * IN-SCOPE VISUAL, as separate slots you must fill:
 *     IN-SCOPE VISUAL: stepdown room ___ ; oncology room ___ ; ED bay unchanged ___ ;
 *                      anything now missing that should not be ___
 * and: CONTRACT_MET_VISUAL: cleaner | no_visible_change | worse | other:<text>
 *
 * **A `worse` verdict is a real possibility and I want it if it is true.** Removing four objects from
 * a room that already reads as empty boxes may make it read as emptier. Say so.
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS
 * THE OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT.
 *
 * SCOPE: whether the generic cue quartet reaches a learner's room. Says NOTHING about prop activation
 * (leaving it broken is deliberate), equipment (#140), fixtures (#143), or what a room should contain.
 *
 * ## FIXED (#139)
 * Factory generic preset now emits `roomProps: []` (stop emitting, not activate). Shipped public
 * manifests for the ten generic-quartet stations patched empty. Hand-authored psych/telehealth/peds
 * and ED-fallback presets untouched. ED reactive props (monitor-waveform-card, monitor-vitals-badge,
 * ekg-leads-on-bed) restored onto shipped ED manifests from runtime-bundles SSOT so the counterweight
 * is live against the shipped path (they previously existed only in the local fixture).
 * inspectGenericCuePropRemoval() measures declared vs live body meshes.
 */

const load = async () => import("./generic-cue-prop-removal.js") as Promise<Record<string, unknown>>;

type StationProps = {
  scenarioId: string;
  /** propIds in the SHIPPED scene manifest. */
  declaredPropIds: string[];
  /** propIds with a rendered body mesh in the LIVE scene. */
  renderedPropIds: string[];
  /** Rendered props whose label is a clinical objective, a raw trace tag, or faculty-facing text. */
  metadataLabelledRenderedProps: { propId: string; label: string; reason: string }[];
};

type Inspect = () => Promise<{ stations: StationProps[] }>;

/** The ED bay's reactive scenery. These activate and must survive. */
const ED_REACTIVE_PROP_IDS = ["monitor-waveform-card", "monitor-vitals-badge", "ekg-leads-on-bed"];

/** Hand-authored props with real clinical names. Static set dressing, worth keeping. */
const HAND_AUTHORED_PROP_IDS = ["safe-room-soft-chair", "observer-station", "glucometer-log-review"];

describe("no station renders a cube labelled with authoring metadata (#139)", () => {
  it("the generic cue quartet does not reach the scene", async () => {
    // Ten of fifteen stations ship <slug>-primary-context / -objective-cue / -communication-cue /
    // -review-cue. The labels never render because activePropIds is a closed ED allow-list; the cube
    // bodies render unconditionally at main.ts:6131.
    const mod = await load();
    const inspect = mod["inspectGenericCuePropRemoval"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.stations.length, `only ${report.stations.length} stations enumerated`).toBeGreaterThan(8);

    const offenders: string[] = [];
    for (const s of report.stations) {
      for (const p of s.metadataLabelledRenderedProps) {
        offenders.push(`${s.scenarioId}/${p.propId}: "${p.label.slice(0, 50)}" (${p.reason})`);
      }
    }
    expect(offenders, `metadata-labelled props still rendering:\n${offenders.join("\n")}`).toHaveLength(0);
  }, 900_000);

  it("no station is left rendering a prop it does not declare", async () => {
    // Kills a lazy satisfaction of the first contract: filtering at the runtime while the factory
    // keeps emitting them leaves the manifests lying about what the room contains, which is the
    // declaration-versus-product gap this project has now hit four times.
    const mod = await load();
    const inspect = mod["inspectGenericCuePropRemoval"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const ghosts: string[] = [];
    for (const s of report.stations) {
      const declared = new Set(s.declaredPropIds);
      for (const id of s.renderedPropIds) {
        if (!declared.has(id)) ghosts.push(`${s.scenarioId}: renders ${id}, manifest does not declare it`);
      }
    }
    expect(ghosts, `props rendered but not declared:\n${ghosts.join("\n")}`).toHaveLength(0);
  }, 900_000);

  it("the ED reactive props and hand-authored props survive (COUNTERWEIGHT)", async () => {
    // The cheap satisfaction is deleting every room prop everywhere. The ED bay's props are the only
    // reactive scenery in the product, and psych/telehealth/peds carry real clinical names.
    const mod = await load();
    const inspect = mod["inspectGenericCuePropRemoval"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const allRendered = new Set(report.stations.flatMap((s) => s.renderedPropIds));

    const survivors = ED_REACTIVE_PROP_IDS.filter((id) => allRendered.has(id));
    expect(survivors.length, `the ED bay lost its reactive props: ${ED_REACTIVE_PROP_IDS.join(", ")}`)
      .toBeGreaterThan(0);

    const authored = HAND_AUTHORED_PROP_IDS.filter((id) => allRendered.has(id));
    expect(authored.length, `hand-authored props were deleted: ${HAND_AUTHORED_PROP_IDS.join(", ")}`)
      .toBeGreaterThan(0);
  }, 900_000);
});
