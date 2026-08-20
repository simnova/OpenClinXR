import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * E2 / xr-systems-architect. Sanctioned by the superagent 2026-08-20 on the THIRD spec; the first
 * two were refused and both were the same error.
 *
 * ## THE DEFECT, MEASURED — do not re-derive these. The INFERENCE is fenced separately below.
 *
 * The viseme capture cannot grade a face it cannot see:
 *
 *   subjectVisible     false
 *   firstHitMeshName   ...scenario-expectation-visual-review-panel
 *   firstHitDistance   2.55 m, on the camera->head ray
 *
 * The occluder is a 2.25 x 0.82 m billboard whose own `userData` (`main.ts:5044`) declares it
 * `scenario_expectations_visible_inside_3d_scene_for_adversarial_visual_comparison`. It is a review
 * affordance standing inside a learner exam volume. The superagent ruled (c): it does not belong there.
 *
 * The raycast is sound and is NOT the defect — it walks ancestors and returns on `visible === false`
 * (`ui-xr-viseme-drive-capture.ts:368-371`), so this is a real rendered object, not a debug volume.
 *
 * ## TWO SPECS DIED HERE. BOTH REACHED FOR A SWITCH THE CAPTURE CONTROLS.
 *
 *   spec 1  route through `shouldUseCleanHumanoidSourceComparatorCapture()` -- REFUSED.
 *           `main.ts:8365-8371` hides four cues and RETURNS before `:8639
 *           applyHumanoidMorphTargetCue(slot, openness, viseme, ...)`. Clean mode zeroes the very
 *           influences this slice exists to grade. The flag is not free; it is the mixer's off switch.
 *           The known-good column claimed for it was also wrong: `humanoid-vision-score.ts` passes
 *           `clean=1` / `__hideHud`, a DIFFERENT predicate.
 *
 *   spec 2  gate on `selectedPortalPreviewStart()` -- REFUSED, and this is the instructive one.
 *           It returns `null` with no param (`main.ts:3143`) and the harness ALREADY sends
 *           `openclinxrPortalStart=encounter`. The assertion would have gone green against a query
 *           the capture sets itself, while a default learner still walked into the billboard.
 *           VACUOUS BY CONSTRUCTION. Clause (4) below exists solely to close that hole.
 *
 * ## THE DISCRIMINATOR THAT IS NOT A QUERY
 *
 *   main.ts:3166  side = transitionProbeZ > portalThresholdZ + 0.25 ? ... : "dynamic_encounter_world"
 *                 -- LIVE probe geometry. No URL can set it.
 *   main.ts:4132  updatePortalTransitionEvidence(locomotionRig, camera) runs every frame, so the
 *                 hide is LEVEL-triggered: a capture that starts already inside takes the same
 *                 branch as a walk-in.
 *   main.ts:3179  portalInteriorHiddenObjectNames = updateReusableExteriorAnteroomVisibility(side)
 *   main.ts:3194  published on window.__openClinXrPortalTransitionEvidence
 *
 * ## KNOWN-GOOD COLUMN (SS9h) — `reusableExteriorAnteroom`
 *
 * The anteroom is the working example of exam-volume membership, in the same function, driven by the
 * same `side`. The first two specs had NO known-good column and said so; this one does.
 *
 * **THE TRAP THE KNOWN-GOOD COLUMN DOES NOT CARRY, and it is load-bearing:**
 * `updateReusableExteriorAnteroomVisibility` (`main.ts:3207-3219`) hides by **NAME FILTER**, not by
 * group membership -- a hardcoded `object.name.includes(...)` list of eight portal parts plus
 * `.endsWith(".floor")`. **Re-parenting the panel into `reusableExteriorAnteroom` without also adding
 * its name to that filter leaves clause (1) RED.** The panel is currently parented straight to the
 * scene (`main.ts:5045 scene.add(scenarioPanel.mesh)`), which that traversal never reaches.
 *
 * ## WHICH ARE REDS AND WHICH ARE NETS (#227)
 *
 * The deliverable is ONE artifact, so every clause that reads it is red on a clean tree — that is
 * arithmetic, not rigour. Clauses (1)(2)(3)(4)(5) read the artifact: **REDS**, planted `it.fails`.
 * Clause (6) reads main.ts and passes today: a **TRUE NET**. Clause (7) reads the tree: vacuity guard.
 *
 * NOT TESTED:
 *   - The `mismatchPanel` at `main.ts:3468`, a second review affordance in the same block. Whether it
 *     also occludes is UNMEASURED and deliberately out of scope.
 *   - That a human finds the resulting frame legible. This proves the head is the first hit, not that
 *     twelve remaining visemes read correctly to an eye. That grade is still owed.
 *   - Quest, clinical validity, exam equivalence.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const MAIN_TS = join(REPO_ROOT, "apps/ui-xr/src/main.ts");
