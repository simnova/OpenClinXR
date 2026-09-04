/**
 * Authored-source binding — every motion action/constraint source reference
 * must bind to learner-visible authored case evidence.
 *
 * M5 (`validateLLMScenarioMotionProgram`) admits a case-bounded llm_proposal
 * when actor + mapped region + provenance are honest. It does not require
 * `trigger.ref` (or a contact constraint's body_region target) to bind to
 * learner-visible authored evidence. This module is that closed contract:
 * missing, fabricated, and hiddenFact refs are refused by name; an exact
 * approved touchResponse or visible-facts dialogue seed is admitted.
 *
 * facts.visibleSources / hiddenTokens are caller-derived from the shipped
 * case (same posture as AuthoredCaseMotionFacts). This gate does not restate
 * fixture literals.
 *
 * claimScope: that a motion action/constraint source reference must bind to
 *   learner-visible authored case evidence, and that missing, fabricated, or
 *   hidden references are refused by name.
 * notEvidenceFor: clinical validity, scoring, Quest readiness, animation
 *   quality, or that any bound plan LOOKS like guarding.
 */

import { motionBodyRegionForComplianceRegion } from "../motion-body-region.js";
import { RESPONSE_KIND_TO_PRIMITIVE } from "./response-kind-to-primitive.js";

export type MotionValidation = { ok: boolean; errors: string[] };

export type VisibleAuthoredSource = {
  actorId: string;
  sourceId: string;
  kind: "touch_response" | "dialogue";
  region?: string;
  responseKind?: string;
};

export type AuthoredSourceFacts = {
  scenarioId: string;
  visibleSources: readonly VisibleAuthoredSource[];
  hiddenTokens: readonly string[];
};

function visibleForActor(
  facts: AuthoredSourceFacts,
  actorId: string,
  sourceId: string,
): VisibleAuthoredSource | undefined {
  return facts.visibleSources.find((source) => source.actorId === actorId && source.sourceId === sourceId);
}

/**
 * Bind every action `trigger.ref` and every contact-constraint body_region
 * target to a learner-visible authored source for the program's actor.
 * HiddenFacts, hiddenFactCanaries, and `blocks_hidden_truth_probe` seeds are
 * not sources.
 */
export function validateAuthoredSourceBinding(
  program: unknown,
  facts: AuthoredSourceFacts,
): MotionValidation {
  const errors: string[] = [];
  if (typeof program !== "object" || program === null || Array.isArray(program)) {
    return { ok: false, errors: ["program is not an object"] };
  }

  const record = program as Record<string, unknown>;
  const hidden = new Set(facts.hiddenTokens);

  const provenance = record["provenance"] as { sourceRefs?: unknown } | undefined;
  for (const ref of Array.isArray(provenance?.sourceRefs) ? provenance.sourceRefs : []) {
    if (typeof ref === "string" && hidden.has(ref)) {
      errors.push(`provenance.sourceRefs "${ref}" is hidden — not learner-visible authored evidence`);
    }
  }

  const actorId = record["actorId"];
  const actions = record["actions"];
  if (!Array.isArray(actions)) return { ok: false, errors: ["actions must be an array"] };

  actions.forEach((raw, index) => {
    const at = `action ${index}`;
    const action = raw as Record<string, unknown>;
    const trigger = action["trigger"] as { ref?: unknown } | undefined;
    const ref = trigger?.ref;
    if (typeof ref !== "string" || ref.length === 0) {
      errors.push(`${at}: missing source ref — every action must bind to learner-visible authored evidence`);
      return;
    }
    if (hidden.has(ref)) {
      errors.push(
        `${at}: source ref "${ref}" is hidden diagnosis — authored actor and region cannot authorize it`,
      );
      return;
    }
    const source = typeof actorId === "string" ? visibleForActor(facts, actorId, ref) : undefined;
    if (source === undefined) {
      errors.push(`${at}: source ref "${ref}" is not a learner-visible authored source for this actor`);
      return;
    }
    if (source.kind !== "touch_response" || source.responseKind === undefined) return;

    const expectedPrimitive = RESPONSE_KIND_TO_PRIMITIVE[source.responseKind];
    if (expectedPrimitive !== undefined && action["primitiveId"] !== expectedPrimitive) {
      errors.push(
        `${at}: primitiveId ${JSON.stringify(action["primitiveId"])} is not authored by source "${ref}" (${source.responseKind} -> ${expectedPrimitive})`,
      );
    }
    if (source.region === undefined) return;

    const expectedRegion = motionBodyRegionForComplianceRegion(source.region);
    const target = action["target"] as { kind?: string; id?: string } | undefined;
    if (target?.kind === "body_region" && target.id !== expectedRegion) {
      errors.push(`${at}: target "${target.id}" does not bind to authored source region ${source.region}`);
    }
    const constraints = Array.isArray(action["constraints"]) ? action["constraints"] : [];
    constraints.forEach((rawConstraint, constraintIndex) => {
      const constraint = rawConstraint as { target?: { kind?: string; id?: string } };
      if (constraint.target?.kind === "body_region" && constraint.target.id !== expectedRegion) {
        errors.push(
          `${at} constraint ${constraintIndex}: target "${constraint.target.id}" does not bind to authored source "${ref}"`,
        );
      }
    });
  });

  return { ok: errors.length === 0, errors };
}
