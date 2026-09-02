import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: the humanoid motion design commits ~48 slices to baking per-encounter behaviour into a
 * fresh GLB per case, and NOTHING has measured that against the alternative.
 *
 * The alternative is a deterministic runtime-goal backend: ship a content-addressed descriptor plus
 * a rig capability record instead of baked tracks. Rock becomes a pelvis oscillator, clutch becomes a
 * hand-to-live-body-region goal, and pulse presentation becomes a goal relative to the learner's live
 * hand. It removes the per-case packer and survives an actor rebake, which baked tracks do not.
 *
 * MEASURED by the orchestrator on 2026-09-02 at main `9a0657df`, over four adversarial review
 * iterations recorded in docs/openclinxr/humanoid-motion-full-design-2026-09-02.md:
 *
 *   - shared-schemas depends on factory-stations, so factory-stations -> motion-compiler closes a
 *     dependency cycle; the baked path needs a process boundary the runtime-goal path does not.
 *   - Every upstream humanoid correction changes the actor digest and restales the whole descendant
 *     chain actor -> rest -> additives -> gate report -> packed GLB -> runtime binding -> capture.
 *   - CCDIKSolver solves the full target then slerps per joint, so the reach limit that carries the
 *     clinical content lives in the TARGET, which is a runtime quantity either way.
 *
 * IMMUTABLE diagnosis. Flip it.fails -> it and append a `## FIXED` block. Do not rewrite this header.
 *
 * ## LANE C: THIS IS A BAKE-OFF, AND A NEGATIVE RESULT CLOSES IT
 *
 * `runtime_goals_win` closes this card. So does `baked_wins`. So does `inconclusive_blocked` with a
 * stated reason. What does NOT close it is a report that ran one arm, or that ran neither and
 * asserts a preference. The verdict enum leads with its escape values on purpose.
 *
 * claimScope: whether both backends were built far enough to render the same two behaviours on the
 *   same actor, and what the orchestrator saw.
 * notEvidenceFor: that either backend is production ready; clinical validity of any pose; Quest
 *   performance; that the winning backend generalises past one seated MPFB actor.
 *
 * ## FIXED (tsk_37785faf55d16dc6)
 * Four native 1280×1280 stills written by capture.mts (Playwright + harness.html) against
 * mpfb-clinical-nurse-adult.glb at HEAD e14d7a42. report.json verdict=inconclusive_blocked:
 * homemade twoBoneToward / baked eulers, not CCDIKSolver; clutch absent on all four frames;
 * pulse reach only on baked_tracks/pulse_presentation. Digests unique. Diagnosis header above
 * is unchanged.
 */

const REPO = join(import.meta.dirname, "../../..");
const REPORT = join(REPO, "tools/openclinxr/evidence/motion-backend-bakeoff/report.json");

/** Escape values FIRST. A bake-off that clears nothing is a result, not a failure to report. */
const VERDICTS = [
  "inconclusive_blocked",
  "other",
  "runtime_goals_win",
  "baked_wins",
  "indistinguishable",
] as const;

/** The two behaviours the design says decide it: one sustained overlay, one live-target reach. */
const BEHAVIOURS = ["rock_plus_clutch", "pulse_presentation"] as const;
const ARMS = ["baked_tracks", "runtime_goals"] as const;

type Still = { path: string; widthPx: number; heightPx: number; sha256: string };
type ArmRow = { arm: string; behaviour: string; stills: Still[]; notes: string };
type Report = {
  schemaVersion: string;
  measuredAgainstCommit: string;
  actorAssetSha256: string;
  actorId: string;
  arms: ArmRow[];
  verdict: (typeof VERDICTS)[number];
  verdictDetail: string;
};

const report = (): Report => {
  expect(existsSync(REPORT), `${REPORT} missing — the bake-off has not been run`).toBe(true);
  return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
};

describe("the motion backend bake-off has been graded", () => {
  it("(1) both backends rendered both behaviours on the SAME actor", () => {
    const r = report();
    expect(VERDICTS).toContain(r.verdict);
    for (const arm of ARMS) {
      for (const behaviour of BEHAVIOURS) {
        const row = r.arms.find((a) => a.arm === arm && a.behaviour === behaviour);
        expect(row, `no row for ${arm} / ${behaviour}`).toBeDefined();
        if (!row) continue;
        expect(row.stills.length, `${arm}/${behaviour} rendered nothing`).toBeGreaterThan(0);
        for (const still of row.stills) {
          expect(existsSync(join(REPO, still.path)), `missing still ${still.path}`).toBe(true);
          // Native resolution. An upscaled crop invents structure the grader then reports.
          expect(still.widthPx, `${still.path} is not a native-resolution capture`).toBeGreaterThanOrEqual(1024);
          expect(
            createHash("sha256").update(readFileSync(join(REPO, still.path))).digest("hex"),
            `${still.path} does not match its recorded digest`,
          ).toBe(still.sha256);
        }
      }
    }
  });

  it("(2) COUNTERWEIGHT: the two arms are not the same pixels wearing two labels", () => {
    // The cheapest green is to render once, copy the file, and label the copy. Every still across the
    // whole report must be a distinct image, and each arm must carry its own.
    const r = report();
    const digests = r.arms.flatMap((a) => a.stills.map((s) => s.sha256));
    expect(digests.length, "no stills at all").toBeGreaterThan(0);
    expect(new Set(digests).size, "two stills are byte-identical — one render was relabelled").toBe(digests.length);
  });

  it("(3) VACUITY GUARD: the report names the tree and the actor it measured", () => {
    // exists: and min-bytes: both pass a `{}`. Clause (1) iterates zero rows against one, so without
    // this the pair goes green about nothing. Binding the ACTOR digest is what stops the two arms
    // being measured on two different humanoids.
    const r = report();
    expect(r.schemaVersion, "no schemaVersion").toMatch(/^openclinxr\./u);
    expect(r.measuredAgainstCommit, "the report does not name the tree it measured").toMatch(/^[0-9a-f]{7,40}$/u);
    expect(r.actorAssetSha256, "the report does not name the actor bytes both arms used").toMatch(/^[0-9a-f]{64}$/u);
    expect(r.actorId.length, "no actorId").toBeGreaterThan(0);
    expect(r.verdictDetail.trim().length, "a verdict with no stated reason is not a result").toBeGreaterThan(60);
  });
});
