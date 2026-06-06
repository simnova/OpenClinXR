import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { globFiles, readJson } from "../../agent-factory/lib.js";
import {
  validateModelVettingRuntimeMappingEvidence,
  type ModelVettingRuntimeMappingActor,
  type ModelVettingRuntimeMappingEvidence,
} from "./model-vetting-runtime-mapping-evidence.js";

const defaultOutputPath = `docs/openclinxr/model-vetting-runtime-hook-bindings-peds-asthma-parent-anxiety-${new Date().toISOString().slice(0, 10)}.json`;

type CliOptions = {
  sourceRuntimeMappingPath?: string;
  outputPath?: string;
  validateLatest: boolean;
  validatePath?: string;
};

export type ModelVettingRuntimeHookBindingsEvidence = {
  schemaVersion: "openclinxr.model-vetting-runtime-hook-bindings.v1";
  generatedAt: string;
  sourceRuntimeMappingEvidencePath: string;
  claimScope: "guarded_actor_player_hook_binding_metadata_only";
  actors: Array<{
    actorId: string;
    candidateId: string;
    turnTraceTag: string;
    turnText: string;
    roleAnimationHandoff?: ModelVettingRuntimeMappingActor["roleAnimationHandoff"];
    hookBindings: Array<{
      hookId:
        | "speech_viseme_timeline_binding"
        | "emotion_transition_state_binding"
        | "gaze_blink_runtime_binding"
        | "posture_locomotion_runtime_binding";
      actorPlayerInputStatus: "attached_to_guarded_actor_player_stub";
      sourceEvidenceArtifactPaths: string[];
      deterministicRuntimeInputs: {
        turnText: string;
        emotion: string;
        intensity: number;
        transitionMs: number;
        gazeTargetKind: string;
        postureCue: string;
        roleAnimationClipName: string | null;
      };
      runtimeVerificationStatus: "not_scene_executed";
      blockers: string[];
    }>;
  }>;
  decision: {
    actorPlayerHookInputsAttached: boolean;
    actorPlayerHookEvidenceComplete: boolean;
    runtimeActorMappingReady: false;
    scenePlacementEvidenceAllowed: false;
    runtimePromotionAllowed: false;
    productionManifestPromotionAllowed: false;
    learnerLaunchAllowed: false;
    providerExecutionPerformed: false;
    nextSafeStep: string;
  };
  providerBoundary: ModelVettingRuntimeMappingEvidence["providerBoundary"];
  notEvidenceFor: Array<
    | "real_anny_model_output"
    | "b_plus_visual_realism_gate"
    | "runtime_readiness"
    | "scene_placement_readiness"
    | "quest_readiness"
    | "production_asset_readiness"
    | "learner_readiness"
    | "clinical_validity"
    | "scoring_validity"
  >;
};

export function buildModelVettingRuntimeHookBindingsEvidence(input: {
  generatedAt?: string;
  sourceRuntimeMappingEvidencePath: string;
  runtimeMappingEvidence: ModelVettingRuntimeMappingEvidence;
}): ModelVettingRuntimeHookBindingsEvidence {
  const validation = validateModelVettingRuntimeMappingEvidence(input.runtimeMappingEvidence);
  if (!validation.ok) throw new Error(`Invalid runtime mapping evidence: ${validation.errors.join("; ")}`);
  const actors = input.runtimeMappingEvidence.actors.map(buildActorHookBindings);
  const allActorsHaveHookEvidence = actors.every((actor) => actor.hookBindings.every((binding) => binding.sourceEvidenceArtifactPaths.length > 0));
  return {
    schemaVersion: "openclinxr.model-vetting-runtime-hook-bindings.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sourceRuntimeMappingEvidencePath: input.sourceRuntimeMappingEvidencePath,
    claimScope: "guarded_actor_player_hook_binding_metadata_only",
    actors,
    decision: {
      actorPlayerHookInputsAttached: actors.length > 0,
      actorPlayerHookEvidenceComplete: allActorsHaveHookEvidence,
      runtimeActorMappingReady: false,
      scenePlacementEvidenceAllowed: false,
      runtimePromotionAllowed: false,
      productionManifestPromotionAllowed: false,
      learnerLaunchAllowed: false,
      providerExecutionPerformed: false,
      nextSafeStep: "Execute the guarded actor-player in a local runtime evidence surface before any scene-placement or learner-facing claim.",
    },
    providerBoundary: input.runtimeMappingEvidence.providerBoundary,
    notEvidenceFor: [
      "real_anny_model_output",
      "b_plus_visual_realism_gate",
      "runtime_readiness",
      "scene_placement_readiness",
      "quest_readiness",
      "production_asset_readiness",
      "learner_readiness",
      "clinical_validity",
      "scoring_validity",
    ],
  };
}

