import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#176). The human review gate is not operable, and even when it is operated
 * correctly the decisions do not reach the thing that reads them.
 *
 * NOTHING HERE APPROVES ANY CLINICAL CONTENT, and nothing here may. The 52 review decisions
 * (13 scenarios × clinical / psychometric / legal / simulationQa) are a HUMAN gate by design. These
 * contracts make that gate OPERABLE and make its output REACH the exam assembly pool. Forbidden, and
 * a counterweight below enforces it: auto-approving `stage_0_synthetic_draft`, relaxing
 * `isActivationEligible`, lowering `STEP2CS_STATION_COUNT`, marking anything `validated_summative`,
 * or shipping the bank with more approved scenarios than it has today.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT and is `it.fails` only because the module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * MY FIRST PROPOSAL WAS WRONG AND A PEER ROUND KILLED IT — DISCLOSED SO YOU DO NOT REPEAT IT
 *
 * I proposed wiring `faculty-review-decision-panel.tsx` through to `isActivationEligible`. **That panel
 * is a different product entirely**: it handles a COMPLETED STATION RUN handoff (`stationRunId` +
 * `localDecision: "hold" | "local_promote_candidate"`) for debrief, via
 * `POST /sessions/:stationRunId/review-decision`, and it writes records with the promotion gates
 * forced false. It has no `clinical`/`psychometric`/`legal`/`simulationQa` concept and never touches
 * scenario activation. Do not open there.
 *
 * The scenario-gate path is `App.tsx` Scenario Detail -> `api-client.ts` -> GraphQL
 * `SubmitScenarioReview` -> `api-route-support.ts` -> `applyScenarioReviewDecision` ->
 * `persistAuthoredScenarioReviewPromotion`.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * TWO DEFECTS, BOTH MEASURED IN THE TREE. Do not re-derive these; DO verify them.
 *
 * **Defect 1 — three of the four dimensions have no UI, and the fourth is canned.**
 * `apps/ui-admin/src/App.tsx:890-937` is the entire review surface: one button, "Record clinical
 * approval", with `reviewerRole: "clinical"` and every human field hardcoded —
 * `reviewerId: "admin_clinical_reviewer"`, a fixed `comments` string, a fixed `evidenceRefs` entry.
 * A psychometric, legal, or simulation-QA reviewer cannot record anything at all, and the clinical
 * reviewer cannot say WHY. Fifty-two decisions cannot be made through this.
 *
 * **Defect 2 — a complete set of decisions on a bank fixture reaches nothing.**
 * `apps/api/src/scenario-review-promotion.ts:192-197`:
 *
 *     const base = await findAuthoredScenarioDocument(persistence, scenarioId, version);
 *     if (!base) return;
 *
 * The 13 drafts live in `scenarioBank` as TypeScript fixtures, not in the authored store. So the
 * decision is recorded, the GraphQL listing updates, and the promotion **silently no-ops**.
 * `buildExamAssemblyScenarioPool` reads `scenarioBank ∪ approved authored`, so the pool keeps serving
 * the unchanged draft. **A human could make all 52 decisions correctly and the exam would still not
 * assemble.** That is the load-bearing half of this slice.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT IS ALREADY BUILT — do not rebuild it
 *
 * The route, the resolver, `applyScenarioReviewDecision`, `scenarioStatusForReview`,
 * `persistence.saveScenarioReviewDecision`, the Mongo sinks, and promotion for scenarios that ARE in
 * the authored store all exist and are proven by #39/#41/#42/#167. #167 in particular already drives
 * the real routes on a CLONED bank draft all the way to `activation_ready` and a learner
 * `api_authored` source. Re-planting that is wasted work — the gap is the fixture that was never
 * cloned, and the UI a human would use.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - **How a bank fixture becomes reviewable.** Clone-on-first-review into the authored store, an
 *    explicit "import to authored" action a human takes first, or promotion reading the bank
 *    directly. Each has a different failure mode; pick one and say what you rejected.
 *  - **Whether an unmade decision is `pending` or absent** in whatever the UI renders. It changes
 *    what a reviewer sees on a scenario nobody has touched.
 *  - **What a reviewer must supply before submit.** A rationale is the obvious minimum. Whether
 *    `evidenceRefs` is required is not obvious.
 *
 * LEARNER- AND REVIEWER-FACING COPY IS NOT YOURS. Any string a reviewer reads that makes a clinical
 * assertion must not be invented here. Neutral procedural labels ("Record psychometric decision",
 * "Rationale (required)") are fine; anything that characterises clinical content is not.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * PER-DIMENSION AUTH IS EXPLICITLY OUT OF SCOPE
 *
 * Measured: auth roles are `learner | faculty | admin` only, `SubmitScenarioReview` gates on
 * `hasFacultyAccess`, and any faculty or admin caller can submit any dimension. The client-side
 * `hasClinicalReviewerRole` reads governance metadata and is not auth. **Do not build a role model
 * in this slice** — say in your report that the gap exists and leave it. Four dimensions are data
 * fields, not access control, and making them access control is its own decision.
 *
 * CALIBRATION — `.openclinxr/evidence/issue-176/pre-fix.json` BEFORE any product edit: for every
 * scenario in the bank, its status, its four review states, its `validationStage`, whether it is in
 * the authored store, and whether `isActivationEligible` accepts it. Expected shape of the defect:
 * 1 approved, 13 at `stage_0_synthetic_draft`, 0 in the authored store. **Record the mechanism, not
 * only the counts** — one line per failing row saying WHY, e.g.
 * `promotion_noop_not_in_authored_store`.
 *
 * SIGNATURE IS YOURS. These read `inspectFacultyReviewGate()`. What must not change: the pool and
 * eligibility are read through the SAME functions the exam assembly uses, and the API is exercised
 * in-process via `createApiApp()` + `app.request()` — no dev server, no browser. The smallest thing
 * that proves the machine seam is the in-process API; the React surface is proven by its own tests.
 *
 * REQUIRED, the observable half: a reviewer using the admin app can record a decision in **each of
 * the four dimensions** with their own rationale. If the surface a reviewer touches does not change,
 * the slice is not done — "optional UI" means it will not happen.
 *
 * IN-SCOPE VERDICT — answer EVERY line. Do not replace with a sentence:
 *     four_dimensions_recordable:  yes | no | partial:<which>
 *     rationale_is_free_text:      yes | no
 *     decision_history_visible:    yes | no
 *     fixture_reaches_pool:        yes | no | blocked:<reason>
 *     bank_approved_count_changed: yes | no
 *
 * IF SATISFYING A CONTRACT HERE WILL MAKE THE PRODUCT VISIBLY WORSE, SAY SO — AND THEN SATISFY IT
 * ANYWAY. IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, SAY
 * SO IN YOUR REPORT rather than silently running a corrected version.
 *
 * SCOPE: the human review gate is operable and its output reaches the assembly pool. Says NOTHING
 * about whether any scenario SHOULD be approved, about clinical validity, about exam equivalence, or
 * about per-dimension authorization.
 */

