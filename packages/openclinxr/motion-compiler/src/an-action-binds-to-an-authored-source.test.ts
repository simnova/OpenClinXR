import { describe, expect, it } from "vitest";

import {
  edChestPainDialogueSeeds,
  edChestPainScenario,
} from "../../scenario-fixtures/src/ed-chest-pain.js";
import { motionBodyRegionForComplianceRegion } from "./motion-body-region.js";
import { validateMotionProgram } from "./motion-program.js";
import { RESPONSE_KIND_TO_PRIMITIVE } from "./program/compile-scenario-motion.js";
import { validateLLMScenarioMotionProgram } from "./program/llm-scenario-motion-planner.js";

/**
 * PLANTED RED — BothyBoard tsk_7f2c889c39d8e43b (authored-source binding). IMMUTABLE HEADER.
 *
 * Do not rewrite this block. Flip `it.fails` -> `it` and append a `## FIXED` block BELOW it.
 * Do not edit the measured tables or the paths in this header.
 *
 * OBSERVABLE TODAY, measured 2026-09-03 on this tree (HEAD 92b58c8f):
 *
 *   packages/openclinxr/motion-compiler/src/program/authored-source-binding.ts   ABSENT
 *   packages/openclinxr/motion-compiler/src/program/llm-scenario-motion-planner.ts
 *     admits a case-bounded llm_proposal when actor + mapped region + provenance
 *     are honest. It does NOT require action.trigger.ref (or a constraint's
 *     body_region target) to bind to learner-visible authored evidence.
 *
 *   So authored actor + chest region alone currently authorize a plan whose
 *   trigger.ref is missing, fabricated, or a hiddenFact token. That is the
 *   defect: hidden diagnosis cannot be allowed to mint clutch/guard.
 *
 * THE INPUT IS REAL AND ALREADY SHIPS. `ed_chest_pain_priority_v1` /
 * `patient_robert_hayes_v1` authors a chest_L guarding touch row (traceTag,
 * emotionEventId, dialogueLine, responseKind) AND hiddenFacts the learner
 * must not see. Visible vs hidden is DERIVED from that fixture at runtime,
 * never restated as literals in the RED clauses.
 *
 * THE BOUNDARY. Every action source reference (`trigger.ref`) and every
 * constraint source reference (a contact constraint's `target.id` when it
 * names a body_region) must bind to a learner-visible authored source:
 * a touchResponse traceTag / emotionEventId, or a dialogue seedId whose
 * safetyExpectation is `responds_from_visible_facts`. HiddenFacts,
 * hiddenFactCanaries, and `blocks_hidden_truth_probe` seeds are not sources.
 *
 * COUNTERWEIGHTS (the cheapest passes this plant refuses):
 *   - actor + authored chest region with no trigger.ref          -> missing source
 *   - fabricated `clinical_touch_appendicitis_v1`                -> foreign source
 *   - hiddenFact token as trigger.ref                            -> hidden diagnosis
 *   - chest-bound action whose constraint targets RLQ            -> unbound constraint
 *   - clutch_body_region bound to a guarding-only chest row      -> invented primitive
 *   - blanket `ok: false`                                        -> live known-good fails
 *
 * API inherited, not invented: `validateAuthoredSourceBinding(program, facts)`
 * in `./program/authored-source-binding.js`, returning `{ ok, errors }` like
 * `validateLLMScenarioMotionProgram`. facts.visibleSources / hiddenTokens are
 * caller-derived from the shipped case (same posture as AuthoredCaseMotionFacts).
 *
 * WHY `it.fails` AND NOT `planted()`. This card's write-root is this file only.
 * `planted()` requires a planted-red-manifest.ts edit, which is out of scope.
 * Flip `it.fails` -> `it` when the module lands; do not rewrite the diagnosis.
 *
 * HONEST-FLIP / CHEAP-EVASION PROBE (module written then deleted; measured, not assumed):
 *   | treatment                                         | result                                      |
 *   |---------------------------------------------------|---------------------------------------------|
 *   | product binder present + `it.fails` flipped to `it` | 9 passed                                    |
 *   | binder `() => ({ ok: false, errors: ["no"] })`    | 6 failed — each clause names its token, not "no" |
 *   | restore: module absent, `it.fails` kept           | 3 passed \| 6 expected fail                 |
 *
 * claimScope: that a motion action/constraint source reference must bind to
 *   learner-visible authored case evidence derived from the shipped fixture,
 *   and that missing, fabricated, or hidden references are refused by name.
 * notEvidenceFor: clinical validity, scoring, Quest readiness, animation
 *   quality, or that any bound plan LOOKS like guarding.
 */

