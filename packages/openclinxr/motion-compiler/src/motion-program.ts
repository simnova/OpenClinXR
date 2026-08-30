/**
 * MotionProgram v1 — the closed SEMANTIC motion IR. (M1 deliverable.)
 *
 * The reproducibility boundary between semantic planning and physical motion
 * generation. The planner answers "what should this actor do"; the compiler
 * (later cards) answers "how does this specific skeleton physically do it".
 *
 * THE IR CARRIES NO RAW SKELETON OUTPUT. There are no bone names, no
 * quaternion tracks, no bind-frame values, no SkeletonProfile ownership on this
 * side of the boundary. A program is declarative, case-bounded intent; a later
 * stage retargets it onto a SkeletonProfile (M1b). The validator below is what
 * makes "closed" mean something: unknown fields that could smuggle raw tracks
 * or self-attested verdicts are REFUSED, not ignored.
 *
 * WHERE THE CLOSED SETS LIVE, AND WHERE THEY DELIBERATELY DO NOT:
 *
 *   - effector, target.kind, the constraint union, the compliance→motion
 *     vocabulary, provenance.sourceKind, schemaVersion, claimBoundary: closed
 *     here, and enforced by `validateMotionProgram`.
 *   - primitiveId, trigger.kind, baseline.posture and the baseline modifiers:
 *     OPEN here, on purpose. The M1 plant's own structural types declare them
 *     `string`/open, and the sibling M5 plant authors legitimate programs with
 *     posture "seated_upright" and trigger.kind "clinical_touch" — values
 *     outside the brief's suggested unions. The plants close what must be
 *     closed and leave the rest for the cards that own those vocabularies
 *     (the primitive registry, the posture/trigger enums). Closing them here
 *     would red the sibling plant for a reason unrelated to its defect.
 */

import { isMotionBodyRegion, MOTION_BODY_REGIONS } from "./motion-body-region.js";

export const MOTION_PROGRAM_SCHEMA_VERSION = "openclinxr.motion-program.v1";
export const MOTION_PLAN_CLAIM_BOUNDARY = "motion_plan_not_animation_or_clinical_validity_evidence";

/** Closed action effectors, per the M1 plant. */
export const MOTION_ACTION_EFFECTORS = ["handL", "handR", "head", "pelvis"] as const;
export type MotionEffector = (typeof MOTION_ACTION_EFFECTORS)[number];

/** Closed target kinds, per the M1 plant. */
export const MOTION_TARGET_KINDS = ["body_region", "actor", "clinical_object", "world_position"] as const;
export type MotionTargetKind = (typeof MOTION_TARGET_KINDS)[number];

/**
 * Provenance source kinds. `reviewed_llm_proposal` is NOT mintable by any
 * sanctioned step yet: no review step exists, so a program that self-declares
 * it has erased the reviewer. The validator refuses it.
 */
export const MOTION_PROVENANCE_SOURCE_KINDS = [
  "authored_case",
  "deterministic_case_compiler",
  "llm_proposal",
] as const;
export type MotionProvenanceSourceKind = (typeof MOTION_PROVENANCE_SOURCE_KINDS)[number];

export type MotionActionTarget =
  | { kind: "body_region"; id: string }
  | { kind: "actor"; id: string }
  | { kind: "clinical_object"; id: string }
  | { kind: "world_position"; position: { x: number; y: number; z: number } };

/**
 * ContactConstraint, brief §14 verbatim shape. Contacts DEFINE guard/clutch/
 * reach — they are not a later validator. The IR carries the type now (the
 * contact SOLVER is a later card); the deterministic planner emits an empty
 * constraints array until a solver exists to honour them.
 */
export type ContactConstraint = {
  kind: "contact";
  effector: string;
  target: MotionActionTarget;
  positionToleranceMeters: number;
  orientationToleranceRadians?: number;
  startFraction: number;
  endFraction: number;
  penetrationToleranceMeters?: number;
  preserveWhileActive: boolean;
};

/**
 * The CLOSED constraint union. ContactConstraint is the only member the first
 * milestone needs; a closed union is what stops a worker adding a sixth kind
 * silently. Extending it is a deliberate edit.
 */
export type MotionConstraint = ContactConstraint;

export type MotionTrigger = { kind: string; ref?: string };

export type MotionTiming = {
  startMs?: number;
  durationMs: number;
  attackFraction?: number;
  holdFraction?: number;
  releaseFraction?: number;
};