const load = async () => import("./faculty-review-gate.js") as Promise<Record<string, unknown>>;

type ReviewDimension = "clinical" | "psychometric" | "legal" | "simulationQa";

type ScenarioGateRow = {
  scenarioId: string;
  status: string;
  validationStage: string;
  review: Record<ReviewDimension, string>;
  inAuthoredStore: boolean;
  activationEligible: boolean;
  /** One line naming WHY this row is not eligible, or null when it is. */
  ineligibleMechanism: string | null;
};

type Report = {
  /** Every scenario the exam assembly pool would consider, enumerated from what ships. */
  rows: ScenarioGateRow[];
  /** Dimensions a reviewer can actually submit through the admin surface. */
  recordableDimensions: ReviewDimension[];
  /** True when the reviewer supplies the rationale rather than the client hardcoding it. */
  rationaleIsCallerSupplied: boolean;
  /**
   * Result of driving the real routes over a TEST-SCOPED CLONE: four decisions submitted, then the
   * pool re-read. Null when the probe did not run.
   */
  fixturePromotionProbe: {
    clonedScenarioId: string;
    dimensionsSubmitted: ReviewDimension[];
    reachedAuthoredStore: boolean;
    visibleToAssemblyPool: boolean;
    mechanism: string;
  } | null;
  claimScope: string;
  notEvidenceFor: string[];
};

type Inspect = () => Promise<Report>;

