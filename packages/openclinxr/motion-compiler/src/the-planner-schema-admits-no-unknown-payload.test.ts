import { describe, expect, it } from "vitest";

import { edChestPainScenario } from "../../scenario-fixtures/src/ed-chest-pain.js";
import { motionBodyRegionForComplianceRegion } from "./motion-body-region.js";
import {
  canonicalMotionProgramHash,
  MOTION_COMPILER_VERSION,
  PRIMITIVE_LIBRARY_VERSION,
} from "./program/compile-scenario-motion.js";
import { validateLLMScenarioMotionProgram } from "./program/llm-scenario-motion-planner.js";
import { deriveDeterministicVariationSeed } from "./trajectory/deterministic-variation.js";

/**
 * PLANTED RED — BothyBoard tsk_306eadc3d520fc22 (instrument for dormant
 * tsk_edd59d0568ed36e0). IMMUTABLE HEADER.
 *
 * Do not rewrite this block. Flip `it.fails` -> `it` and append a `## FIXED`
 * block BELOW it. Do not edit the measured table or the paths in this header.
 *
 * OBSERVABLE TODAY, measured 2026-09-03 on this tree (HEAD 92b58c8f) through
 * `validateLLMScenarioMotionProgram` against an otherwise-valid M5
 * case-bounded `llm_proposal` for `ed_chest_pain_priority_v1`. One mutation
 * at a time. Top-level unknown keys on program/action/timing/trigger are
 * already refused by the closed-IR key lists. Nested objects and allowed
 * string slots are not:
 *
 *   | mutation                                         | admitted? |
 *   |--------------------------------------------------|-----------|
 *   | honest M5 proposal (no mutation)                 | yes       |
 *   | action.boneTracks / eulerTracks / clip / tracks  | no        |
 *   | program.skeleton                                 | no        |
 *   | timing.bakedClip / trigger.code                  | no        |
 *   | target.boneTracks                                | yes       |
 *   | target.eulerTracks                               | yes       |
 *   | target.embeddedClip                              | yes       |
 *   | target.payloadB64 / target.rotation / target.href| yes       |
 *   | trigger.ref = /tmp/clip.glb                      | yes       |
 *   | trigger.ref = https://…                          | yes       |
 *   | trigger.ref = data:…base64,…                     | yes       |
 *   | primitiveId = import/eval code                   | yes       |
 *   | baseline.affect = { eulerTracks }                | yes       |
 *   | provenance.planner.boneTracks                    | yes       |
 *   | constraint.target.quaternionTrack                | yes       |
 *
 * THE DEFECT. M5 clause (1) pins one spelling (`boneTracks` on an action).
 * A closed structured schema refuses the CLASS: raw tracks, rotations,
 * embedded clips, base64 blobs, file paths, URLs, code, and unknown
 * properties, at every nesting, under every name. A substring blacklist of
 * `boneTracks` is the cheap evasion this plant is built to refuse — it
 * would flip clause (1) and leave (2)-(8) admitted.
 *
 * THE INPUT IS THE LANDED M5 HONEST PROPOSAL. Clause (0) reads it through
 * the same fixture + mapper + five-input seed as
 * `the-llm-planner-cannot-emit-bone-tracks.test.ts`. Each RED mutates
 * exactly one physical payload so a refusal cannot be a confound.
 *
 * SATISFIABILITY lives in this file as `honestClosedPlannerSchema`. It is
 * the test-local oracle, not product code. It accepts the honest proposal
 * and refuses every mutation below. The product slice flips the `it.fails`
 * clauses by moving that closed schema into `src/program`; it must not
 * copy a `/boneTracks/i` blacklist.
 *
 * claimScope: that a case-bounded llm_proposal carrying a physical payload
 *   (tracks, rotation, embedded clip, base64, code, file path, URL, or an
 *   unknown property) is refused with the offending token named, and that
 *   the unmutated M5 proposal remains admitted.
 * notEvidenceFor: clinical_validity, scoring_validity, production_asset_readiness,
 *   quest_readiness, animation quality, or that any admitted program produces
 *   visible motion.
 */

const CLAIM_BOUNDARY = "motion_plan_not_animation_or_clinical_validity_evidence";

const AUTHORED_COMPLIANCE_REGIONS: string[] = (edChestPainScenario.actors ?? []).flatMap(
  (actor) => (actor.bodyMechanics?.touchResponses ?? []).map((touch) => touch.region),
);

const AUTHORED_ACTOR_IDS: string[] = (edChestPainScenario.actors ?? []).map((actor) => actor.actorId);

