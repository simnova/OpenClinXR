import { describe, expect, it } from "vitest";

import {
  evaluateScenarioPublicationReadiness,
  type ReviewerAttestationVerifier,
} from "../../review-workflow/src/scenario-publication.js";
import { edChestPainScenario } from "../../scenario-fixtures/src/ed-chest-pain.js";
// M5 (tsk_fe21a528321bd6bb): the semantic admission gate is a LANDED module by the time
// these clauses run, so it is imported statically (knip traces static imports; the dynamic
// imports above stay dynamic because the original RED clauses predate the modules they name).
import { validateLLMScenarioMotionProgram } from "./program/llm-scenario-motion-planner.js";

/**
 * IMMUTABLE DIAGNOSIS HEADER — do not rewrite. Flip `it.fails` -> `it` and append a `## FIXED (#N)`
 * block BELOW this comment. Do not edit the measured tables or the paths above them.
 *
 * WHY THE REFUSAL CLAUSES ARE THE VALUABLE ONES HERE, AND A HAPPY PATH IS NOT.
 *
 * `packages/openclinxr/motion-compiler/src/motion-program.ts` DOES NOT EXIST on this tree, and
 * nothing named `MotionProgram` existed anywhere in the repo when this was planted — measured
 * 2026-08-29:
 *
 *     grep -rln --include='*.ts' -e 'MotionProgram' . | grep -v node_modules   ->  0 files
 *
 * So this card authors a NEW trust boundary, and the whole value of a boundary is what it REFUSES.
 * A clause showing a well-formed program validating would be satisfied by
 * `validateMotionProgram = () => ({ ok: true, errors: [] })` — which is exactly the implementation
 * the boundary exists to forbid. The three refusal clauses are the contract. An accept path appears
 * ONLY inside clause (3), as the counterweight that defeats the cheapest wrong pass
 * (`() => ({ ok: false, errors: ["no"] })` would otherwise green (1), (2) and (3) at once).
 *
 * THE BOUNDARY, STATED ONCE. An LLM planner may emit `MotionProgram` objects — declarative,
 * case-bounded intent. It is NEVER authoritative for raw skeleton output. A VLM critic downstream
 * produces ADVISORY findings, and advisory findings cannot clear a deterministic or human release
 * gate. Three ways that boundary is breached, one clause each:
 *
 *   (1) the planner smuggles raw bone tracks through a program field  -> it IS the animator
 *   (2) the planner targets a region the case never authored          -> it INVENTS the encounter
 *   (3) the planner marks its own output as reviewed                  -> it IS its own reviewer
 *
 * API IS NOT INVENTED HERE — IT IS INHERITED, AND THAT WAS A CORRECTION.
 * This plant was first written against a guessed `validateMotionProgram(program, caseFacts)` in a
 * new `./validate-motion-program.js`, returning `{ ok, refusals, claimBoundary }`. A sibling card's
 * plant, already on disk in this same package
 * (`the-planner-emits-a-validated-motion-program.test.ts:158-181`), had ALREADY fixed a different
 * and more specific contract for the same symbol. Shipping both would have made the card
 * unimplementable: two modules exporting one name with incompatible signatures. The sibling's shape
 * wins because it is more specific and was planted first. Inherited verbatim from it:
 *
 *     module            ./motion-program.js       (NOT ./validate-motion-program.js)
 *     validate          validateMotionProgram(program) => { ok: boolean; errors: string[] }
 *     provenance        { sourceKind: string; sourceRefs: string[] }
 *     action target     { kind: "body_region" | "actor" | "clinical_object" | "world_position";
 *                         id?: string; position?: {x,y,z} }
 *     region vocabulary ./motion-body-region.js -> MOTION_BODY_REGIONS,
 *                       motionBodyRegionForComplianceRegion(complianceRegion)
 *
 * THE TWO-VOCABULARY RULE MATTERS TO CLAUSE (2). The sibling asserts that motion regions and the
 * case's clinical-compliance regions are DISJOINT vocabularies — `chest_L` and `abdomen_rlq` are
 * compliance regions and must not leak into `MOTION_BODY_REGIONS`. So "a region the case authored"
 * is not a touch-map string; it is `motionBodyRegionForComplianceRegion(<touch-map string>)`.
 * Clause (2) derives the case's authored motion regions through that mapper rather than restating
 * any region literal, so it cannot drift from the fixture.
 *
 * REFUSAL MESSAGE STRINGS ARE THE IMPLEMENTER'S CHOICE. The clauses assert `ok === false` and that
 * `errors` names the offending token (the bone, the region, the sourceKind). They deliberately do
 * NOT pin an error code, because a string invented in a planted fixture becomes the specification
 * by accident.
 *
 * CLOSED ENUM, from the card:
 *     provenance.sourceKind: authored_case | deterministic_case_compiler | llm_proposal | reviewed_llm_proposal
 *
 * WHY `it.fails` AND NOT A STATIC IMPORT. The module under test is absent, so a top-level
 * `import ... from "./motion-program.js"` fails at COLLECTION and the whole file errors —
 * indistinguishable from a syntax error, and it would take the live clause (4) down with it. Each
 * RED clause therefore does a DYNAMIC import inside its own body, so the rejection is the module's
 * absence and nothing else. VERIFIED on this tree by flipping all three to `it()`: each fails with
 * `Error: Cannot find module '.../motion-program.js'`, and clause (4) still passed.
 *
 * WHY EACH RED PROGRAM IS OTHERWISE VALID. `plannerProgram()` builds one legitimate case-bounded
 * `llm_proposal`, and each clause breaks EXACTLY ONE thing. A refusal therefore cannot be
 * attributed to a confound.
 *
 * MEASURED — clause (4) is live and passes on THIS tree, against shipped product code
 * (`review-workflow/src/scenario-publication.ts`), with `ed_chest_pain_priority_v1`
 * (`governance.requiredReviewerRoles = ["clinician","psychometrician","legal","simulation_qa"]`):
 *
 *   | reviewerEvidence supplied          | reviewer_evidence | other 6 gates | canPublish |
 *   |------------------------------------|-------------------|---------------|------------|
 *   | one approved `vlm_critic` finding  | block             | all pass      | false      |
 *   | four approved human required roles | pass              | all pass      | true       |
 *
 * Both rows measured, not assumed. Row 1 is the counterweight: `reviewer_evidence` is the ONLY
 * blocking gate, so `canPublishForLearnerUse === false` is caused by the critic's advisory status
 * and by nothing else. Row 2 is the known-good column, and it is what stops clause (4) being the
 * vacuous claim "publication always blocks".
 *
 * CLAUSE (4) IS INDEPENDENTLY BREAKABLE, which is its job. It touches no motion-compiler code.
 * VERIFIED by destructive probe: making `missingApprovedReviewerRoles` accept any approved evidence
 * regardless of role (`scenario-publication.ts:210-222`) turned this run into
 * `1 failed | 3 expected fail` — clause (4) red, clauses (1)-(3) untouched. Reverted; file restored
 * and hash-checked identical. Nothing an implementer does to `motion-program.ts` can move it.
 *
 * claimScope: that a motion program carrying raw skeleton tracks, or naming a body region the case
 *   never authored, or self-declaring review, is REFUSED; and that an advisory critic finding does
 *   not clear the human publication gate.
 * notEvidenceFor: that any motion program produces good-looking motion; that the planner's output is
 *   clinically valid; that the critic's findings are correct; the runtime that consumes a validated
 *   program; or how a genuine human review is captured.
 *   claimBoundary: motion_plan_not_animation_or_clinical_validity_evidence
 * ## ONE IR, ONE DIALECT — amended 2026-08-30 after two independent reviews
 *
 * This plant originally used schemaVersion "motion-program.v1" and primitiveId "guard_withdraw",
 * while the sibling planner plant (the-planner-emits-a-validated-motion-program.test.ts:268,290)
 * requires "openclinxr.motion-program.v1" and "guard_body_region".
 *
 * ONE `validateMotionProgram` COULD HAVE SATISFIED BOTH BY ACCEPTING TWO DIALECTS. That is a cheap
 * pass spanning two plants: neither test can see the other's vocabulary, so neither counterweight
 * catches it, and the implementation that clears both is the wrong one. Found by a Grok orchestrator
 * reading the committed REDs, independently confirmed by a Codex reviewer against the tree; I had
 * reviewed the card graph three times and never compared the plants to each other.
 *
 * A worker implements the RED, not the card prose. Cards that agree while their plants disagree
 * describe an architecture nobody is building.
 *
 */

