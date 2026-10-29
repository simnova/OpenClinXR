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
 *
 * ## FIXED (#468) — the panel is under live-`side` governance
 *
 * The panel is re-parented from `scene` into `reusableExteriorAnteroom` and marked
 * `openClinXrPortalInteriorReviewAffordance = true`; `updateReusableExteriorAnteroomVisibility`
 * hides it by that group-membership marker (NOT by adding its name to the name filter, which
 * clause (7) forbids). The capture crosses by locomotion (no `openclinxrPortalStart`) and reads
 * `window.__openClinXrPortalTransitionEvidence` live. Clauses (1)(4)(5) are green.
 *
 * TWO RESIDUALS REMAIN RED AND ARE OUT OF SCOPE FOR THIS SLICE:
 *   (2) the camera->head ray is aimed at the crown apex (localHeadY = geometry bbMax.y), a
 *       tangential graze that misses the head; the raycast therefore reports the first SIMPLE
 *       mesh behind the head — the room's `kitchen_00exterior` hull at 4.42 m — never the head
 *       itself (0.71 m). Hiding the panel is correct and necessary, but it does not make
 *       subjectVisible true; the raycast's subject-visible verdict is blind to the head for any
 *       camera aiming at the crown. The "the raycast is sound" premise is false for the
 *       subject-visible half of the verdict.
 *   (3) the current parent dialogue phonemes are ARPAbet `AH`, which `resolveVisemeTarget` does
 *       not alias to `viseme_aa` (only lowercase `a` -> `AA` -> `viseme_aa`); the mixer drives
 *       `viseme_sil` + `viseme_TH` at influence 1, not `viseme_aa`. The committed parent summary
 *       that listed `viseme_aa` is stale against current dialogue. Pre-existing, unrelated to the
 *       panel change.
 *
 * ## FIXED (#472) — residuals (2) and (3) are green
 *
 * (2) is this issue's follow-on: the capture now anchors the camera->head ray on the `jaw` joint
 * (read at runtime via getWorldPosition, skinned head-region raycast), so the first hit is
 * `mpfb_ob_patient_aisha_body_1` and subjectVisible is true. (3) went green on a refreshed capture:
 * the current dialogue drives `viseme_aa` at influence 1 (alongside `viseme_sil`/`viseme_TH`), so
 * the stale committed summary is superseded. Flipped `it.fails` -> `it` for both.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const MAIN_TS = join(REPO_ROOT, "apps/ui-xr/src/main.ts");
