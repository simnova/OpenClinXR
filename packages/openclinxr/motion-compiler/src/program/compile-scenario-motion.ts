/**
 * compileScenarioMotion — the deterministic translation of authored touch
 * responses into a validated MotionProgram v1. (M1 deliverable.)
 *
 * This is the D9 "dark factory" step: authored case data in, semantic motion
 * plan out, no LLM anywhere in the path. Each arrow is a closed, documented
 * mapping:
 *
 *   TouchResponse.responseKind = guarding       -> primitiveId guard_body_region
 *   TouchResponse.responseKind = palpation      -> primitiveId reach_target
 *   TouchResponse.responseKind = passive_rom    -> primitiveId brace
 *   TouchResponse.responseKind = positioning    -> primitiveId posture_shift
 *   TouchResponse.region (ComplianceRegion)     -> target.id via
 *     motionBodyRegionForComplianceRegion       (the explicit vocabulary boundary)
 *   TouchResponse.emotionEventId                -> trigger.ref
 *   TouchResponse.traceTag                      -> actionId
 *   TouchResponse.forceThreshold                -> intensity + duration
 *   placement.supportSurface = chair            -> baseline.posture seated
 *   placement.supportSurface = stretcher        -> baseline.posture supine
 *   placement.supportSurface = none / absent    -> baseline.posture standing
 *
 * The responseKind->primitive mapping is a product decision written down, in
 * the same spirit as the compliance->motion mapping: guarding withdraws toward
 * the touched site; palpation reaches protectively; passive_rom is met with a
 * stiffening brace; positioning draws a posture shift. All four primitives are
 * members of the brief's primitive vocabulary.
 */

import { createHash } from "node:crypto";

import { motionBodyRegionForComplianceRegion } from "../motion-body-region.js";
import { MOTION_PROGRAM_SCHEMA_VERSION, MOTION_PLAN_CLAIM_BOUNDARY, type MotionAction, type MotionEffector, type MotionProgram, type MotionTargetKind } from "../motion-program.js";

/**
 * The authored row shape this compiler consumes. Mirrors the SHIPPED
 * TouchResponseSchema (shared-schemas/src/schemas.ts) field-for-field; the M1
 * plant reads the real fixture row at runtime, so this structural type cannot
 * drift away from what the factory actually authors.
 */
export type AuthoredTouchResponse = {
  region: string;
  responseKind: string;
  forceThreshold: number;
  emotionEventId: string;
  emotion: string;
  responseClip: string;
  dialogueLine: string;
  traceTag: string;
};

export type ScenarioMotionCompileInput = {
  scenarioId: string;
  actorId: string;
  touchResponses: readonly AuthoredTouchResponse[];
  placement?: { supportSurface?: string };
};

/** Closed responseKind -> primitive mapping. */
export const RESPONSE_KIND_TO_PRIMITIVE: Readonly<Record<string, string>> = {
  guarding: "guard_body_region",
  palpation: "reach_target",
  passive_rom: "brace",
  positioning: "posture_shift",
};

export const RESPONSE_KIND_TO_BASE_DURATION_MS: Readonly<Record<string, number>> = {
  guarding: 800,
  palpation: 700,
  passive_rom: 1100,
  positioning: 1400,
};

/**
 * Which hand guards which site, keyed on the CLINICAL laterality the authored
 * region encodes: right-side sites draw the right hand, left-side sites the
 * left hand, midline sites the right hand by convention (the patient's
 * protective hand). Deterministic, closed, and stated — not per-target tables.
 */
export function effectorForComplianceRegion(region: string): MotionEffector {
  if (/_(ruq|rlq|R)$/.test(region)) return "handR";
  if (/_(luq|llq|L)$/.test(region)) return "handL";
  return "handR";
}

/**
 * Support surface -> baseline posture (brief §4, verbatim mappings). An
 * unsupported or un-authored actor stands. Unknown surfaces are REFUSED rather
 * than guessed, so a placement the factory does not understand fails loudly.
 */