const CLAIM_BOUNDARY = "motion_plan_not_animation_or_clinical_validity_evidence";
const PRODUCT_MODULE = "./program/authored-source-binding.js";
const FABRICATED_APPENDICITIS_REF = "clinical_touch_appendicitis_v1";

type MotionValidation = { ok: boolean; errors: string[] };
type VisibleAuthoredSource = {
  actorId: string;
  sourceId: string;
  kind: "touch_response" | "dialogue";
  region?: string;
  responseKind?: string;
};
type AuthoredSourceFacts = {
  scenarioId: string;
  visibleSources: readonly VisibleAuthoredSource[];
  hiddenTokens: readonly string[];
};

type FixtureTouchRow = {
  region: string;
  responseKind: string;
  emotionEventId: string;
  traceTag: string;
};

type FixtureActor = {
  actorId: string;
  hiddenFacts?: string[];
  bodyMechanics?: { touchResponses?: FixtureTouchRow[] };
};

const SHIPPED_ACTORS: readonly FixtureActor[] = (edChestPainScenario.actors ?? []) as FixtureActor[];

function plantModule(specifier: string): string {
  return new URL(specifier, import.meta.url).href;
}

function deriveAuthoredSourceFacts(): AuthoredSourceFacts {
  const visibleSources: VisibleAuthoredSource[] = [];
  const hiddenTokens: string[] = [];

  for (const actor of SHIPPED_ACTORS) {
    for (const fact of actor.hiddenFacts ?? []) hiddenTokens.push(fact);
    for (const row of actor.bodyMechanics?.touchResponses ?? []) {
      visibleSources.push({
        actorId: actor.actorId,
        sourceId: row.traceTag,
        kind: "touch_response",
        region: row.region,
        responseKind: row.responseKind,
      });
      visibleSources.push({
        actorId: actor.actorId,
        sourceId: row.emotionEventId,
        kind: "touch_response",
        region: row.region,
        responseKind: row.responseKind,
      });
    }
  }

  for (const seed of edChestPainDialogueSeeds) {
    if (seed.safetyExpectation === "blocks_hidden_truth_probe") {
      hiddenTokens.push(seed.seedId);
      hiddenTokens.push(...seed.hiddenFactCanaries);
      continue;
    }
    visibleSources.push({ actorId: seed.actorId, sourceId: seed.seedId, kind: "dialogue" });
    hiddenTokens.push(...seed.hiddenFactCanaries);
  }

  return { scenarioId: edChestPainScenario.scenarioId, visibleSources, hiddenTokens };
}

function chestGuardingRow(): {
  actorId: string;
  region: string;
  responseKind: string;
  traceTag: string;
  emotionEventId: string;
} {
  for (const actor of SHIPPED_ACTORS) {
    const row = (actor.bodyMechanics?.touchResponses ?? []).find((touch: { region: string }) =>
      touch.region.startsWith("chest_"),
    );
    if (row === undefined) continue;
    return {
      actorId: actor.actorId,
      region: row.region,
      responseKind: row.responseKind,
      traceTag: row.traceTag,
      emotionEventId: row.emotionEventId,
    };
  }
  throw new Error("the shipped case no longer authors a chest touch row this plant reads");
}

function rlqRow(): { region: string; traceTag: string } | undefined {
  for (const actor of SHIPPED_ACTORS) {
    const row = (actor.bodyMechanics?.touchResponses ?? []).find((touch: { region: string }) => touch.region === "abdomen_rlq");
    if (row !== undefined) return { region: row.region, traceTag: row.traceTag };
  }
  return undefined;
}

function contactConstraint(motionRegion: string): Record<string, unknown> {
  return {
    kind: "contact",
    effector: "handR",
    target: { kind: "body_region", id: motionRegion },
    positionToleranceMeters: 0.03,
    startFraction: 0.4,
    endFraction: 0.72,
    penetrationToleranceMeters: 0.01,
    preserveWhileActive: true,
  };
}

