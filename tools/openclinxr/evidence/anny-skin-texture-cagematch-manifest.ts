import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { globFiles, readJson, writeJson } from "../../agent-factory/lib.js";
import {
  validateAnnySkinCagematchProbeReport,
  type AnnySkinCagematchProbeReport,
} from "./anny-skin-cagematch-probe.js";

const scenarioId = "peds_asthma_parent_anxiety_v1";
const defaultOutputPath = `docs/openclinxr/anny-skin-texture-cagematch-manifest-${scenarioId}-${new Date().toISOString().slice(0, 10)}.json`;

// Copied-candidate peds_asthma_parent_anxiety_v1 for patient/parent/nurse (Track A MIT PBR complete + Track B non-software-distribution GPL-ok skeleton).
// Records checkpoint/cache/license boundary per requiredFieldsBeforeGeneration.
// Non-software-distribution constraints: no GPL distrib (server-side only, local tooling only; no GPL code enters repo or runtime bundles).
const actorConfigs: Array<{
  role: "patient" | "parent" | "nurse";
  bundlePath: string;
  glbPath: string;
  plannedWorkingDir: string;
}> = [
  {
    role: "patient",
    bundlePath: "apps/ui-xr/public/generated-humanoids/peds_patient_child.bundle.json",
    glbPath: "apps/ui-xr/public/generated-humanoids/peds_patient_child.glb",
    plannedWorkingDir: ".openclinxr/asset-production/skin-cagematch/peds_patient_child_mit_pbr",
  },
  {
    role: "parent",
    bundlePath: "apps/ui-xr/public/generated-humanoids/peds_anxious_parent.bundle.json",
    glbPath: "apps/ui-xr/public/generated-humanoids/peds_anxious_parent.glb",
    plannedWorkingDir: ".openclinxr/asset-production/skin-cagematch/peds_anxious_parent_mit_pbr",
  },
  {
    role: "nurse",
    bundlePath: "apps/ui-xr/public/generated-humanoids/peds_nurse_kevin.bundle.json",
    glbPath: "apps/ui-xr/public/generated-humanoids/peds_nurse_kevin.glb",
    plannedWorkingDir: ".openclinxr/asset-production/skin-cagematch/peds_nurse_kevin_mit_pbr",
  },
];

type CliOptions = {
  outputPath?: string;
  validateLatest: boolean;
  validatePath?: string;
  sourceProbePath?: string;
};

