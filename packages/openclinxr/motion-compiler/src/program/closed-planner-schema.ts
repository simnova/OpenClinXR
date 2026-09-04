/**
 * Closed case-bounded planner proposal schema. (M5 residual: nested objects
 * and allowed string slots.)
 *
 * `validateMotionProgram` already closes program/action/timing/trigger keys.
 * Nested targets, baseline modifiers, constraint targets, and string slots
 * (primitiveId, trigger.ref, ids) still admitted physical carriers: tracks,
 * rotations, embedded clips, base64, paths, URLs, code, unknown properties.
 *
 * This schema is additionalProperties:false on every closed object plus
 * value-kind refusals for paths/URLs/data-URIs/code. It does not match a
 * substring of any one track spelling.
 *
 * claimScope: a case-bounded llm_proposal carrying a physical payload is
 *   refused with the offending token named; the unmutated M5 proposal remains
 *   admitted.
 * notEvidenceFor: clinical_validity, scoring_validity, production_asset_readiness,
 *   quest_readiness, animation quality, or that any admitted program produces
 *   visible motion.
 */

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
const TARGET_KEYS = ["kind", "id", "position"] as const;
const TRIGGER_KEYS = ["kind", "ref"] as const;
const TIMING_KEYS = ["startMs", "durationMs", "attackFraction", "holdFraction", "releaseFraction"] as const;
const PROVENANCE_KEYS = ["sourceKind", "sourceRefs", "planner"] as const;
const PLANNER_KEYS = ["provider", "model", "modelVersion", "promptVersion", "seed"] as const;
const BASELINE_KEYS = ["posture", "supportSurface", "affect", "breathing", "gaze"] as const;
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
const POSITION_KEYS = ["x", "y", "z"] as const;
const BASELINE_TOKEN_KEYS = ["posture", "supportSurface", "affect", "breathing", "gaze"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

function physicalStringReason(value: string): string | undefined {
  if (/^(?:\/|\.\/|\.\.\/|file:|[A-Za-z]:\\)/.test(value) || value.includes("\\")) return "file path";
  if (/^https?:/i.test(value)) return "URL";
  if (/^data:/i.test(value) || /base64,/i.test(value)) return "base64";
  if (/\b(?:import|export|eval)\b/.test(value) || /from\s+['"]/.test(value)) return "code";
  return undefined;
}

function refuseUnknown(where: string, value: Record<string, unknown>, allowed: readonly string[], errors: string[]): void {
  for (const key of unknownKeys(value, allowed)) {
    errors.push(
      `${where}: unknown property "${key}" — the planner schema is closed; physical payloads do not travel on it`,
    );
  }
}

function refusePhysicalString(where: string, value: unknown, errors: string[]): void {
  if (typeof value !== "string") return;
  const reason = physicalStringReason(value);
  if (reason !== undefined) {
    errors.push(`${where}: ${reason} payload ${JSON.stringify(value)} is not a motion-plan token`);
  }
}

function scanTarget(target: Record<string, unknown>, where: string, errors: string[]): void {
  refuseUnknown(where, target, TARGET_KEYS, errors);
  refusePhysicalString(`${where}.id`, target["id"], errors);
  if (isPlainObject(target["position"])) {
    refuseUnknown(`${where}.position`, target["position"], POSITION_KEYS, errors);
  }
}

/**
 * Closed planner-proposal schema. Call after the IR structural gate so a
 * program that already fails as IR is refused for that reason first.
 */
export function validateClosedPlannerProposalSchema(program: unknown): MotionValidation {
  const errors: string[] = [];
  if (!isPlainObject(program)) return { ok: false, errors: ["program is not an object"] };
  refuseUnknown("program", program, PROGRAM_KEYS, errors);
  refusePhysicalString("scenarioId", program["scenarioId"], errors);
  refusePhysicalString("actorId", program["actorId"], errors);

  const provenance = program["provenance"];
  if (isPlainObject(provenance)) {
    refuseUnknown("provenance", provenance, PROVENANCE_KEYS, errors);
    if (Array.isArray(provenance["sourceRefs"])) {
      provenance["sourceRefs"].forEach((ref, index) =>
        refusePhysicalString(`provenance.sourceRefs[${index}]`, ref, errors),
      );
    }
    const planner = provenance["planner"];
    if (isPlainObject(planner)) {
      refuseUnknown("provenance.planner", planner, PLANNER_KEYS, errors);
    }
  }

  const baseline = program["baseline"];
  if (isPlainObject(baseline)) {
    refuseUnknown("baseline", baseline, BASELINE_KEYS, errors);
    for (const key of BASELINE_TOKEN_KEYS) {
      const value = baseline[key];
      if (isPlainObject(value)) {
        errors.push(
          `baseline.${key}: object payloads are refused — a baseline modifier is a token, not a physical carrier`,
        );
      } else {
        refusePhysicalString(`baseline.${key}`, value, errors);
      }
    }
  }

  const actions = program["actions"];
  if (Array.isArray(actions)) {
    actions.forEach((raw, index) => {
      if (!isPlainObject(raw)) return;
      const at = `action ${index}`;
      refuseUnknown(at, raw, ACTION_KEYS, errors);
      refusePhysicalString(`${at}.actionId`, raw["actionId"], errors);
      refusePhysicalString(`${at}.primitiveId`, raw["primitiveId"], errors);
      const trigger = raw["trigger"];
      if (isPlainObject(trigger)) {
        refuseUnknown(`${at}.trigger`, trigger, TRIGGER_KEYS, errors);
        refusePhysicalString(`${at}.trigger.kind`, trigger["kind"], errors);
        refusePhysicalString(`${at}.trigger.ref`, trigger["ref"], errors);
      }
      const timing = raw["timing"];
      if (isPlainObject(timing)) refuseUnknown(`${at}.timing`, timing, TIMING_KEYS, errors);
      if (isPlainObject(raw["target"])) scanTarget(raw["target"], `${at}.target`, errors);
      const constraints = raw["constraints"];
      if (Array.isArray(constraints)) {
        constraints.forEach((constraint, constraintIndex) => {
          if (!isPlainObject(constraint)) return;
          const atConstraint = `${at} constraint ${constraintIndex}`;
          refuseUnknown(atConstraint, constraint, CONTACT_KEYS, errors);
          if (isPlainObject(constraint["target"])) {
            scanTarget(constraint["target"], `${atConstraint}.target`, errors);
          }
        });
      }
    });
  }

  const notEvidenceFor = program["notEvidenceFor"];
  if (Array.isArray(notEvidenceFor)) {
    notEvidenceFor.forEach((item, index) => refusePhysicalString(`notEvidenceFor[${index}]`, item, errors));
  }

  return { ok: errors.length === 0, errors };
}