const M5_FACTS = {
  scenarioId: edChestPainScenario.scenarioId,
  actorIds: AUTHORED_ACTOR_IDS,
  authoredComplianceRegions: AUTHORED_COMPLIANCE_REGIONS,
};

type MotionValidation = { ok: boolean; errors: string[] };

function honestProposal(): Record<string, unknown> {
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
        target: { kind: "body_region", id: motionBodyRegionForComplianceRegion(complianceRegion) },
        effector: "handR",
        constraints: [],
      },
    ],
    claimBoundary: CLAIM_BOUNDARY,
    notEvidenceFor: ["clinical_validity", "animation_quality"],
  };
  const motionProgramHash = canonicalMotionProgramHash(stable as never);
  return {
    ...stable,
    deterministicSeed: deriveDeterministicVariationSeed({
      motionProgramHash,
      skeletonProfileHash: motionProgramHash,
      compilerVersion: MOTION_COMPILER_VERSION,
      primitiveLibraryVersion: PRIMITIVE_LIBRARY_VERSION,
      variationIndex: 0,
    }),
  };
}

function cloneProposal(): Record<string, unknown> {
  return structuredClone(honestProposal());
}

function action0(program: Record<string, unknown>): Record<string, unknown> {
  const actions = program["actions"];
  if (!Array.isArray(actions) || actions.length === 0 || typeof actions[0] !== "object" || actions[0] === null) {
    throw new Error("honest proposal lost its action");
  }
  return actions[0] as Record<string, unknown>;
}

function target0(program: Record<string, unknown>): Record<string, unknown> {
  const target = action0(program)["target"];
  if (typeof target !== "object" || target === null) throw new Error("honest proposal lost its target");
  return target as Record<string, unknown>;
}

/** One mutation each. Names are the tokens the future refusal must mention. */
const boneTracksPayload = [{ bone: "upper_arm.L", keyframes: [{ tMs: 0, quat: [0, 0, 0, 1] }] }];
const eulerTracksPayload = [{ bone: "spine.001", keyframes: [{ tMs: 0, euler: [0.13, 0, 0] }] }];

function mutateBoneTracksOnTarget(): Record<string, unknown> {
  const program = cloneProposal();
  target0(program)["boneTracks"] = boneTracksPayload;
  return program;
}

function mutateEulerTracksOnTarget(): Record<string, unknown> {
  const program = cloneProposal();
  target0(program)["eulerTracks"] = eulerTracksPayload;
  return program;
}

function mutateEmbeddedClipOnTarget(): Record<string, unknown> {
  const program = cloneProposal();
  target0(program)["embeddedClip"] = { format: "glb", bytes: "QklOQVJZQ0xJUA==" };
  return program;
}

function mutateBase64TriggerRef(): Record<string, unknown> {
  const program = cloneProposal();
  const trigger = action0(program)["trigger"] as Record<string, unknown>;
  trigger["ref"] = "data:application/octet-stream;base64,QklOQVJZQ0xJUA==";
  return program;
}

function mutateCodePrimitiveId(): Record<string, unknown> {
  const program = cloneProposal();
  action0(program)["primitiveId"] = 'import fs from "node:fs"; fs.readFileSync("/etc/passwd")';
  return program;
}

function mutateFilePathTriggerRef(): Record<string, unknown> {
  const program = cloneProposal();
  const trigger = action0(program)["trigger"] as Record<string, unknown>;
  trigger["ref"] = "/tmp/openclinxr-clip.glb";
  return program;
}

function mutateUrlOnTarget(): Record<string, unknown> {
  const program = cloneProposal();
  target0(program)["href"] = "https://cdn.example/clip.glb";
  return program;
}

function mutateUnknownPropertyOnTarget(): Record<string, unknown> {
  const program = cloneProposal();
  target0(program)["smuggledPayload"] = { bindPose: true };
  return program;
}

function mutateNestedAffectEulerTracks(): Record<string, unknown> {
  const program = cloneProposal();
  const baseline = program["baseline"] as Record<string, unknown>;
  baseline["affect"] = { eulerTracks: eulerTracksPayload };
  return program;
}

function mutateConstraintTargetQuaternion(): Record<string, unknown> {
  const program = cloneProposal();
  const region = target0(program)["id"];
  action0(program)["constraints"] = [
    {
      kind: "contact",
      effector: "handR",
      target: { kind: "body_region", id: region, quaternionTrack: [0, 0.13, 0, 0.99] },
      positionToleranceMeters: 0.01,
      startFraction: 0,
      endFraction: 1,
      preserveWhileActive: true,
    },
  ];
  return program;
}

