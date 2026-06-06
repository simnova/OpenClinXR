import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { globFiles, readJson } from "../../agent-factory/lib.js";
import {
  validateModelVettingRuntimeHookBindingsEvidence,
  type ModelVettingRuntimeHookBindingsEvidence,
} from "./model-vetting-runtime-hook-bindings.js";
import { deriveBasicActorTurnExpectationsFromCase } from "../factory/encounter-runtime-selection-review-packet.js";

const defaultOutputPath = `docs/openclinxr/model-vetting-actor-player-runtime-evidence-peds-asthma-parent-anxiety-${new Date().toISOString().slice(0, 10)}.json`;

type CliOptions = {
  sourceRuntimeHookBindingsPath?: string;
  scenarioId?: string;
  outputPath?: string;
  validateLatest: boolean;
  validatePath?: string;
};

type RuntimeSample = {
  sampleMs: number;
  turnText: string;
  emotion: string;
  emotionWeight: number;
  gazeTargetKind: string;
  postureCue: string;
  roleAnimationClipName: string | null;
};

type RuntimeSourceCaptureArtifacts = {
  speechVisemeTimelineVideoPath: string | null;
  emotionTransitionVideoPath: string | null;
  gazeBlinkTurntableVideoPath: string | null;
  postureAndMaterialArtifactPaths: string[];
};

export type ModelVettingActorPlayerRuntimeEvidence = {
  schemaVersion: "openclinxr.model-vetting-actor-player-runtime-evidence.v1";
  generatedAt: string;
  sourceRuntimeHookBindingsEvidencePath: string;
  claimScope: "guarded_local_actor_player_stub_execution_only";
  executionSurface: {
    surfaceId: "openclinxr_guarded_actor_player_stub";
    executionMode: "local_deterministic_non_scene";
    providerExecutionPerformed: false;
    sceneExecutionPerformed: false;
    learnerRuntimeExecuted: false;
  };
  actors: Array<{
    actorId: string;
    candidateId: string;
    turnTraceTag: string;
    sourceCaptureArtifacts: RuntimeSourceCaptureArtifacts;
    roleAnimationHandoff?: ModelVettingRuntimeHookBindingsEvidence["actors"][number]["roleAnimationHandoff"];
    caseDerivedTurnSequence: Array<{
      turnId: string;
      cue: string;
      expectedEmotion: string;
      localActorPlayerStatus: "projected_in_guarded_actor_player_stub";
      sceneExecutionStatus: "not_scene_executed";
      sourceCaptureArtifacts: RuntimeSourceCaptureArtifacts;
      roleAnimationClipName: string | null;
      samples: RuntimeSample[];
      remainingBlockers: string[];
    }>;
    executedHookCount: number;
    hookExecutions: Array<{
      hookId: ModelVettingRuntimeHookBindingsEvidence["actors"][number]["hookBindings"][number]["hookId"];
      runtimeSurfaceStatus: "executed_in_guarded_local_actor_player_stub";
      sceneExecutionStatus: "not_scene_executed";
      sourceEvidenceArtifactCount: number;
      sourceEvidenceArtifactPaths: string[];
      samples: RuntimeSample[];
      remainingBlockers: string[];
    }>;
  }>;
  decision: {
    localActorPlayerRuntimeEvidenceExecuted: boolean;
    actorPlayerRuntimeEvidenceComplete: boolean;
    multiTurnCaseSequenceProjected: boolean;
    runtimeActorMappingReady: false;
    scenePlacementEvidenceAllowed: false;
    runtimePromotionAllowed: false;
    productionManifestPromotionAllowed: false;
    learnerLaunchAllowed: false;
    providerExecutionPerformed: false;
    nextSafeStep: string;
  };
  providerBoundary: ModelVettingRuntimeHookBindingsEvidence["providerBoundary"];
  notEvidenceFor: Array<
    | "real_anny_model_output"
    | "b_plus_visual_realism_gate"
    | "scene_placement_readiness"
    | "quest_readiness"
    | "production_asset_readiness"
    | "learner_readiness"
    | "clinical_validity"
    | "scoring_validity"
  >;
};

const NOT_EVIDENCE_FOR = [
  "real_anny_model_output",
  "b_plus_visual_realism_gate",
  "scene_placement_readiness",
  "quest_readiness",
  "production_asset_readiness",
  "learner_readiness",
  "clinical_validity",
  "scoring_validity",
] as const satisfies ModelVettingActorPlayerRuntimeEvidence["notEvidenceFor"];