/**
 * ## FIXED (tsk_bca4085904e3b071) — clauses (1), (2) and (3) are now live `it` tests.
 *
 * The M1 closed-IR validator in src/motion-program.ts landed the boundary these
 * clauses exist to enforce, so they are no longer RED:
 *
 *   (1) `validateMotionProgram` refuses unknown action fields, and a program
 *       carrying raw per-bone `boneTracks` is refused with the field named. The
 *       closed IR does not carry raw skeleton output, so the planner-as-animator
 *       smuggling shape is closed by construction.
 *   (2) `validateMotionProgram` refuses any `body_region` target whose id is
 *       not a DECLARED MotionBodyRegion, naming the invented region. The
 *       UNAUTHORED_REGION half passes for its recorded reason. The ACTOR half
 *       passes CONFINED, and this is recorded rather than hidden: the default
 *       `plannerProgram()` carries `target.id = "PLACEHOLDER"` (an undeclared
 *       region), so the foreign-actor program is refused for the placeholder
 *       target, not for its actorId — the validator has no case context to
 *       refuse a never-cast actor. Closing the actor half needs the validator
 *       to know the case's cast, which is the M5 card's own residual.
 *   (3) `provenance.sourceKind = "reviewed_llm_proposal"` is refused (no
 *       sanctioned review step exists to mint it) while an honestly-labelled
 *       `llm_proposal` with the same actions is ACCEPTED — the anti-blanket-
 *       refusal counterweight holds.
 *
 * Measured 2026-08-30 on this tree: all three clauses pass as live tests.
 */

