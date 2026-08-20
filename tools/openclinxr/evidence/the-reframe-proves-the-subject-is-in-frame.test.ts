import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #465 — the face-reframe reports `status: "ok"` 88 times and frames a wall.
 *
 * ## MEASURED on #464's fresh capture (generatedAt 2026-08-20T03:07, parent speaking)
 *
 *     reframe.status              "ok"
 *     reframe.reappliedCount      88
 *     reframe.reappliedFailures   []
 *     reframe.targetWorldPosition { x: -1.346, y: 0.0822, z: 0.421 }
 *     framingDescription          "...headY=1.20 fov=28 camLocal=-1.31,1.24,1.76"
 *
 * **`targetWorldPosition.y` is 0.082 — the mesh ORIGIN at floor level.** `headY = 1.20` is computed
 * and then not used as the aim point. The camera sits at y=1.24 and looks at the floor, so the
 * frames contain a grey wall and a blue slab. I graded `viseme_frame_00` and `viseme_frame_04` at
 * native resolution: **no head, no face, no humanoid in either.** Frame 00 is the parent mid-
 * sentence — *"Tara Johnson: Please tell me exactly what I can do to help her."*
 *
 * This is the SS6e class: `status: "ok"` answers *did the reframe run*, never *did it frame the
 * subject*. Eighty-eight successful re-applications and zero failures, pointing at the floor.
 *
 * ## THE SECOND DEFECT — frames are not attributable to visemes
 *
 *     strongVisemeTargets[].framePath  ->  None, None, None
 *
 * The three strong instants (`viseme_sil` t=0.286, `viseme_aa` t=7.37, `viseme_TH` t=9.603) carry
 * no frame. Frames are periodic and unlinked, so even a correctly-aimed capture could not say which
 * frame shows which viseme.
 *
 * ## WHAT THIS DOES NOT UNDO
 *
 * #464's CLAIM stands and is not weakened here. It asserted **which targets are driven and at what
 * weight**, read from `morphTargetInfluences` on the live mesh — not from frames. Its own
 * NOT EVIDENCE FOR already said nobody had graded a frame of the parent mid-sentence. This slice is
 * why that could not be done, and it blocks D12 for anything face-related until fixed.
 *
 * ## WHICH ARE REDS AND WHICH ARE NETS (#227)
 *
 *   (1) RED — the artifact must record whether the SUBJECT'S HEAD is inside the frame, measured,
 *             not whether the reframe ran.
 *   (2) RED — that measurement must say the head IS in frame.
 *   (3) RED — every strong viseme instant must carry a `framePath`.
 *   (4) NET — the capture SOURCE still emits the reframe failure surface #368 built. Reads the
 *             tree, so it genuinely passes today and refuses a "fix" that deletes those fields.
 *   (5) RED — head height and aim point recorded as distinct numbers. Reads the artifact, so it
 *             fails today like (1)-(3).
 *
 * Clean tree: **4 failing / 1 passing.** Only (4) reads the tree; every other clause reads the
 * deliverable and is therefore red until it exists.
 *
 * FIFTH TIME I have mis-declared this. The pattern, stated so I stop repeating it: **when the
 * deliverable is a single artifact, every clause that reads it is red on a clean tree — only a
 * clause reading the TREE can be a true net.** I rewrote (4) to read the capture source for
 * exactly that reason, rather than shipping a contract with no counterweight that can pass.
 *
 * ## THE CHEAPEST FIXES THIS REFUSES
 *
 *   a) set `subjectInFrame: true` by hand                -> (1) needs a projected coordinate, not a
 *      boolean assertion of the thing being asserted
 *   b) aim at `headY` and keep reporting `status: ok`    -> (2) still needs the MEASUREMENT; a
 *      corrected aim with no in-frame check is the same instrument one bug later
 *   c) delete `status`/`reappliedCount` and call it fixed-> (4) fails
 *   d) link frames by nearest timestamp without capturing at the instant -> allowed, but say so in
 *      the artifact; (3) asks for a path, and a stated approximation is honest where a silent one
 *      is not
 *
 * NOT TESTED:
 *   - Whether the lip motion is LEGIBLE once the head is in frame. That is the grade this unblocks,
 *     and it is mine to make afterwards — not this contract's business.
 *   - Other captures using the same reframe helper. Unaudited; if the helper is shared, say which
 *     callers you touched.
 *   - #464's morph measurement, which did not depend on frames and is unaffected.
 *   - Quest, frame budget, on-device rendering.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SUMMARY = join(HERE, "reframe-subject-in-frame.json");
