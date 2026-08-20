import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #473. The reframe verdict is a single scalar for a multi-frame capture.
 *
 * ## THE DEFECT, MEASURED — IMMUTABLE. Flip assertions and append `## FIXED (#N)`.
 *
 * `reframe-subject-in-frame.json` carries ONE `subjectInFrame` and ONE `headNdc` for a run that
 * emits EIGHT frames. Graded natively, **6 of 8 hold the subject**; frames 00 and 07 show walls.
 * So `subjectInFrame: true` is simultaneously accurate and unable to describe the sequence, and
 * `the-capture-aims-at-the-mouth` passes 18/18 while two frames are unusable.
 *
 * §6e: two instruments agreeing is not correctness, and here ONE instrument is blind to the
 * variation. §11s: I bounded a value where the defect lives in the distribution. Only the pixels
 * caught it, which does not scale to the 12-of-15 viseme legibility work that reads this sequence.
 *
 * ## NARROWED 2026-08-20 — this is SMALLER than the issue as filed
 *
 * I filed this as "build per-frame records". Measured before speccing: **per-frame linkage ALREADY
 * EXISTS** in the same artifact —
 *
 *   frameLinkage: { viseme_I: {framePath: …frame_00.png, linkage: "nearest-timestamp"},
 *                   viseme_sil: {framePath: …frame_01.png, linkage: "dominant-match"}, … }
 *
 * with `linkageApproximation` documenting the rule. What is missing is not the machinery; it is that
 * the **reframe verdict** never got the same treatment. **Extend the existing linkage, do not build a
 * second one** — clause (4) refuses replacing it.
 *
 * ## KNOWN-GOOD COLUMN (§9h)
 *
 * `frameLinkage` itself: same artifact, same writer, already keyed per frame with a documented
 * approximation rule. The mechanism is proven; only the reframe fields are missing from it.
 *
 * ## WHY CLAUSE (3) IS NOT A FITTED ASSERTION
 *
 * The obvious cheap fix is to stamp the one scalar into N identical rows, which satisfies "has rows"
 * and "row count matches". Requiring the values to VARY would be fitted to today's 6-of-8 and would
 * wrongly fail a capture where every frame holds the subject. So clause (3) requires each row to name
 * a **distinct framePath** matching the frames actually captured — a property of being per-frame,
 * not of the outcome.
 *
 * ## WHICH ARE REDS AND WHICH ARE NETS (#227)
 *
 * (1)(2)(3) read the not-yet-extended artifact: **REDS**, planted `it.fails`.
 * (4)(5) read the tree and pass today: **TRUE NETS**.
 *
 * NOT TESTED:
 *   - Whether frames 00 and 07 SHOULD hold the subject. Start/end framing may be expected; this
 *     contract makes the fact recordable, it does not rule on it.
 *   - Legibility of any viseme — the orchestrator's pixel grade, per the artifact's own
 *     `notEvidenceFor`.
 *   - Other captures using the same reframe helper, which that artifact already lists as unaudited.
 *   - Quest, clinical validity, exam equivalence.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SUMMARY = join(HERE, "reframe-subject-in-frame.json");
const CAPTURE = join(HERE, "ui-xr-viseme-drive-capture.ts");

type PerFrame = { framePath?: string; subjectInFrame?: boolean; headNdc?: { x: number; y: number } };
type Summary = {
  reframe?: Record<string, unknown>;
  frameLinkage?: Record<string, { framePath?: string }>;
  reframePerFrame?: PerFrame[];
};

function summary(): Summary {
  if (!existsSync(SUMMARY)) throw new Error(`${SUMMARY} does not exist`);
  return JSON.parse(readFileSync(SUMMARY, "utf8")) as Summary;
}

/**
 * An EMPTY enumeration must FAIL, never pass vacuously (§7t). The first draft used
 * `summary().reframePerFrame ?? []` inside clauses (2) and (3); with the field absent they iterated
 * an empty array and PASSED, so two planted `it.fails` reported as failures on a clean tree. Caught
 * by the plant run before dispatch.
 */
function rowsOrThrow(): PerFrame[] {
  const rows = summary().reframePerFrame;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("reframePerFrame is absent or empty — the verdict is still one scalar for the whole run");
  }
  return rows;
}

describe("the reframe verdict is recorded per frame", () => {
  it.fails("(1) RED: a per-frame reframe array exists", () => {
    const rows = summary().reframePerFrame;
    expect(Array.isArray(rows), "reframePerFrame must be an array — today the verdict is one scalar for the whole run").toBe(true);
    expect((rows ?? []).length, "at least one row").toBeGreaterThan(0);
  });

  it.fails("(2) RED: every row carries its OWN verdict, not an inherited one", () => {
    for (const r of rowsOrThrow()) {
      expect(typeof r.subjectInFrame, `row ${r.framePath}: subjectInFrame must be present per row`).toBe("boolean");
      expect(Number.isFinite(r.headNdc?.x) && Number.isFinite(r.headNdc?.y),
        `row ${r.framePath}: headNdc must be measured per row`).toBe(true);
    }
  });

  it.fails("(3) RED+COUNTERWEIGHT: rows are per-frame, not one scalar stamped N times", () => {
    // Refuses the cheap fix WITHOUT being fitted to today's 6-of-8: distinct framePaths are a
    // property of being per-frame; requiring the VALUES to differ would wrongly fail a capture in
    // which every frame legitimately holds the subject.
    const rows = rowsOrThrow();
    const paths = rows.map((r) => r.framePath ?? "");
    expect(paths.every((p) => p.length > 0), "every row must name the frame it describes").toBe(true);
    expect(new Set(paths).size, `${paths.length} rows resolved to ${new Set(paths).size} distinct frames`).toBe(paths.length);
  });

  it("(4) NET: the existing frameLinkage is extended, not replaced", () => {
    // Refuses building a second linkage mechanism beside the proven one. frameLinkage already keys
    // viseme instants to frames with a documented approximation rule; this slice adds the reframe
    // verdict to that world, it does not start over.
    const s = summary();
    expect(s.frameLinkage && typeof s.frameLinkage === "object", "frameLinkage must survive").toBe(true);
    expect(Object.keys(s.frameLinkage ?? {}).length, "and must still link viseme instants to frames").toBeGreaterThan(0);
    expect(Object.values(s.frameLinkage ?? {}).every((v) => typeof v.framePath === "string"),
      "each linkage entry keeps its framePath").toBe(true);
  });

  it("(5) VACUITY GUARD: the capture really does emit multiple frames", () => {
    // Reads the tree. If the capture ever emitted a single frame, clauses (1)-(3) would be about
    // nothing and this says so rather than passing quietly.
    const src = readFileSync(CAPTURE, "utf8");
    expect(/viseme_frame_\$\{/.test(src) || src.includes("viseme_frame_"),
      "the capture must still write numbered frames").toBe(true);
    expect(src.includes("REFRAME_SUMMARY_PATH"), "and must still write the tracked reframe summary (#396 land path)").toBe(true);
  });
});