export type MotionAction = {
  actionId: string;
  primitiveId: string;
  trigger: MotionTrigger;
  timing: MotionTiming;
  intensity: number;
  target: MotionActionTarget;
  effector: MotionEffector;
  constraints: MotionConstraint[];
};

export type MotionBaseline = {
  posture: string;
  supportSurface?: string;
  affect?: unknown;
  breathing?: unknown;
  gaze?: unknown;
};

export type MotionProgram = {
  schemaVersion: typeof MOTION_PROGRAM_SCHEMA_VERSION;
  scenarioId: string;
  actorId: string;
  provenance: {
    sourceKind: MotionProvenanceSourceKind;
    sourceRefs: string[];
    planner?: { provider: string; model: string; modelVersion?: string; promptVersion: string; seed?: number };
  };
  baseline: MotionBaseline;
  actions: MotionAction[];
  /** Derived from stable inputs (brief §13), never a caller-chosen integer. */
  deterministicSeed: string | number;
  claimBoundary: typeof MOTION_PLAN_CLAIM_BOUNDARY;
  notEvidenceFor: string[];
};

export type MotionValidation = { ok: boolean; errors: string[] };

const PROGRAM_KEYS = [
  "schemaVersion",
  "scenarioId",
  "actorId",
  "provenance",
  "baseline",
  "actions",
  "deterministicSeed",
  "claimBoundary",
  "notEvidenceFor",
] as const;

const BASELINE_KEYS = ["posture", "supportSurface", "affect", "breathing", "gaze"] as const;

const ACTION_KEYS = [
  "actionId",
  "primitiveId",
  "trigger",
  "timing",
  "intensity",
  "target",
  "effector",
  "constraints",
] as const;