const CLAIM_BOUNDARY = "motion_plan_not_animation_or_clinical_validity_evidence";

const MODULE_UNDER_TEST = "./motion-program.js";
const REGION_MODULE = "./motion-body-region.js";

/** The case's authored clinical-compliance regions, DERIVED rather than restated. */
const AUTHORED_COMPLIANCE_REGIONS: string[] = (edChestPainScenario.actors ?? []).flatMap(
  (actor) => (actor.bodyMechanics?.touchResponses ?? []).map((touch) => touch.region),
);

/** The case's authored actors, likewise derived. */
const AUTHORED_ACTOR_IDS: string[] = (edChestPainScenario.actors ?? []).map((actor) => actor.actorId);

/**
 * A region the vocabulary does not declare and no authored compliance region maps to. Asserted in (2).
 *
 * DERIVED, NOT PINNED (product-owner review, 2026-08-29). The first draft pinned "left_ankle" and
 * guarded the clause with `expect(MOTION_BODY_REGIONS).not.toContain("left_ankle")`. That guard is
 * correct about vacuity and wrong about brittleness: the sibling contract in this package
 * (the-planner-emits-a-validated-motion-program.test.ts:340-345) REQUIRES MOTION_BODY_REGIONS to
 * carry motion-only members the touch vocabulary lacks, and an ankle is an obvious one the moment
 * gait lands. Pinning it would red this clause on a legitimate vocabulary extension, for a reason
 * unrelated to the defect under test.
 *
 * So pick the first candidate the live vocabulary does not declare. The clause still fails honestly
 * if EVERY candidate is declared, which is the vacuity case worth failing on.
 */
const UNAUTHORED_REGION_CANDIDATES = [
  "left_ankle",
  "right_ankle",
  "left_wrist_dorsum",
  "posterior_calf_L",
  "region_the_case_never_authored_v1",
] as const;

function pickUnauthoredRegion(declared: readonly string[], authored: ReadonlySet<string>): string {
  const found = UNAUTHORED_REGION_CANDIDATES.find(
    (candidate) => !declared.includes(candidate) && !authored.has(candidate),
  );
  if (found === undefined) {
    throw new Error(
      `clause (2) has no undeclared region left to test with: every candidate in ` +
        `${UNAUTHORED_REGION_CANDIDATES.join(", ")} is present in MOTION_BODY_REGIONS or is an ` +
        `authored region. Add a candidate rather than weakening the clause.`,
    );
  }
  return found;
}

type MotionValidation = { ok: boolean; errors: string[] };

/**
 * Resolve a plant's module specifier to an ABSOLUTE url before the deferred import.
 *
 * Added 2026-08-30. A bare `./x.js` in a path VARIABLE under `@vite-ignore` is resolved natively, and
 * when the module is absent the native resolver reports the MANGLED path — `/src/motion-program.js`,
 * `/scenario-fixtures/src/...` — which reads as a broken test rather than as the missing module the
 * RED is demanding. One instance of this had M1's clauses (1) and (2) failing on a fixture path bug
 * instead of on the absent planner, since d1ad5063, invisibly, because `it.fails` hides the reason.
 */
function plantModule(specifier: string): string {
  return new URL(specifier, import.meta.url).href;
}

async function loadValidator(): Promise<(program: unknown) => MotionValidation> {
  const mod = (await import(/* @vite-ignore */ plantModule(MODULE_UNDER_TEST))) as Record<string, unknown>;
  return mod['validateMotionProgram'] as (program: unknown) => MotionValidation;
}

async function loadRegionVocabulary(): Promise<{
  MOTION_BODY_REGIONS: readonly string[];
  motionBodyRegionForComplianceRegion: (region: string) => string;
}> {
  const mod = (await import(/* @vite-ignore */ plantModule(REGION_MODULE))) as Record<string, unknown>;
  return {
    MOTION_BODY_REGIONS: mod['MOTION_BODY_REGIONS'] as readonly string[],
    motionBodyRegionForComplianceRegion: mod['motionBodyRegionForComplianceRegion'] as (r: string) => string,
  };
}

/**
 * One legitimate, case-bounded `llm_proposal`. Each RED clause breaks exactly one thing about it,
 * so a refusal is attributable to that one thing.
 */
function plannerProgram(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: "openclinxr.motion-program.v1",
    scenarioId: edChestPainScenario.scenarioId,
    actorId: "patient_robert_hayes_v1",
    provenance: { sourceKind: "llm_proposal", sourceRefs: [edChestPainScenario.scenarioId] },
    baseline: { posture: "seated_upright", affect: "anxious", breathing: "laboured" },
    actions: [
      {
        actionId: "guard_chest_v1",
        primitiveId: "guard_body_region",
        trigger: { kind: "clinical_touch", ref: "clinical_touch_guard_chest_l" },
        timing: { durationMs: 900 },
        intensity: 0.6,
        // Placeholder — clause (2) replaces this with a mapped, case-authored motion region.
        target: { kind: "body_region", id: "PLACEHOLDER" },
        effector: "handR",
        constraints: [],
      },
    ],
    deterministicSeed: 1,
    claimBoundary: CLAIM_BOUNDARY,
    notEvidenceFor: ["clinical_validity", "animation_quality"],
    ...overrides,
  };
}

