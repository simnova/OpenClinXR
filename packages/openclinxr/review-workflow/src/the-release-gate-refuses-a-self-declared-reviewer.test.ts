import { describe, expect, it } from "vitest";

import { planted } from "./planted.js";

// Through the PACKAGE, not a relative path into its src. `@openclinxr/scenario-fixtures` is already a
// workspace dependency here; the relative form reached a file this package's tsconfig does not list
// and failed `pnpm typecheck` with TS6307 while `npx tsc --noEmit` reported clean. I ran the check I
// chose instead of the one the package defines.
import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { evaluateScenarioPublicationReadiness } from "./scenario-publication.js";
import type { EvaluateScenarioPublicationReadinessInput, ReviewerEvidence } from "./scenario-publication.js";

/**
 * **OBSERVABLE: anyone who can write a review record can approve their own scenario in any role.**
 *
 * Card tsk_a5045834c138eceb.
 *
 * ## MEASURED ON HEAD — do not re-derive. This block is IMMUTABLE.
 *
 * `scenario-publication.ts:210-222`, `missingApprovedReviewerRoles`. A required role is satisfied
 * when SOME evidence row carries that role and passes four shape checks:
 *
 *     decision === "approved"
 *     comments.trim().length > 0
 *     evidenceRefs.length > 0 and every ref non-blank
 *     Date.parse(reviewedAt) is not NaN
 *
 * Then `.map((evidence) => evidence.reviewerRole)`. Every one of those is a property of the ROW.
 * `reviewerRole` and `reviewerId` are strings the row's author typed. Nothing binds the row to a
 * person, to a role that person holds, or to the scenario and version being published.
 *
 * MEASURED against the live `ed_chest_pain_priority_v1` at c7761cef, and the numbers shaped this
 * file rather than decorating it:
 *
 *     requiredReviewerRoles : clinician, psychometrician, legal, simulation_qa   (FOUR, not one)
 *     scenario.version      : 1        (a NUMBER — an approval must bind to it, so the port carries it as-is)
 *     four fabricated rows  : reviewer_evidence gate = PASS, canPublishForLearnerUse = true for local_formative
 *
 * The first draft of this file supplied ONE approval and asserted the gate blocked. It did — for the
 * legitimate reason that three required roles were missing, which is not the exploit. Its LIVE clause
 * (6) caught that before the file was committed, which is what that clause is for.
 *
 * TARGET USE IS `local_formative` ON PURPOSE. Under `summative` and `pilot_research` this scenario
 * blocks on `validation_stage` and `score_use` regardless of any reviewer evidence, so a
 * publication-level assertion there would pass whatever this contract does. `local_formative` is the
 * only target where the reviewer gate is load-bearing for the outcome.
 *
 * ## THE TRAP THIS PLANT IS BUILT TO AVOID
 *
 * "Authentication infrastructure is out of scope" is true, and it tempts the fix into ANOTHER
 * self-declared marker — an `attested: true` field, or an allowlist of reviewer ids that the same
 * row author supplies. That is the identical defect one layer along, and it would pass a contract
 * that only asked for a new field to exist.
 *
 * So this plants a VERIFIER PORT, not an authentication system. The gate must consume a trusted
 * verification RESULT and derive approved roles from the principal the verifier returns — never from
 * `evidence.reviewerRole`. Clause (5) is the counterweight that proves the port is actually
 * consulted: swap in a reject-all verifier and publication must block.
 *
 * ## NOT TESTED, deliberately
 *
 * The production identity provider, signature format, token lifetime, and the authentication
 * ceremony that produces an attestation. Those are a real system and none of them belongs in a
 * review-workflow contract. What is tested is that this package TRUSTS a verification result rather
 * than the evidence row, and that the binding is checked.
 *
 * Also NOT tested: whether one identity may hold several required roles. That is governance policy,
 * not attestation correctness, and forbidding it here would freeze a decision nobody has made.
 */

const SCENARIO = edChestPainScenario as unknown as {
  scenarioId: string;
  version: string | number;
  governance: { requiredReviewerRoles: string[] };
};

/** Read from the scenario, never restated: the bank authors four and a list here would go stale. */
const REQUIRED_ROLES = SCENARIO.governance.requiredReviewerRoles;

