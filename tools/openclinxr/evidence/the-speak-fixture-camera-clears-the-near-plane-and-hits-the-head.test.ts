import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: the speak-fixture still camera accepts a candidate that puts its first hit 5 mm
 * INSIDE the renderer's near plane, and the current contract cannot see it.
 *
 * MEASURED by the orchestrator on 2026-08-31 from the preserved worker output at `a7d9a1f2` on
 * `wt/bothy-tsk_27baa1ed86266d7b` (six files that a card close would have destroyed):
 *
 *   still         camera z   firstHitDistance   firstHitMeshName
 *   rest            0.72          0.7252        openclinxr.ed_chest_pain_priority_v1.phoneme-mouth-cue.patient
 *   speaking-1      0.45          0.0948        openclinxr_real_garment_from_phenotype_hospital_gown
 *   speaking-2      0.45          0.0952        openclinxr_real_garment_from_phenotype_hospital_gown
 *
 * The camera near plane is 0.1 (apps/ui-xr/src/main.ts:3331), so both speaking frames are clipped.
 * MECHANISM: STILL_CAMERA_OFFSETS is ordered z=0.72, 0.72, 0.72, 0.45, 0.90 and the loop accepts
 * the first candidate whose firstHitActorId equals the patient (ui-xr-viseme-drive-capture.ts:1766).
 * The gown inherits the patient actor id, so z=0.45 accepts and z=0.90 is never reached. Reordering
 * does not fix it: reframeForStill hard-codes z=0.72 then iterates STILL_CAMERA_OFFSETS.slice(1),
 * so promoting z=0.90 to element zero would skip it. Ordering is policy; the predicate is the defect.
 *
 * The predecessor plant asserted firstHitActorId and occluder===false only, so it greens with the
 * camera inside the gown. That card (tsk_27baa1ed86266d7b) is Planted and frozen; this file is its
 * successor, not a rewrite of it.
 *
 * IMMUTABLE diagnosis. Flip it.fails -> it and append a ## FIXED block. Do not rewrite the table.
 *
 * ## THE TRAP THIS CONTRACT IS DESIGNED AGAINST
 *
 * A head-cue name is NOT evidence of a rendered face. `phoneme-mouth-cue` is a 13 x 3 x 1.4 cm
 * BoxGeometry proxy (apps/ui-xr/src/main.ts:6474), `runtime-jaw-viseme-target` is another box
 * (:6547), and updateHumanoidSpeechCue sets mouthCue.visible = false whenever no speech is active
 * (:8476). So the rest frame's mouth-cue hit is a hit on an INVISIBLE proxy. Clause (1) therefore
 * requires firstHitVisible, which the capture must read off the live object and its ancestors.
 *
 * Worse, with ANCHOR_OVERRIDE set the capture skips the deformed skinned-face intersection
 * (ui-xr-viseme-drive-capture.ts:585) and, when the anchor is nearest, overwrites firstHitMeshName
 * with the anchor's own LABEL rather than a measured triangle (:752). Clause (1) therefore requires
 * firstHitKind === "triangle"; a synthesized label is "anchor" and fails.
 *
 * ## THRESHOLD PROVENANCE
 *
 * cameraNear is read from the live camera per frame, never copied as a constant here, so the bar is
 * the renderer's own value and is independent of the 0.0948 that motivated this card. Clause (3)
 * pins that value at its source so lowering the product near plane cannot buy a green.
 *
 * There is deliberately NO numeric "good portrait distance" in this contract. One known-good frame
 * (rest at 0.7252 m) does not derive a lower visual bound, and inventing 0.36 or 0.5 or "half of
 * rest" would be a fitted threshold. This contract asserts clipping safety and demands the full
 * candidate sweep; the portrait verdict stays an orchestrator pixel grade on the stills.
 *
 * claimScope: whether every speak-fixture still selected a visible, real-triangle head hit outside
 *   the renderer's own near plane, and whether every attempted candidate was recorded.
 * notEvidenceFor: that the resulting frame is a good portrait; learner-runtime camera placement
 *   outside this dev fixture; headset appearance; gown topology, sharpness, rigging or issue 750.
 */

const REPO = join(import.meta.dirname, "../../..");
const REPORT = join(REPO, "tools/openclinxr/evidence/speak-fixture-camera-candidate-report.json");
const MAIN_TS = join(REPO, "apps/ui-xr/src/main.ts");

/** Escape values are first: a sweep that clears nothing is a result, not a failure to report. */
const OUTCOMES = [
  "no_candidate_clears_near_plane",
  "inconclusive_blocked",
  "other",
  "resolved",
] as const;

const HEAD_CUE = /(?:phoneme-mouth-cue|runtime-jaw-viseme-target)/u;

type Attempt = {
  offset: { x: number; y: number; z: number };
  status: string;
  accepted: boolean;
  rejectionReason: string | null;
  firstHitMeshName: string | null;
  firstHitActorId: string | null;
  firstHitDistance: number | null;
  firstHitKind: string | null;
  firstHitVisible: boolean | null;
  subjectInFrame: boolean | null;
};

type FrameRow = {
  framePath: string;
  cameraNear: number;
  selectedCandidate: Attempt | null;
  attempts: Attempt[];
};