describe("the llm planner cannot emit bone tracks", () => {
  // (1) PRIMARY RED. A planner output carrying per-bone quaternion keyframes is the planner acting
  //     as the animator. Everything else here is valid — honest `llm_proposal` provenance, a
  //     case-authored region resolved through the mapper — so the raw track is the only thing left
  //     to refuse.
  it("(1) RED: refuses a planner output carrying raw per-bone quaternion tracks", async () => {
    const [validateMotionProgram, { motionBodyRegionForComplianceRegion }] = await Promise.all([
      loadValidator(),
      loadRegionVocabulary(),
    ]);
    const authoredMotionRegion = motionBodyRegionForComplianceRegion(AUTHORED_COMPLIANCE_REGIONS[0]!);

    const result = validateMotionProgram(
      plannerProgram({
        actions: [
          {
            actionId: "guard_chest_v1",
            primitiveId: "guard_body_region",
            trigger: { kind: "clinical_touch", ref: "clinical_touch_guard_chest_l" },
            timing: { durationMs: 900 },
            intensity: 0.6,
            target: { kind: "body_region", id: authoredMotionRegion },
            effector: "handR",
            constraints: [],
            // THE DEFECT: a raw skeleton track smuggled through a program field.
            boneTracks: [
              {
                bone: "upper_arm.L",
                keyframes: [
                  { tMs: 0, quat: [0, 0, 0, 1] },
                  { tMs: 400, quat: [0.13, 0, 0, 0.99] },
                ],
              },
            ],
          },
        ],
      }),
    );

    expect(result.ok, "a program carrying raw bone tracks is not a motion PLAN").toBe(false);
    expect(
      result.errors.join(" | "),
      "the refusal must name the offending track, not merely say 'invalid'",
    ).toMatch(/boneTracks|upper_arm\.L|track/i);
  });

  // (2) RED. LLM planning is bounded by authored facts: it may not invent a region, an actor, or a
  //     behaviour the encounter definition does not carry. This program carries NO bone tracks, so
  //     clause (1)'s mechanism cannot be what refuses it.
  it("(2) RED: refuses a target naming a body region the case never authored", async () => {
    const [validateMotionProgram, { MOTION_BODY_REGIONS, motionBodyRegionForComplianceRegion }] =
      await Promise.all([loadValidator(), loadRegionVocabulary()]);

    // Guards against this clause going vacuous if the vocabulary or the fixture ever changes.
    expect(AUTHORED_COMPLIANCE_REGIONS.length, "the case must author some touch map").toBeGreaterThan(0);

    const authoredMotionRegions = new Set(
      AUTHORED_COMPLIANCE_REGIONS.map(motionBodyRegionForComplianceRegion),
    );
    // Derived against the LIVE vocabulary, so a legitimate extension (gait adding ankles) moves the
    // sentinel instead of reddening this clause. See UNAUTHORED_REGION_CANDIDATES.
    const UNAUTHORED_REGION = pickUnauthoredRegion(MOTION_BODY_REGIONS, authoredMotionRegions);

    const result = validateMotionProgram(
      plannerProgram({
        actions: [
          {
            actionId: "withdraw_ankle_v1",
            primitiveId: "guard_body_region",
            trigger: { kind: "clinical_touch", ref: "clinical_touch_guard_chest_l" },
            timing: { durationMs: 900 },
            intensity: 0.6,
            // THE DEFECT: a region this case never authored and the vocabulary never declared.
            target: { kind: "body_region", id: UNAUTHORED_REGION },
            effector: "handR",
            constraints: [],
          },
        ],
      }),
    );

    expect(result.ok, "the planner may not invent a body region the case does not carry").toBe(false);
    expect(
      result.errors.join(" | "),
      "the refusal must name the invented region so the author can see what was made up",
    ).toContain(UNAUTHORED_REGION);

    // Same boundary, second authored fact: an actor the encounter never cast.
    const foreignActor = validateMotionProgram(
      plannerProgram({ actorId: "attending_physician_v1" }),
    );
    expect(AUTHORED_ACTOR_IDS).not.toContain("attending_physician_v1");
    expect(foreignActor.ok, "the planner may not cast an actor the case never authored").toBe(false);
  });

  // (3) RED. The review step must be DISTINGUISHABLE from the proposal step. A planner that can
  //     stamp its own output `reviewed_llm_proposal` has erased the reviewer.
  //
  //     This clause also carries the ANTI-BLANKET-REFUSAL counterweight. Without the accept path
  //     below, `() => ({ ok: false, errors: ["no"] })` greens (1), (2) and (3) together. The accept
  //     path is here as that counterweight, NOT as a happy-path demonstration.
  it("(3) RED: a planner-produced program cannot self-declare reviewed_llm_proposal", async () => {
    const [validateMotionProgram, { motionBodyRegionForComplianceRegion }] = await Promise.all([
      loadValidator(),
      loadRegionVocabulary(),
    ]);
    const authoredMotionRegion = motionBodyRegionForComplianceRegion(AUTHORED_COMPLIANCE_REGIONS[0]!);

    const validAction = {
      actionId: "guard_chest_v1",
      primitiveId: "guard_body_region",
      trigger: { kind: "clinical_touch", ref: "clinical_touch_guard_chest_l" },
      timing: { durationMs: 900 },
      intensity: 0.6,
      target: { kind: "body_region", id: authoredMotionRegion },
      effector: "handR",
      constraints: [],
    };

    const selfPromoted = validateMotionProgram(
      plannerProgram({
        actions: [validAction],
        // THE DEFECT: produced by the planner, marked as though a reviewer had already seen it.
        provenance: {
          sourceKind: "reviewed_llm_proposal",
          sourceRefs: [edChestPainScenario.scenarioId],
        },
      }),
    );

    expect(
      selfPromoted.ok,
      "only a distinct review step may mint reviewed_llm_proposal; the planner may not",
    ).toBe(false);
    expect(selfPromoted.errors.join(" | ")).toMatch(/reviewed_llm_proposal|provenance|sourceKind/);

    // COUNTERWEIGHT: the SAME program, honestly labelled `llm_proposal`, is ACCEPTED. This is what
    // makes (1)-(3) unsatisfiable by a validator that refuses everything.
    const honest = validateMotionProgram(plannerProgram({ actions: [validAction] }));

    expect(honest.ok, "a case-bounded llm_proposal with no raw tracks is a legitimate plan").toBe(true);
    expect(honest.errors).toEqual([]);
  });

  // (4) LIVE COUNTERWEIGHT — passes on arrival, and is breakable WITHOUT touching (1)-(3).
  //
  //     A VLM critic produces ADVISORY findings. Advisory findings do not clear a human release
  //     gate. Asserted against shipped product code, with the precedence stated explicitly: an
  //     approved critic finding leaves `reviewer_evidence` BLOCKING and every required human role
  //     still missing, while four human approvals clear the same gate on the same scenario.
  // ADDED 2026-09-03, after 6d51728e made the release gate consult a trusted verifier. Before that
  // commit, a self-declared `reviewerRole` cleared the gate, so this clause's KNOWN-GOOD COLUMN
  // passed with no verifier at all. 6d51728e is CORRECT — no verifier credits nothing, fail-closed —
  // and it left this consumer's known-good column measuring the old behaviour, red on main.
  //
  // The repair supplies one verifier to BOTH halves rather than only to the human half, so the
  // critic-only refusal is no longer explained by there being no verifier at all.
  //
  // SCOPE, measured rather than asserted. I first wrote that this makes the counterweight "stronger"
  // because the critic is "refused by name". PROBED on 2026-09-03 by widening the verifier to credit
  // `vlm_critic` and dropping its principal-id binding: clause (4) still PASSED. It bounds role
  // COVERAGE — an approval carrying only `vlm_critic` credits none of the four REQUIRED roles, so
  // the gate blocks whatever the verifier thinks of the critic. That is the real and useful claim.
  //
  // NOT caught here: a verifier that credits `vlm_critic` as satisfying a required role. That is
  // `review-workflow/src/the-release-gate-refuses-a-self-declared-reviewer.test.ts`, which owns
  // verifier trust; this file owns what the motion pipeline may not do.
  // Sourced from the scenario, not hand-listed: a hand-list would drift from the fixture and start
  // crediting a role the scenario no longer requires. `vlm_critic` is absent from it by construction.
  const humanReviewerRoles: readonly string[] = edChestPainScenario.governance.requiredReviewerRoles;
  const trustedHumanVerifier: ReviewerAttestationVerifier = (request) =>
    humanReviewerRoles.includes(request.assertedRole) && request.reviewerId === `human-${request.assertedRole}`
      ? { verified: true, principalId: request.reviewerId, roles: [request.assertedRole] }
      : { verified: false, reason: `${request.assertedRole} is not a trusted human reviewer principal` };

  it("(4) COUNTERWEIGHT: a VLM critic finding cannot satisfy the human release gate", () => {
    const assetReadiness = {
      scenarioId: edChestPainScenario.scenarioId,
      devReady: true,
      productionReady: true,
      missingRequiredAssetIds: [],
      blockedAssets: [],
      productionBlockedAssets: [],
    };

    const criticOnly = evaluateScenarioPublicationReadiness({
      scenario: edChestPainScenario,
      targetUse: "local_formative",
      reviewerEvidence: [
        {
          reviewerRole: "vlm_critic",
          reviewerId: "vlm-critic-run-1",
          decision: "approved",
          comments: "Frames look plausible; no clipping observed.",
          evidenceRefs: [".openclinxr/evidence/critic/frames.png"],
          reviewedAt: "2026-08-29T00:00:00.000Z",
        },
      ],
      assetReadiness,
      attestationVerifier: trustedHumanVerifier,
    });

    const criticGate = criticOnly.gateResults.find((gate) => gate.gate === "reviewer_evidence");

    // PRECEDENCE, stated explicitly: the critic approved, and the gate still blocks.
    expect(criticGate?.status, "an advisory critic approval does not satisfy reviewer_evidence").toBe("block");
    expect(
      criticOnly.missingReviewerRoles,
      "the critic contributes nothing toward any required human role",
    ).toEqual([...edChestPainScenario.governance.requiredReviewerRoles]);
    expect(criticOnly.canPublishForLearnerUse).toBe(false);
    expect(criticOnly.blockerVisibility.recommendedNextAction).toBe("collect_required_reviewer_evidence");

    // NOT CONFOUNDED: reviewer_evidence is the ONLY blocking gate, so the refusal above is caused by
    // the critic's advisory status and not by some unrelated gate failing.
    expect(
      criticOnly.gateResults.filter((gate) => gate.status === "block").map((gate) => gate.gate),
    ).toEqual(["reviewer_evidence"]);

    // KNOWN-GOOD COLUMN: the same gate on the same scenario IS satisfiable by human reviewers.
    // Without this, clause (4) would pass on a build where publication always blocks.
    const humanApproved = evaluateScenarioPublicationReadiness({
      scenario: edChestPainScenario,
      targetUse: "local_formative",
      reviewerEvidence: edChestPainScenario.governance.requiredReviewerRoles.map((role) => ({
        reviewerRole: role,
        reviewerId: `human-${role}`,
        decision: "approved" as const,
        comments: "Reviewed against the case definition.",
        evidenceRefs: ["docs/openclinxr/review-record.md"],
        reviewedAt: "2026-08-29T00:00:00.000Z",
      })),
      assetReadiness,
      attestationVerifier: trustedHumanVerifier,
    });

    expect(
      humanApproved.gateResults.find((gate) => gate.gate === "reviewer_evidence")?.status,
    ).toBe("pass");
    expect(humanApproved.missingReviewerRoles).toEqual([]);
    expect(humanApproved.canPublishForLearnerUse).toBe(true);
  });
});