export type AnnySkinTextureCagematchManifest = {
  schemaVersion: "openclinxr.anny-skin-texture-cagematch-manifest.v1";
  generatedAt: string;
  claimScope: "copied_candidate_skin_texture_cagematch_plan_no_generation";
  sourceProbePath: string;
  // Updated for copied-candidate peds_asthma_parent_anxiety_v1 (patient/parent/nurse)
  candidates: Array<{
    scenarioId: typeof scenarioId;
    actorId: string;
    role: "patient" | "parent" | "nurse";
    sourceBundlePath: string;
    sourceGlbPath: string;
    sourceGlbSha256: string;
    copiedCandidateOnly: true;
    runtimeAssetOverwriteAllowed: false;
    plannedWorkingDir: string;
  }>;
  localStack: {
    stablegenAvailable: boolean;
    comfyuiAvailableAtProbeTime: boolean;
    simplifyOptimizeAvailable: boolean;
    cloudrigAvailable: boolean;
  };
  checkpointBoundary: {
    selectedCheckpointPath: string | null;
    selectedCheckpointSha256: string | null;
    licenseManifestPath: string | null;
    licenseReviewed: boolean;
    cacheReuseKey: string | null;
    modelDownloadApprovedByThisManifest: boolean;
    generationBlockedUntilManifestComplete: boolean;
    requiredFieldsBeforeGeneration: [
      "checkpoint_source_url",
      "checkpoint_license",
      "checkpoint_local_path",
      "checkpoint_sha256",
      "cache_reuse_key",
      "human_skin_prompt_boundary",
    ];
  };
  // Updated probe evidencePlan/paths for 3 actors + MIT Track A PBR bakes (basecolor/normal/roughness/metallic/ao) from clean baselines.
  // Tangible cagematch outputs in docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/*/
  // Non-software-distribution: GPL tools (StableGen/Comfy) for Track B only server-side; no GPL in distrib or committed artifacts.
  evidencePlan: {
    mitPbrBakes: {
      patient: {
        basecolor: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_patient_child/basecolor.png";
        normal: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_patient_child/normal.png";
        roughness: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_patient_child/roughness.png";
        metallic: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_patient_child/metallic.png";
        ao: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_patient_child/ao.png";
        beforeAfterPlan: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_patient_child/before_after_plan.json";
      };
      parent: {
        basecolor: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_anxious_parent/basecolor.png";
        normal: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_anxious_parent/normal.png";
        roughness: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_anxious_parent/roughness.png";
        metallic: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_anxious_parent/metallic.png";
        ao: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_anxious_parent/ao.png";
        beforeAfterPlan: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_anxious_parent/before_after_plan.json";
      };
      nurse: {
        basecolor: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_nurse_kevin/basecolor.png";
        normal: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_nurse_kevin/normal.png";
        roughness: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_nurse_kevin/roughness.png";
        metallic: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_nurse_kevin/metallic.png";
        ao: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_nurse_kevin/ao.png";
        beforeAfterPlan: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_nurse_kevin/before_after_plan.json";
      };
    };
    beforeScreenshotPaths: {
      patient: "docs/openclinxr/model-vetting-patient-real-anny-clean-baseline-three-quarter-2026-06-06.png";
      parent: "docs/openclinxr/model-vetting-parent-real-anny-clean-baseline-three-quarter-2026-06-06.png";
      nurse: "docs/openclinxr/model-vetting-nurse-real-anny-clean-baseline-three-quarter-2026-06-06.png";
    };
    plannedAfterScreenshotPaths: {
      patient: "docs/openclinxr/model-vetting-patient-stablegen-skin-cagematch-three-quarter-2026-06-06.png";
      parent: "docs/openclinxr/model-vetting-parent-stablegen-skin-cagematch-three-quarter-2026-06-06.png";
      nurse: "docs/openclinxr/model-vetting-nurse-stablegen-skin-cagematch-three-quarter-2026-06-06.png";
    };
    plannedTextureHashPath: "docs/openclinxr/anny-skin-texture-cagematch-texture-hashes-peds-asthma-parent-anxiety-2026-06-06.json";
    plannedReportPath: "docs/openclinxr/anny-skin-texture-cagematch-report-peds-asthma-parent-anxiety-2026-06-06.json";
    beforeAfterRequired: true;
  };
  providerBoundary: {
    localOnly: true;
    manifestOnly: true;
    stableGenGenerationAttempted: false;
    comfyWorkflowQueued: false;
    diffusionWeightsLoaded: false;
    modelDownloadsUsed: false;
    externalNetworkUsed: false;
    paidApiUsed: false;
    credentialsUsed: false;
    runtimePromotionAllowed: false;
    productionAssetReadinessClaimed: false;
  };
  readiness: {
    status: "ready_for_local_stablegen_one_actor_trial" | "blocked_pending_checkpoint_license_manifest" | "blocked_skin_stack_not_ready";
    readyForGeneration: boolean;
    blockers: string[];
    nextSafeStep: string;
  };
  notEvidenceFor: [
    "generated_skin_quality",
    "stablegen_texture_success",
    "diffusion_model_license_clearance",
    "b_plus_visual_realism_gate",
    "production_asset_readiness",
    "quest_readiness",
    "learner_readiness",
    "clinical_validity",
    "scoring_validity",
  ];
};

type CandidateBundle = {
  actorId?: unknown;
  actorRole?: unknown;
  outputs?: {
    glbPath?: unknown;
  };
};

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestPath("docs/openclinxr/anny-skin-texture-cagematch-manifest-*.json");
    if (!validatePath) throw new Error("Missing Anny skin texture cagematch manifest to validate.");
    const validation = validateAnnySkinTextureCagematchManifest(await readJson<unknown>(validatePath));
    if (validation.ok) {
      console.log(`Validated ${validatePath}`);
      return;
    }
    for (const error of validation.errors) console.error(error);
    process.exitCode = 1;
    return;
  }

  const manifest = await buildAnnySkinTextureCagematchManifest({
    sourceProbePath: options.sourceProbePath,
  });
  await writeJson(options.outputPath ?? defaultOutputPath, manifest);
  console.log(`Wrote ${options.outputPath ?? defaultOutputPath}`);
}