function honestProgram(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const chest = chestGuardingRow();
  const motionRegion = motionBodyRegionForComplianceRegion(chest.region);
  const primitiveId = RESPONSE_KIND_TO_PRIMITIVE[chest.responseKind];
  if (primitiveId === undefined) {
    throw new Error(`shipped chest row responseKind ${chest.responseKind} has no primitive mapping`);
  }
  return {
    schemaVersion: "openclinxr.motion-program.v1",
    scenarioId: edChestPainScenario.scenarioId,
    actorId: chest.actorId,
    provenance: { sourceKind: "llm_proposal", sourceRefs: [edChestPainScenario.scenarioId] },
    baseline: { posture: "seated", affect: "anxious", breathing: "laboured" },
    actions: [
      {
        actionId: chest.traceTag,
        primitiveId,
        trigger: { kind: "clinical_touch", ref: chest.traceTag },
        timing: { durationMs: 900 },
        intensity: 0.6,
        target: { kind: "body_region", id: motionRegion },
        effector: "handR",
        constraints: [contactConstraint(motionRegion)],
      },
    ],
    deterministicSeed: "authored-source-binding-plant-seed",
    claimBoundary: CLAIM_BOUNDARY,
    notEvidenceFor: ["clinical_validity", "animation_quality"],
    ...overrides,
  };
}

function m5Facts() {
  return {
    scenarioId: edChestPainScenario.scenarioId,
    actorIds: SHIPPED_ACTORS.map((actor) => actor.actorId),
    authoredComplianceRegions: SHIPPED_ACTORS.flatMap((actor) =>
      (actor.bodyMechanics?.touchResponses ?? []).map((touch) => touch.region),
    ),
  };
}

/**
 * Spec oracle used ONLY to prove the contract is satisfiable. It is not the
 * product. The product worker copies this shape into
 * `./program/authored-source-binding.js` as `validateAuthoredSourceBinding`.
 */
function oracleBind(program: Record<string, unknown>, facts: AuthoredSourceFacts): MotionValidation {
  const errors: string[] = [];
  const hidden = new Set(facts.hiddenTokens);
  const visibleForActor = (actorId: string, sourceId: string): VisibleAuthoredSource | undefined =>
    facts.visibleSources.find((source) => source.actorId === actorId && source.sourceId === sourceId);

  const provenance = program["provenance"] as { sourceRefs?: unknown } | undefined;
  for (const ref of Array.isArray(provenance?.sourceRefs) ? provenance.sourceRefs : []) {
    if (typeof ref === "string" && hidden.has(ref)) {
      errors.push(`provenance.sourceRefs "${ref}" is hidden — not learner-visible authored evidence`);
    }
  }

  const actorId = program["actorId"];
  const actions = program["actions"];
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
      errors.push(`${at}: source ref "${ref}" is hidden diagnosis — authored actor and region cannot authorize it`);
      return;
    }
    const source = typeof actorId === "string" ? visibleForActor(actorId, ref) : undefined;
    if (source === undefined) {
      errors.push(`${at}: source ref "${ref}" is not a learner-visible authored source for this actor`);
      return;
    }
    if (source.kind === "touch_response" && source.responseKind !== undefined) {
      const expectedPrimitive = RESPONSE_KIND_TO_PRIMITIVE[source.responseKind];
      if (expectedPrimitive !== undefined && action["primitiveId"] !== expectedPrimitive) {
        errors.push(
          `${at}: primitiveId ${JSON.stringify(action["primitiveId"])} is not authored by source "${ref}" (${source.responseKind} -> ${expectedPrimitive})`,
        );
      }
      if (source.region !== undefined) {
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
      }
    }
  });

  return { ok: errors.length === 0, errors };
}

async function loadProductBinder(): Promise<(program: unknown, facts: AuthoredSourceFacts) => MotionValidation> {
  const mod = (await import(/* @vite-ignore */ plantModule(PRODUCT_MODULE))) as Record<string, unknown>;
  const fn = mod["validateAuthoredSourceBinding"];
  if (typeof fn !== "function") {
    throw new Error(
      "validateAuthoredSourceBinding is not exported from ./program/authored-source-binding.js — authored-source binding is absent",
    );
  }
  return fn as (program: unknown, facts: AuthoredSourceFacts) => MotionValidation;
}