/**
 * ## M5 SEMANTIC ADMISSION CLAUSES (tsk_fe21a528321bd6bb) — appended 2026-09-03.
 *
 * The four clauses above gate the CLOSED-IR boundary (`validateMotionProgram`). M5 is a
 * SECOND gate with case context — the M1 FIXED note above records the gap: "the validator
 * has no case context to refuse a never-cast actor... which is the M5 card's own residual."
 * These clauses gate `validateLLMScenarioMotionProgram`
 * (src/program/llm-scenario-motion-planner.ts): the same one-mutation-at-a-time shape,
 * against a baseline that is FULLY valid on its own (posture=seated, canonical derived
 * string seed), so no refusal can be blamed on an invalid baseline.
 *
 * claimScope: that a case-bounded `llm_proposal` whose actor is cast, whose body_region
 *   targets are the image of the case's OWN touch map, and whose provenance is honest
 *   validates with zero errors; and that physical tracks, a declared-but-never-authored
 *   region, a never-cast actor, a producer-claim that did not run, and a self-declared
 *   review are each refused naming the offending cause.
 * notEvidenceFor: anything clause (4) does not already claim — clinical validity, motion
 *   quality, or what a genuine review step may mint.
 */

const M5_MODULE_UNDER_TEST = "./program/llm-scenario-motion-planner.js";

