import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#139) — `roomProps.length > 0` is being used as the definition of "this is a
 * real generated learner station". A station with no room props falls into debug/placeholder mode and
 * renders evidence panels, affordance markers and primitive fallbacks over the room.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT — a station that still has props must stay dynamic, and
 * debug capture modes must keep working.
 *
 * ## FIXED (#139)
 * Predicate is `environment.reviewStatus !== "blocked"` only — not roomProps.length.
 * Emptied-props route-intercept measure: isDynamic=true, panels=0, bed/monitor=0.
 * Debug capture mode still surfaces affordance + fallback chrome via captureMode escape hatches.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, TRACED — verified against the tree, do not re-derive
 *
 * `main.ts:1213-1216`
 *
 *     function isDynamicGeneratedEncounterSceneMode(): boolean {
 *       return encounterRuntimeAssetBundle.sceneManifest.roomProps.length > 0
 *         && encounterRuntimeAssetBundle.environment.reviewStatus !== "blocked";
 *     }
 *
 * A prop count is standing in for "this bundle is a generated learner station". Consumers invert it:
 *
 *     shouldShowRuntimeAffordanceMarkers()   `:1270+`  → !isDynamic || captureMode debug-ish
 *     shouldShowPrimitiveAssetFallbacks()    `:1279+`  → !isDynamic || captureMode debug-ish
 *     isGeneratedPlaceholderSourceForDifferentScenario() `:1224` → isDynamic && …
 *
 * **and more than those three** — a peer round found the same flag gating in-scene evidence panels
 * and identity labels around `:1287-1312`, and legacy bed/monitor visibility around `:3410`. Fixing
 * only the affordance and fallback consumers leaves the panels wrong. Find them all.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * HOW THIS WAS FOUND — a slice landed, I graded it, and reverted it
 *
 * #139 set `roomProps: []` on ten stations to remove four metadata-labelled cubes. Every contract
 * passed. The capture then showed five large floating debug panels (Simulated EHR, Actor Realism
 * Requirements, Live Dialogue, Conversation Tooling, Input Evidence), giant equipment nameplates
 * across the figures, and primitive fallbacks. Reverted at `5430b3a`, isolated by restoring only the
 * pre-#139 stepdown manifest.
 *
 * So the empty-prop state is not merely unsupported — it is a **trap**, and any future station that
 * legitimately has no scenery walks into it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE FIX IS (a). A PEER ROUND TALKED ME OUT OF (d).
 *
 * I leaned toward splitting the flag into "generated scene" and "has scenery". The peer round's
 * reading, which I accept: **every consumer today inverts the same bit**, so splitting is overbuilding
 * until two of them provably mean different things. Define one honest predicate for "generated learner
 * station" — bank membership plus a shipped bundle path or store kind, plus the existing
 * `reviewStatus !== "blocked"` — and **not** a prop count.
 *
 * **Rejected, and named so you do not reach for them:**
 *   - props OR equipment OR actors — still couples mode to scenery density, and a station can ship
 *     zero equipment
 *   - give every station at least one prop so the zero case never occurs — that re-blocks the cue-prop
 *     removal and preserves the lie
 *   - split into three flags — defer until meanings diverge
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT MUST KEEP WORKING — this is the sharp edge
 *
 * `!isDynamic` deliberately means "show me the debug chrome" for fixture and capture modes. If the new
 * predicate is too loose, a genuine offline fixture stops surfacing markers and panels that someone
 * relies on. The counterweight covers the capture-mode escape hatches; do not remove them.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - What defines "generated learner station". Bank membership, `assetStoreKind`, the presence of a
 *    shipped bundle path, or a combination. Say which and why, and say what it does NOT cover.
 *  - Whether `environment.reviewStatus !== "blocked"` stays part of it. It is doing real work today.
 *  - Which consumers you found. There are more than the three named above and enumerating them is part
 *    of the slice — if you find one whose current zero-prop behaviour is correct, STOP and say so.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands a station with no props still count as a generated scene, and is satisfiable by making
 * the predicate always true. (2) forbids that by requiring the debug capture modes to still surface
 * their chrome. (3) is green today and forbids buying either by giving stations dummy props back.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectGeneratedSceneModePredicate()`. What must
 * not change: stations are enumerated from what ships, and the predicate plus its consumers are
 * evaluated in the LIVE scene, not read out of the source.
 *
 * REQUIRED, the observable half: capture `stepdown_sepsis_nurse_escalation_v1` **twice** — once as it
 * ships, and once with its `roomProps` emptied — and confirm both render the same clean room. That
 * second capture is the one #139 got wrong. Reuse
 * `tools/openclinxr/evidence/ui-xr-environment-room-capture.ts`.
 *
 * IN-SCOPE VISUAL — answer EVERY line, `none` or `present`. Do not replace this with a sentence:
 *     debug_panels:         none | present
 *     equipment_nameplates: none | present
 *     primitive_fallbacks:  none | present
 *     figures_intact:       yes  | no
 *     legacy_bed_monitor_boxes: none | present
 *
 * That checklist exists because #139's worker looked at exactly this regression, described every
 * element of it, and still graded the capture "cleaner" — it optimised for the brief's subject and
 * attributed the rest to pre-existing clutter. A slot it must fill cannot be filtered.
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS THE
 * OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT.
 *
 * SCOPE: what makes a scene "generated" and what that gates. Says NOTHING about whether the cue props
 * should exist (that is the follow-on this unblocks), equipment (#140), or fixtures (#143).
 */

const load = async () => import("./generated-scene-mode-predicate.js") as Promise<Record<string, unknown>>;

type SceneModeFacts = {
  scenarioId: string;
  /** roomProps in the manifest under test — zero for the emptied variant. */
  roomPropCount: number;
  /** Capture mode the scene was evaluated in. "" is the normal learner path. */
  captureMode: string;
  isDynamicGeneratedEncounterSceneMode: boolean;
  showsRuntimeAffordanceMarkers: boolean;
  showsPrimitiveAssetFallbacks: boolean;
  /** In-scene evidence/debug panels rendered in the room. */
  inSceneEvidencePanelCount: number;
  /** Legacy bed/monitor primitive boxes that a generated scene is supposed to hide. */
  legacyBedMonitorBoxCount: number;
};

type Inspect = () => Promise<{ scenes: SceneModeFacts[] }>;

const NORMAL = "";

describe("a station with no room props is still a generated scene (#139)", () => {
  it("an emptied-props station stays in generated scene mode", async () => {
    // main.ts:1213 defines the mode by roomProps.length > 0, so emptying a station's props drops it
    // into debug/placeholder mode. #139 did exactly that on ten stations and I reverted it.
    const mod = await load();
    const inspect = mod["inspectGeneratedSceneModePredicate"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const emptied = report.scenes.filter((s) => s.roomPropCount === 0 && s.captureMode === NORMAL);
    expect(emptied.length, "no zero-prop scene was evaluated in the normal capture path").toBeGreaterThan(0);

    const wrong: string[] = [];
    for (const s of emptied) {
      if (!s.isDynamicGeneratedEncounterSceneMode) {
        wrong.push(`${s.scenarioId}: zero props dropped it out of generated scene mode`);
      }
      if (s.showsPrimitiveAssetFallbacks) wrong.push(`${s.scenarioId}: primitive fallbacks rendered`);
      if (s.inSceneEvidencePanelCount > 0) {
        wrong.push(`${s.scenarioId}: ${s.inSceneEvidencePanelCount} debug panels in the room`);
      }
      if (s.legacyBedMonitorBoxCount > 0) {
        wrong.push(`${s.scenarioId}: ${s.legacyBedMonitorBoxCount} legacy bed/monitor boxes re-shown`);
      }
    }
    expect(wrong, `zero-prop stations falling into debug mode:\n${wrong.join("\n")}`).toHaveLength(0);
  }, 900_000);

  it("debug capture modes still surface their chrome", async () => {
    // Kills the cheap satisfaction of the first contract: making the predicate unconditionally true
    // silences the markers and panels that fixture and capture modes exist to show.
    const mod = await load();
    const inspect = mod["inspectGeneratedSceneModePredicate"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const debugScenes = report.scenes.filter((s) => s.captureMode.length > 0);
    expect(debugScenes.length, "no debug capture mode was evaluated").toBeGreaterThan(0);

    const silenced = debugScenes
      .filter((s) => !s.showsRuntimeAffordanceMarkers && !s.showsPrimitiveAssetFallbacks)
      .map((s) => `${s.scenarioId} in ${s.captureMode}: debug chrome silenced`);
    expect(silenced, `capture modes that lost their chrome:\n${silenced.join("\n")}`).toHaveLength(0);
  }, 900_000);

  it("stations that ship props are unaffected (COUNTERWEIGHT)", async () => {
    // The other cheap satisfaction is giving every station dummy props back, which re-blocks the
    // cue-prop removal this unblocks and preserves the lie that props define "generated".
    const mod = await load();
    const inspect = mod["inspectGeneratedSceneModePredicate"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const withProps = report.scenes.filter((s) => s.roomPropCount > 0 && s.captureMode === NORMAL);
    expect(withProps.length, "no prop-carrying station was evaluated").toBeGreaterThan(0);
    for (const s of withProps) {
      expect(s.isDynamicGeneratedEncounterSceneMode, `${s.scenarioId} stopped being a generated scene`).toBe(true);
      expect(s.inSceneEvidencePanelCount, `${s.scenarioId} gained debug panels`).toBe(0);
    }
  }, 900_000);
});