describe("every motion action binds to learner-visible authored source", () => {
  it("(0) LIVE: visible authored evidence is derived from the shipped case and is disjoint from hiddenFacts", () => {
    const facts = deriveAuthoredSourceFacts();
    const chest = chestGuardingRow();

    expect(facts.scenarioId).toBe(edChestPainScenario.scenarioId);
    expect(facts.visibleSources.some((source) => source.sourceId === chest.traceTag)).toBe(true);
    expect(facts.visibleSources.some((source) => source.sourceId === chest.emotionEventId)).toBe(true);
    expect(facts.hiddenTokens.length).toBeGreaterThan(0);
    for (const token of facts.hiddenTokens) {
      expect(facts.visibleSources.map((source) => source.sourceId)).not.toContain(token);
    }
    expect(facts.visibleSources.map((source) => source.sourceId)).not.toContain(FABRICATED_APPENDICITIS_REF);
  });

  it("(0b) LIVE KNOWN-GOOD: M5 still admits the honest chest-bound proposal (anti-blanket-refusal)", () => {
    const program = honestProgram();
    const structural = validateMotionProgram(program);
    expect(structural.ok, structural.errors.join(" | ")).toBe(true);
    const admitted = validateLLMScenarioMotionProgram(program, m5Facts());
    expect(admitted.ok, admitted.errors.join(" | ")).toBe(true);
    expect(admitted.errors).toEqual([]);
  });

  it("(0c) SATISFIABILITY: a local oracle flips every refusal clause and still accepts the exact approved source", () => {
    const facts = deriveAuthoredSourceFacts();
    const chest = chestGuardingRow();
    const rlq = rlqRow();
    expect(rlq, "the shipped case authors an RLQ row used as the unbound-constraint foil").toBeDefined();

    expect(oracleBind(honestProgram(), facts).ok, "exact approved touchResponse source must pass").toBe(true);

    const dialogueSeed = edChestPainDialogueSeeds.find((seed) => seed.safetyExpectation === "responds_from_visible_facts");
    expect(dialogueSeed).toBeDefined();
    const dialogueProgram = honestProgram({
      actions: [
        {
          ...(honestProgram()["actions"] as Record<string, unknown>[])[0],
          trigger: { kind: "dialogue", ref: dialogueSeed!.seedId },
        },
      ],
    });
    expect(oracleBind(dialogueProgram, facts).ok, "exact approved dialogue source must pass").toBe(true);

    const missing = honestProgram({
      actions: [
        {
          ...(honestProgram()["actions"] as Record<string, unknown>[])[0],
          trigger: { kind: "clinical_touch" },
        },
      ],
    });
    const missingResult = oracleBind(missing, facts);
    expect(missingResult.ok).toBe(false);
    expect(missingResult.errors.join(" | ")).toMatch(/missing source ref/);

    const fabricated = honestProgram({
      actions: [
        {
          ...(honestProgram()["actions"] as Record<string, unknown>[])[0],
          trigger: { kind: "clinical_touch", ref: FABRICATED_APPENDICITIS_REF },
        },
      ],
    });
    const fabricatedResult = oracleBind(fabricated, facts);
    expect(fabricatedResult.ok).toBe(false);
    expect(fabricatedResult.errors.join(" | ")).toContain(FABRICATED_APPENDICITIS_REF);

    const hiddenToken = facts.hiddenTokens[0]!;
    const hidden = honestProgram({
      actions: [
        {
          ...(honestProgram()["actions"] as Record<string, unknown>[])[0],
          trigger: { kind: "clinical_touch", ref: hiddenToken },
        },
      ],
    });
    const hiddenResult = oracleBind(hidden, facts);
    expect(hiddenResult.ok).toBe(false);
    expect(hiddenResult.errors.join(" | ")).toContain(hiddenToken);

    const rlqMotion = motionBodyRegionForComplianceRegion(rlq!.region);
    const unboundConstraint = honestProgram({
      actions: [
        {
          ...(honestProgram()["actions"] as Record<string, unknown>[])[0],
          constraints: [contactConstraint(rlqMotion)],
        },
      ],
    });
    const constraintResult = oracleBind(unboundConstraint, facts);
    expect(constraintResult.ok).toBe(false);
    expect(constraintResult.errors.join(" | ")).toMatch(/constraint/);

    const inventedClutch = honestProgram({
      actions: [
        {
          ...(honestProgram()["actions"] as Record<string, unknown>[])[0],
          primitiveId: "clutch_body_region",
        },
      ],
    });
    const clutchResult = oracleBind(inventedClutch, facts);
    expect(clutchResult.ok).toBe(false);
    expect(clutchResult.errors.join(" | ")).toMatch(/clutch_body_region/);

    expect(chest.responseKind).toBe("guarding");
  });

  it.fails("(1) RED: the product binder refuses a missing action source ref", async () => {
    const bind = await loadProductBinder();
    const facts = deriveAuthoredSourceFacts();
    const program = honestProgram({
      actions: [
        {
          ...(honestProgram()["actions"] as Record<string, unknown>[])[0],
          trigger: { kind: "clinical_touch" },
        },
      ],
    });
    expect(validateLLMScenarioMotionProgram(program, m5Facts()).ok, "M5 still admits a missing ref").toBe(true);
    const result = bind(program, facts);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" | ")).toMatch(/missing source ref|trigger\.ref/);
  });

  it.fails("(2) RED: the product binder refuses a fabricated appendicitis source ref", async () => {
    const bind = await loadProductBinder();
    const facts = deriveAuthoredSourceFacts();
    const program = honestProgram({
      actions: [
        {
          ...(honestProgram()["actions"] as Record<string, unknown>[])[0],
          trigger: { kind: "clinical_touch", ref: FABRICATED_APPENDICITIS_REF },
        },
      ],
    });
    expect(validateLLMScenarioMotionProgram(program, m5Facts()).ok, "M5 still admits a fabricated ref").toBe(true);
    const result = bind(program, facts);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" | ")).toContain(FABRICATED_APPENDICITIS_REF);
  });

  it.fails("(3) RED: hidden diagnosis cannot authorize clutch/guard — hiddenFact as trigger.ref is refused", async () => {
    const bind = await loadProductBinder();
    const facts = deriveAuthoredSourceFacts();
    const hiddenToken = facts.hiddenTokens[0]!;
    const program = honestProgram({
      actions: [
        {
          ...(honestProgram()["actions"] as Record<string, unknown>[])[0],
          trigger: { kind: "clinical_touch", ref: hiddenToken },
        },
      ],
    });
    expect(validateLLMScenarioMotionProgram(program, m5Facts()).ok, "M5 still admits a hiddenFact ref").toBe(true);
    const result = bind(program, facts);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" | ")).toContain(hiddenToken);
  });

  it.fails("(4) RED: a constraint whose body_region target is not the bound authored source is refused", async () => {
    const bind = await loadProductBinder();
    const facts = deriveAuthoredSourceFacts();
    const rlq = rlqRow();
    expect(rlq).toBeDefined();
    const rlqMotion = motionBodyRegionForComplianceRegion(rlq!.region);
    const program = honestProgram({
      actions: [
        {
          ...(honestProgram()["actions"] as Record<string, unknown>[])[0],
          constraints: [contactConstraint(rlqMotion)],
        },
      ],
    });
    expect(validateLLMScenarioMotionProgram(program, m5Facts()).ok, "M5 admits any authored region on a constraint").toBe(
      true,
    );
    const result = bind(program, facts);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" | ")).toMatch(/constraint/);
    expect(result.errors.join(" | ")).toContain(rlqMotion);
  });

  it.fails("(5) RED: clutch_body_region is refused when the bound visible source authored guarding only", async () => {
    const bind = await loadProductBinder();
    const facts = deriveAuthoredSourceFacts();
    const program = honestProgram({
      actions: [
        {
          ...(honestProgram()["actions"] as Record<string, unknown>[])[0],
          primitiveId: "clutch_body_region",
        },
      ],
    });
    expect(validateLLMScenarioMotionProgram(program, m5Facts()).ok, "M5 does not bind primitive to the source row").toBe(
      true,
    );
    const result = bind(program, facts);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" | ")).toMatch(/clutch_body_region/);
  });

  it.fails("(6) RED: the exact approved touchResponse source is admitted by the product binder (anti-blanket-refusal)", async () => {
    const bind = await loadProductBinder();
    const facts = deriveAuthoredSourceFacts();
    const program = honestProgram();
    const result = bind(program, facts);
    expect(result.ok, result.errors.join(" | ")).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

// NOT TESTED: the product implementation in src/program (this card authors the RED only);
// whether a genuine review step may mint additional source kinds; clinical sense of the
// chest_L -> motion_guard_chest_l mapping; Quest/runtime evidence that a bound action is visible.