/**
 * What a verifier is handed. It must be enough to BIND an approval to its subject: an approval that
 * verifies for one scenario must not verify for another, or for a later version of the same one.
 */
type AttestationRequest = {
  scenarioId: string;
  /** Whatever the scenario carries — measured as a number on the live bank. Bound, not reformatted. */
  scenarioVersion: string | number;
  reviewerId: string;
  assertedRole: string;
  decision: "approved" | "changes_requested";
  evidenceId: string;
};

/** What it returns. Roles come from HERE, never from the evidence row. */
type VerifiedPrincipal = { verified: true; principalId: string; roles: readonly string[] } | { verified: false; reason: string };

type ReviewerAttestationVerifier = (request: AttestationRequest) => VerifiedPrincipal;

type EvaluateWithVerifier = (
  input: EvaluateScenarioPublicationReadinessInput & { attestationVerifier?: ReviewerAttestationVerifier },
) => ReturnType<typeof evaluateScenarioPublicationReadiness>;

const REQUIRED_ROLE = REQUIRED_ROLES[0]!;

/** One fabricated approval per required role — the full set the gate asks for. */
function fullyApproved(): ReviewerEvidence[] {
  return REQUIRED_ROLES.map((role) => approval(role));
}

/** A complete, well-formed approval — every shape check on HEAD passes. Only trust is missing. */
function approval(role: string, over: Partial<ReviewerEvidence> = {}): ReviewerEvidence {
  return {
    reviewerRole: role,
    reviewerId: `reviewer_who_typed_their_own_name_${role}`,
    decision: "approved",
    comments: "Reviewed against the rubric; no safety concerns.",
    evidenceRefs: [`review-packet://ed-chest-pain/${role}`],
    reviewedAt: "2026-08-30T00:00:00.000Z",
    ...over,
  };
}

function inputWith(
  evidence: readonly ReviewerEvidence[],
  verifier?: ReviewerAttestationVerifier,
): EvaluateScenarioPublicationReadinessInput & { attestationVerifier?: ReviewerAttestationVerifier } {
  return {
    scenario: edChestPainScenario as never,
    targetUse: "local_formative",
    reviewerEvidence: evidence,
    assetReadiness: {
      scenarioId: SCENARIO.scenarioId,
      devReady: true,
      productionReady: true,
      missingRequiredAssetIds: [],
      blockedAssets: [],
      productionBlockedAssets: [],
    },
    ...(verifier ? { attestationVerifier: verifier } : {}),
  };
}

const evaluate = evaluateScenarioPublicationReadiness as EvaluateWithVerifier;

/** Accepts anything, binding correctly. Used where the clause is about something else. */
const acceptAll: ReviewerAttestationVerifier = (request) => ({
  verified: true,
  principalId: request.reviewerId,
  roles: [request.assertedRole],
});

function reviewerGate(readiness: ReturnType<typeof evaluateScenarioPublicationReadiness>) {
  return readiness.gateResults.find((gate) => gate.gate === "reviewer_evidence");
}

