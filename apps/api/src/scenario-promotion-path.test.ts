import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scenarioBank } from "@openclinxr/scenario-fixtures";
import { measureBankBaseline, PRE_FIX_ARTIFACT_RELATIVE_PATH } from "./scenario-promotion-baseline.js";
import {
  repoRoot,
} from "./scenario-promotion-io.js";
import {
  CONTROL_SCENARIO_ID,
  PROMOTED_SCENARIO_ID,
  REVIEW_GATES,
  inspectScenarioPromotionPath,
  inspectStageZeroStaysBlocking,
} from "./scenario-promotion-path.js";

/**
 * PLANTED CONTRACTS (#166) — LANE B. **Prove the promotion path before spending expert time on it.**
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 *
 * `canStartLearnerExam` needs EVERY one of `STEP2CS_STATION_COUNT = 12` queue slots to be
 * `activation_ready`, and 13 of 14 shipped scenarios sit in one uniform state — `status: draft`,
 * `validationStage: stage_0_synthetic_draft`, all four review gates unapproved. The gate is
 * `isActivationEligible` (`assembly.ts:367-373`): approved status + four approved gates +
 * stage past stage_0 + formative score use + replay-ready dialogue seeds.
 *
 * That is 52 unmade review decisions plus a stage promotion — a HUMAN gate by design, and this
 * slice makes none of those decisions. What is provable by machine is the MACHINE half: if a
 * reviewer approves, does the promotion take? Nothing has ever driven review decisions through the
 * real routes against a real bank fixture while reading persistence back at every hop.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THE EXISTING TESTS DO NOT COVER
 *
 * `exam-assembly.test.ts` and `app.test.ts` exercise approve → queue → `canStartLearnerExam` with
 * SYNTHETIC scenarios. The seams that can still fail on a REAL bank fixture through REAL route
 * handlers (peer round, #166):
 *
 * | seam | how this suite sees it |
 * |---|---|
 * | review apply mutates the wrong field, or does not persist | hop's `persistedReview` read back via `GET /scenarios/:id` (the sink, not the GraphQL override map) stays `draft` |
 * | stage stays `stage_0` after the status flip | final `validationStage` ≠ `stage_1_expert_reviewed` → queue `governance_blocked` |
 * | the selection pool excludes the scenario | scenario never appears in the queue / readiness `activationEligibleScenarioIds` |
 * | `GET /scenarios/:id` returns bank residual only | learner `bodySource` stays `bank_residual`, never `api_authored` |
 * | admin-only write | `SubmitScenarioReview` route is faculty-gated; a 403 throws the drive |
 *
 * Per-hop assertions are the point: a single end-to-end assertion cannot say WHICH of the four
 * silent failure modes fired. Every hop records the persisted review state, so a wrong-field or
 * no-persist failure is located at the hop that caused it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS MUST NOT DO — AND THIS IS THE SHARP EDGE
 *
 * **It must not approve anything clinically and must not weaken the gate.** The approvals here are
 * test review decisions applied to a scoped memory clone (clone-on-first-review) of ONE bank
 * draft; the shipped bank is never mutated. Explicitly rejected, named so nobody reaches for them:
 *
 *  - auto-approving `stage_0_synthetic_draft` anywhere in the fixture or the factory default
 *  - relaxing any condition in `isActivationEligible`
 *  - lowering `STEP2CS_STATION_COUNT`
 *  - marking a scenario `validated_summative`, ever
 *
 * The COUNTERWEIGHT below asserts the gate still refuses partial approval and refuses four
 * approvals while the stage is still `stage_0`. If satisfying a contract required weakening a
 * gate, the right move is to stop and say so.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * ISOLATED — #165's HARNESS, EXTENDED NOT DUPLICATED (§6k)
 *
 * `tools/openclinxr/evidence/authored-exam-reaches-learner.ts` and `promotion-path-reaches-
 * learner.ts` already build the `fetch`-shaped adapter over `createApiApp()` + `app.request` and
 * drive the REAL `resolveLearnerExamScenarios`. This module reuses that exact in-process shape —
 * zero dev servers, zero browsers — from apps/api/src (the contract path). The learner resolver is
 * loaded at runtime because apps/ui-xr source cannot be a static import inside this app's
 * composite tsconfig; the module loaded is the same one the tools/ harnesses call statically.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * MEASURED, TRUST THESE — verify the inferences
 *
 * `.openclinxr/evidence/issue-166/pre-fix.json` records all 15 shipped scenarios (status,
 * validationStage, four review flags, isActivationEligible) measured through the real routes and
 * the real resolver BEFORE this suite's runs. It reads exactly: 1 approved / 14 stage_0,
 * 1 activation-eligible, `canStartLearnerExam: false`, 12 queue slots all `bank_residual`.
 * The last contract re-measures and requires the artifact to still match — a stale before-column
 * would be caught, not trusted.
 *
 * The chosen draft `telehealth_diabetes_health_literacy_v1` is bank index 3 (in the first-12
 * queue mapping), has full dialogue seeds, and is distinct from #167's promoted and control picks.
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS
 * THE OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT.
 *
 * SCOPE: whether a review decision applied through a real route makes a real bank draft reach the
 * learner resolver as an approved, stage_1 authored body — and whether the gate still refuses the
 * partial / stage-stuck states. Says NOTHING about whether any scenario SHOULD be approved; the 52
 * unmade review decisions remain a human judgement this suite makes none of.
 */