const CAPTURE = join(HERE, "ui-xr-viseme-drive-capture.ts");

type Reframe = {
  status: string;
  targetMeshName: string;
  reappliedCount: number;
  /** NEW: where the head projected to, in normalised device coords. */
  headNdc?: { x: number; y: number };
  /** NEW: the measured verdict, derived from headNdc — not asserted by hand. */
  subjectInFrame?: boolean;
  headWorldY?: number;
  aimWorldY?: number;
};
type Summary = { capturedFrom: string; reframe: Reframe; visemeInstants: { targetName: string; framePath: string | null }[] };

const summary: Summary | null = existsSync(SUMMARY)
  ? (JSON.parse(readFileSync(SUMMARY, "utf8")) as Summary)
  : null;

function requireSummary(): Summary {
  expect(
    summary,
    `tools/openclinxr/evidence/reframe-subject-in-frame.json must exist — a TRACKED summary from a `
      + `live capture. The capture's own inspection.json is gitignored (#396).`,
  ).not.toBeNull();
  return summary as Summary;
}

describe("the reframe proves the subject is in frame", () => {
  it("(1) RED: the artifact records where the head projected to, not just that the reframe ran", () => {
    // Refuses (a). A boolean with no coordinate behind it is the assertion, not the measurement.
    const r = requireSummary().reframe;
    expect(r.headNdc, `record the head's normalised device coords — status:"ok" fired 88 times over a wall`)
      .toBeDefined();
    expect(typeof r.headNdc?.x, "headNdc.x is a number").toBe("number");
    expect(typeof r.headNdc?.y, "headNdc.y is a number").toBe("number");
  });

  it("(2) RED: the head is actually inside the frame", () => {
    // Refuses (b). Fixing the aim without measuring leaves the same instrument one bug later.
    const r = requireSummary().reframe;
    const { x = 99, y = 99 } = r.headNdc ?? {};
    expect(Math.abs(x), `head is off-frame horizontally at ndc.x=${x}`).toBeLessThanOrEqual(1);
    expect(Math.abs(y), `head is off-frame vertically at ndc.y=${y}`).toBeLessThanOrEqual(1);
    expect(r.subjectInFrame, "the derived verdict must agree with the coordinates").toBe(true);
  });

  it("(3) RED: every strong viseme instant carries a frame", () => {
    const s = requireSummary();
    expect(s.visemeInstants.length, "the capture found strong viseme instants").toBeGreaterThan(0);
    const unlinked = s.visemeInstants.filter((v) => !v.framePath);
    expect(
      unlinked.map((v) => v.targetName),
      `#464's capture recorded framePath: None for all three instants, so no frame is attributable `
        + `to a viseme`,
    ).toEqual([]);
  });

  it("(4) COUNTERWEIGHT: the capture still emits the reframe failure surface", () => {
    // Refuses (c). #368 built status/targetMeshName/reappliedCount so a broken reframe is locatable.
    // This slice ADDS a measurement; it does not replace the failure codes. Reads the TREE, not the
    // deliverable, so it is a counterweight that can actually hold on a clean checkout.
    const src = readFileSync(CAPTURE, "utf8");
    for (const field of ["status", "targetMeshName", "reappliedCount", "reappliedFailures"]) {
      expect(src, `the capture must keep emitting reframe.${field} (#368's failure surface)`).toContain(field);
    }
  });

  it("(5) VACUITY GUARD: head height and aim point are distinct quantities on this capture", () => {
    const r = requireSummary().reframe;
    expect(r.headWorldY, "record the head world Y the reframe computed").toBeDefined();
    expect(r.aimWorldY, "record the Y it actually aimed at").toBeDefined();
    expect(
      typeof r.headWorldY === "number" && typeof r.aimWorldY === "number",
      "both are numbers so the gap is measurable rather than narrated",
    ).toBe(true);
    expect(existsSync(CAPTURE), "the instrument under repair is still in the tree").toBe(true);
  });
});
