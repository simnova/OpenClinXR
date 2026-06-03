import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { globFiles } from "../../agent-factory/lib.js";

const defaultInputPath = "apps/ui-xr/public/xr-assets/humanoids/neutral-generated-human.glb";
const defaultOutputPath = `docs/openclinxr/humanoid-realism-gate-${new Date().toISOString().slice(0, 10)}.json`;

export type HumanoidRealismGateReport = {
  schemaVersion: "openclinxr.humanoid-realism-gate.v1";
  generatedAt: string;
  inputPath: string;
  tool: {
    package: "@gltf-transform/core";
    purpose: "humanoid_animation_morph_target_realism_gate";
  };
  metrics: {
    sceneCount: number;
    meshCount: number;
    skinCount: number;
    animationCount: number;
    morphTargetPrimitiveCount: number;
    vertexCount: number;
    primitiveVisualProxyNodeCount: number;
    annyBaseMeshNodeCount: number;
    clinicalIdlePoseClipCount: number;
  };
  verdict: {
    status: "generated_human_base_mesh_ready" | "generated_human_base_mesh_with_posture_debt" | "primitive_proxy_visual_debt" | "procedural_fallback_only";
    blockers: string[];
    nextPipelineActions: string[];
  };
  productionReadinessClaimed: false;
  notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"];
};

export type CaseDefinedActorRealismRequirement = {
  actorId: string;
  role: string;
  baselineMood: string[];
  locomotionRequired: boolean;
  expressionRequired: boolean;
  gazeRequired: boolean;
  lipSyncRequired: boolean;
  interactionRequired: boolean;
  requiredCueIds: string[];
};

export type CaseDefinedActorRealismLaunchBadge = {
  actorId: string;
  actorRole: string;
  baselineMood: string[];
  status: "realismReady" | "realismBlocked";
  readyDimensions: string[];
  blockedDimensions: string[];
  blockers: string[];
  requiredCueIds: string[];
  claimBoundary: "case_defined_actor_realism_launch_badge_metadata_only";
  notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"];
};

type CliOptions = {
  inputPath: string;
  outputPath: string;
  validateLatest: boolean;
  validatePath?: string | undefined;
};

async function main(): Promise<void> {
  await runHumanoidRealismGateCli(process.argv.slice(2));
}