/** Tracked, not under gitignored .openclinxr/evidence — #396: that path has no land path. */
const SUMMARY = join(HERE, "review-panel-leaves-exam-volume.json");

const PANEL = "scenario-expectation-visual-review-panel";
const REQUIRED_VISEMES = ["viseme_sil", "viseme_aa", "viseme_TH"] as const;

type Summary = {
  capturedFrom: string;
  queryUsed: string;
  side: string;
  portalInteriorHiddenObjectNames: string[];
  panelPresentOutsideEncounter: boolean;
  subjectVisible: boolean;
  firstHitMeshName: string | null;
  visemeInfluences: { drivenTargetName: string; influence: number }[];
};

function summary(): Summary {
  if (!existsSync(SUMMARY)) {
    throw new Error(
      `${SUMMARY} does not exist. The capture must write a tracked summary of a LIVE crossing.`,
    );
  }
  return JSON.parse(readFileSync(SUMMARY, "utf8")) as Summary;
}

describe("the adversarial review panel leaves the learner exam volume", () => {
  it.fails("(1) RED: a live crossing hides the review panel", () => {
    const s = summary();
    expect(s.side, "must be a real crossing, not a preview").toBe("dynamic_encounter_world");
    expect(
      s.portalInteriorHiddenObjectNames.some((n) => n.includes(PANEL)),
      `today impossible: main.ts:3207 traverses only reusableExteriorAnteroom and the panel is scene.add()ed at :5045`,
    ).toBe(true);
  });

  it.fails("(2) RED: the subject is the first hit, not the billboard", () => {
    const s = summary();
    expect(s.subjectVisible, "camera->head ray must reach the head").toBe(true);
    expect(s.firstHitMeshName, "the occluder must not be the first hit").not.toContain(PANEL);
    expect(s.firstHitMeshName, "and something must actually be hit").not.toBeNull();
  });

  it.fails("(3) COUNTERWEIGHT: the viseme mixer still drives", () => {
    // Refuses spec 1. Routing through shouldUseCleanHumanoidSourceComparatorCapture() returns at
    // main.ts:8371 before the mixer, so these influences collapse to rest. This is the flag detector.
    const s = summary();
    for (const name of REQUIRED_VISEMES) {
      const hit = s.visemeInfluences.find((v) => v.drivenTargetName === name);
      expect(hit, `${name} must still be driven`).toBeDefined();
      expect(hit?.influence, `${name} influence`).toBeCloseTo(1, 2);
    }
  });

  it.fails("(4) COUNTERWEIGHT: not satisfiable by a URL parameter", () => {
    // Refuses spec 2, the vacuous one. selectedPortalPreviewStart() returns null with no param and
    // the harness already sends openclinxrPortalStart=encounter, so any fix keyed on the preview
    // would pass while a default learner still faces the billboard.
    const s = summary();
    expect(
      s.queryUsed,
      "the crossing must be earned by locomotion, not declared in the query string",
    ).not.toContain("openclinxrPortalStart");
  });

  it.fails("(5) COUNTERWEIGHT: the panel survives outside the exam volume", () => {
    // Deleting the panel is the cheap fix and is refused. It is a legitimate review affordance; the
    // finding is that it is in the wrong VOLUME, not that it should not exist.
    const s = summary();
    expect(s.panelPresentOutsideEncounter, `the panel must still exist when side !== encounter`).toBe(
      true,
    );
  });

  it("(6) NET: the clean-capture predicate is untouched", () => {
    // Reads the tree, passes today, and stays passing. If a fix reroutes through the clean flag the
    // call-site count moves and this fires before anyone reads the artifact.
    const src = readFileSync(MAIN_TS, "utf8");
    const sites = src.match(/shouldUseCleanHumanoidSourceComparatorCapture\(\)/g) ?? [];
    expect(sites.length, "measured 11 on 281444fd; the clean flag is not this slice's mechanism").toBe(
      11,
    );
  });

  it("(7) VACUITY GUARD: the anteroom name filter is real and lacks the panel", () => {
    // Reads the tree, not the absent artifact, so it passes today and keeps the trap honest: if
    // someone widens the filter to a catch-all, the known-good column stops meaning anything.
    const src = readFileSync(MAIN_TS, "utf8");
    expect(src, "the known-good hider must still exist").toContain(
      "function updateReusableExteriorAnteroomVisibility",
    );
    expect(src, "the anteroom's own entries must survive").toContain('object.name.includes("portal-lintel")');
    expect(
      src.slice(src.indexOf("function updateReusableExteriorAnteroomVisibility")).slice(0, 900),
      "the filter does not name the panel today — that absence is the defect",
    ).not.toContain(PANEL);
  });
});