type M5PlannerFacts = {
  scenarioId: string;
  actorIds: string[];
  authoredComplianceRegions: string[];
};

/**
 * The case-bounded honest baseline for the M5 clauses. Everything it needs is DERIVED from
 * the live fixture: the actor who authors the touch map, the first authored compliance
 * region mapped through the live vocabulary, and the canonical five-input seed derived
 * from the program's OWN stable content (the plan-time convention: no rig bound, so the
 * skeleton slot is the program's own hash). posture=seated is KNOWN-GOOD's baseline value.
 */
async function m5HonestProposal(): Promise<Record<string, unknown>> {
  const [vocab] = await Promise.all([loadRegionVocabulary()]);
  const actorId = (edChestPainScenario.actors ?? []).find(
    (actor) => (actor.bodyMechanics?.touchResponses ?? []).length > 0,
  )?.actorId;
  const complianceRegion = AUTHORED_COMPLIANCE_REGIONS[0];
  if (actorId === undefined || complianceRegion === undefined) {
    throw new Error("the fixture no longer authors a touch map this clause reads");
  }
  const stable = {
    schemaVersion: "openclinxr.motion-program.v1",
    scenarioId: edChestPainScenario.scenarioId,
    actorId,
    provenance: { sourceKind: "llm_proposal", sourceRefs: [edChestPainScenario.scenarioId] },
    baseline: { posture: "seated", affect: "anxious", breathing: "laboured" },
    actions: [
      {
        actionId: "guard_chest_v1",
        primitiveId: "guard_body_region",
        trigger: { kind: "clinical_touch", ref: "clinical_touch_guard_chest_l" },
        timing: { durationMs: 900 },
        intensity: 0.6,
        target: { kind: "body_region", id: vocab.motionBodyRegionForComplianceRegion(complianceRegion) },
        effector: "handR",
        constraints: [],
      },
    ],
    claimBoundary: CLAIM_BOUNDARY,
    notEvidenceFor: ["clinical_validity", "animation_quality"],
  };
  const compile = (await import(/* @vite-ignore */ plantModule("./program/compile-scenario-motion.js"))) as Record<
    string,
    unknown
  >;
  const variation = (await import(/* @vite-ignore */ plantModule("./trajectory/deterministic-variation.js"))) as Record<
    string,
    unknown
  >;
  const canonicalMotionProgramHash = compile["canonicalMotionProgramHash"] as (program: unknown) => string;
  const deriveDeterministicVariationSeed = variation["deriveDeterministicVariationSeed"] as (input: {
    motionProgramHash: string;
    skeletonProfileHash: string;
    compilerVersion: string;
    primitiveLibraryVersion: string;
    variationIndex: number;
  }) => string;
  const motionProgramHash = canonicalMotionProgramHash(stable);
  return {
    ...stable,
    deterministicSeed: deriveDeterministicVariationSeed({
      motionProgramHash,
      skeletonProfileHash: motionProgramHash,
      compilerVersion: compile["MOTION_COMPILER_VERSION"] as string,
      primitiveLibraryVersion: compile["PRIMITIVE_LIBRARY_VERSION"] as string,
      variationIndex: 0,
    }),
  };
}