export async function buildAnnySkinTextureCagematchManifest(input: {
  generatedAt?: string;
  sourceProbePath?: string;
  sourceProbe?: AnnySkinCagematchProbeReport;
} = {}): Promise<AnnySkinTextureCagematchManifest> {
  const sourceProbePath = input.sourceProbePath ?? await requiredLatestPath("docs/openclinxr/anny-skin-cagematch-probe-*.json");
  const sourceProbe = input.sourceProbe ?? await readJson<AnnySkinCagematchProbeReport>(sourceProbePath);
  const probeValidation = validateAnnySkinCagematchProbeReport(sourceProbe);
  if (!probeValidation.ok) throw new Error(`Invalid skin cagematch probe: ${probeValidation.errors.join("; ")}`);
  const stablegenReady = sourceProbe.observations.blenderAddons.stablegen.status === "available";
  const comfyReady = sourceProbe.observations.comfyui.status === "available";
  const optimizeReady =
    sourceProbe.observations.cliTools.fastSimplification.status === "available"
    && sourceProbe.observations.cliTools.trimesh.status === "available"
    && sourceProbe.observations.cliTools.gltfTransform.status === "available";
  const skinStackReady = stablegenReady && comfyReady && optimizeReady;
  const realVis = sourceProbe.licensedCheckpoints?.["RealVisXL_V5.0_fp16.safetensors"];
  const checkpointReady = Boolean(realVis?.exists && realVis.localPath);
  const selectedCheckpointPath = checkpointReady ? realVis.localPath : null;
  const selectedCheckpointSha256 = selectedCheckpointPath ? await sha256File(selectedCheckpointPath) : null;
  const readyForGeneration = skinStackReady && checkpointReady;
  const blockers = [
    skinStackReady ? undefined : "local_skin_stack_not_ready",
    checkpointReady ? undefined : "realvisxl_v5_0_fp16_checkpoint_not_cached_or_not_license_recorded",
  ].filter((value): value is string => Boolean(value));

  // Build candidates for all 3 (patient/parent/nurse) from clean baselines; shas computed for provenance.
  const candidates = await Promise.all(actorConfigs.map(async (cfg) => {
    const bundle = await readJson<CandidateBundle>(cfg.bundlePath);
    const glbPath = stringOr(bundle.outputs?.glbPath, cfg.glbPath);
    const sha = await sha256File(glbPath);
    const bundleActorId = stringOr(bundle.actorId, "");
    if (!bundleActorId) throw new Error(`Missing actorId in ${cfg.bundlePath}`);
    return {
      scenarioId,
      actorId: bundleActorId,
      role: cfg.role,
      sourceBundlePath: cfg.bundlePath,
      sourceGlbPath: glbPath,
      sourceGlbSha256: sha,
      copiedCandidateOnly: true as const,
      runtimeAssetOverwriteAllowed: false as const,
      plannedWorkingDir: cfg.plannedWorkingDir,
    };
  }));

  return {
    schemaVersion: "openclinxr.anny-skin-texture-cagematch-manifest.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    claimScope: "copied_candidate_skin_texture_cagematch_plan_no_generation",
    sourceProbePath,
    candidates,
    localStack: {
      stablegenAvailable: stablegenReady,
      comfyuiAvailableAtProbeTime: comfyReady,
      simplifyOptimizeAvailable: optimizeReady,
      cloudrigAvailable: sourceProbe.observations.blenderAddons.cloudrig.status === "available",
    },
    checkpointBoundary: {
      selectedCheckpointPath,
      selectedCheckpointSha256,
      licenseManifestPath: checkpointReady
        ? `${sourceProbePath}#/licensedCheckpoints/RealVisXL_V5.0_fp16.safetensors`
        : null,
      licenseReviewed: checkpointReady,
      cacheReuseKey: checkpointReady ? "realvisxl_v5_0_fp16_creativeml_openrailpp_m_local_2026-06-06" : null,
      modelDownloadApprovedByThisManifest: checkpointReady,
      generationBlockedUntilManifestComplete: !readyForGeneration,
      requiredFieldsBeforeGeneration: [
        "checkpoint_source_url",
        "checkpoint_license",
        "checkpoint_local_path",
        "checkpoint_sha256",
        "cache_reuse_key",
        "human_skin_prompt_boundary",
      ],
    },
    evidencePlan: {
      mitPbrBakes: {
        patient: {
          basecolor: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_patient_child/basecolor.png",
          normal: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_patient_child/normal.png",
          roughness: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_patient_child/roughness.png",
          metallic: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_patient_child/metallic.png",
          ao: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_patient_child/ao.png",
          beforeAfterPlan: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_patient_child/before_after_plan.json",
        },
        parent: {
          basecolor: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_anxious_parent/basecolor.png",
          normal: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_anxious_parent/normal.png",
          roughness: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_anxious_parent/roughness.png",
          metallic: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_anxious_parent/metallic.png",
          ao: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_anxious_parent/ao.png",
          beforeAfterPlan: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_anxious_parent/before_after_plan.json",
        },
        nurse: {
          basecolor: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_nurse_kevin/basecolor.png",
          normal: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_nurse_kevin/normal.png",
          roughness: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_nurse_kevin/roughness.png",
          metallic: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_nurse_kevin/metallic.png",
          ao: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_nurse_kevin/ao.png",
          beforeAfterPlan: "docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-2026-06-05/peds_nurse_kevin/before_after_plan.json",
        },
      },
      beforeScreenshotPaths: {
        patient: "docs/openclinxr/model-vetting-patient-real-anny-clean-baseline-three-quarter-2026-06-06.png",
        parent: "docs/openclinxr/model-vetting-parent-real-anny-clean-baseline-three-quarter-2026-06-06.png",
        nurse: "docs/openclinxr/model-vetting-nurse-real-anny-clean-baseline-three-quarter-2026-06-06.png",
      },
      plannedAfterScreenshotPaths: {
        patient: "docs/openclinxr/model-vetting-patient-stablegen-skin-cagematch-three-quarter-2026-06-06.png",
        parent: "docs/openclinxr/model-vetting-parent-stablegen-skin-cagematch-three-quarter-2026-06-06.png",
        nurse: "docs/openclinxr/model-vetting-nurse-stablegen-skin-cagematch-three-quarter-2026-06-06.png",
      },
      plannedTextureHashPath: "docs/openclinxr/anny-skin-texture-cagematch-texture-hashes-peds-asthma-parent-anxiety-2026-06-06.json",
      plannedReportPath: "docs/openclinxr/anny-skin-texture-cagematch-report-peds-asthma-parent-anxiety-2026-06-06.json",
      beforeAfterRequired: true,
    },
    providerBoundary: {
      localOnly: true,
      manifestOnly: true,
      stableGenGenerationAttempted: false,
      comfyWorkflowQueued: false,
      diffusionWeightsLoaded: false,
      modelDownloadsUsed: false,
      externalNetworkUsed: false,
      paidApiUsed: false,
      credentialsUsed: false,
      runtimePromotionAllowed: false,
      productionAssetReadinessClaimed: false,
    },
    readiness: {
      status: readyForGeneration
        ? "ready_for_local_stablegen_one_actor_trial"
        : (skinStackReady ? "blocked_pending_checkpoint_license_manifest" : "blocked_skin_stack_not_ready"),
      readyForGeneration,
      blockers,
      nextSafeStep: readyForGeneration
        ? "Run one local-only StableGen/ComfyUI copied-candidate trial, starting with the peds patient, then capture before/after isolated model-vetting evidence and visual-adversary review before any promotion."
        : skinStackReady
          ? "Select or install a local diffusion checkpoint only with source URL, license, local path, sha256, and cache reuse key; then capture before/after isolated model-vetting evidence on a copied candidate. MIT Track A PBR bakes complete for all 3 (see evidencePlan.mitPbrBakes)."
        : "Restore the local StableGen/ComfyUI/simplify stack, then rerun the skin cagematch probe before selecting a checkpoint.",
    },
    notEvidenceFor: [
      "generated_skin_quality",
      "stablegen_texture_success",
      "diffusion_model_license_clearance",
      "b_plus_visual_realism_gate",
      "production_asset_readiness",
      "quest_readiness",
      "learner_readiness",
      "clinical_validity",
      "scoring_validity",
    ],
  };
}