const PORTAL_TRAIL = join(REPO_ROOT, "packages/openclinxr/xr-locomotion/src/portal-trail.ts");
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
  it("(1) GREEN: a live crossing hides the review panel", () => {
    const s = summary();
    expect(s.side, "must be a real crossing, not a preview").toBe("dynamic_encounter_world");
    expect(
      s.portalInteriorHiddenObjectNames.some((n) => n.includes(PANEL)),
      `today impossible: main.ts:3207 traverses only reusableExteriorAnteroom and the panel is scene.add()ed at :5045`,
    ).toBe(true);
  });

  it("(2) RED: the subject is the first hit, not the billboard", () => {
    const s = summary();
    expect(s.subjectVisible, "camera->head ray must reach the head").toBe(true);
    expect(s.firstHitMeshName, "the occluder must not be the first hit").not.toContain(PANEL);
    expect(s.firstHitMeshName, "and something must actually be hit").not.toBeNull();
  });

  it("(3) COUNTERWEIGHT: natural viseme profile from live evidence", async () => {
    const { assertNaturalVisemeProfile } = await import("./review-panel/natural-viseme-profile-guard.js");
    const authority = JSON.parse(readFileSync(join(HERE, "review-panel/profile-authority.json"), "utf8"));
    type Ev = Record<string, unknown>;
    const raw = summary() as unknown as { visemeProfileEvidence?: unknown };
    if (raw.visemeProfileEvidence === undefined || raw.visemeProfileEvidence === null) {
      expect("visemeProfileEvidence missing: old summary predates the real producer capture", "old summary must fail until new capture").toBe("present");
    }
    const ev = raw.visemeProfileEvidence as Ev;
    assertNaturalVisemeProfile(ev, authority, REPO_ROOT);
    const clone = (): Ev => JSON.parse(JSON.stringify(ev)) as Ev;
    const peaks = (m: Ev, which: string): Record<string, number> => m[which] as Record<string, number>;
    const mustThrow = (m: Ev, re: RegExp, why: string): void => {
      expect(() => assertNaturalVisemeProfile(m, authority, REPO_ROOT), why).toThrow(re);
    };
    { const m = clone(); peaks(m, "activeMorphPeaks").viseme_TH = 0.5; mustThrow(m, /viseme_TH/, "TH at rest level must fail"); }
    { const m = clone(); peaks(m, "activeMorphPeaks").viseme_aa = 0; mustThrow(m, /viseme_aa/, "AA collapsed to 0 must fail"); }
    { const m = clone(); peaks(m, "activeMorphPeaks").viseme_aa = 1; mustThrow(m, /viseme_aa/, "AA at full drive must fail"); }
    { const m = clone(); m["actorId"] = "intruder"; mustThrow(m, /actorId|ownerMismatch|owner/, "wrong owner must fail"); }
    { const m = clone(); m["ownerMismatchCount"] = 1; mustThrow(m, /ownerMismatch/, "owner mismatch count must fail"); }
    { const m = clone(); m["subjectAssetSha256"] = "00".repeat(32); mustThrow(m, /subjectAssetSha256/, "wrong asset hash must fail"); }
    { const m = clone(); m["dictKeysSha256"] = "00".repeat(32); mustThrow(m, /dictKeysSha256/, "wrong dictionary hash must fail"); }
    { const m = clone(); peaks(m, "inactiveMorphPeaks").viseme_TH = 0.5; mustThrow(m, /inactiveMorphPeaks\.viseme_TH/, "inactive TH drive must fail"); }
    { const m = clone(); m["prematureEpochClearCount"] = 1; mustThrow(m, /prematureEpochClearCount/, "premature clear must fail"); }
    { const m = clone(); m["completedEpochCount"] = 0; mustThrow(m, /completedEpochCount/, "no observed completion must fail"); }
    { const m = clone(); m["sourceFile"] = "packages/openclinxr/xr-dialogue/src/other-driver.ts"; mustThrow(m, /sourceFile/, "record from a different driver must fail"); }
    { const m = clone(); m["sourceSha256"] = "00".repeat(32); mustThrow(m, /sourceSha256/, "record with wrong driver hash must fail"); }
    { const m = clone(); m["collectorSourceSha256"] = "00".repeat(32); mustThrow(m, /collectorSourceSha256/, "record with wrong collector hash must fail"); }
  });

  it("(4) GREEN: not satisfiable by a URL parameter", () => {
    // Refuses spec 2, the vacuous one. selectedPortalPreviewStart() returns null with no param and
    // the harness already sends openclinxrPortalStart=encounter, so any fix keyed on the preview
    // would pass while a default learner still faces the billboard.
    const s = summary();
    expect(
      s.queryUsed,
      "the crossing must be earned by locomotion, not declared in the query string",
    ).not.toContain("openclinxrPortalStart");
  });

  it("(5) GREEN: the panel survives outside the exam volume", () => {
    // Deleting the panel is the cheap fix and is refused. It is a legitimate review affordance; the
    // finding is that it is in the wrong VOLUME, not that it should not exist.
    const s = summary();
    expect(s.panelPresentOutsideEncounter, `the panel must still exist when side !== encounter`).toBe(
      true,
    );
  });

  it("(6) NET: the clean-capture predicate is untouched", async () => {
    const { assertFrozenCleanCapture } = await import("./review-panel/clean-capture-guard.js");
    const baseline = JSON.parse(readFileSync(join(HERE, "review-panel/clean-capture-baseline.json"), "utf8"));
    const src = readFileSync(MAIN_TS, "utf8");
    const ok = assertFrozenCleanCapture(src, baseline);
    expect(ok.callSites, "7 exact AST call-sites anchored to Git 604").toBe(7);
    const P = "shouldUseCleanHumanoidSourceComparatorCapture";
    // AST-shape mutants: each still parses; each must be refused for its own reason.
    const dropCall = (s: string): string => {
      const sf = (globalThis as unknown as { __ts?: unknown }).__ts as never;
      void sf;
      // Remove the callee identifier of the first real call (keeps parens/args shape valid).
      let done = false;
      return s.split("\n").map((ln) => {
        if (!done && ln.includes(P + "()") && !ln.trimStart().startsWith("function")) { done = true; return ln.replace(P, "droppedCleanCaptureCall"); }
        return ln;
      }).join("\n");
    };
    expect(() => assertFrozenCleanCapture(dropCall(src), baseline), "removed call must be refused").toThrow(/call-sites 6/);
    expect(() => assertFrozenCleanCapture(src.split('"source-clean"').join('"source-cleaX"'), baseline), "body change must be refused").toThrow(/body sha/);
    expect(() => assertFrozenCleanCapture(src.split(P).join("shouldUseCleanHumanoidSourceComparatorCapturX"), baseline), "lookalikes must be refused").toThrow(/declarations: 0/);
    expect(() => assertFrozenCleanCapture(dropCall(src) + `\n// ${P}()\n`, baseline), "comment padding must not restore count").toThrow(/call-sites 6/);
    expect(() => assertFrozenCleanCapture(dropCall(src) + `\nconst x = "${P}()";\n`, baseline), "string padding must not restore count").toThrow(/call-sites 6/);
  });

  it("(7) VACUITY GUARD: the anteroom hider is real and marker-governed", async () => {
    const { assertHiderSemantics } = await import("./review-panel/clean-capture-guard.js");
    const src = readFileSync(PORTAL_TRAIL, "utf8");
    const ok = assertHiderSemantics(src);
    expect(ok.terms, "OR of explicit selector terms").toBeGreaterThanOrEqual(11);
    // True-catchall mutant (still parses): must now fail.
    const catchAll = src.replace('object.name.includes("portal-lintel")', "true");
    expect(() => assertHiderSemantics(catchAll), "true catch-all must be refused").toThrow(/non-explicit/);
    // Terms-only-in-comment mutant (still parses): must now fail.
    const commentOnly = src.split('object.name.includes("portal-lintel")').join("knownLintelCheck") + '\n// portal-lintel .floor openClinXrPortalInteriorReviewAffordance\n';
    expect(() => assertHiderSemantics(commentOnly), "comment decoys must be refused").toThrow();
    // Constant-name receiver: valid spelling, wrong receiver — must be refused.
    const constRecv = src.replace('object.name.includes("portal-lintel")', '({name:"portal-lintel"}).name.includes("portal-lintel")');
    expect(() => assertHiderSemantics(constRecv), "constant receiver must be refused").toThrow();
    // Foreign userData receiver: valid marker spelling on the wrong object — must be refused.
    const foreignRecv = src.replace('object.userData["openClinXrPortalInteriorReviewAffordance"]', 'foreign.userData["openClinXrPortalInteriorReviewAffordance"]');
    expect(() => assertHiderSemantics(foreignRecv), "foreign userData receiver must be refused").toThrow();
    // Original actual hider must PASS.
    expect(() => assertHiderSemantics(src), "actual hider must pass").not.toThrow();
  });
});
