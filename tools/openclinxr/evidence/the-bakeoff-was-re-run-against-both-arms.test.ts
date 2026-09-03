import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: the bake-off's verdict was measured against a tree that had no runtime-goal arm, and
 * the arm has since landed. The recorded answer describes a comparison that could not happen.
 *
 * The design's headline says roughly 48 slices wait on this verdict, and the entrypoint's step 1 is
 * "run the bake-off". It ran once, on 2026-09-02, and closed `inconclusive_blocked` because only one
 * of the two backends existed.
 *
 * MEASURED 2026-09-03 on origin/main:
 *
 *   report.json          measuredAgainstCommit e14d7a42, verdict inconclusive_blocked
 *                        verdictDetail: "clutch is absent on all four frames (no hand on torso)"
 *                        and the close comment: "designed backends did not execute"
 *   four stills          all committed at 1c63c4d7 (09-02), the blocked run
 *   harness.html         committed at 62cdabd3 (09-03) — CCDIKSolver import at line 29,
 *                        7 references, a per-frame applier at line 175
 *   runtime-goal-eval.json  62cdabd3, 269,676 bytes: pelvis oscillates 0.060 m over 12 frames,
 *                        targetA/B 0.120 m apart, wristR follows by 0.120 m, solverBlend 1 throughout
 *
 * So the runtime-goal arm now demonstrably drives the chain, and the stills that produced the verdict
 * predate it. A re-run is not a refresh; it is the first time the comparison has been possible.
 *
 * ## WHAT THIS FILE DOES NOT DO
 *
 * It does not assert which arm wins, and it must not. A negative or blocked result closes the
 * bake-off — that was true of the first run and stays true. What it refuses is a verdict carried over
 * from a tree where one backend did not execute.
 *
 * The PIXELS are the orchestrator's to grade, at native resolution, from the fresh stills. This file
 * only proves fresh stills exist and were taken against both arms; it makes no claim about what they
 * show. The first run's own close records why that split matters: a schema-valid report proved
 * nothing about whether the backends ran.
 *
 * IMMUTABLE diagnosis. Flip `it.fails` -> `it` and append a `## FIXED (#N)` block. Do not rewrite the
 * measured tables or the recorded digests.
 *
 * claimScope: whether the recorded bake-off verdict was measured against a tree containing both arms,
 *   with four distinct fresh stills.
 * notEvidenceFor: which backend is better; what any still SHOWS; pose quality, clinical plausibility
 *   or Quest budget; anything about apps/ui-xr.
 */

const ROOT = join(import.meta.dirname, "../../..");
const DIR = join(ROOT, "tools/openclinxr/evidence/motion-backend-bakeoff");
const REPORT = join(DIR, "report.json");
const HARNESS = join(DIR, "harness.html");

/** The four still digests recorded by the BLOCKED run at 1c63c4d7. A re-run must not reproduce them. */
const _BLOCKED_RUN_STILLS = [
  "a32a9572fcbbbdc6", // baked_tracks  rock_plus_clutch
  "bac8b7602ba2f420", // baked_tracks  pulse_presentation
  "25face790e6fca49", // runtime_goals rock_plus_clutch
  "fb41a56cc141fe57", // runtime_goals pulse_presentation
] as const;

type Still = { path: string; sha256: string };
type Arm = { arm: string; behaviour: string; stills: Still[] };
const report = (): Record<string, unknown> => JSON.parse(readFileSync(REPORT, "utf8")) as Record<string, unknown>;
const arms = (): Arm[] => (report()["arms"] ?? []) as Arm[];
const stills = (): Still[] => arms().flatMap((a) => a.stills ?? []);