const ALL_DIMENSIONS: ReviewDimension[] = ["clinical", "psychometric", "legal", "simulationQa"];
/** Measured on main before planting: 1 approved, 13 at stage_0. Nothing here may raise it. */
const SHIPPED_APPROVED_COUNT = 1;

describe("the human review gate is operable and its output reaches the pool (#176)", () => {
  it("a reviewer can record all four dimensions with their own rationale", async () => {
    // App.tsx:890-937 is one button, reviewerRole "clinical", with reviewerId, comments and
    // evidenceRefs hardcoded. Three dimensions have no surface at all and the fourth cannot say why.
    const mod = await load();
    const inspect = mod["inspectFacultyReviewGate"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    for (const dimension of ALL_DIMENSIONS) {
      expect(
        report.recordableDimensions,
        `a reviewer cannot record a ${dimension} decision — recordable: `
        + `${report.recordableDimensions.join(", ") || "(none)"}`,
      ).toContain(dimension);
    }
    expect(
      report.rationaleIsCallerSupplied,
      "the rationale is hardcoded by the client, so a reviewer cannot say why they decided",
    ).toBe(true);
  }, 600_000);

  it("a fully reviewed bank fixture reaches the exam assembly pool", async () => {
    // scenario-review-promotion.ts:197 `if (!base) return` — a bank fixture is not in the authored
    // store, so four correct decisions record, the listing updates, and the promotion silently
    // no-ops. This is the half that makes 52 human decisions worthless.
    const mod = await load();
    const inspect = mod["inspectFacultyReviewGate"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const probe = report.fixturePromotionProbe;
    expect(probe, "the fixture promotion probe did not run — the seam is untested").toBeTruthy();
    expect(probe!.dimensionsSubmitted.length, "fewer than four dimensions were submitted in the probe")
      .toBe(ALL_DIMENSIONS.length);
    expect(
      probe!.reachedAuthoredStore,
      `the reviewed fixture never reached the authored store: ${probe!.mechanism}`,
    ).toBe(true);
    expect(
      probe!.visibleToAssemblyPool,
      `the reviewed fixture is not visible to the assembly pool: ${probe!.mechanism}`,
    ).toBe(true);

    // Every row carries its mechanism, not just a boolean — a count says what is wrong, a mechanism
    // says why, and the next person should not have to rediscover the hop.
    for (const row of report.rows) {
      if (row.activationEligible) continue;
      expect(
        row.ineligibleMechanism,
        `${row.scenarioId} is ineligible with no mechanism recorded`,
      ).toBeTruthy();
    }
  }, 600_000);

  it("nothing was approved and no gate was relaxed (COUNTERWEIGHT)", async () => {
    // The cheap way to make an exam assemble is to approve things. That is a HUMAN decision and this
    // slice may not make it. The probe above operates on a TEST-SCOPED CLONE; the shipped bank must
    // come out exactly as it went in.
    const mod = await load();
    const inspect = mod["inspectFacultyReviewGate"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.rows.length, "fewer scenarios enumerated than the bank ships")
      .toBeGreaterThanOrEqual(14);

    const approved = report.rows.filter((r) => r.status === "approved");
    expect(
      approved.length,
      `${approved.length} scenarios are approved in the shipped bank, was ${SHIPPED_APPROVED_COUNT} `
      + `— this slice builds the gate, it does not walk through it`,
    ).toBe(SHIPPED_APPROVED_COUNT);

    // stage_0 must still be disqualifying, and nothing may be labelled summative.
    for (const row of report.rows) {
      if (row.validationStage === "stage_0_synthetic_draft") {
        expect(
          row.activationEligible,
          `${row.scenarioId} is at stage_0_synthetic_draft and activation-eligible — the gate was relaxed`,
        ).toBe(false);
      }
    }

    // The probe's clone must not be one of the shipped ids masquerading as a clone.
    if (report.fixturePromotionProbe) {
      expect(
        report.rows.some((r) => r.scenarioId === report.fixturePromotionProbe!.clonedScenarioId),
        `the probe promoted ${report.fixturePromotionProbe.clonedScenarioId}, which is a SHIPPED `
        + `scenario id — the probe must operate on a test-scoped clone`,
      ).toBe(false);
    }

    expect(report.notEvidenceFor.join(" ").toLowerCase()).toContain("clinical");
  }, 600_000);
});