type Report = {
  schemaVersion: string;
  measuredAgainstCommit: string;
  outcome: (typeof OUTCOMES)[number];
  outcomeDetail: string;
  frames: FrameRow[];
};

const report = (): Report => {
  expect(existsSync(REPORT), `${REPORT} missing - the candidate sweep has not been recorded`).toBe(true);
  return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
};

describe("the speak-fixture camera clears the near plane and hits the head", () => {
  it.fails("(1) every still's selected candidate is a visible triangle head hit outside the near plane", () => {
    const r = report();
    expect(OUTCOMES).toContain(r.outcome);
    if (r.outcome !== "resolved") {
      // The stop branch is legal and is NOT a cheap green: clause (2) still demands the full sweep.
      expect(r.outcomeDetail.trim().length, "an escape outcome must say what it found").toBeGreaterThan(40);
      return;
    }
    expect(r.frames.map((f) => f.framePath).sort()).toEqual([
      "tools/openclinxr/evidence/speak-fixture-stills/speak-fixture-rest.png",
      "tools/openclinxr/evidence/speak-fixture-stills/speak-fixture-speaking-1.png",
      "tools/openclinxr/evidence/speak-fixture-stills/speak-fixture-speaking-2.png",
    ]);
    for (const frame of r.frames) {
      const hit = frame.selectedCandidate;
      expect(hit, `${frame.framePath}: outcome resolved but no candidate selected`).not.toBeNull();
      if (!hit) continue;
      expect(hit.firstHitDistance, `${frame.framePath}: first hit is inside the near plane`)
        .toBeGreaterThan(frame.cameraNear);
      expect(hit.firstHitKind, `${frame.framePath}: hit is a synthesized anchor label, not a triangle`)
        .toBe("triangle");
      expect(hit.firstHitVisible, `${frame.framePath}: hit is an invisible proxy cue`).toBe(true);
      expect(hit.firstHitMeshName ?? "", `${frame.framePath}: first hit is not a head cue`)
        .toMatch(HEAD_CUE);
      expect(hit.subjectInFrame, `${frame.framePath}: anchor projects outside the frame`).toBe(true);
    }
  });

  it.fails("(2) COUNTERWEIGHT: every attempted candidate is recorded, not only the winner", () => {
    const r = report();
    // The present capture records the selected offset alone, which is why nobody could say why the
    // z=0.72 candidates were rejected before z=0.45 accepted. A report of winners cannot be audited.
    for (const frame of r.frames) {
      expect(frame.attempts.length, `${frame.framePath}: fewer than two candidates recorded`)
        .toBeGreaterThanOrEqual(2);
      for (const a of frame.attempts) {
        for (const key of [
          "offset", "status", "accepted", "firstHitMeshName", "firstHitActorId",
          "firstHitDistance", "firstHitKind", "firstHitVisible", "subjectInFrame",
        ] as const) {
          expect(a[key], `${frame.framePath} ${JSON.stringify(a.offset)}: ${key} not recorded`)
            .not.toBeUndefined();
        }
        if (!a.accepted) {
          expect((a.rejectionReason ?? "").length, `${frame.framePath}: rejection reason missing`)
            .toBeGreaterThan(0);
        }
      }
      expect(frame.attempts.filter((a) => a.accepted).length, `${frame.framePath}: not exactly one winner`)
        .toBeLessThanOrEqual(1);
    }
  });

  it("(3) COUNTERWEIGHT: the product near plane is not lowered to buy a green", () => {
    // The cheapest way to satisfy clause (1) is to move the bar rather than the camera. The near
    // plane is the renderer's own value and this contract's only threshold source; pin it here.
    // If a later slice legitimately changes it, this assertion is what forces that to be argued.
    const src = readFileSync(MAIN_TS, "utf8");
    expect(
      src,
      "apps/ui-xr/src/main.ts no longer constructs the scene camera with near = 0.1. Restore it, or "
      + "argue the change on its own card: this contract's only threshold source is that value, and "
      + "widening or deleting this assertion instead of restoring the near plane is the cheap green "
      + "it exists to refuse.",
    )
      .toMatch(/new PerspectiveCamera\([^)]*,\s*1,\s*0\.1,\s*100\)/u);
  });

  it.fails("(4) VACUITY GUARD: the assertions above read a real report, not an empty object", () => {
    // exists: and min-bytes: on the report would both pass a `{}`. Clause (1) returns early on an
    // escape outcome and clause (2) iterates zero frames, so without this the pair goes green about
    // nothing. Once flipped this must hold on every future tree, INCLUDING a report-and-stop run:
    // the escape branch still owes three frames and a full sweep.
    const r = report();
    expect(r.schemaVersion, "report has no schemaVersion").toMatch(/^openclinxr\./u);
    expect(r.measuredAgainstCommit, "report does not name the tree it measured").toMatch(/^[0-9a-f]{7,40}$/u);
    expect(r.frames.length, "report records no frames").toBe(3);
    for (const frame of r.frames) {
      expect(frame.cameraNear, `${frame.framePath}: cameraNear not read off the live camera`)
        .toBeGreaterThan(0);
      expect(frame.attempts.length, `${frame.framePath}: no candidates attempted`).toBeGreaterThan(0);
    }
  });
});