const TRIGGER_KEYS = ["kind", "ref"] as const;
const TIMING_KEYS = ["startMs", "durationMs", "attackFraction", "holdFraction", "releaseFraction"] as const;
const PROVENANCE_KEYS = ["sourceKind", "sourceRefs", "planner"] as const;
const CONTACT_KEYS = [
  "kind",
  "effector",
  "target",
  "positionToleranceMeters",
  "orientationToleranceRadians",
  "startFraction",
  "endFraction",
  "penetrationToleranceMeters",
  "preserveWhileActive",
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function unknownFields(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(value).filter((key) => !(allowed as readonly string[]).includes(key));
}

/**
 * Validate a MotionProgram structurally against the closed IR.
 *
 * Collects ALL violations (not fail-fast) so the caller sees the full shape of
 * what is wrong. Refusals that matter for the planted contracts:
 *
 *   - raw compliance values / undeclared regions as body_region targets (M1 (2))
 *   - undeclared regions as targets (M5 (2))
 *   - raw bone tracks or any other unknown field on the program or an action
 *     (M5 (1)) — a closed IR refuses what it does not declare
 *   - self-declared `reviewed_llm_proposal` provenance (M5 (3))
 *
 * Deliberately OPEN (see header): primitiveId, trigger.kind, baseline.posture
 * and the baseline modifiers. The plants' structural types declare those open.
 */
export function validateMotionProgram(program: unknown): MotionValidation {
  const errors: string[] = [];

  if (!isPlainObject(program)) {
    return { ok: false, errors: ["program is not an object"] };
  }

  for (const key of unknownFields(program, PROGRAM_KEYS)) {
    errors.push(`unknown program field "${key}" — the IR is closed; raw tracks and verdicts do not travel on it`);
  }

  if (program["schemaVersion"] !== MOTION_PROGRAM_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be "${MOTION_PROGRAM_SCHEMA_VERSION}", got ${JSON.stringify(program["schemaVersion"])}`);
  }
  if (!isNonEmptyString(program["scenarioId"])) errors.push("scenarioId must be a non-empty string");
  if (!isNonEmptyString(program["actorId"])) errors.push("actorId must be a non-empty string");

  const provenance = program["provenance"];
  if (!isPlainObject(provenance)) {
    errors.push("provenance must be an object");
  } else {
    for (const key of unknownFields(provenance, PROVENANCE_KEYS)) {
      errors.push(`unknown provenance field "${key}"`);
    }
    const sourceKind = provenance["sourceKind"];
    if (sourceKind === "reviewed_llm_proposal") {
      errors.push(
        'provenance.sourceKind "reviewed_llm_proposal" is not mintable by any sanctioned step — only a distinct review step may mint it, and none exists',
      );
    } else if (!(MOTION_PROVENANCE_SOURCE_KINDS as readonly string[]).includes(sourceKind as string)) {
      errors.push(`provenance.sourceKind must be one of ${MOTION_PROVENANCE_SOURCE_KINDS.join(", ")}, got ${JSON.stringify(sourceKind)}`);
    }
    const sourceRefs = provenance["sourceRefs"];
    if (!Array.isArray(sourceRefs) || sourceRefs.length === 0 || !sourceRefs.every(isNonEmptyString)) {
      errors.push("provenance.sourceRefs must be a non-empty array of non-empty strings");
    }
    if (provenance["planner"] !== undefined && !isPlainObject(provenance["planner"])) {
      errors.push("provenance.planner must be an object when present");
    }
  }

  const baseline = program["baseline"];
  if (!isPlainObject(baseline)) {
    errors.push("baseline must be an object");
  } else {
    for (const key of unknownFields(baseline, BASELINE_KEYS)) {
      errors.push(`unknown baseline field "${key}"`);
    }
    if (!isNonEmptyString(baseline["posture"])) errors.push("baseline.posture must be a non-empty string");
    if (baseline["supportSurface"] !== undefined && typeof baseline["supportSurface"] !== "string") {
      errors.push("baseline.supportSurface must be a string when present");
    }
    // affect/breathing/gaze are deliberately loosely typed: the brief's shape is
    // an object, the M5 plant authors strings, and no plant closes them.
    for (const key of ["affect", "breathing", "gaze"] as const) {
      const value = baseline[key];
      if (value !== undefined && typeof value !== "string" && !isPlainObject(value)) {
        errors.push(`baseline.${key} must be a string or object when present`);
      }
    }
  }

  const actions = program["actions"];
  if (!Array.isArray(actions)) {
    errors.push("actions must be an array");
  } else if (actions.length === 0) {
    errors.push("actions must not be empty — a motion plan with zero actions is not a plan");
  } else {
    actions.forEach((rawAction, index) => {
      const at = `action ${index}`;
      if (!isPlainObject(rawAction)) {
        errors.push(`${at}: not an object`);
        return;
      }
      for (const key of unknownFields(rawAction, ACTION_KEYS)) {
        errors.push(`${at}: unknown action field "${key}" — the IR is closed; raw bone tracks do not travel on a motion plan`);
      }
      if (!isNonEmptyString(rawAction["actionId"])) errors.push(`${at}: actionId must be a non-empty string`);
      if (!isNonEmptyString(rawAction["primitiveId"])) errors.push(`${at}: primitiveId must be a non-empty string`);

      const trigger = rawAction["trigger"];
      if (!isPlainObject(trigger)) {
        errors.push(`${at}: trigger must be an object`);
      } else {
        for (const key of unknownFields(trigger, TRIGGER_KEYS)) errors.push(`${at}: unknown trigger field "${key}"`);
        if (!isNonEmptyString(trigger["kind"])) errors.push(`${at}: trigger.kind must be a non-empty string`);
        if (trigger["ref"] !== undefined && !isNonEmptyString(trigger["ref"])) {
          errors.push(`${at}: trigger.ref must be a non-empty string when present`);
        }
      }

      const timing = rawAction["timing"];
      if (!isPlainObject(timing)) {
        errors.push(`${at}: timing must be an object`);
      } else {
        for (const key of unknownFields(timing, TIMING_KEYS)) errors.push(`${at}: unknown timing field "${key}"`);
        const durationMs = timing["durationMs"];
        if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs <= 0) {
          errors.push(`${at}: timing.durationMs must be a positive finite number`);
        }
        if (timing["startMs"] !== undefined && (typeof timing["startMs"] !== "number" || timing["startMs"] < 0)) {
          errors.push(`${at}: timing.startMs must be a non-negative number when present`);
        }
        for (const fraction of ["attackFraction", "holdFraction", "releaseFraction"] as const) {
          const value = timing[fraction];
          if (value !== undefined && (typeof value !== "number" || value < 0 || value > 1)) {
            errors.push(`${at}: timing.${fraction} must be a number in [0, 1] when present`);
          }
        }
      }

      const intensity = rawAction["intensity"];
      if (typeof intensity !== "number" || !Number.isFinite(intensity) || intensity < 0 || intensity > 1) {
        errors.push(`${at}: intensity must be a number in [0, 1]`);
      }

      const target = rawAction["target"];
      if (!isPlainObject(target)) {
        errors.push(`${at}: target must be an object`);
      } else {
        validateTarget(target, errors, at);
      }

      const effector = rawAction["effector"];
      if (!(MOTION_ACTION_EFFECTORS as readonly string[]).includes(effector as string)) {
        errors.push(`${at}: effector must be one of ${MOTION_ACTION_EFFECTORS.join(", ")}, got ${JSON.stringify(effector)}`);
      }

      const constraints = rawAction["constraints"];
      if (!Array.isArray(constraints)) {
        errors.push(`${at}: constraints must be an array`);
      } else {
        constraints.forEach((rawConstraint, constraintIndex) => {
          const atConstraint = `${at} constraint ${constraintIndex}`;
          if (!isPlainObject(rawConstraint)) {
            errors.push(`${atConstraint}: not an object`);
            return;
          }
          // CLOSED union: "contact" is the only member the IR declares.
          if (rawConstraint["kind"] !== "contact") {
            errors.push(`${atConstraint}: unknown constraint kind ${JSON.stringify(rawConstraint["kind"])} — the constraint union is closed over "contact"`);
            return;
          }
          for (const key of unknownFields(rawConstraint, CONTACT_KEYS)) {
            errors.push(`${atConstraint}: unknown contact field "${key}"`);
          }
          if (!isNonEmptyString(rawConstraint["effector"])) errors.push(`${atConstraint}: effector must be a non-empty string`);
          if (!isPlainObject(rawConstraint["target"])) {
            errors.push(`${atConstraint}: target must be an object`);
          } else {
            validateTarget(rawConstraint["target"], errors, atConstraint);
          }
          for (const key of ["positionToleranceMeters", "startFraction", "endFraction"] as const) {
            const value = rawConstraint[key];
            if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
              errors.push(`${atConstraint}: ${key} must be a non-negative finite number`);
            }
          }
          if (rawConstraint["preserveWhileActive"] !== undefined && typeof rawConstraint["preserveWhileActive"] !== "boolean") {
            errors.push(`${atConstraint}: preserveWhileActive must be a boolean when present`);
          }
        });
      }
    });
  }

  const seed = program["deterministicSeed"];
  const seedValid =
    (typeof seed === "string" && seed.length > 0) || (typeof seed === "number" && Number.isFinite(seed));
  if (!seedValid) errors.push("deterministicSeed must be a non-empty string or a finite number");

  if (program["claimBoundary"] !== MOTION_PLAN_CLAIM_BOUNDARY) {
    errors.push(`claimBoundary must be "${MOTION_PLAN_CLAIM_BOUNDARY}"`);
  }

  const notEvidenceFor = program["notEvidenceFor"];
  if (!Array.isArray(notEvidenceFor) || notEvidenceFor.length === 0 || !notEvidenceFor.every(isNonEmptyString)) {
    errors.push("notEvidenceFor must be a non-empty array of non-empty strings");
  }

  return { ok: errors.length === 0, errors };
}

function validateTarget(target: Record<string, unknown>, errors: string[], at: string): void {
  const kind = target["kind"];
  if (!(MOTION_TARGET_KINDS as readonly string[]).includes(kind as string)) {
    errors.push(`${at}: target.kind must be one of ${MOTION_TARGET_KINDS.join(", ")}, got ${JSON.stringify(kind)}`);
    return;
  }
  if (kind === "body_region") {
    const id = target["id"];
    if (!isNonEmptyString(id)) {
      errors.push(`${at}: a body_region target needs a non-empty id`);
    } else if (!isMotionBodyRegion(id)) {
      errors.push(
        `${at}: target id "${id}" is not a declared MotionBodyRegion — raw ComplianceRegion values and invented regions are both refused here`,
      );
    }
    return;
  }
  if (kind === "world_position") {
    const position = target["position"];
    if (!isPlainObject(position)) {
      errors.push(`${at}: a world_position target needs a position {x, y, z}`);
    } else {
      for (const axis of ["x", "y", "z"] as const) {
        const value = position[axis];
        if (typeof value !== "number" || !Number.isFinite(value)) {
          errors.push(`${at}: world_position.${axis} must be a finite number`);
        }
      }
    }
    return;
  }
  // actor / clinical_object
  if (!isNonEmptyString(target["id"])) errors.push(`${at}: a ${kind} target needs a non-empty id`);
}
