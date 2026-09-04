/**
 * LLMScenarioMotionPlanner — the semantic admission gate between an authoring LLM
 * and the closed MotionProgram IR. (M5 deliverable.)
 *
 * The authoring LLM is an UNTRUSTED semantic front-end: it may propose declarative,
 * case-bounded MotionProgram intent, and nothing else. This module is the gate that
 * says which proposals cross into the factory. It composes the closed-IR structural
 * validator (`validateMotionProgram`) with the checks only a CASE-AWARE layer can
 * make — this is the M5 residual the M1 validator records in its own FIXED note:
 * "the validator has no case context to refuse a never-cast actor. Closing the actor
 * half needs the validator to know the case's cast."
 *
 * WHAT IS REFUSED, AND WHY (one intended reason each):
 *
 *   - physical tracks: a raw per-bone payload (`boneTracks` or any unknown field) is
 *     refused by the closed IR — the planner is not the animator. Carried forward,
 *     never re-implemented.
 *   - nested physical payloads: unknown properties on targets/constraints/planner,
 *     object baseline modifiers, and path/URL/data-URI/code strings in allowed
 *     slots are refused by `validateClosedPlannerProposalSchema`. A renamed
 *     track (`eulerTracks`) is the same class as `boneTracks`.
 *   - unknown region: a `body_region` target must be the motion image of a compliance
 *     region the CASE authored (the mapper over the case's authored touch map). A
 *     motion region DECLARED in `MOTION_BODY_REGIONS` but never authored by THIS case
 *     (e.g. `sternum` for a case with no sternal touch row) is still an invention for
 *     this case, even though the IR accepts it.
 *   - unknown actor: `actorId` and actor-kind targets must be members of the case's
 *     authored cast.
 *   - hidden-fact provenance: a proposal entering through the LLM path must declare
 *     `provenance.sourceKind = "llm_proposal"`. Claiming `deterministic_case_compiler`
 *     or `authored_case` hides the fact that an LLM authored the output, and
 *     `reviewed_llm_proposal` claims a review that never ran (self-review).
 *
 * A VLM critic downstream produces ADVISORY findings: nothing in this planner (or in
 * the deterministic factory) may mint a provenance kind or reviewer evidence that
 * clears a human release gate. That refusal lives in review-workflow and is asserted
 * live by clause (4) of the-llm-planner-cannot-emit-bone-tracks.test.ts.
 *
 * claimScope: that an otherwise-valid `llm_proposal` MotionProgram for a case is
 *   admitted with zero errors, and that isolated mutations (physical tracks, a
 *   non-authored region, a never-cast actor, a hidden-origin provenance, a
 *   self-declared review) are each refused with the offending cause named.
 * notEvidenceFor: that any admitted program produces good-looking motion; clinical
 *   validity of the plan; that the mapper's region choices are clinically sensible;
 *   the runtime that consumes an admitted program; or how a genuine human review is
 *   captured.
 */

import {
  MOTION_PROVENANCE_SOURCE_KINDS,
  validateMotionProgram,
  type MotionActionTarget,
  type MotionProgram,
} from "../motion-program.js";
import { motionBodyRegionForComplianceRegion } from "../motion-body-region.js";
import { validateClosedPlannerProposalSchema } from "./closed-planner-schema.js";

export type MotionValidation = { ok: boolean; errors: string[] };

/**
 * The authored case facts a proposal is bounded by. All three are DERIVED by the
 * caller from the case definition (never restated here), so this gate cannot drift
 * from the fixture that actually ships.
 */
export type AuthoredCaseMotionFacts = {
  scenarioId: string;
  /** Every actor the case casts. `actorId` and actor-kind targets must be members. */
  actorIds: readonly string[];
  /** The compliance regions the case authors through touch responses (the touch map). */
  authoredComplianceRegions: readonly string[];
};

const LLM_PLANNER_SOURCE_KIND = "llm_proposal" as const;

function authoredMotionRegions(
  facts: AuthoredCaseMotionFacts,
  errors: string[],
): Set<string> {
  const regions = new Set<string>();
  for (const complianceRegion of facts.authoredComplianceRegions) {
    try {
      regions.add(motionBodyRegionForComplianceRegion(complianceRegion));
    } catch {
      errors.push(
        `case facts author compliance region "${complianceRegion}" which the compliance→motion mapper does not declare — ` +
          `the authored touch map is closed over the ten clinical touch sites`,
      );
    }
  }
  return regions;
}

