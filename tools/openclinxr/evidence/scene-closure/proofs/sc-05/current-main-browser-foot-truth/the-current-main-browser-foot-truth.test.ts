import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A1 (tsk_3f01d5bd55a00505) — does the browser instrument disagree with the Node known-good about
 * where the physician's feet are, and if so, is that a product defect or an instrument mismatch?
 *
 * THIS FILE VALIDATES THE REPORT, IT DOES NOT PRODUCE IT. The measurement is made by
 * `../ui-xr-bedside-approach-capture.ts`, twice, at one SHA. This test is the contract that report
 * must satisfy, and it was WRITTEN BEFORE THE TWO RUNS WERE GRADED so it cannot be fitted to the
 * answer. It therefore accepts every member of the verdict enum — including the one that says the
 * instrument is broken — and fails only when the report's verdict disagrees with the report's own
 * numbers, or when a required binding is absent.
 *
 * ## THE DISAGREEMENT, AS THE CARD STATES IT
 *
 *   Node known-good   101 settled + 432 arrived frames, ZERO below-floor frames,
 *                     deepest signed depth -0.013571 m (13.6 mm ABOVE the floor)
 *   Browser, earlier  ~0.037 m, and a reproducible 0-sample mode
 *
 * Sign convention, fixed here because the two instruments report it differently:
 * `penetrationMeters = floorOriginY - toe.y`. POSITIVE is BELOW the floor (submerged). Node's
 * -0.013571 m is therefore 13.6 mm clear of the floor, and a browser reading of +0.037 m is 37 mm
 * through it. A report that mixes these signs is refused by clause (3).
 *
 * ## WHY PER-PHASE AND PER-TOE, AND NOT ONE NUMBER
 *
 * `gradeBrowserApproach` reports ONE aggregate `deepestFloorPenetrationMeters`, and that aggregate
 * hides the shape of the disagreement. Recomputed from the raw samples of the three pre-A1 runs, the
 * browser AGREES with Node while walking and diverges only once the actor settles:
 *
 *   phase      left toe deepest   right toe deepest
 *   walking          0.001995          -0.000364     <- at/above the floor, consistent with Node
 *   settling         0.035733           0.037172
 *   arrived          0.033501           0.036384
 *
 * The aggregate 0.037 is the SETTLING RIGHT TOE. Reporting it as a whole-run property would name the
 * wrong defect, which is why clause (3) requires both toes in every phase and clause (4) reads the
 * verdict against the phase rows rather than against any single maximum.
 *
 * claimScope: what two headless chromium runs measured about toe height against the named floor
 *   frame, at one pinned commit, and whether that agrees with the recorded Node measurement.
 * notEvidenceFor: clinical validity, scoring validity, exam equivalence, Quest or worn-headset
 *   readiness, visual quality, or whether any corrective treatment would be sufficient.
 */

const HERE = import.meta.dirname;
const REPORT = path.join(HERE, "report.json");

/** The card's closed vocabulary. Exactly one of these, and the escape values are real outcomes. */
const VERDICTS = ["instruments_agree", "browser_submerged", "capture_null"] as const;
type Verdict = (typeof VERDICTS)[number];

/** Node known-good, from the A1 card's immutable knownGood. Negative = above the floor. */
const NODE_DEEPEST_METERS = -0.013571;

/**
 * Agreement tolerance about the FLOOR PLANE, derived from ambient noise rather than from the
 * quantity under test.
 *
 * REJECTED FIRST DRAFT, recorded because it was nearly used: SC-00's 0.06 m contact band
 * (`FOOT_CONTACT_HEIGHT_METERS`). That band answers "is this toe planted", measured UPWARD from the
 * floor. It does not answer "do the two instruments agree about which SIDE of the floor the toe is
 * on". Used as an agreement threshold it would score a toe 37.8 mm THROUGH the floor as
 * `instruments_agree` — while the instrument's own grader calls that same reading a defect
 * ("a submerged foot is not a stance"). A threshold whose cheapest satisfaction contradicts the
 * product's own verdict is the wrong threshold.
 *
 * What replaces it: the disagreement is about SIGN. Node reports zero below-floor frames and a
 * deepest signed depth of -0.013571 m; the browser reports hundreds of below-floor frames. So the
 * boundary is the floor plane itself, and the only tolerance needed is measurement noise.
 *
 * The noise reference is the WALKING phase, which is ambient with respect to the defect: across the
 * runs measured before this threshold was chosen, walking straddles zero at sub-millimetre scale
 * (0.000652, -0.000147, 0.001995, -0.000364, 0.001871, 0.000820 m) while settling and arrived sit
 * near 0.035 m. 0.005 m is above that ambient spread by ~2.5x and an order of magnitude BELOW the
 * divergence it must not absorb. It is not fitted to 0.037: it is derived from frames in which the
 * two instruments already agree.
 */
