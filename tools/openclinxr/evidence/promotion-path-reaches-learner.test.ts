import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#167) — LANE B. **Prove the promotion path before spending expert time on it.**
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT — the safety gate must NOT be weakened, and offline
 * boot must be untouched. It is `it.fails` only because the module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 *
 * Thirteen of fourteen shipped scenarios sit in one uniform state — `status: draft`,
 * `validationStage: stage_0_synthetic_draft`, and `clinical`/`psychometric`/`legal`/`simulationQa`
 * all unapproved. `isActivationEligible` (`assembly.ts:367-373`) therefore rejects them, and
 * `canStartLearnerExam` needs **every** one of `STEP2CS_STATION_COUNT = 12` slots ready.
 *
 * That is **52 unmade review decisions plus a stage promotion**, and it is a **human gate by design**
 * — a peer round found no tree evidence of an intended auto-promoter. I cannot make those decisions.
 *
 * **But nothing has ever driven a review decision through the real routes against a real bank
 * fixture.** If a clinician approves thirteen scenarios and the promotion does not take, that is
 * wasted expert time. This slice proves the machine works so the human's time lands.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THE EXISTING TESTS DO NOT COVER
 *
 * `exam-assembly.test.ts` and `app.test.ts` already exercise approve → queue → `canStartLearnerExam`
 * — with **synthetic scenarios**. What can still break on a **real bank fixture through real route
 * handlers**, per a peer round:
 *
 * | seam | failure |
 * |---|---|
 * | review apply mutates the wrong field, or does not persist | still `draft` after "approve" |
 * | stage stays `stage_0` after the status flip | `governance_blocked`, not ready |
 * | the selection pool excludes the scenario | never appears in the queue at all |
 * | `GET /scenarios/:id` returns bank residual only | no `api_authored` body |
 * | admin-only write | the promotion cannot be driven from where it needs to be |
 *
 * **Do not re-test `isActivationEligible` in isolation.** It has unit coverage. The value here is the
 * chain from a real route to a learner-visible body.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS MUST NOT DO — AND THIS IS THE SHARP EDGE
 *
 * **It must not approve anything clinically, and it must not weaken the gate.** Explicitly rejected,
 * named here so nobody reaches for them:
 *
 *  - auto-approving `stage_0_synthetic_draft` anywhere in the fixture or the factory default
 *  - relaxing any condition in `isActivationEligible`
 *  - lowering `STEP2CS_STATION_COUNT`
 *  - marking a scenario `validated_summative`, ever
 *
 * The promotion in this test is a **test fixture applying test review decisions to a CLONE**, and the
 * counterweight asserts the shipped bank is unchanged and the gate still refuses an unreviewed
 * scenario. If satisfying a contract here required weakening a gate, the right move is to stop and
 * say so.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * ISOLATED — #165's HARNESS, EXTENDED NOT DUPLICATED (§6k)
 *
 * `tools/openclinxr/evidence/authored-exam-reaches-learner.ts` landed yesterday and already builds a
 * `fetch`-shaped adapter over `createApiApp()` + `app.request`, then drives the REAL
 * `resolveLearnerExamScenarios`. **Zero dev servers, zero browsers.** Extend it.
 *
 * If your run boots Vite or launches a browser you have built the wrong thing. Contract (2) asserts
 * both are zero.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * MEASURED, TRUST THESE — verify the inferences
 *
 * All 14 shipped scenarios, read from the bank:
 *
 * | | `ed_chest_pain_priority_v1` | the other 13 |
 * |---|---|---|
 * | `status` | `approved` | `draft` |
 * | `validationStage` | `stage_1_expert_reviewed` | `stage_0_synthetic_draft` |
 * | `review` | all approved | all four unapproved |
 * | `scoreUseLabel` | `formative_local_only` | `formative_local_only` — **not a blocker** |
 *
 * And **`hasReplayReadyDialogueSeeds` is NOT a blocker** — a peer round measured all 13 drafts as
 * already satisfying the seed predicate. Approvals and stage are the entire gate. If you find
 * otherwise, say so; that would change the finding.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - **Which draft scenario to promote.** Any of the thirteen. Say which and why.
 *  - **Whether to clone or mutate in a scoped store.** The shipped bank must be unchanged afterwards
 *    — contract (3) asserts it — but how you achieve that is yours.
 *  - **Whether the stage promotion is a separate route or implied by the reviews.** I do not know, and
 *    finding out is part of the answer. If the stage never moves and there is no route to move it,
 *    **that is the finding** — report it and do not invent one.
 *  - **What distinguishing field proves the learner got the promoted body** rather than a bank
 *    residual. #165 solved the same problem; reuse its approach if it fits.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands a promoted scenario become `activation_ready` and reach the learner as `api_authored`,
 * and is satisfiable by seeding an already-approved scenario and calling it a promotion. (2) forbids
 * that by requiring the run to start from a scenario that was `draft`/`stage_0` and to have crossed
 * real review routes. (3) is green today and forbids buying either by weakening the gate or mutating
 * the shipped bank.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectPromotionPathReachesLearner()`. What must
 * not change: real route handlers, the real `resolveLearnerExamScenarios`, and a starting state that
 * is genuinely unpromoted.
 *
 * CALIBRATION — `.openclinxr/evidence/issue-167/pre-fix.json` BEFORE any product edit: for the
 * chosen scenario, its `status`, `validationStage`, all four review states, its queue status, and its
 * `bodySource` from the resolver. Every one should read the unpromoted value. **If any already reads
 * promoted, stop** — the fixture is not what I measured and I want to know.
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS THE
 * OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT.
 *
 * SCOPE: whether a review decision applied through a real route makes a scenario reachable by a
 * learner. Says NOTHING about whether any scenario SHOULD be approved — that is a clinical,
 * psychometric and legal judgement and this test makes none of it.
 */

const load = async () => import("./promotion-path-reaches-learner.js") as Promise<Record<string, unknown>>;

type ScenarioGateState = {
  scenarioId: string;
  status: string;
  validationStage: string;
  /** All four review gates, by reviewer role. */
  reviewStates: Record<string, string>;
  /** "activation_ready" | "draft_blocked" | "governance_blocked". */
  queueStatus: string;
  /** Blockers the queue reports for this scenario. */
  blockers: string[];
};

type PromotionRun = {
  /** The chosen scenario BEFORE any review decision was applied. */
  before: ScenarioGateState;
  /** The same scenario AFTER the review decisions crossed real routes. */
  after: ScenarioGateState;
  /** Routes actually requested. Proves real handlers, not a direct store poke. */
  requestedPaths: string[];
  /** What the learner resolver returned for the promoted scenario. */
  learnerBodySource: string | null;
  /** A value present only in the promoted body — a bank residual cannot carry it. */
  learnerDistinguishingValue: string | null;
  /** Must be zero — isolated proof, not a browser end-to-end. */
  devServerBoots: number;
  browserLaunches: number;
  /** Gate integrity: an untouched draft must still be refused. */
  control: { scenarioId: string; queueStatus: string };
  /** The shipped bank as it stands after the run. */
  shippedBankApprovedCount: number;
  shippedBankStageZeroCount: number;
};

type Inspect = () => Promise<PromotionRun>;

describe("a review decision through a real route reaches the learner (#167)", () => {
  it.fails("a promoted scenario becomes activation_ready and arrives as api_authored", async () => {
    // Nothing has ever driven review decisions through the real routes against a real bank fixture.
    // exam-assembly.test.ts and app.test.ts do it with synthetic scenarios.
    const mod = await load();
    const inspect = mod["inspectPromotionPathReachesLearner"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const run = await inspect!();
    expect(run.after.queueStatus, `after promotion the queue still says ${run.after.queueStatus}; blockers: ${run.after.blockers.join(", ")}`)
      .toBe("activation_ready");
    expect(run.after.blockers, `blockers remained: ${run.after.blockers.join(", ")}`).toHaveLength(0);
    expect(run.learnerBodySource, "the learner did not receive the promoted body from the API")
      .toBe("api_authored");
    expect(
      run.learnerDistinguishingValue,
      "the learner body carries nothing the fixture bank could not have produced — this may be a bank residual",
    ).toBeTruthy();
  }, 900_000);

  it.fails("it started genuinely unpromoted and crossed real review routes", async () => {
    // Kills the cheap satisfaction of the first contract: seeding an already-approved scenario and
    // calling it a promotion. The BEFORE state has to be the unpromoted one I measured.
    const mod = await load();
    const inspect = mod["inspectPromotionPathReachesLearner"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const run = await inspect!();
    expect(run.before.status, `chosen scenario started as "${run.before.status}", not a draft`).not.toBe("approved");
    expect(run.before.validationStage, "chosen scenario did not start at stage_0_synthetic_draft")
      .toBe("stage_0_synthetic_draft");
    expect(run.before.queueStatus, "chosen scenario was not blocked to begin with").not.toBe("activation_ready");

    const unapprovedBefore = Object.values(run.before.reviewStates).filter((v) => v !== "approved");
    expect(unapprovedBefore.length, "chosen scenario already had every review approved").toBeGreaterThan(0);

    expect(run.requestedPaths.length, "no route was requested — reviews were applied by poking a store")
      .toBeGreaterThan(1);
    expect(run.devServerBoots, "isolated proof — no dev server").toBe(0);
    expect(run.browserLaunches, "isolated proof — no browser").toBe(0);
  }, 900_000);

  it.fails("the gate is not weakened and the shipped bank is unchanged (COUNTERWEIGHT)", async () => {
    // The cheapest satisfaction is relaxing isActivationEligible, auto-approving stage_0, or editing
    // the shipped fixtures. All three are forbidden: they would silently convert a safety gate into
    // a formality, and 52 review decisions are a HUMAN judgement this test makes none of.
    const mod = await load();
    const inspect = mod["inspectPromotionPathReachesLearner"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const run = await inspect!();

    // An untouched draft must still be refused by the same gate.
    expect(
      run.control.queueStatus,
      `control scenario ${run.control.scenarioId} became ${run.control.queueStatus} without review`,
    ).not.toBe("activation_ready");

    // The shipped bank must still read exactly as measured: 1 approved, 13 at stage_0.
    expect(run.shippedBankApprovedCount, "the shipped bank's approved count changed").toBe(1);
    expect(run.shippedBankStageZeroCount, "the shipped bank's stage_0 count changed").toBe(13);
  }, 900_000);
});