export function validateModelVettingRuntimeHookBindingsEvidence(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be object"] };
  requireLiteral(value["schemaVersion"], "openclinxr.model-vetting-runtime-hook-bindings.v1", "/schemaVersion", errors);
  requireLiteral(value["claimScope"], "guarded_actor_player_hook_binding_metadata_only", "/claimScope", errors);
  requireString(value["sourceRuntimeMappingEvidencePath"], "/sourceRuntimeMappingEvidencePath", errors);
  if (!Array.isArray(value["actors"]) || value["actors"].length === 0) errors.push("/actors must be nonempty array");
  if (Array.isArray(value["actors"])) {
    for (const [index, actor] of value["actors"].entries()) validateActor(actor, `/actors/${index}`, errors);
  }
  requireRecord(value["decision"], "/decision", errors);
  if (isRecord(value["decision"])) {
    requireLiteral(value["decision"]["runtimeActorMappingReady"], false, "/decision/runtimeActorMappingReady", errors);
    requireLiteral(value["decision"]["scenePlacementEvidenceAllowed"], false, "/decision/scenePlacementEvidenceAllowed", errors);
    requireLiteral(value["decision"]["runtimePromotionAllowed"], false, "/decision/runtimePromotionAllowed", errors);
    requireLiteral(value["decision"]["productionManifestPromotionAllowed"], false, "/decision/productionManifestPromotionAllowed", errors);
    requireLiteral(value["decision"]["learnerLaunchAllowed"], false, "/decision/learnerLaunchAllowed", errors);
    requireLiteral(value["decision"]["providerExecutionPerformed"], false, "/decision/providerExecutionPerformed", errors);
  }
  for (const claim of ["real_anny_model_output", "b_plus_visual_realism_gate", "quest_readiness", "production_asset_readiness", "learner_readiness", "clinical_validity", "scoring_validity"]) {
    requireStringArrayIncludes(value["notEvidenceFor"], claim, "/notEvidenceFor", errors);
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestPath("docs/openclinxr/model-vetting-runtime-hook-bindings-*.json");
    if (!validatePath) throw new Error("Missing model-vetting runtime hook bindings evidence to validate.");
    const validation = validateModelVettingRuntimeHookBindingsEvidence(await readJson<unknown>(validatePath));
    if (validation.ok) {
      console.log(`Validated ${validatePath}`);
      return;
    }
    for (const error of validation.errors) console.error(error);
    process.exitCode = 1;
    return;
  }

  const sourceRuntimeMappingEvidencePath = options.sourceRuntimeMappingPath ?? await latestPath("docs/openclinxr/model-vetting-runtime-mapping-evidence-*.json");
  if (!sourceRuntimeMappingEvidencePath) throw new Error("Missing model-vetting runtime mapping evidence source.");
  const evidence = buildModelVettingRuntimeHookBindingsEvidence({
    sourceRuntimeMappingEvidencePath,
    runtimeMappingEvidence: await readJson<ModelVettingRuntimeMappingEvidence>(sourceRuntimeMappingEvidencePath),
  });
  const outputPath = options.outputPath ?? defaultOutputPath;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outputPath}`);
}

function buildActorHookBindings(actor: ModelVettingRuntimeMappingActor): ModelVettingRuntimeHookBindingsEvidence["actors"][number] {
  const turn = actor.turnMappings[0];
  if (!turn) throw new Error(`Missing turn mapping for ${actor.actorId}`);
  return {
    actorId: actor.actorId,
    candidateId: actor.candidateId,
    turnTraceTag: turn.traceTag,
    turnText: turn.text,
    ...(actor.roleAnimationHandoff ? { roleAnimationHandoff: actor.roleAnimationHandoff } : {}),
    hookBindings: actor.mappingChecks.map((check) => ({
      hookId: check.checkId,
      actorPlayerInputStatus: "attached_to_guarded_actor_player_stub",
      sourceEvidenceArtifactPaths: check.evidence.map(stripSlotPrefix),
      deterministicRuntimeInputs: {
        turnText: turn.text,
        emotion: turn.emotion,
        intensity: turn.intensity,
        transitionMs: turn.transitionMs,
        gazeTargetKind: turn.gazeTargetKind,
        postureCue: "openclinxr_posture_shift_standing",
        roleAnimationClipName: actor.roleAnimationHandoff?.roleSpecificClipNames[0] ?? null,
      },
      runtimeVerificationStatus: "not_scene_executed",
      blockers: uniqueStrings([
        ...check.blockers,
        "guarded_actor_player_not_executed_in_scene",
        "runtime_selector_disabled_guard_not_wired",
        "learner_launch_disabled_until_evidence_gates_clear",
      ]),
    })),
  };
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = { validateLatest: false };
  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--source-runtime-mapping") options.sourceRuntimeMappingPath = requireNext(normalizedArgs, ++index, arg);
    else if (arg === "--output") options.outputPath = requireNext(normalizedArgs, ++index, arg);
    else if (arg === "--validate") options.validatePath = requireNext(normalizedArgs, ++index, arg);
    else if (arg === "--validate-latest") options.validateLatest = true;
    else throw new Error(`Unknown argument: ${arg ?? ""}`);
  }
  return options;
}

async function latestPath(pattern: string): Promise<string | undefined> {
  const paths = await globFiles(pattern);
  return paths.sort().at(-1);
}

function validateActor(value: unknown, path: string, errors: string[]): void {
  requireRecord(value, path, errors);
  if (!isRecord(value)) return;
  requireString(value["actorId"], `${path}/actorId`, errors);
  requireString(value["candidateId"], `${path}/candidateId`, errors);
  const roleAnimationHandoff = value["roleAnimationHandoff"];
  if (roleAnimationHandoff !== undefined) {
    requireRecord(roleAnimationHandoff, `${path}/roleAnimationHandoff`, errors);
    if (isRecord(roleAnimationHandoff)) {
      if (!Array.isArray(roleAnimationHandoff["roleSpecificClipNames"]) || roleAnimationHandoff["roleSpecificClipNames"].length === 0) {
        errors.push(`${path}/roleAnimationHandoff/roleSpecificClipNames must be nonempty array`);
      }
      requireStringArrayIncludes(roleAnimationHandoff["notEvidenceFor"], "production_asset_readiness", `${path}/roleAnimationHandoff/notEvidenceFor`, errors);
    }
  }
  if (!Array.isArray(value["hookBindings"]) || value["hookBindings"].length !== 4) errors.push(`${path}/hookBindings must include four bindings`);
  if (Array.isArray(value["hookBindings"])) {
    for (const [index, binding] of value["hookBindings"].entries()) {
      requireRecord(binding, `${path}/hookBindings/${index}`, errors);
      if (!isRecord(binding)) continue;
      requireLiteral(binding["actorPlayerInputStatus"], "attached_to_guarded_actor_player_stub", `${path}/hookBindings/${index}/actorPlayerInputStatus`, errors);
      requireLiteral(binding["runtimeVerificationStatus"], "not_scene_executed", `${path}/hookBindings/${index}/runtimeVerificationStatus`, errors);
      if (!Array.isArray(binding["sourceEvidenceArtifactPaths"]) || binding["sourceEvidenceArtifactPaths"].length === 0) errors.push(`${path}/hookBindings/${index}/sourceEvidenceArtifactPaths must be nonempty array`);
      requireRecord(binding["deterministicRuntimeInputs"], `${path}/hookBindings/${index}/deterministicRuntimeInputs`, errors);
      if (isRecord(binding["deterministicRuntimeInputs"])) {
        const roleAnimationClipName = binding["deterministicRuntimeInputs"]["roleAnimationClipName"];
        if (roleAnimationClipName !== null && typeof roleAnimationClipName !== "string") {
          errors.push(`${path}/hookBindings/${index}/deterministicRuntimeInputs/roleAnimationClipName must be string or null`);
        }
      }
    }
  }
}

function stripSlotPrefix(value: string): string {
  const delimiterIndex = value.indexOf(":");
  return delimiterIndex >= 0 ? value.slice(delimiterIndex + 1) : value;
}

function requireNext(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

function requireRecord(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) errors.push(`${path} must be object`);
}

function requireString(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) errors.push(`${path} must be nonempty string`);
}

function requireLiteral<T extends boolean | string>(value: unknown, expected: T, path: string, errors: string[]): void {
  if (value !== expected) errors.push(`${path} must be ${String(expected)}`);
}

function requireStringArrayIncludes(value: unknown, expected: string, path: string, errors: string[]): void {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string") || !value.includes(expected)) {
    errors.push(`${path} must include ${expected}`);
  }
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