export async function runHumanoidRealismGateCli(args: string[]): Promise<void> {
  const options = parseArgs(args);
  if (options.validateLatest || options.validatePath) {
    const validatePath = options.validatePath ?? await latestPath("docs/openclinxr/humanoid-realism-gate-*.json");
    if (!validatePath) throw new Error("Missing humanoid realism gate report to validate.");
    const validation = validateHumanoidRealismGateReport(JSON.parse(await readFile(validatePath, "utf8")) as unknown);
    if (validation.ok) {
      console.log(`Validated ${validatePath}`);
      return;
    }
    for (const error of validation.errors) console.error(error);
    process.exitCode = 1;
    return;
  }

  const report = await buildHumanoidRealismGateReport({ inputPath: options.inputPath });
  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Wrote ${options.outputPath}`);
}

export async function buildHumanoidRealismGateReport(input: {
  inputPath: string;
  generatedAt?: string | undefined;
}): Promise<HumanoidRealismGateReport> {
  const document = await new NodeIO().read(input.inputPath);
  const root = document.getRoot();
  const meshes = root.listMeshes();
  const nodeNames = root.listNodes().map((node) => node.getName());
  const primitiveVisualProxyNodeCount = nodeNames.filter((name) =>
    name.startsWith("local_fixture_")
    || name.startsWith("openclinxr_proportioned_")
    || name.startsWith("openclinxr_visual_detail_")
    || name.startsWith("openclinxr_camera_facing_")
  ).length;
  const annyBaseMeshNodeCount = nodeNames.filter((name) => name === "neutral_generated_human_skinned_mesh").length;
  const morphTargetPrimitiveCount = meshes.flatMap((mesh) => mesh.listPrimitives())
    .filter((primitive) => primitive.listTargets().length > 0).length;
  const clinicalIdlePoseClipCount = root.listAnimations()
    .filter((animation) => /clinical|idle|relaxed|conversation|consult/i.test(animation.getName()))
    .length;
  const vertexCount = meshes.flatMap((mesh) => mesh.listPrimitives())
    .reduce((count, primitive) => count + (primitive.getAttribute("POSITION")?.getCount() ?? 0), 0);
  const blockers = [
    ...(root.listAnimations().length === 0 ? ["humanoid_animation_clips_missing"] : []),
    ...(morphTargetPrimitiveCount === 0 ? ["humanoid_morph_targets_missing"] : []),
    ...(primitiveVisualProxyNodeCount > 0 ? ["primitive_visual_proxy_nodes_present"] : []),
    ...(root.listAnimations().length > 0 && clinicalIdlePoseClipCount === 0 ? ["clinical_idle_pose_clip_missing"] : []),
  ];
  const status = root.listAnimations().length === 0 || morphTargetPrimitiveCount === 0
    ? "procedural_fallback_only"
    : primitiveVisualProxyNodeCount > 0
      ? "primitive_proxy_visual_debt"
      : clinicalIdlePoseClipCount === 0
        ? "generated_human_base_mesh_with_posture_debt"
        : "generated_human_base_mesh_ready";

  return {
    schemaVersion: "openclinxr.humanoid-realism-gate.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    inputPath: input.inputPath,
    tool: {
      package: "@gltf-transform/core",
      purpose: "humanoid_animation_morph_target_realism_gate",
    },
    metrics: {
      sceneCount: root.listScenes().length,
      meshCount: meshes.length,
      skinCount: root.listSkins().length,
      animationCount: root.listAnimations().length,
      morphTargetPrimitiveCount,
      vertexCount,
      primitiveVisualProxyNodeCount,
      annyBaseMeshNodeCount,
      clinicalIdlePoseClipCount,
    },
    verdict: {
      status,
      blockers,
      nextPipelineActions: status === "generated_human_base_mesh_ready"
        ? ["run_gltf_transform_optimization_and_quest_visual_capture"]
        : status === "generated_human_base_mesh_with_posture_debt"
        ? ["author_clinical_idle_conversation_pose_clip_in_generated_glb", "rerun_actor_close_visual_qa_before_realism_claims"]
        : status === "primitive_proxy_visual_debt"
          ? ["replace_primitive_visual_proxy_nodes_with_generated_humanoid_mesh_surface", "retarget_runtime_face_eye_mouth_body_motion_cues_to_generated_mesh_controls"]
        : ["materialize_retargeted_idle_speak_reaction_gaze_clips", "materialize_audio_aligned_viseme_or_morph_targets", "rerun_humanoid_realism_gate_before_readiness_claims"],
    },
    productionReadinessClaimed: false,
    notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
  };
}

export function buildCaseDefinedActorRealismLaunchBadges(
  requirements: CaseDefinedActorRealismRequirement[],
  gateReport: HumanoidRealismGateReport,
): CaseDefinedActorRealismLaunchBadge[] {
  const gateReady = gateReport.verdict.status === "generated_human_base_mesh_ready" && gateReport.verdict.blockers.length === 0;
  return requirements.map((requirement) => {
    const requiredDimensions = [
      requirement.locomotionRequired ? "locomotion" : "",
      requirement.expressionRequired ? "expression" : "",
      requirement.gazeRequired ? "gaze" : "",
      requirement.lipSyncRequired ? "lip_sync" : "",
      requirement.interactionRequired ? "interaction" : "",
    ].filter(Boolean);
    const missingRequirementBlockers = [
      ...(requirement.requiredCueIds.length === 0 ? ["actor_required_cue_ids_missing"] : []),
      ...(requirement.baselineMood.length === 0 ? ["actor_baseline_mood_missing"] : []),
    ];
    const blockers = uniqueStrings([
      ...gateReport.verdict.blockers,
      ...missingRequirementBlockers,
      ...(gateReady ? [] : ["humanoid_realism_gate_not_ready"]),
    ]);
    return {
      actorId: requirement.actorId,
      actorRole: requirement.role,
      baselineMood: [...requirement.baselineMood],
      status: blockers.length === 0 ? "realismReady" : "realismBlocked",
      readyDimensions: blockers.length === 0 ? requiredDimensions : [],
      blockedDimensions: blockers.length === 0 ? [] : requiredDimensions,
      blockers,
      requiredCueIds: [...requirement.requiredCueIds],
      claimBoundary: "case_defined_actor_realism_launch_badge_metadata_only",
      notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
    };
  });
}

export function validateHumanoidRealismGateReport(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be an object"] };
  if (value.schemaVersion !== "openclinxr.humanoid-realism-gate.v1") errors.push("/schemaVersion invalid");
  if (typeof value.generatedAt !== "string" || Number.isNaN(Date.parse(value.generatedAt))) errors.push("/generatedAt must be ISO date string");
  if (typeof value.inputPath !== "string" || value.inputPath.length === 0) errors.push("/inputPath required");
  if (!isRecord(value.metrics)) errors.push("/metrics must be object");
  if (isRecord(value.metrics)) {
    for (const key of ["sceneCount", "meshCount", "skinCount", "animationCount", "morphTargetPrimitiveCount", "vertexCount", "primitiveVisualProxyNodeCount", "annyBaseMeshNodeCount", "clinicalIdlePoseClipCount"]) {
      if (typeof value.metrics[key] !== "number" || value.metrics[key] < 0) errors.push(`/metrics/${key} must be nonnegative number`);
    }
  }
  if (!isRecord(value.verdict)) errors.push("/verdict must be object");
  if (isRecord(value.verdict)) {
    if (!["generated_human_base_mesh_ready", "generated_human_base_mesh_with_posture_debt", "primitive_proxy_visual_debt", "procedural_fallback_only"].includes(String(value.verdict.status))) errors.push("/verdict/status invalid");
    if (!Array.isArray(value.verdict.blockers)) errors.push("/verdict/blockers must be array");
    if (!Array.isArray(value.verdict.nextPipelineActions)) errors.push("/verdict/nextPipelineActions must be array");
    if (value.verdict.status === "procedural_fallback_only" && Array.isArray(value.verdict.blockers) && value.verdict.blockers.length === 0) {
      errors.push("/verdict/blockers required for procedural_fallback_only");
    }
    if (value.verdict.status === "primitive_proxy_visual_debt" && Array.isArray(value.verdict.blockers) && value.verdict.blockers.length === 0) {
      errors.push("/verdict/blockers required for primitive_proxy_visual_debt");
    }
    if (value.verdict.status === "generated_human_base_mesh_with_posture_debt" && Array.isArray(value.verdict.blockers) && !value.verdict.blockers.includes("clinical_idle_pose_clip_missing")) {
      errors.push("/verdict/blockers must include clinical_idle_pose_clip_missing for posture debt");
    }
  }
  if (value.productionReadinessClaimed !== false) errors.push("/productionReadinessClaimed must be false");
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    inputPath: defaultInputPath,
    outputPath: defaultOutputPath,
    validateLatest: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--input") options.inputPath = requireNext(args, ++index, arg);
    else if (arg === "--output") options.outputPath = requireNext(args, ++index, arg);
    else if (arg === "--validate-latest") options.validateLatest = true;
    else if (arg === "--validate") options.validatePath = requireNext(args, ++index, arg);
  }
  return options;
}

function requireNext(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function latestPath(pattern: string): Promise<string | null> {
  const matches = await globFiles(pattern);
  return matches.sort().at(-1) ?? null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