describe("a real bank draft is promoted by real review decisions, per hop (#166)", () => {
  it("four SubmitScenarioReview decisions persist per hop, flip the stage, flip eligibility, and reach the learner as api_authored", async () => {
    const run = await inspectScenarioPromotionPath();

    // --- BEFORE: genuinely unpromoted, and not already authored. -------------------------------
    expect(run.beforeAuthored, "the scenario was already an authored document before any decision")
      .toBeNull();
    expect(run.beforeQueueStatus, "chosen scenario was not blocked to begin with")
      .not.toBe("activation_ready");

    // --- PER HOP: the decision persisted to the authored store, not only the override map. ------
    expect(run.hops.length, "expected exactly four review hops").toBe(REVIEW_GATES.length);

    const approvedRoles = new Set<string>();
    for (const [index, hop] of run.hops.entries()) {
      const label = `hop ${index} (${hop.reviewerRole})`;

      // The mutation response reflects the applied decision on the GraphQL view.
      expect(hop.responseReviewStates[hop.reviewerRole], `${label}: mutation response did not apply review.${hop.reviewerRole}`)
        .toBe("approved");

      // The authored store (GET /scenarios/:id) reflects it — this is the persistence proof.
      expect(hop.decisionRecordCount, `${label}: decision record not persisted`).toBe(index + 1);
      expect(hop.persistedStatus, `${label}: no persisted status (clone-on-first-review failed)`).not.toBeNull();
      expect(hop.persistedValidationStage, `${label}: no persisted validationStage`).not.toBeNull();

      approvedRoles.add(hop.reviewerRole);
      for (const role of REVIEW_GATES) {
        const expected = approvedRoles.has(role) ? "approved" : "draft";
        expect(
          hop.persistedReview[role],
          `${label}: persisted review.${role} is "${hop.persistedReview[role]}", expected "${expected}" — ` +
            "the decision did not persist to the authored store (wrong field / no persist seam)",
        ).toBe(expected);
      }

      // COUNTERWEIGHT inside the drive: three of four approvals must leave the scenario INELIGIBLE.
      if (index < REVIEW_GATES.length - 1) {
        expect(
          hop.queueStatus,
          `${label}: queue became ${hop.queueStatus} with only ${index + 1} of 4 approvals — ` +
            "partial approval promoted the scenario (gate broken)",
        ).not.toBe("activation_ready");
      }
    }

    // --- AFTER THE FOURTH: stage flip, eligibility flip, queue ready. ---------------------------
    const last = run.hops[run.hops.length - 1]!;
    expect(last.responseStatus, "fourth decision did not flip the GraphQL status to APPROVED")
      .toBe("APPROVED");
    expect(run.after.status, "promoted status is not approved").toBe("approved");
    expect(run.after.validationStage, "stage did not move off stage_0_synthetic_draft")
      .toBe("stage_1_expert_reviewed");
    expect(run.after.queueStatus, `queue slot still ${run.after.queueStatus} after full promotion`)
      .toBe("activation_ready");
    expect(run.after.blockers, `blockers remained: ${run.after.blockers.join(", ")}`).toHaveLength(0);
    expect(run.afterEligible, "isActivationEligible did not flip true for the promoted scenario")
      .toBe(true);

    // --- LEARNER: the promoted body arrived as api_authored, not a bank residual. ---------------
    expect(run.learner, "the learner resolver did not return the promoted scenario").not.toBeNull();
    expect(run.learner!.scenarioSource, "the learner was not on the api_queue path")
      .toBe("api_queue");
    expect(run.learner!.bodySource, "the learner body is a bank residual, not the promoted authored body")
      .toBe("api_authored");
    expect(run.learner!.status).toBe("approved");
    expect(run.learner!.validationStage).toBe("stage_1_expert_reviewed");
    for (const role of REVIEW_GATES) {
      expect(run.learner!.reviewStates[role], `learner body review.${role} not approved`)
        .toBe("approved");
    }

    // --- TRANSPORT PROOF: real routes were used; nothing was poked in a store. ------------------
    expect(run.requestedPaths).toContain("/admin/graphql");
    expect(run.requestedPaths).toContain("/exam-blueprints/step2cs-seed/station-run-queue");
    expect(run.requestedPaths).toContain(`/scenarios/${encodeURIComponent(PROMOTED_SCENARIO_ID)}`);
    expect(run.devServerBoots, "isolated proof — no dev server").toBe(0);
    expect(run.browserLaunches, "isolated proof — no browser").toBe(0);

    // HONEST SCOPE: one promoted slot does not start the 12-station exam. The 11 other slots are
    // still draft_blocked. This is the human gate doing its job, not a defect of the path.
    expect(run.canStartLearnerExam, "one promoted scenario must NOT make the 12-station exam startable")
      .toBe(false);
  }, 900_000);

  it("counterweight: four approvals with the stage still stage_0 is REFUSED (stage gate is load-bearing)", async () => {
    // The real path always advances the stage with four approvals, so this state cannot be produced
    // through the routes — the planted authored document isolates the GATE itself. It must read
    // governance_blocked, proving the successful promotion's stage flip was required, not optional.
    const stuck = await inspectStageZeroStaysBlocking();

    expect(stuck.scenarioId).toBe(PROMOTED_SCENARIO_ID);
    expect(stuck.queueStatus, `all-four-approved/stage_0 became ${stuck.queueStatus} — the stage condition is not load-bearing`)
      .toBe("governance_blocked");
    expect(stuck.blockers, "the stage_0 blocker is missing from the queue report")
      .toContain("synthetic_draft_validation_stage");
    expect(stuck.inActivationEligibleSet, "all-four-approved/stage_0 entered the activation-eligible set")
      .toBe(false);
  }, 900_000);

  it("counterweight: the shipped bank is unchanged and an unreviewed control draft is still refused", async () => {
    // The shipped bank fixture module must read exactly as measured: 1 approved / 14 stage_0.
    // The in-memory sink never touches it — this asserts no fixture edit smuggled in.
    expect(scenarioBank.filter((s) => s.status === "approved").length).toBe(1);
    expect(scenarioBank.filter((s) => s.governance.validationStage === "stage_0_synthetic_draft").length)
      .toBe(14);

    // An untouched control draft must still be refused by the same gate, and the exam must still
    // be unstartable.
    const baseline = await measureBankBaseline();
    const control = baseline.scenarios.find((s) => s.scenarioId === CONTROL_SCENARIO_ID);
    expect(control, `control scenario ${CONTROL_SCENARIO_ID} missing from baseline`).toBeDefined();
    expect(control!.queueStatus, "control draft became activation_ready without review")
      .not.toBe("activation_ready");
    expect(baseline.canStartLearnerExam, "canStartLearnerExam flipped true on the untouched bank")
      .toBe(false);
  }, 900_000);

  it("the pre-fix artifact exists and still matches the current bank (staleness guard)", async () => {
    // The before-column was measured through the real routes before any edit. Re-measuring now
    // must produce the same 15 rows — a stale or reconstructed artifact would be caught here.
    const artifactPath = join(repoRoot(), PRE_FIX_ARTIFACT_RELATIVE_PATH);
    const raw = await readFile(artifactPath, "utf8");
    const artifact = JSON.parse(raw) as {
      scenarioCount: number;
      shippedBankApprovedCount: number;
      shippedBankStageZeroCount: number;
      activationEligibleCount: number;
      canStartLearnerExam: boolean;
      scenarios: Array<Record<string, unknown>>;
    };

    expect(artifact.scenarioCount).toBe(15);
    expect(artifact.shippedBankApprovedCount).toBe(1);
    expect(artifact.shippedBankStageZeroCount).toBe(14);
    expect(artifact.activationEligibleCount).toBe(1);
    expect(artifact.canStartLearnerExam).toBe(false);

    const now = await measureBankBaseline();
    expect(artifact.scenarios).toEqual(now.scenarios);
  }, 900_000);
});