describe("the release gate trusts a verifier, not a self-declared role", () => {
  planted("(1) RED: a self-declared approval with NO verifier still blocks", () => {
    // THE EXPLOIT, stated as the contract. This row passes every shape check on HEAD today.
    const readiness = evaluate(inputWith(fullyApproved()));
    expect(
      reviewerGate(readiness)?.status,
      "a fabricated approval satisfied a required reviewer role — reviewerRole is a string its own author typed",
    ).toBe("block");
    expect(readiness.canPublishForLearnerUse, "publication is permitted on unverified approval").toBe(false);
  });

  it("(2) LIVE COUNTERWEIGHT: the same approval passes when a trusted verifier binds identity to role", () => {
    // NOT A RED, and it took a run to see why. HEAD ignores the extra `attestationVerifier` field and
    // accepts the fabricated rows outright, so this clause is GREEN TODAY FOR THE WRONG REASON — the
    // gate trusts the row, not the verifier. It was written as `it.fails` and passed immediately.
    //
    // It stays, as a counterweight, because clause (1) is otherwise satisfiable by refusing every
    // approval forever. What it discriminates is a naive implementation of (1) that blocks whatever
    // the verifier says; it does not discriminate today's behaviour from tomorrow's, and labelling it
    // RED would have claimed that it did.
    const readiness = evaluate(inputWith(fullyApproved(), acceptAll));
    expect(
      reviewerGate(readiness)?.status,
      "a verified approval did not satisfy its required role — the gate is not consuming the verifier",
    ).not.toBe("block");
    expect(readiness.canPublishForLearnerUse, "a fully verified local_formative release is still blocked").toBe(true);
  });

  planted("(3) RED: roles come from the VERIFIER, never from the evidence row", () => {
    // The row asserts the required role; the verifier says this principal does not hold it. If the
    // gate reads `evidence.reviewerRole` anywhere, this passes and the port is decoration.
    const wrongRole: ReviewerAttestationVerifier = (request) => ({
      verified: true,
      principalId: request.reviewerId,
      roles: ["scenario_author"],
    });
    const readiness = evaluate(inputWith(fullyApproved(), wrongRole));
    expect(
      reviewerGate(readiness)?.status,
      "the claimed role was accepted while the verifier reported a principal who does not hold it",
    ).toBe("block");
  });

  planted("(4) RED: an approval is BOUND to its scenario and version — it cannot be replayed", () => {
    // A verifier that answers without binding lets one genuine approval authorise every scenario in
    // the bank, and every later version of this one. Both halves are asserted through the SAME
    // verifier, so a gate that never passes the subject through fails both.
    const seenRequests: AttestationRequest[] = [];
    const recording: ReviewerAttestationVerifier = (request) => {
      seenRequests.push(request);
      return request.scenarioId === SCENARIO.scenarioId && request.scenarioVersion === SCENARIO.version
        ? { verified: true, principalId: request.reviewerId, roles: [request.assertedRole] }
        : { verified: false, reason: "attestation is bound to a different scenario or version" };
    };

    const readiness = evaluate(inputWith(fullyApproved(), recording));
    expect(seenRequests.length, "the verifier was never called with the approval to check").toBeGreaterThan(0);

    const request = seenRequests[0]!;
    expect(request.scenarioId, "the verifier was not told which scenario it is authorising").toBe(SCENARIO.scenarioId);
    expect(request.scenarioVersion, "the verifier was not told which VERSION — an approval would survive an edit").toBe(SCENARIO.version);
    expect(request.assertedRole, "the verifier was not told the role being claimed").toBe(REQUIRED_ROLE);
    expect(request.decision, "the verifier was not told the decision it is binding").toBe("approved");
    expect(
      typeof request.evidenceId === "string" && request.evidenceId.length > 0,
      "the verifier cannot tell two approvals apart — no evidence identity was passed",
    ).toBe(true);
    expect(reviewerGate(readiness)?.status, "a correctly bound approval was rejected").not.toBe("block");
  });

  planted("(5) RED: a reject-all verifier BLOCKS — proving the port is consulted, not decorative", () => {
    // The counterweight for the whole file. Clauses (2) and (4) pass on a gate that ignores the
    // verifier and trusts the row; this one cannot.
    const rejectAll: ReviewerAttestationVerifier = () => ({ verified: false, reason: "no attestation on file" });
    const readiness = evaluate(inputWith(fullyApproved(), rejectAll));
    expect(
      reviewerGate(readiness)?.status,
      "every attestation was refused and the gate still passed — the verifier is not being consulted",
    ).toBe("block");
    expect(readiness.canPublishForLearnerUse, "publication is permitted while no approval verifies").toBe(false);
  });

  it("(6) LIVE: the exploit is real on HEAD — this is the measurement, not a hypothesis", () => {
    // Passes on arrival and fails independently of the REDs. If a later change makes fabricated
    // approvals blocking for some unrelated reason, this clause turns red and the card's premise
    // needs re-reading rather than the fix being assumed.
    const readiness = evaluateScenarioPublicationReadiness(inputWith(fullyApproved()));
    expect(
      reviewerGate(readiness)?.status,
      "the self-declared approval no longer satisfies the role gate — re-read this card's premise",
    ).not.toBe("block");
  });
});