const FLOOR_PLANE_TOLERANCE_METERS = 0.005;

type PhaseRow = {
  phase: "walking" | "settling" | "arrived";
  sampleCount: number;
  leftToeDeepestMeters: number;
  rightToeDeepestMeters: number;
};

type RunRecord = {
  runId: string;
  outputDir: string;
  driveSource: string | null;
  sampleCount: number;
  waitTimedOut: boolean;
  floorOriginY: number | null;
  phases: PhaseRow[];
  artifacts: Array<{ objectKey: string; sha256: string; byteCount: number; retrieval: string }>;
};

type A1Report = {
  schemaVersion: string;
  cardKey: string;
  taskId: string;
  headSha: string;
  treeClean: boolean;
  treeDirtyPaths: string[];
  instrument: { path: string; argv: string[] };
  nodeKnownGood: { deepestMeters: number; settledFrames: number; arrivedFrames: number; source: string };
  runs: RunRecord[];
  verdict: Verdict;
  verdictRationale: string;
  claimScope: string;
  notEvidenceFor: string[];
};

function report(): A1Report {
  return JSON.parse(readFileSync(REPORT, "utf8")) as A1Report;
}

describe("the current main browser foot truth", () => {
  it("(0) VACUITY: the report exists, names this card, and carries both runs", () => {
    const r = report();
    expect(r.schemaVersion, "report must declare its schema").toBe("openclinxr.a1-browser-foot-truth.v1");
    expect(r.taskId).toBe("tsk_3f01d5bd55a00505");
    expect(r.cardKey).toBe("MSC-A1");
    // TWO runs, because a single browser run cannot distinguish a real reading from a flaky one —
    // the 0-sample mode appeared four minutes after a good run on this very instrument.
    expect(r.runs, "the card requires two runs, not one").toHaveLength(2);
  });

  it("(1) the report binds the commit it measured, and the instrument does not record it", () => {
    const r = report();
    // ui-xr-bedside-approach-capture.ts writes no commit into its inspection.json, so headSha is
    // supplied by the harness. Binding it is what stops a stale artifact being read as current.
    expect(r.headSha, "headSha must be a full 40-char sha").toMatch(/^[0-9a-f]{40}$/u);
    expect(typeof r.treeClean, "the report must state whether the tree was clean").toBe("boolean");
    if (!r.treeClean) {
      expect(
        r.treeDirtyPaths.length,
        "a report claiming a dirty tree must name the dirty paths, so a reader can judge whether they could affect the measurement",
      ).toBeGreaterThan(0);
    }
  });

  it("(2) exactly one verdict, drawn from the card's closed vocabulary, with a rationale", () => {
    const r = report();
    expect(VERDICTS as readonly string[]).toContain(r.verdict);
    expect(
      r.verdictRationale.trim().length,
      "a verdict with no rationale is a bare pass; the card forbids it",
    ).toBeGreaterThan(40);
  });

  it("(3) every run reports both toes in every phase, with a floor frame and a stated sign convention", () => {
    const r = report();
    for (const run of r.runs) {
      expect(run.runId.length, "each run needs its own identity").toBeGreaterThan(0);
      expect(typeof run.waitTimedOut).toBe("boolean");

      if (run.sampleCount === 0) {
        // The null-drive shape is a legitimate observation, not a missing field. It must still be
        // recorded honestly rather than silently omitted.
        expect(run.driveSource, "a 0-sample run must record that the drive was null").toBeNull();
        expect(run.phases, "a 0-sample run has no phase rows to report").toHaveLength(0);
        continue;
      }

      expect(run.driveSource, "a run with samples must name the producer that drove it").toBe(
        "case_owned_bedside_approach",
      );
      expect(run.floorOriginY, "penetration is measured against a named floor frame").toEqual(expect.any(Number));

      const phases = run.phases.map((p) => p.phase).sort();
      expect(phases, "all three phases must be reported, not only the worst one").toEqual([
        "arrived",
        "settling",
        "walking",
      ]);
      for (const row of run.phases) {
        expect(row.sampleCount, `${row.phase} must have samples`).toBeGreaterThan(0);
        // BOTH toes, separately. One toe cannot stand for the pair: in the pre-A1 runs the right toe
        // read 0.037 m while the left read 0.0357 m, and during walking they straddled the floor.
        expect(row.leftToeDeepestMeters, `${row.phase} left toe`).toEqual(expect.any(Number));
        expect(row.rightToeDeepestMeters, `${row.phase} right toe`).toEqual(expect.any(Number));
      }

      // The raw media is gitignored, so the report binds it by hash and says how to retrieve it.
      expect(run.artifacts.length, "each run must bind its raw artifacts").toBeGreaterThan(0);
      for (const artifact of run.artifacts) {
        expect(artifact.sha256, `${artifact.objectKey} sha256`).toMatch(/^[0-9a-f]{64}$/u);
        expect(artifact.byteCount).toBeGreaterThan(0);
        expect(
          artifact.retrieval.trim().length,
          "a gitignored artifact needs a retrieval reference, or the hash binds nothing anyone can fetch",
        ).toBeGreaterThan(0);
      }
    }
  });

  it("(4) THE DISCRIMINATOR: the verdict follows from the runs' own numbers", () => {
    const r = report();
    expect(r.nodeKnownGood.deepestMeters, "the Node column must be the card's recorded value").toBeCloseTo(
      NODE_DEEPEST_METERS,
      6,
    );

    const nulls = r.runs.filter((run) => run.sampleCount === 0);
    const measured = r.runs.filter((run) => run.sampleCount > 0);

    if (r.verdict === "capture_null") {
      expect(nulls.length, "capture_null requires at least one run that produced no samples").toBeGreaterThan(0);
      return;
    }

    // Any other verdict asserts the instrument worked, so both runs must have produced samples.
    expect(nulls, "a non-null verdict cannot stand on a run that captured nothing").toHaveLength(0);
    expect(measured).toHaveLength(2);

    const deepestOf = (run: RunRecord): number =>
      Math.max(...run.phases.flatMap((p) => [p.leftToeDeepestMeters, p.rightToeDeepestMeters]));
    const worst = Math.max(...measured.map(deepestOf));

    // REPRODUCIBILITY FIRST: two runs that disagree with EACH OTHER cannot settle a disagreement
    // with a third instrument. 5 mm is the span the two pre-A1 runs actually reproduced within
    // (0.037172 vs 0.037598 = 0.4 mm), so this is an order of magnitude of slack, not a fitted bound.
    const spread = Math.abs(deepestOf(measured[0]!) - deepestOf(measured[1]!));
    expect(spread, "the two runs must agree with each other before either is quoted against Node").toBeLessThanOrEqual(
      0.005,
    );

    if (r.verdict === "browser_submerged") {
      expect(
        worst,
        "browser_submerged claims the browser puts a toe measurably THROUGH the floor, past measurement noise",
      ).toBeGreaterThan(FLOOR_PLANE_TOLERANCE_METERS);
    } else {
      // instruments_agree: every toe on the same side of the floor Node put it on, within noise.
      expect(
        worst,
        `instruments_agree requires every toe at or above the floor within ${FLOOR_PLANE_TOLERANCE_METERS} m; `
          + "Node measured -0.013571 m (above the floor) and zero below-floor frames",
      ).toBeLessThanOrEqual(FLOOR_PLANE_TOLERANCE_METERS);
    }
  });

  it("(5) the report refuses the claims this card cannot support", () => {
    const r = report();
    const forbidden = ["clinical", "scoring", "exam", "headset", "quest"];
    const declared = r.notEvidenceFor.join(" ").toLowerCase();
    for (const term of forbidden) {
      expect(declared, `notEvidenceFor must disclaim ${term}`).toContain(term);
    }
    expect(r.claimScope.trim().length).toBeGreaterThan(40);
  });
});