export function postureForSupportSurface(supportSurface: string | undefined): string {
  if (supportSurface === undefined || supportSurface === "none") return "standing";
  if (supportSurface === "chair") return "seated";
  if (supportSurface === "stretcher") return "supine";
  throw new Error(
    `compileScenarioMotion: unknown supportSurface "${supportSurface}" — the planner only knows chair | stretcher | none`,
  );
}

/** Brief §13: the seed is DERIVED from stable inputs, never a caller-chosen integer. */
export function deriveDeterministicSeed(input: ScenarioMotionCompileInput, posture: string): string {
  const rows = input.touchResponses
    .map((row) => `${row.region}|${row.responseKind}|${row.emotionEventId}|${row.forceThreshold}`)
    .join(",");
  const material = [
    MOTION_PROGRAM_SCHEMA_VERSION,
    input.scenarioId,
    input.actorId,
    posture,
    input.placement?.supportSurface ?? "none",
    rows,
  ].join("::");
  return createHash("sha256").update(material).digest("hex");
}

function actionForTouchResponse(row: AuthoredTouchResponse, index: number): MotionAction {
  const primitiveId = RESPONSE_KIND_TO_PRIMITIVE[row.responseKind];
  if (primitiveId === undefined) {
    throw new Error(
      `compileScenarioMotion: touchResponses[${index}] has responseKind "${row.responseKind}" with no primitive mapping — ` +
        `the compiler is closed over ${Object.keys(RESPONSE_KIND_TO_PRIMITIVE).join(", ")}`,
    );
  }
  const baseDuration = RESPONSE_KIND_TO_BASE_DURATION_MS[row.responseKind] ?? 800;
  const force = typeof row.forceThreshold === "number" && Number.isFinite(row.forceThreshold) ? row.forceThreshold : 0;
  // A firmer touch draws a stronger, slightly longer withdrawal.
  const intensity = Math.max(0.1, Math.min(1, force + 0.5));
  const durationMs = baseDuration + Math.round(force * 500);

  const targetKind: MotionTargetKind = "body_region";
  return {
    actionId: `action_${row.traceTag}`,
    primitiveId,
    trigger: { kind: "touch_response", ref: row.emotionEventId },
    timing: { startMs: 0, durationMs, attackFraction: 0.2, holdFraction: 0.6, releaseFraction: 0.2 },
    intensity,
    target: { kind: targetKind, id: motionBodyRegionForComplianceRegion(row.region) },
    effector: effectorForComplianceRegion(row.region),
    // The IR carries the closed constraint union now; the contact SOLVER is a
    // later card, so the deterministic planner emits no constraints it cannot
    // honour yet.
    constraints: [],
  };
}

/**
 * Compile authored scenario data into a MotionProgram v1. Pure function of its
 * input: the same input yields the byte-identical program, seed included.
 */
export function compileScenarioMotion(input: ScenarioMotionCompileInput): MotionProgram {
  const posture = postureForSupportSurface(input.placement?.supportSurface);
  const actions = input.touchResponses.map(actionForTouchResponse);

  return {
    schemaVersion: MOTION_PROGRAM_SCHEMA_VERSION,
    scenarioId: input.scenarioId,
    actorId: input.actorId,
    provenance: {
      sourceKind: "deterministic_case_compiler",
      sourceRefs: [input.scenarioId],
    },
    baseline: {
      posture,
      ...(input.placement?.supportSurface !== undefined ? { supportSurface: input.placement.supportSurface } : {}),
    },
    actions,
    deterministicSeed: deriveDeterministicSeed(input, posture),
    claimBoundary: MOTION_PLAN_CLAIM_BOUNDARY,
    notEvidenceFor: [
      "clinical_validity",
      "scoring_validity",
      "production_asset_readiness",
      "quest_readiness",
    ],
  };
}