/**
 * Test-local oracle — the honest future implementation. Not imported by
 * product code. additionalProperties:false at every closed object, plus
 * value-kind refusals for paths/URLs/data-URIs/code. No substring of
 * `boneTracks`.
 */
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
    errors.push(`${where}: unknown property "${key}" — the planner schema is closed; physical payloads do not travel on it`);
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

function honestClosedPlannerSchema(program: unknown): MotionValidation {
  const errors: string[] = [];
  if (!isPlainObject(program)) return { ok: false, errors: ["program is not an object"] };
  refuseUnknown("program", program, PROGRAM_KEYS, errors);
  refusePhysicalString("scenarioId", program["scenarioId"], errors);
  refusePhysicalString("actorId", program["actorId"], errors);

  const provenance = program["provenance"];
  if (isPlainObject(provenance)) {
    refuseUnknown("provenance", provenance, PROVENANCE_KEYS, errors);
    if (Array.isArray(provenance["sourceRefs"])) {
      provenance["sourceRefs"].forEach((ref, index) => refusePhysicalString(`provenance.sourceRefs[${index}]`, ref, errors));
    }
    const planner = provenance["planner"];
    if (isPlainObject(planner)) {
      refuseUnknown("provenance.planner", planner, PLANNER_KEYS, errors);
    }
  }

  const baseline = program["baseline"];
  if (isPlainObject(baseline)) {
    refuseUnknown("baseline", baseline, BASELINE_KEYS, errors);
    for (const key of ["posture", "supportSurface", "affect", "breathing", "gaze"] as const) {
      const value = baseline[key];
      if (isPlainObject(value)) {
        errors.push(`baseline.${key}: object payloads are refused — a baseline modifier is a token, not a physical carrier`);
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
          if (isPlainObject(constraint["target"])) scanTarget(constraint["target"], `${atConstraint}.target`, errors);
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

/** Cheap evasion: refuse only if the serialized program mentions boneTracks. */
function boneTracksSubstringBlacklist(program: unknown): MotionValidation {
  const serialized = JSON.stringify(program);
  if (/boneTracks/i.test(serialized)) {
    return { ok: false, errors: ['substring blacklist hit "boneTracks"'] };
  }
  return { ok: true, errors: [] };
}

function productGate(program: Record<string, unknown>): MotionValidation {
  return validateLLMScenarioMotionProgram(program, M5_FACTS);
}

describe("the planner schema admits no unknown physical payload", () => {
  it("(0) KNOWN-GOOD: the unmutated M5 case-bounded llm_proposal is admitted", () => {
    const proposal = honestProposal();
    const admitted = productGate(proposal);
    expect(admitted.ok, "M5 honest proposal must remain the valid baseline").toBe(true);
    expect(admitted.errors).toEqual([]);
    expect(honestClosedPlannerSchema(proposal).ok, "the satisfiability oracle must accept the same baseline").toBe(
      true,
    );
  });

  it.fails("(1) RED: refuses boneTracks smuggled onto a closed target", () => {
    const mutated = mutateBoneTracksOnTarget();
    const result = productGate(mutated);
    expect(result.ok, "raw tracks on a target are still a physical payload").toBe(false);
    expect(result.errors.join(" | ")).toMatch(/boneTracks/);
  });

  it.fails("(2) RED: refuses eulerTracks — the renamed-track alias boneTracks does not catch", () => {
    const mutated = mutateEulerTracksOnTarget();
    const result = productGate(mutated);
    expect(result.ok, "renaming boneTracks to eulerTracks must not evade the closed schema").toBe(false);
    expect(result.errors.join(" | ")).toMatch(/eulerTracks/);
  });

  it.fails("(3) RED: refuses an embedded clip on a closed target", () => {
    const mutated = mutateEmbeddedClipOnTarget();
    const result = productGate(mutated);
    expect(result.ok, "an embedded clip is a physical payload, not a plan").toBe(false);
    expect(result.errors.join(" | ")).toMatch(/embeddedClip/);
  });

  it.fails("(4) RED: refuses a base64 data-URI in an allowed string slot", () => {
    const mutated = mutateBase64TriggerRef();
    const result = productGate(mutated);
    expect(result.ok, "a data-URI in trigger.ref is a smuggled blob").toBe(false);
    expect(result.errors.join(" | ")).toMatch(/base64|data:|QklOQVJZQ0xJUA==/);
  });

  it.fails("(5) RED: refuses code in an allowed string slot", () => {
    const mutated = mutateCodePrimitiveId();
    const result = productGate(mutated);
    expect(result.ok, "import/eval in primitiveId is not a primitive id").toBe(false);
    expect(result.errors.join(" | ")).toMatch(/import|eval|code|node:fs/);
  });

  it.fails("(6) RED: refuses a file path in an allowed string slot", () => {
    const mutated = mutateFilePathTriggerRef();
    const result = productGate(mutated);
    expect(result.ok, "a filesystem path is not a trigger ref").toBe(false);
    expect(result.errors.join(" | ")).toMatch(/\/tmp\/openclinxr-clip\.glb|file path|path/);
  });

  it.fails("(7) RED: refuses a URL smuggled as an unknown target property", () => {
    const mutated = mutateUrlOnTarget();
    const result = productGate(mutated);
    expect(result.ok, "href on a target is a URL payload the schema does not declare").toBe(false);
    expect(result.errors.join(" | ")).toMatch(/href|https:\/\/cdn\.example\/clip\.glb|URL/);
  });

  it.fails("(8) RED: refuses an unknown property that is not a named track spelling", () => {
    const mutated = mutateUnknownPropertyOnTarget();
    const result = productGate(mutated);
    expect(result.ok, "additionalProperties must be false on a target").toBe(false);
    expect(result.errors.join(" | ")).toMatch(/smuggledPayload/);
  });

  it.fails("(9) RED: refuses aliased eulerTracks nested in an open baseline object", () => {
    const mutated = mutateNestedAffectEulerTracks();
    const result = productGate(mutated);
    expect(result.ok, "an open object slot is not a hole for physical tracks").toBe(false);
    expect(result.errors.join(" | ")).toMatch(/eulerTracks|affect/);
  });

  it.fails("(10) RED: refuses a quaternionTrack alias on a constraint target", () => {
    const mutated = mutateConstraintTargetQuaternion();
    const result = productGate(mutated);
    expect(result.ok, "constraint targets are closed; quaternionTrack is a rotation payload").toBe(false);
    expect(result.errors.join(" | ")).toMatch(/quaternionTrack/);
  });

  it("(11) SATISFIABILITY: the test-local closed schema accepts honest and refuses every mutation", () => {
    expect(honestClosedPlannerSchema(honestProposal()).ok).toBe(true);

    const rows: Array<{ name: string; program: Record<string, unknown>; token: RegExp }> = [
      { name: "boneTracks", program: mutateBoneTracksOnTarget(), token: /boneTracks/ },
      { name: "eulerTracks", program: mutateEulerTracksOnTarget(), token: /eulerTracks/ },
      { name: "embeddedClip", program: mutateEmbeddedClipOnTarget(), token: /embeddedClip/ },
      { name: "base64", program: mutateBase64TriggerRef(), token: /base64|data:/ },
      { name: "code", program: mutateCodePrimitiveId(), token: /import|code|node:fs/ },
      { name: "file path", program: mutateFilePathTriggerRef(), token: /\/tmp\/openclinxr-clip\.glb|file path/ },
      { name: "URL", program: mutateUrlOnTarget(), token: /href|https:\/\/cdn\.example\/clip\.glb|URL/ },
      { name: "unknown property", program: mutateUnknownPropertyOnTarget(), token: /smuggledPayload/ },
      { name: "nested affect", program: mutateNestedAffectEulerTracks(), token: /eulerTracks|affect/ },
      { name: "quaternionTrack", program: mutateConstraintTargetQuaternion(), token: /quaternionTrack/ },
    ];

    for (const row of rows) {
      const verdict = honestClosedPlannerSchema(row.program);
      expect(verdict.ok, `oracle admitted ${row.name} — the future implementation cannot flip that clause`).toBe(false);
      expect(verdict.errors.join(" | "), `oracle must name ${row.name}`).toMatch(row.token);
    }
  });

  it("(12) COUNTERWEIGHT: a boneTracks substring blacklist admits every aliased payload", () => {
    expect(boneTracksSubstringBlacklist(mutateBoneTracksOnTarget()).ok).toBe(false);

    const admittedByBlacklist = [
      mutateEulerTracksOnTarget(),
      mutateEmbeddedClipOnTarget(),
      mutateBase64TriggerRef(),
      mutateCodePrimitiveId(),
      mutateFilePathTriggerRef(),
      mutateUrlOnTarget(),
      mutateUnknownPropertyOnTarget(),
      mutateNestedAffectEulerTracks(),
      mutateConstraintTargetQuaternion(),
    ];
    for (const program of admittedByBlacklist) {
      expect(
        boneTracksSubstringBlacklist(program).ok,
        "a /boneTracks/i blacklist is the cheap evasion; it cannot satisfy (2)-(10)",
      ).toBe(true);
    }
  });
});

// NOT TESTED: the future product implementation in src/program; whether a
// genuine review step may mint reviewed_llm_proposal; runtime consumption of
// an admitted program; clinical validity or animation quality of any plan.