export function buildModelVettingActorPlayerRuntimeEvidence(input: {
  generatedAt?: string;
  sourceRuntimeHookBindingsEvidencePath: string;
  runtimeHookBindingsEvidence: ModelVettingRuntimeHookBindingsEvidence;
  caseDerivedActorTurnExpectations?: ReturnType<typeof deriveBasicActorTurnExpectationsFromCase>;
}): ModelVettingActorPlayerRuntimeEvidence {
  const validation = validateModelVettingRuntimeHookBindingsEvidence(input.runtimeHookBindingsEvidence);
  if (!validation.ok) throw new Error(`Invalid runtime hook bindings evidence: ${validation.errors.join("; ")}`);
  const caseDerived = input.caseDerivedActorTurnExpectations ?? deriveBasicActorTurnExpectationsFromCase("peds_asthma_parent_anxiety_v1");
  const actors = input.runtimeHookBindingsEvidence.actors.map((actor) => ({
    actorId: actor.actorId,
    candidateId: actor.candidateId,
    turnTraceTag: actor.turnTraceTag,
    sourceCaptureArtifacts: sourceCaptureArtifactsForActor(actor),
    ...(actor.roleAnimationHandoff ? { roleAnimationHandoff: actor.roleAnimationHandoff } : {}),
    caseDerivedTurnSequence: buildCaseDerivedTurnSequence(actor, caseDerived),
    executedHookCount: actor.hookBindings.length,
    hookExecutions: actor.hookBindings.map((binding) => ({
      hookId: binding.hookId,
      runtimeSurfaceStatus: "executed_in_guarded_local_actor_player_stub" as const,
      sceneExecutionStatus: "not_scene_executed" as const,
      sourceEvidenceArtifactCount: binding.sourceEvidenceArtifactPaths.length,
      sourceEvidenceArtifactPaths: [...binding.sourceEvidenceArtifactPaths],
      samples: buildSamples(binding.deterministicRuntimeInputs),
      remainingBlockers: uniqueStrings([
        ...binding.blockers,
        "scene_runtime_not_executed",
        "learner_runtime_not_enabled",
        "quest_runtime_not_verified",
      ]),
    })),
  }));
  const complete = actors.length > 0 && actors.every((actor) =>
    actor.executedHookCount === 4
    && actor.hookExecutions.every((hook) =>
      hook.sourceEvidenceArtifactCount > 0
      && hook.sourceEvidenceArtifactPaths.length === hook.sourceEvidenceArtifactCount
      && hook.samples.length === 3
    )
  );
  const multiTurnCaseSequenceProjected = actors.length > 0
    && actors.every((actor) => actor.caseDerivedTurnSequence.length > 0)
    && actors.some((actor) => actor.caseDerivedTurnSequence.length > 1);
  return {
    schemaVersion: "openclinxr.model-vetting-actor-player-runtime-evidence.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sourceRuntimeHookBindingsEvidencePath: input.sourceRuntimeHookBindingsEvidencePath,
    claimScope: "guarded_local_actor_player_stub_execution_only",
    executionSurface: {
      surfaceId: "openclinxr_guarded_actor_player_stub",
      executionMode: "local_deterministic_non_scene",
      providerExecutionPerformed: false,
      sceneExecutionPerformed: false,
      learnerRuntimeExecuted: false,
    },
    actors,
    decision: {
      localActorPlayerRuntimeEvidenceExecuted: actors.length > 0,
      actorPlayerRuntimeEvidenceComplete: complete,
      multiTurnCaseSequenceProjected,
      runtimeActorMappingReady: false,
      scenePlacementEvidenceAllowed: false,
      runtimePromotionAllowed: false,
      productionManifestPromotionAllowed: false,
      learnerLaunchAllowed: false,
      providerExecutionPerformed: false,
      nextSafeStep: "Attach this guarded multi-turn local actor-player evidence to the review packet/admin metadata path before any scene-placement evidence is considered.",
    },
    providerBoundary: input.runtimeHookBindingsEvidence.providerBoundary,
    notEvidenceFor: [...NOT_EVIDENCE_FOR],
  };
}