function checkActionTarget(
  target: MotionActionTarget,
  authoredMotionRegions: ReadonlySet<string>,
  facts: AuthoredCaseMotionFacts,
  errors: string[],
  where: string,
): void {
  if (target.kind === "body_region") {
    if (!authoredMotionRegions.has(target.id)) {
      errors.push(
        `${where}: body_region target "${target.id}" is not authored by this case — ` +
          `the planner may not invent a body region the case never authored`,
      );
    }
    return;
  }
  if (target.kind === "actor") {
    if (!facts.actorIds.includes(target.id)) {
      errors.push(
        `${where}: actor target "${target.id}" is not in the case's cast — ` +
          `the planner may not cast an actor the case never authored`,
      );
    }
  }
}

/**
 * Admit an LLM-authored MotionProgram proposal against an authored case.
 *
 * ORDER MATTERS: the closed-IR structural validation runs FIRST, so a program
 * carrying raw bone tracks is refused for that reason and never reaches the
 * case-bound layer. Then the semantic checks collect every violation (not
 * fail-fast), so the author sees the full shape of what is not case-bounded.
 *
 * The honest counterweight is the same composition: a case-bounded `llm_proposal`
 * with no raw tracks, a case-authored actor and mapped region targets returns
 * `{ ok: true, errors: [] }` — a validator that refuses everything cannot satisfy
 * this gate.
 */
export function validateLLMScenarioMotionProgram(
  program: unknown,
  facts: AuthoredCaseMotionFacts,
): MotionValidation {
  // (1) Structural gate: closed IR. Refuses raw per-bone payloads, unknown fields,
  //     undeclared regions and self-declared `reviewed_llm_proposal` by name.
  const structural = validateMotionProgram(program);
  if (!structural.ok) return structural;

  const closed = validateClosedPlannerProposalSchema(program);
  const typed = program as MotionProgram;
  const errors: string[] = [...closed.errors];

  // (2) Provenance honesty (hidden-fact behavior). The LLM admission path may only
  //     mint `llm_proposal`; every other closed sourceKind claims a producer that
  //     did not run here.
  const sourceKind = typed.provenance.sourceKind;
  if (sourceKind !== LLM_PLANNER_SOURCE_KIND) {
    errors.push(
      `provenance.sourceKind "${String(sourceKind)}" cannot be admitted by the LLM scenario planner — ` +
        `only "${LLM_PLANNER_SOURCE_KIND}" is honest for an LLM-authored proposal; ` +
        `"${MOTION_PROVENANCE_SOURCE_KINDS.join('", "')}" are minted by their own sanctioned steps`,
    );
  }

  // (3) The case's identity. A proposal for a different scenario is not this plan.
  if (typed.scenarioId !== facts.scenarioId) {
    errors.push(
      `scenarioId "${typed.scenarioId}" does not match the authored case "${facts.scenarioId}" — ` +
        `a proposal is bounded by one case`,
    );
  }

  // (4) The authored cast. The M5 residual: an actor the case never cast is refused
  //     HERE, for the actor reason, not because some other field happens to be bad.
  if (!facts.actorIds.includes(typed.actorId)) {
    errors.push(
      `actorId "${typed.actorId}" is not in the case's authored cast — the planner may not ` +
        `cast an actor the case never authored`,
    );
  }

  // (5) Authored regions. The image of the case's touch map under the explicit
  //     compliance→motion mapper; a declared-but-never-authored region is refused.
  const authoredRegions = authoredMotionRegions(facts, errors);

  typed.actions.forEach((action, index) => {
    const where = `action ${index}`;
    checkActionTarget(action.target, authoredRegions, facts, errors, where);
    action.constraints.forEach((constraint, constraintIndex) => {
      checkActionTarget(
        constraint.target,
        authoredRegions,
        facts,
        errors,
        `${where} constraint ${constraintIndex}`,
      );
    });
  });

  return { ok: errors.length === 0, errors };
}