describe("the bake-off was re-run against both arms", () => {
  it("(0) VACUITY GUARD: the report, the harness and four stills are all present", () => {
    // Without this, the clauses below pass identically against a deleted or truncated report.
    expect(existsSync(REPORT), `${REPORT} is missing — there is no verdict to check`).toBe(true);
    expect(existsSync(HARNESS), "harness.html is missing — neither arm can have been captured").toBe(true);
    expect(stills().length, "the report records fewer than four stills").toBeGreaterThanOrEqual(4);
    for (const s of stills()) {
      expect(existsSync(join(ROOT, s.path)), `${s.path} is recorded in the report but absent from disk`).toBe(true);
    }
  });

  it("(1) STANDING GUARD (was a RED; see header): the four stills are four distinct images", () => {
    /**
     * ## CORRECTED 2026-09-03 — the original clause was UNSATISFIABLE and that was my error
     *
     * It read: "the stills are fresh, not the four the blocked run produced", and asserted that none
     * of BLOCKED_RUN_STILLS appears among the recorded digests. MEASURED against the re-run at
     * 6c6211db, which is a correct and complete capture:
     *
     *   all four stills written        Sep 3 02:48, the same second — ALL FOUR were recaptured
     *   runtime_goals__rock_plus_clutch   25face79 -> 7ac2f33b   271306 -> 240773 bytes
     *   baked_tracks__rock_plus_clutch    a32a9572 unchanged
     *   baked_tracks__pulse_presentation  bac8b760 unchanged
     *   runtime_goals__pulse_presentation fb41a56c unchanged
     *
     * Three reproduced BYTE-IDENTICALLY because those scenes are deterministic and did not change.
     * Only the still the new CCDIK arm affects differs. Digest inequality therefore demanded that the
     * SCENES change, which this card's own out-of-scope forbids — the clause asked for something the
     * card prohibited.
     *
     * This is the quantity-versus-shape trap in `contract-design`, in my own contract: I bounded
     * digest inequality when the property I wanted was PROVENANCE, that this run produced these
     * stills. Provenance is clause (2)'s job and it does it properly, by requiring `harnessSha256` to
     * equal the digest of the harness on disk.
     *
     * What survives here is the counterweight the first bake-off card needed: copying one still and
     * relabelling it. Four stills, four distinct digests. _BLOCKED_RUN_STILLS is kept above as the
     * measured record of what the blocked run produced; it is deliberately no longer asserted on.
     *
     * DOWNGRADED FROM `it.fails` TO `it`, AND THAT DOWNGRADE IS THE HONEST PART. The four digests on
     * main are already distinct, so as a RED this clause was vacuous the moment the tautology came
     * out of it. A counterweight is not a RED; keeping it marked `it.fails` would have made the
     * card's `live:` count assert a defect that does not exist. Clause (2) is this card's RED.
     *
     * DO NOT DELETE THIS CLAUSE. It is the standing refusal of copy-one-still-and-relabel, which the
     * first bake-off card had to reject in practice. Widening it (allowing 3 distinct of 4) or
     * removing it reinstates that evasion.
     */
    expect(new Set(stills().map((s) => s.sha256)).size, "the stills are not four distinct images").toBe(stills().length);
    expect(stills().length, "fewer than four stills recorded").toBeGreaterThanOrEqual(4);
  });

  it.fails("(2) RED: the verdict is not the blocked one, or no longer blames a backend that now runs", () => {
    // A NEGATIVE RESULT STILL CLOSES THE BAKE-OFF. inconclusive_blocked stays legal — what is refused
    // is blaming non-execution of a backend that has since landed and is measured to drive the chain.
    const r = report();
    const verdict = String(r["verdict"] ?? "");
    const detail = String(r["verdictDetail"] ?? "").toLowerCase();
    if (verdict === "inconclusive_blocked") {
      expect(detail, "the verdict still blames backends that did not execute; harness.html now imports CCDIKSolver")
        .not.toMatch(/did not execute|designed backends/u);
    }
    // And the report must have been measured against a harness that actually carries the second arm.
    const harnessSha = createHash("sha256").update(readFileSync(HARNESS)).digest("hex");
    expect(String(r["harnessSha256"] ?? ""), "the report does not record which harness it captured against")
      .toBe(harnessSha);
  });
});