const M5_FACTS: M5PlannerFacts = {
  scenarioId: edChestPainScenario.scenarioId,
  actorIds: AUTHORED_ACTOR_IDS,
  authoredComplianceRegions: AUTHORED_COMPLIANCE_REGIONS,
};

describe("the M5 semantic planner admits only case-bounded honest proposals", () => {
  it("(5) M5 KNOWN-GOOD: the honest canonical proposal validates with zero errors before any mutation", async () => {
    const [vocab, validator] = await Promise.all([loadRegionVocabulary(), loadValidator()]);
    const proposal = await m5HonestProposal();

    // The baseline is FULLY valid on its own — the anti-vacuous guard: no refusal below
    // may be attributable to an invalid posture or seed.
    const structural = validator(proposal);
    expect(structural.ok, "the M5 baseline must itself pass the closed IR").toBe(true);
    expect(structural.errors).toEqual([]);
    expect((proposal["deterministicSeed"] as string).length).toBeGreaterThan(0);
    expect((proposal["baseline"] as { posture: string }).posture).toBe("seated");

    const admitted = validateLLMScenarioMotionProgram(proposal, M5_FACTS);
    expect(admitted.ok, "a case-bounded llm_proposal is a legitimate plan").toBe(true);
    expect(admitted.errors).toEqual([]);
  });

  it("(6) M5 RED: the semantic planner refuses physical tracks for the track reason", async () => {
    const vocab = await loadRegionVocabulary();
    const proposal = await m5HonestProposal();
    const complianceRegion = AUTHORED_COMPLIANCE_REGIONS[0]!;

    const result = validateLLMScenarioMotionProgram(
      {
        ...proposal,
        actions: [
          {
            actionId: "guard_chest_v1",
            primitiveId: "guard_body_region",
            trigger: { kind: "clinical_touch", ref: "clinical_touch_guard_chest_l" },
            timing: { durationMs: 900 },
            intensity: 0.6,
            target: { kind: "body_region", id: vocab.motionBodyRegionForComplianceRegion(complianceRegion) },
            effector: "handR",
            constraints: [],
            // THE DEFECT: raw skeleton payload through the same program field as clause (1).
            boneTracks: [
              {
                bone: "upper_arm.L",
                keyframes: [
                  { tMs: 0, quat: [0, 0, 0, 1] },
                  { tMs: 400, quat: [0.13, 0, 0, 0.99] },
                ],
              },
            ],
          },
        ],
      },
      M5_FACTS,
    );

    expect(result.ok, "the planner's own gate must refuse raw bone tracks").toBe(false);
    expect(result.errors.join(" | ")).toMatch(/boneTracks|upper_arm\.L|track/);
  });

  it("(7) M5 RED: a declared-but-never-authored motion region is refused for the region", async () => {
    const [vocab, validator] = await Promise.all([loadRegionVocabulary(), loadValidator()]);
    const proposal = await m5HonestProposal();

    // The authored motion regions: the image of the case's OWN touch map under the mapper.
    const authoredMotionRegionSet = new Set(AUTHORED_COMPLIANCE_REGIONS.map(vocab.motionBodyRegionForComplianceRegion));
    // A region the VOCABULARY declares but THIS case never authored — the IR accepts it
    // (it is declared), so only the case-aware layer can refuse it.
    const declaredButUnauthored = vocab.MOTION_BODY_REGIONS.find((region) => !authoredMotionRegionSet.has(region));
    expect(declaredButUnauthored, "the vocabulary must carry a region this case never authors").toBeDefined();

    const actions = [
      {
        actionId: "withdraw_unauthored_v1",
        primitiveId: "guard_body_region",
        trigger: { kind: "clinical_touch", ref: "clinical_touch_guard_chest_l" },
        timing: { durationMs: 900 },
        intensity: 0.6,
        target: { kind: "body_region", id: declaredButUnauthored },
        effector: "handR",
        constraints: [],
      },
    ];

    // Counterweight: the closed IR alone ACCEPTS this program — the target is declared.
    expect(validator({ ...proposal, actions }).ok, "declared regions pass the closed IR").toBe(true);

    const result = validateLLMScenarioMotionProgram(
      { ...proposal, actions },
      M5_FACTS,
    );

    expect(result.ok, "a region the case never authored is an invention for THIS case").toBe(false);
    expect(result.errors.join(" | ")).toContain(declaredButUnauthored);
  });

  it("(8) M5 RED: a never-cast actor is refused for the actor — the recorded M1 residual", async () => {
    const validator = await loadValidator();
    const proposal = await m5HonestProposal();
    const foreignActor = "attending_physician_v1";

    expect(AUTHORED_ACTOR_IDS).not.toContain(foreignActor);
    // Counterweight: nothing else is wrong with this program — the target is a case-authored
    // region and the provenance is honest, so the closed IR accepts it.
    expect(validator({ ...proposal, actorId: foreignActor }).ok, "the IR has no case context").toBe(true);

    const result = validateLLMScenarioMotionProgram(
      { ...proposal, actorId: foreignActor },
      M5_FACTS,
    );

    expect(result.ok, "the planner may not cast an actor the case never authored").toBe(false);
    expect(result.errors.join(" | ")).toContain(foreignActor);
  });

  it("(9) M5 RED: a producer-claim that did not run is refused for its provenance", async () => {
    const validator = await loadValidator();
    const proposal = await m5HonestProposal();

    // The IR permits deterministic_case_compiler as a closed sourceKind, so this refusal
    // belongs to the LLM admission path: an LLM output stamped as a producer that did not
    // run hides the fact that an LLM authored it.
    for (const disguisedSourceKind of ["deterministic_case_compiler", "authored_case"]) {
      const disguised = {
        ...proposal,
        provenance: { sourceKind: disguisedSourceKind, sourceRefs: [edChestPainScenario.scenarioId] },
      };
      expect(validator(disguised).ok, `the IR accepts ${disguisedSourceKind} as a closed kind`).toBe(true);

      const result = validateLLMScenarioMotionProgram(disguised, M5_FACTS);
      expect(result.ok, `an LLM proposal may not claim ${disguisedSourceKind} provenance`).toBe(false);
      expect(result.errors.join(" | ")).toMatch(/sourceKind|provenance/);
    }
  });

  it("(10) M5 RED: a self-declared review is refused by the planner's own gate", async () => {
    const validator = await loadValidator();
    const proposal = await m5HonestProposal();

    const selfPromoted = {
      ...proposal,
      provenance: { sourceKind: "reviewed_llm_proposal", sourceRefs: [edChestPainScenario.scenarioId] },
    };
    expect(validator(selfPromoted).ok, "the closed IR refuses self-minted review provenance").toBe(false);

    const result = validateLLMScenarioMotionProgram(selfPromoted, M5_FACTS);
    expect(result.ok, "only a distinct review step may mint reviewed_llm_proposal").toBe(false);
    expect(result.errors.join(" | ")).toMatch(/reviewed_llm_proposal|provenance|sourceKind/);
  });
});

// NOT TESTED: that a VLM critic recorded under an IMPERSONATED human role is refused — measured
// 2026-08-29, `missingApprovedReviewerRoles` (scenario-publication.ts:210-222) matches the
// `reviewerRole` STRING only, with no provenance or human-attestation check, so a critic writing
// `reviewerRole: "clinician"` WOULD clear the gate today. That is a real hole in the human release
// gate, it is out of scope for this card, and it needs its own card against review-workflow.
// Also not tested: raw tracks smuggled under a field name other than `boneTracks` (euler tracks,
// baked clips, a base64 payload) — clause (1) pins one shape, not the class; that `claimBoundary`
// and `notEvidenceFor` are ENFORCED rather than merely carried, since this file constructs those
// fields itself and asserting them here would be vacuous; whether a `reviewed_llm_proposal` minted
// by a genuine review step is accepted (no review step exists yet); the runtime that consumes an
// accepted program; and anything about clinical validity or animation quality of the planned motion.