export function validateModelVettingActorPlayerRuntimeEvidence(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be object"] };
  requireLiteral(value["schemaVersion"], "openclinxr.model-vetting-actor-player-runtime-evidence.v1", "/schemaVersion", errors);
  requireLiteral(value["claimScope"], "guarded_local_actor_player_stub_execution_only", "/claimScope", errors);
  requireString(value["sourceRuntimeHookBindingsEvidencePath"], "/sourceRuntimeHookBindingsEvidencePath", errors);
  validateExecutionSurface(value["executionSurface"], errors);
  if (!Array.isArray(value["actors"]) || value["actors"].length === 0) errors.push("/actors must be nonempty array");
  if (Array.isArray(value["actors"])) {
    for (const [index, actor] of value["actors"].entries()) validateActor(actor, `/actors/${index}`, errors);
  }
  validateDecision(value["decision"], errors);
  for (const claim of NOT_EVIDENCE_FOR) requireStringArrayIncludes(value["notEvidenceFor"], claim, "/notEvidenceFor", errors);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestPath("docs/openclinxr/model-vetting-actor-player-runtime-evidence-*.json");
    if (!validatePath) throw new Error("Missing model-vetting actor-player runtime evidence to validate.");
    const validation = validateModelVettingActorPlayerRuntimeEvidence(await readJson<unknown>(validatePath));
    if (validation.ok) {
      console.log(`Validated ${validatePath}`);
      return;
    }
    for (const error of validation.errors) console.error(error);
    process.exitCode = 1;
    return;
  }

  const sourceRuntimeHookBindingsEvidencePath = options.sourceRuntimeHookBindingsPath ?? await latestPath("docs/openclinxr/model-vetting-runtime-hook-bindings-*.json");
  if (!sourceRuntimeHookBindingsEvidencePath) throw new Error("Missing model-vetting runtime hook bindings evidence source.");
  const evidence = buildModelVettingActorPlayerRuntimeEvidence({
    sourceRuntimeHookBindingsEvidencePath,
    runtimeHookBindingsEvidence: await readJson<ModelVettingRuntimeHookBindingsEvidence>(sourceRuntimeHookBindingsEvidencePath),
    caseDerivedActorTurnExpectations: deriveBasicActorTurnExpectationsFromCase(options.scenarioId ?? "peds_asthma_parent_anxiety_v1"),
  });
  const outputPath = options.outputPath ?? defaultOutputPath;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outputPath}`);
}

function buildSamples(input: ModelVettingRuntimeHookBindingsEvidence["actors"][number]["hookBindings"][number]["deterministicRuntimeInputs"]): RuntimeSample[] {
  const duration = Math.max(300, input.transitionMs);
  return [0, Math.round(duration / 2), duration].map((sampleMs) => {
    const progress = duration === 0 ? 1 : sampleMs / duration;
    return {
      sampleMs,
      turnText: input.turnText,
      emotion: input.emotion,
      emotionWeight: round(input.intensity * progress),
      gazeTargetKind: input.gazeTargetKind,
      postureCue: input.postureCue,
      roleAnimationClipName: input.roleAnimationClipName,
    };
  });
}

function buildCaseDerivedTurnSequence(
  actor: ModelVettingRuntimeHookBindingsEvidence["actors"][number],
  caseDerived: ReturnType<typeof deriveBasicActorTurnExpectationsFromCase>,
): ModelVettingActorPlayerRuntimeEvidence["actors"][number]["caseDerivedTurnSequence"] {
  if (!caseDerived) return [];
  const speechBinding = actor.hookBindings.find((binding) => binding.hookId === "speech_viseme_timeline_binding") ?? actor.hookBindings[0];
  const baseInputs = speechBinding?.deterministicRuntimeInputs;
  if (!baseInputs) return [];
  const sourceCaptureArtifacts = sourceCaptureArtifactsForActor(actor);
  return caseDerived.turns
    .filter((turn) => turn.actorId === actor.actorId)
    .map((turn, index) => ({
      turnId: turn.turnId,
      cue: turn.cue,
      expectedEmotion: turn.expectedEmotion,
      localActorPlayerStatus: "projected_in_guarded_actor_player_stub" as const,
      sceneExecutionStatus: "not_scene_executed" as const,
      sourceCaptureArtifacts,
      roleAnimationClipName: baseInputs.roleAnimationClipName,
      samples: buildSamples({
        ...baseInputs,
        turnText: `${turn.cue}: ${baseInputs.turnText}`,
        emotion: turn.expectedEmotion,
        transitionMs: baseInputs.transitionMs + index * 120,
      }),
      remainingBlockers: [
        "multi_turn_sequence_not_executed_in_scene_runtime",
        "learner_runtime_not_enabled",
        "quest_runtime_not_verified",
      ],
    }));
}

function sourceCaptureArtifactsForActor(actor: ModelVettingRuntimeHookBindingsEvidence["actors"][number]): RuntimeSourceCaptureArtifacts {
  const sourcePathsForHook = (hookId: ModelVettingRuntimeHookBindingsEvidence["actors"][number]["hookBindings"][number]["hookId"]) =>
    actor.hookBindings.find((binding) => binding.hookId === hookId)?.sourceEvidenceArtifactPaths ?? [];
  const firstPathForHook = (hookId: ModelVettingRuntimeHookBindingsEvidence["actors"][number]["hookBindings"][number]["hookId"]) =>
    sourcePathsForHook(hookId)[0] ?? null;
  return {
    speechVisemeTimelineVideoPath: firstPathForHook("speech_viseme_timeline_binding"),
    emotionTransitionVideoPath: firstPathForHook("emotion_transition_state_binding"),
    gazeBlinkTurntableVideoPath: firstPathForHook("gaze_blink_runtime_binding"),
    postureAndMaterialArtifactPaths: sourcePathsForHook("posture_locomotion_runtime_binding"),
  };
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = { validateLatest: false };
  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--source-runtime-hook-bindings") options.sourceRuntimeHookBindingsPath = requireNext(normalizedArgs, ++index, arg);
    else if (arg === "--scenario-id") options.scenarioId = requireNext(normalizedArgs, ++index, arg);
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

function validateExecutionSurface(value: unknown, errors: string[]): void {
  requireRecord(value, "/executionSurface", errors);
  if (!isRecord(value)) return;
  requireLiteral(value["surfaceId"], "openclinxr_guarded_actor_player_stub", "/executionSurface/surfaceId", errors);
  requireLiteral(value["executionMode"], "local_deterministic_non_scene", "/executionSurface/executionMode", errors);
  requireLiteral(value["providerExecutionPerformed"], false, "/executionSurface/providerExecutionPerformed", errors);
  requireLiteral(value["sceneExecutionPerformed"], false, "/executionSurface/sceneExecutionPerformed", errors);
  requireLiteral(value["learnerRuntimeExecuted"], false, "/executionSurface/learnerRuntimeExecuted", errors);
}

function validateDecision(value: unknown, errors: string[]): void {
  requireRecord(value, "/decision", errors);
  if (!isRecord(value)) return;
  requireLiteral(value["runtimeActorMappingReady"], false, "/decision/runtimeActorMappingReady", errors);
  requireLiteral(value["scenePlacementEvidenceAllowed"], false, "/decision/scenePlacementEvidenceAllowed", errors);
  requireLiteral(value["runtimePromotionAllowed"], false, "/decision/runtimePromotionAllowed", errors);
  requireLiteral(value["productionManifestPromotionAllowed"], false, "/decision/productionManifestPromotionAllowed", errors);
  requireLiteral(value["learnerLaunchAllowed"], false, "/decision/learnerLaunchAllowed", errors);
  requireLiteral(value["providerExecutionPerformed"], false, "/decision/providerExecutionPerformed", errors);
}

function validateActor(value: unknown, path: string, errors: string[]): void {
  requireRecord(value, path, errors);
  if (!isRecord(value)) return;
  requireString(value["actorId"], `${path}/actorId`, errors);
  requireString(value["candidateId"], `${path}/candidateId`, errors);
  validateSourceCaptureArtifacts(value["sourceCaptureArtifacts"], `${path}/sourceCaptureArtifacts`, errors);
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
  if (!Array.isArray(value["caseDerivedTurnSequence"]) || value["caseDerivedTurnSequence"].length === 0) errors.push(`${path}/caseDerivedTurnSequence must be nonempty array`);
  if (Array.isArray(value["caseDerivedTurnSequence"])) {
    for (const [index, turn] of value["caseDerivedTurnSequence"].entries()) validateCaseDerivedTurnProjection(turn, `${path}/caseDerivedTurnSequence/${index}`, errors);
  }
  requireLiteral(value["executedHookCount"], 4, `${path}/executedHookCount`, errors);
  if (!Array.isArray(value["hookExecutions"]) || value["hookExecutions"].length !== 4) errors.push(`${path}/hookExecutions must include four hook executions`);
  if (Array.isArray(value["hookExecutions"])) {
    for (const [index, hook] of value["hookExecutions"].entries()) validateHookExecution(hook, `${path}/hookExecutions/${index}`, errors);
  }
}

function validateCaseDerivedTurnProjection(value: unknown, path: string, errors: string[]): void {
  requireRecord(value, path, errors);
  if (!isRecord(value)) return;
  requireString(value["turnId"], `${path}/turnId`, errors);
  requireString(value["cue"], `${path}/cue`, errors);
  requireString(value["expectedEmotion"], `${path}/expectedEmotion`, errors);
  requireLiteral(value["localActorPlayerStatus"], "projected_in_guarded_actor_player_stub", `${path}/localActorPlayerStatus`, errors);
  requireLiteral(value["sceneExecutionStatus"], "not_scene_executed", `${path}/sceneExecutionStatus`, errors);
  validateSourceCaptureArtifacts(value["sourceCaptureArtifacts"], `${path}/sourceCaptureArtifacts`, errors);
  if (value["roleAnimationClipName"] !== null && typeof value["roleAnimationClipName"] !== "string") {
    errors.push(`${path}/roleAnimationClipName must be string or null`);
  }
  if (!Array.isArray(value["samples"]) || value["samples"].length !== 3) errors.push(`${path}/samples must include three deterministic samples`);
  requireStringArrayIncludes(value["remainingBlockers"], "multi_turn_sequence_not_executed_in_scene_runtime", `${path}/remainingBlockers`, errors);
}

function validateHookExecution(value: unknown, path: string, errors: string[]): void {
  requireRecord(value, path, errors);
  if (!isRecord(value)) return;
  requireLiteral(value["runtimeSurfaceStatus"], "executed_in_guarded_local_actor_player_stub", `${path}/runtimeSurfaceStatus`, errors);
  requireLiteral(value["sceneExecutionStatus"], "not_scene_executed", `${path}/sceneExecutionStatus`, errors);
  requirePositiveNumber(value["sourceEvidenceArtifactCount"], `${path}/sourceEvidenceArtifactCount`, errors);
  if (!Array.isArray(value["sourceEvidenceArtifactPaths"]) || value["sourceEvidenceArtifactPaths"].length !== value["sourceEvidenceArtifactCount"]) {
    errors.push(`${path}/sourceEvidenceArtifactPaths must match sourceEvidenceArtifactCount`);
  }
  if (!Array.isArray(value["samples"]) || value["samples"].length !== 3) errors.push(`${path}/samples must include three deterministic samples`);
  requireStringArrayIncludes(value["remainingBlockers"], "scene_runtime_not_executed", `${path}/remainingBlockers`, errors);
  requireStringArrayIncludes(value["remainingBlockers"], "learner_runtime_not_enabled", `${path}/remainingBlockers`, errors);
}

function validateSourceCaptureArtifacts(value: unknown, path: string, errors: string[]): void {
  requireRecord(value, path, errors);
  if (!isRecord(value)) return;
  requireString(value["speechVisemeTimelineVideoPath"], `${path}/speechVisemeTimelineVideoPath`, errors);
  requireString(value["emotionTransitionVideoPath"], `${path}/emotionTransitionVideoPath`, errors);
  requireString(value["gazeBlinkTurntableVideoPath"], `${path}/gazeBlinkTurntableVideoPath`, errors);
  if (!Array.isArray(value["postureAndMaterialArtifactPaths"]) || value["postureAndMaterialArtifactPaths"].length < 6) {
    errors.push(`${path}/postureAndMaterialArtifactPaths must include fixed-camera and temporal capture artifacts`);
  }
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

function requirePositiveNumber(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "number" || value <= 0) errors.push(`${path} must be positive number`);
}

function requireLiteral<T extends boolean | number | string>(value: unknown, expected: T, path: string, errors: string[]): void {
  if (value !== expected) errors.push(`${path} must be ${String(expected)}`);
}

function requireStringArrayIncludes(value: unknown, expected: string, path: string, errors: string[]): void {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string") || !value.includes(expected)) {
    errors.push(`${path} must include ${expected}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