export function validateAnnySkinTextureCagematchManifest(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be object"] };
  requireLiteral(value["schemaVersion"], "openclinxr.anny-skin-texture-cagematch-manifest.v1", "/schemaVersion", errors);
  requireLiteral(value["claimScope"], "copied_candidate_skin_texture_cagematch_plan_no_generation", "/claimScope", errors);
  const providerBoundary = value["providerBoundary"];
  if (!isRecord(providerBoundary)) errors.push("/providerBoundary must be object");
  else for (const key of ["localOnly", "manifestOnly"]) requireLiteral(providerBoundary[key], true, `/providerBoundary/${key}`, errors);
  if (isRecord(providerBoundary)) for (const key of ["stableGenGenerationAttempted", "comfyWorkflowQueued", "diffusionWeightsLoaded", "modelDownloadsUsed", "externalNetworkUsed", "paidApiUsed", "credentialsUsed", "runtimePromotionAllowed", "productionAssetReadinessClaimed"]) {
    requireLiteral(providerBoundary[key], false, `/providerBoundary/${key}`, errors);
  }
  // (candidate single removed; now validated via /candidates array of 3)
  const checkpointBoundary = value["checkpointBoundary"];
  if (!isRecord(checkpointBoundary)) errors.push("/checkpointBoundary must be object");
  else {
    if (checkpointBoundary["selectedCheckpointPath"] !== null) requireString(checkpointBoundary["selectedCheckpointPath"], "/checkpointBoundary/selectedCheckpointPath", errors);
    if (checkpointBoundary["selectedCheckpointSha256"] !== null) requireSha256(checkpointBoundary["selectedCheckpointSha256"], "/checkpointBoundary/selectedCheckpointSha256", errors);
    if (checkpointBoundary["licenseManifestPath"] !== null) requireString(checkpointBoundary["licenseManifestPath"], "/checkpointBoundary/licenseManifestPath", errors);
    if (typeof checkpointBoundary["licenseReviewed"] !== "boolean") errors.push("/checkpointBoundary/licenseReviewed must be boolean");
    if (typeof checkpointBoundary["modelDownloadApprovedByThisManifest"] !== "boolean") errors.push("/checkpointBoundary/modelDownloadApprovedByThisManifest must be boolean");
    if (typeof checkpointBoundary["generationBlockedUntilManifestComplete"] !== "boolean") errors.push("/checkpointBoundary/generationBlockedUntilManifestComplete must be boolean");
    requireStringArray(checkpointBoundary["requiredFieldsBeforeGeneration"], "/checkpointBoundary/requiredFieldsBeforeGeneration", errors);
  }
  const readiness = value["readiness"];
  if (!isRecord(readiness)) errors.push("/readiness must be object");
  else {
    if (typeof readiness["readyForGeneration"] !== "boolean") errors.push("/readiness/readyForGeneration must be boolean");
    requireStringArray(readiness["blockers"], "/readiness/blockers", errors);
  }
  // Validate multi-candidate for patient/parent/nurse (updated from single)
  const candidates = value["candidates"];
  if (!Array.isArray(candidates) || candidates.length !== 3) errors.push("/candidates must be array of 3 (patient/parent/nurse)");
  else {
    for (const [idx, c] of candidates.entries()) {
      if (!isRecord(c)) errors.push(`/candidates/${idx} must be object`);
      else {
        requireLiteral(c["runtimeAssetOverwriteAllowed"], false, `/candidates/${idx}/runtimeAssetOverwriteAllowed`, errors);
        requireLiteral(c["copiedCandidateOnly"], true, `/candidates/${idx}/copiedCandidateOnly`, errors);
        requireSha256(c["sourceGlbSha256"], `/candidates/${idx}/sourceGlbSha256`, errors);
      }
    }
  }
  for (const gate of ["generated_skin_quality", "stablegen_texture_success", "diffusion_model_license_clearance", "b_plus_visual_realism_gate", "production_asset_readiness", "quest_readiness", "learner_readiness", "clinical_validity", "scoring_validity"]) {
    requireStringArrayIncludes(value["notEvidenceFor"], gate, "/notEvidenceFor", errors);
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function requiredLatestPath(pattern: string): Promise<string> {
  const path = await latestPath(pattern);
  if (!path) throw new Error(`Missing required file for ${pattern}`);
  return path;
}

async function latestPath(pattern: string): Promise<string | undefined> {
  const paths = await globFiles(pattern);
  return paths.sort().at(-1);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { validateLatest: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--output") options.outputPath = requireNext(args, ++index, arg);
    else if (arg === "--validate") options.validatePath = requireNext(args, ++index, arg);
    else if (arg === "--validate-latest") options.validateLatest = true;
    else if (arg === "--source-probe") options.sourceProbePath = requireNext(args, ++index, arg);
    else throw new Error(`Unknown argument: ${arg ?? ""}`);
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

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function requireLiteral(value: unknown, expected: unknown, pointer: string, errors: string[]): void {
  if (value !== expected) errors.push(`${pointer} must be ${JSON.stringify(expected)}`);
}

function requireString(value: unknown, pointer: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) errors.push(`${pointer} must be nonempty string`);
}

function requireSha256(value: unknown, pointer: string, errors: string[]): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) errors.push(`${pointer} must be sha256 hex`);
}

function requireStringArray(value: unknown, pointer: string, errors: string[]): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) errors.push(`${pointer} must be string array`);
}

function requireStringArrayIncludes(value: unknown, expected: string, pointer: string, errors: string[]): void {
  if (!Array.isArray(value) || !value.includes(expected)) errors.push(`${pointer} must include ${expected}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
