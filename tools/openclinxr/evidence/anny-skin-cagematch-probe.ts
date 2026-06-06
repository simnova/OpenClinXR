import { execFile } from "node:child_process";
import { access, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { globFiles, writeJson, readJson } from "../../agent-factory/lib.js";

const execFileAsync = promisify(execFile);
const defaultOutputPath = `docs/openclinxr/anny-skin-cagematch-probe-${new Date().toISOString().slice(0, 10)}.json`;
const defaultComfyUrl = "http://127.0.0.1:8188";

type CliOptions = {
  outputPath?: string;
  validateLatest: boolean;
  validatePath?: string;
  blenderExecutable: string;
  comfyUrl: string;
};

type AvailabilityStatus = "available" | "missing" | "unknown";
type CandidateStatus = "ready_for_local_cagematch" | "blocked" | "advisory_only";

type ToolObservation = {
  status: AvailabilityStatus;
  executable?: string | null;
  version?: string | null;
  detail?: string | null;
};

type BlenderAddonObservation = {
  status: AvailabilityStatus;
  moduleName: string | null;
  source: string | null;
};

type ComfyObservation = {
  status: AvailabilityStatus;
  url: string;
  endpoint: "/system_stats";
  responseStatus: number | null;
  hasSystemStats: boolean;
  detail: string | null;
};

type PathObservation = {
  path: string;
  exists: boolean;
};

type LicensedCheckpointObservation = {
  source: string;
  license: "CreativeML Open RAIL++-M";
  licenseUrl: string;
  placementDate: "2026-06-06";
  usage: string;
  localPath: string;
  exists: boolean;
  sizeBytes: number | null;
};

type SupportingModelObservation = {
  source: string;
  localPath: string;
  exists: boolean;
  sizeBytes: number | null;
  usage: string;
};

export type AnnySkinCagematchProbeReport = {
  schemaVersion: "openclinxr.anny-skin-cagematch-probe.v1";
  generatedAt: string;
  claimScope: "local_skin_texturing_and_rigging_cagematch_availability_only";
  upstreamReferences: Array<{
    id: "stablegen" | "comfyui" | "cloudrig";
    url: string;
    observedUse: string;
    licensePosture: "GPL-3.0" | "GPL-3.0-or-later";
    claimBoundary: string;
  }>;
  providerBoundary: {
    localOnly: true;
    availabilityProbeOnly: true;
    blenderExecutedForProbe: boolean;
    comfyStatusEndpointProbed: boolean;
    stableGenGenerationAttempted: false;
    comfyWorkflowQueued: false;
    diffusionWeightsLoaded: false;
    modelDownloadsUsed: false;
    externalNetworkUsed: false;
    paidApiUsed: false;
    credentialsUsed: false;
    productionAssetReadinessClaimed: false;
  };
  licensedCheckpoints: {
    "RealVisXL_V5.0_fp16.safetensors": LicensedCheckpointObservation;
  };
  supportingModels: {
    "ip-adapter-plus_sdxl_vit-h.safetensors": SupportingModelObservation;
    "controlnet_depth_sdxl.safetensors": SupportingModelObservation;
    "CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors": SupportingModelObservation;
  };
  observations: {
    blender: ToolObservation;
    blenderAddons: {
      stablegen: BlenderAddonObservation;
      cloudrig: BlenderAddonObservation;
      rigify: BlenderAddonObservation;
    };
    comfyui: ComfyObservation;
    localPaths: {
      comfyUiCandidates: PathObservation[];
      blenderAddonCandidates: PathObservation[];
    };
    cliTools: {
      fastSimplification: ToolObservation;
      trimesh: ToolObservation;
      gltfTransform: ToolObservation;
    };
  };
  candidates: Array<{
    id: "stablegen_comfyui_skin_texturing" | "cloudrig_rigging" | "simplify_optimize_webxr";
    status: CandidateStatus;
    blockers: string[];
    nextSafeStep: string;
    notEvidenceFor: string[];
  }>;
  readiness: {
    status:
      | "blocked_missing_local_skin_generation_stack"
      | "ready_for_local_skin_texture_cagematch_without_generation"
      | "blocked_missing_blender";
    readyForLocalTextureCagematch: boolean;
    generationAllowedByThisReport: false;
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

type ProbeInput = {
  generatedAt?: string;
  blenderExecutable?: string;
  comfyUrl?: string;
  observations?: AnnySkinCagematchProbeReport["observations"];
};

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestPath("docs/openclinxr/anny-skin-cagematch-probe-*.json");
    if (!validatePath) throw new Error("Missing Anny skin cagematch probe report to validate.");
    const validation = validateAnnySkinCagematchProbeReport(await readJson<unknown>(validatePath));
    if (validation.ok) {
      console.log(`Validated ${validatePath}`);
      return;
    }
    for (const error of validation.errors) console.error(error);
    process.exitCode = 1;
    return;
  }

  const report = await buildAnnySkinCagematchProbeReport({
    blenderExecutable: options.blenderExecutable,
    comfyUrl: options.comfyUrl,
  });
  await writeJson(options.outputPath ?? defaultOutputPath, report);
  console.log(`Wrote ${options.outputPath ?? defaultOutputPath}`);
}

export async function buildAnnySkinCagematchProbeReport(input: ProbeInput = {}): Promise<AnnySkinCagematchProbeReport> {
  const observations = input.observations ?? await probeLocalStack({
    blenderExecutable: input.blenderExecutable ?? process.env.BLENDER_PATH ?? "blender",
    comfyUrl: input.comfyUrl ?? process.env.COMFYUI_URL ?? defaultComfyUrl,
  });

  const blenderAvailable = observations.blender.status === "available";
  const stablegenAvailable = observations.blenderAddons.stablegen.status === "available";
  const cloudrigAvailable = observations.blenderAddons.cloudrig.status === "available";
  const comfyAvailable = observations.comfyui.status === "available";
  const licensedModels = await probeLicensedLocalModelCache();
  const realVisCheckpointReady = licensedModels.licensedCheckpoints["RealVisXL_V5.0_fp16.safetensors"].exists;
  const simplifyAvailable =
    observations.cliTools.fastSimplification.status === "available"
    && observations.cliTools.trimesh.status === "available"
    && observations.cliTools.gltfTransform.status === "available";

  const skinBlockers = unique([
    blenderAvailable ? undefined : "blender_executable_missing_or_unusable",
    stablegenAvailable ? undefined : "stablegen_blender_addon_not_detected",
    comfyAvailable ? undefined : "comfyui_local_server_not_available",
    realVisCheckpointReady ? undefined : "realvisxl_v5_0_fp16_checkpoint_not_cached",
    "before_after_skin_texture_screenshot_plan_required",
    // evidencePlan/paths updated in anny-skin-texture-cagematch-manifest.ts for peds_asthma_parent_anxiety_v1 (patient/parent/nurse) + MIT Track A PBR bakes (see mitPbrBakes + before/after plans in cagematch dir)
  ]);
  const cloudrigBlockers = unique([
    blenderAvailable ? undefined : "blender_executable_missing_or_unusable",
    cloudrigAvailable ? undefined : "cloudrig_blender_addon_not_detected",
    "anny_specific_metarig_alignment_template_not_recorded",
  ]);
  const simplifyBlockers = unique([
    observations.cliTools.fastSimplification.status === "available" ? undefined : "python_module_fast_simplification_missing",
    observations.cliTools.trimesh.status === "available" ? undefined : "python_module_trimesh_missing",
    observations.cliTools.gltfTransform.status === "available" ? undefined : "gltf_transform_cli_missing_or_unusable",
  ]);

  const readyForTextureCagematch = blenderAvailable && stablegenAvailable && comfyAvailable;
  const readinessBlockers = unique([
    ...skinBlockers,
    cloudrigAvailable ? undefined : "cloudrig_not_ready_for_rigging_cagematch",
    simplifyAvailable ? undefined : "simplify_optimize_stack_not_fully_available",
  ]);

  return {
    schemaVersion: "openclinxr.anny-skin-cagematch-probe.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    claimScope: "local_skin_texturing_and_rigging_cagematch_availability_only",
    upstreamReferences: [
      {
        id: "stablegen",
        url: "https://github.com/sakalond/StableGen",
        observedUse: "Blender add-on candidate for local multi-view texture generation/refinement through ComfyUI.",
        licensePosture: "GPL-3.0",
        claimBoundary: "Availability and license posture only; no generated skin quality or model-weight clearance claimed.",
      },
      {
        id: "comfyui",
        url: "https://github.com/Comfy-Org/ComfyUI",
        observedUse: "Local diffusion backend candidate for StableGen skin texture workflows.",
        licensePosture: "GPL-3.0",
        claimBoundary: "Local server probe only; cloud/API nodes, paid cloud, model downloads, and queued workflows stay out of scope.",
      },
      {
        id: "cloudrig",
        url: "https://extensions.blender.org/add-ons/cloudrig/",
        observedUse: "Blender Studio rig generation extension candidate for later Anny rigging cagematches.",
        licensePosture: "GPL-3.0-or-later",
        claimBoundary: "Add-on availability only; no Anny metarig fit, skin weights, facial rig, or runtime suitability claimed.",
      },
    ],
    providerBoundary: {
      localOnly: true,
      availabilityProbeOnly: true,
      blenderExecutedForProbe: blenderAvailable,
      comfyStatusEndpointProbed: true,
      stableGenGenerationAttempted: false,
      comfyWorkflowQueued: false,
      diffusionWeightsLoaded: false,
      modelDownloadsUsed: false,
      externalNetworkUsed: false,
      paidApiUsed: false,
      credentialsUsed: false,
      productionAssetReadinessClaimed: false,
    },
    licensedCheckpoints: licensedModels.licensedCheckpoints,
    supportingModels: licensedModels.supportingModels,
    observations,
    candidates: [
      {
        id: "stablegen_comfyui_skin_texturing",
        status: readyForTextureCagematch ? "ready_for_local_cagematch" : "blocked",
        blockers: skinBlockers,
        nextSafeStep: readyForTextureCagematch
          ? "Run one local-only before/after Anny skin texturing cagematch on a copied candidate, recording checkpoint license/cache provenance and screenshots before any promotion."
          : "Install/enable StableGen and start a local ComfyUI server, then record local checkpoint license/cache provenance before any generation.",
        notEvidenceFor: [
          "generated_skin_quality",
          "stablegen_texture_success",
          "b_plus_visual_realism_gate",
          "production_asset_readiness",
        ],
      },
      {
        id: "cloudrig_rigging",
        status: cloudrigBlockers.length === 0 ? "ready_for_local_cagematch" : "blocked",
        blockers: cloudrigBlockers,
        nextSafeStep: cloudrigBlockers.length === 0
          ? "Run a separate copied-mesh CloudRig metarig-fit cagematch with no runtime promotion."
          : "Enable CloudRig in Blender and create/record an Anny-specific metarig alignment template before using it on candidates.",
        notEvidenceFor: [
          "skin_weight_quality",
          "facial_rig_quality",
          "animation_retargeting_quality",
          "production_asset_readiness",
          "quest_readiness",
        ],
      },
      {
        id: "simplify_optimize_webxr",
        status: simplifyAvailable ? "advisory_only" : "blocked",
        blockers: simplifyBlockers,
        nextSafeStep: simplifyAvailable
          ? "Use simplification/optimization only after a visible candidate exists, preserving before/after screenshots and structural GLB inspection."
          : "Install missing local simplification or glTF optimization tools before performance cagematches.",
        notEvidenceFor: [
          "visual_realism_improvement",
          "rig_quality",
          "production_asset_readiness",
          "quest_readiness",
        ],
      },
    ],
    readiness: {
      status: blenderAvailable
        ? (readyForTextureCagematch ? "ready_for_local_skin_texture_cagematch_without_generation" : "blocked_missing_local_skin_generation_stack")
        : "blocked_missing_blender",
      readyForLocalTextureCagematch: readyForTextureCagematch,
      generationAllowedByThisReport: false,
      blockers: readinessBlockers,
      nextSafeStep: readyForTextureCagematch
        ? "Create a no-promotion copied-candidate skin cagematch task with checkpoint license/cache manifest and before/after model-vetting screenshots."
        : "Close the missing local availability blockers, then rerun this probe before attempting StableGen/ComfyUI generation.",
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

export function validateAnnySkinCagematchProbeReport(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be object"] };
  requireLiteral(value["schemaVersion"], "openclinxr.anny-skin-cagematch-probe.v1", "/schemaVersion", errors);
  requireLiteral(value["claimScope"], "local_skin_texturing_and_rigging_cagematch_availability_only", "/claimScope", errors);
  const providerBoundary = value["providerBoundary"];
  if (!isRecord(providerBoundary)) errors.push("/providerBoundary must be object");
  else {
    requireLiteral(providerBoundary["localOnly"], true, "/providerBoundary/localOnly", errors);
    requireLiteral(providerBoundary["availabilityProbeOnly"], true, "/providerBoundary/availabilityProbeOnly", errors);
    requireLiteral(providerBoundary["stableGenGenerationAttempted"], false, "/providerBoundary/stableGenGenerationAttempted", errors);
    requireLiteral(providerBoundary["comfyWorkflowQueued"], false, "/providerBoundary/comfyWorkflowQueued", errors);
    requireLiteral(providerBoundary["diffusionWeightsLoaded"], false, "/providerBoundary/diffusionWeightsLoaded", errors);
    requireLiteral(providerBoundary["modelDownloadsUsed"], false, "/providerBoundary/modelDownloadsUsed", errors);
    requireLiteral(providerBoundary["externalNetworkUsed"], false, "/providerBoundary/externalNetworkUsed", errors);
    requireLiteral(providerBoundary["paidApiUsed"], false, "/providerBoundary/paidApiUsed", errors);
    requireLiteral(providerBoundary["credentialsUsed"], false, "/providerBoundary/credentialsUsed", errors);
    requireLiteral(providerBoundary["productionAssetReadinessClaimed"], false, "/providerBoundary/productionAssetReadinessClaimed", errors);
  }

  const observations = value["observations"];
  if (!isRecord(observations)) errors.push("/observations must be object");
  else {
    validateToolObservation(observations["blender"], "/observations/blender", errors);
    const addons = observations["blenderAddons"];
    if (!isRecord(addons)) errors.push("/observations/blenderAddons must be object");
    else for (const addonName of ["stablegen", "cloudrig", "rigify"]) validateAddonObservation(addons[addonName], `/observations/blenderAddons/${addonName}`, errors);
    validateComfyObservation(observations["comfyui"], "/observations/comfyui", errors);
  }

  const licensedCheckpoints = value["licensedCheckpoints"];
  if (!isRecord(licensedCheckpoints)) errors.push("/licensedCheckpoints must be object");
  else {
    const realVis = licensedCheckpoints["RealVisXL_V5.0_fp16.safetensors"];
    if (!isRecord(realVis)) errors.push("/licensedCheckpoints/RealVisXL_V5.0_fp16.safetensors must be object");
    else {
      requireLiteral(realVis["source"], "https://huggingface.co/SG161222/RealVisXL_V5.0", "/licensedCheckpoints/RealVisXL_V5.0_fp16.safetensors/source", errors);
      requireLiteral(realVis["license"], "CreativeML Open RAIL++-M", "/licensedCheckpoints/RealVisXL_V5.0_fp16.safetensors/license", errors);
      requireLiteral(realVis["licenseUrl"], "https://github.com/Stability-AI/generative-models/blob/main/model_licenses/LICENSE-SDXL1.0", "/licensedCheckpoints/RealVisXL_V5.0_fp16.safetensors/licenseUrl", errors);
      requireLiteral(realVis["placementDate"], "2026-06-06", "/licensedCheckpoints/RealVisXL_V5.0_fp16.safetensors/placementDate", errors);
      requireString(realVis["usage"], "/licensedCheckpoints/RealVisXL_V5.0_fp16.safetensors/usage", errors);
      requireString(realVis["localPath"], "/licensedCheckpoints/RealVisXL_V5.0_fp16.safetensors/localPath", errors);
    }
  }

  const candidates = value["candidates"];
  if (!Array.isArray(candidates) || candidates.length < 3) errors.push("/candidates must include skin, rigging, and optimization candidates");
  else for (const [index, candidate] of candidates.entries()) validateCandidate(candidate, `/candidates/${index}`, errors);

  const readiness = value["readiness"];
  if (!isRecord(readiness)) errors.push("/readiness must be object");
  else {
    requireLiteral(readiness["generationAllowedByThisReport"], false, "/readiness/generationAllowedByThisReport", errors);
    requireStringArray(readiness["blockers"], "/readiness/blockers", errors);
    requireString(readiness["nextSafeStep"], "/readiness/nextSafeStep", errors);
  }

  for (const gate of ["generated_skin_quality", "stablegen_texture_success", "diffusion_model_license_clearance", "b_plus_visual_realism_gate", "production_asset_readiness", "quest_readiness", "learner_readiness", "clinical_validity", "scoring_validity"]) {
    requireStringArrayIncludes(value["notEvidenceFor"], gate, "/notEvidenceFor", errors);
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

async function probeLocalStack(input: { blenderExecutable: string; comfyUrl: string }): Promise<AnnySkinCagematchProbeReport["observations"]> {
  const [blender, comfyui, localPaths, cliTools] = await Promise.all([
    probeBlender(input.blenderExecutable),
    probeComfy(input.comfyUrl),
    probeLocalPaths(),
    probeCliTools(),
  ]);
  const blenderAddons = blender.status === "available"
    ? await probeBlenderAddons(input.blenderExecutable)
    : missingAddons();

  return {
    blender,
    blenderAddons,
    comfyui,
    localPaths,
    cliTools,
  };
}

async function probeBlender(blenderExecutable: string): Promise<ToolObservation> {
  try {
    const result = await execFileAsync(blenderExecutable, ["--version"], { timeout: 8_000, maxBuffer: 1024 * 1024 });
    return {
      status: "available",
      executable: blenderExecutable,
      version: result.stdout.split("\n").find((line) => /^Blender\s+/u.test(line))?.trim() ?? null,
      detail: null,
    };
  } catch (error) {
    return {
      status: "missing",
      executable: blenderExecutable,
      version: null,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function probeBlenderAddons(blenderExecutable: string): Promise<AnnySkinCagematchProbeReport["observations"]["blenderAddons"]> {
  const script = [
    "import addon_utils, json",
    "rows = []",
    "for module in addon_utils.modules():",
    "    name = getattr(module, '__name__', '')",
    "    enabled, loaded = addon_utils.check(name)",
    "    rows.append({'name': name, 'file': getattr(module, '__file__', None), 'enabled': bool(enabled), 'loaded': bool(loaded)})",
    "print('OPENCLINXR_ADDONS_JSON=' + json.dumps(rows))",
  ].join("\n");
  try {
    const result = await execFileAsync(blenderExecutable, ["--background", "--python-expr", script], { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 });
    const line = result.stdout.split("\n").find((row) => row.startsWith("OPENCLINXR_ADDONS_JSON="));
    const rows = line ? JSON.parse(line.slice("OPENCLINXR_ADDONS_JSON=".length)) as Array<Record<string, unknown>> : [];
    return {
      stablegen: addonFromRows(rows, /stablegen/i),
      cloudrig: addonFromRows(rows, /cloudrig/i),
      rigify: addonFromRows(rows, /rigify/i),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      stablegen: { status: "unknown", moduleName: null, source: detail },
      cloudrig: { status: "unknown", moduleName: null, source: detail },
      rigify: { status: "unknown", moduleName: null, source: detail },
    };
  }
}

async function probeComfy(comfyUrl: string): Promise<ComfyObservation> {
  const url = new URL("/system_stats", comfyUrl).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.json().catch(() => null) as unknown;
    return {
      status: response.ok && isRecord(body) ? "available" : "missing",
      url: comfyUrl,
      endpoint: "/system_stats",
      responseStatus: response.status,
      hasSystemStats: isRecord(body),
      detail: response.ok ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      status: "missing",
      url: comfyUrl,
      endpoint: "/system_stats",
      responseStatus: null,
      hasSystemStats: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeLocalPaths(): Promise<AnnySkinCagematchProbeReport["observations"]["localPaths"]> {
  const home = os.homedir();
  const comfyCandidates = unique([
    process.env.COMFYUI_DIR,
    path.join(home, "ComfyUI"),
    path.join(home, "Documents", "ComfyUI"),
    path.join(home, "Applications", "ComfyUI"),
  ]).map((candidatePath) => pathObservation(candidatePath));
  const blenderAddonCandidates = (await globFiles([
    path.join(home, "Library/Application Support/Blender/*/scripts/addons/*stablegen*"),
    path.join(home, "Library/Application Support/Blender/*/scripts/addons/*cloudrig*"),
    path.join(home, "Library/Application Support/Blender/*/extensions/*stablegen*"),
    path.join(home, "Library/Application Support/Blender/*/extensions/*cloudrig*"),
  ])).map((candidatePath) => pathObservation(candidatePath));
  return {
    comfyUiCandidates: await Promise.all(comfyCandidates),
    blenderAddonCandidates: await Promise.all(blenderAddonCandidates),
  };
}

async function probeLicensedLocalModelCache(): Promise<Pick<AnnySkinCagematchProbeReport, "licensedCheckpoints" | "supportingModels">> {
  const home = os.homedir();
  const realVisPath = path.join(home, "ComfyUI/models/checkpoints/RealVisXL_V5.0_fp16.safetensors");
  const ipAdapterPath = path.join(home, "ComfyUI/models/ipadapter/ip-adapter-plus_sdxl_vit-h.safetensors");
  const depthPath = path.join(home, "ComfyUI/models/controlnet/controlnet_depth_sdxl.safetensors");
  const clipVisionPath = path.join(home, "ComfyUI/models/clip_vision/CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors");
  return {
    licensedCheckpoints: {
      "RealVisXL_V5.0_fp16.safetensors": {
        source: "https://huggingface.co/SG161222/RealVisXL_V5.0",
        license: "CreativeML Open RAIL++-M",
        licenseUrl: "https://github.com/Stability-AI/generative-models/blob/main/model_licenses/LICENSE-SDXL1.0",
        placementDate: "2026-06-06",
        usage: "Local-only no-promotion skin texturing cagematch for Anny pediatric assets. No redistribution. Nonprofit medical training use.",
        localPath: realVisPath,
        ...(await filePresence(realVisPath)),
      },
    },
    supportingModels: {
      "ip-adapter-plus_sdxl_vit-h.safetensors": {
        source: "https://huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors",
        localPath: ipAdapterPath,
        usage: "Local-only IPAdapter support for no-promotion StableGen/ComfyUI Anny skin cagematches.",
        ...(await filePresence(ipAdapterPath)),
      },
      "controlnet_depth_sdxl.safetensors": {
        source: "https://huggingface.co/xinsir/controlnet-depth-sdxl-1.0/resolve/main/diffusion_pytorch_model.safetensors",
        localPath: depthPath,
        usage: "Local-only depth ControlNet support for no-promotion StableGen/ComfyUI Anny skin cagematches.",
        ...(await filePresence(depthPath)),
      },
      "CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors": {
        source: "https://huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/image_encoder/model.safetensors",
        localPath: clipVisionPath,
        usage: "Local-only SDXL CLIP vision encoder dependency for IPAdapter-backed StableGen/ComfyUI cagematches.",
        ...(await filePresence(clipVisionPath)),
      },
    },
  };
}

async function filePresence(filePath: string): Promise<{ exists: boolean; sizeBytes: number | null }> {
  try {
    const fileStat = await stat(filePath);
    return { exists: fileStat.isFile(), sizeBytes: fileStat.isFile() ? fileStat.size : null };
  } catch {
    return { exists: false, sizeBytes: null };
  }
}

async function probeCliTools(): Promise<AnnySkinCagematchProbeReport["observations"]["cliTools"]> {
  const [pythonModules, gltfTransform] = await Promise.all([
    probePythonModules(["fast_simplification", "trimesh"]),
    probeGltfTransform(),
  ]);
  return {
    fastSimplification: pythonModules.fast_simplification,
    trimesh: pythonModules.trimesh,
    gltfTransform,
  };
}

async function probePythonModules(moduleNames: string[]): Promise<Record<string, ToolObservation>> {
  const script = [
    "import importlib.util, json",
    `names = ${JSON.stringify(moduleNames)}`,
    "out = {}",
    "for name in names:",
    "    spec = importlib.util.find_spec(name)",
    "    out[name] = {'status': 'available' if spec else 'missing', 'location': spec.origin if spec else None}",
    "print(json.dumps(out))",
  ].join("\n");
  try {
    const result = await execFileAsync("python3", ["-c", script], { timeout: 5_000, maxBuffer: 1024 * 1024 });
    const parsed = JSON.parse(result.stdout) as Record<string, { status: AvailabilityStatus; location: string | null }>;
    return Object.fromEntries(moduleNames.map((moduleName) => [
      moduleName,
      {
        status: parsed[moduleName]?.status ?? "missing",
        executable: "python3",
        version: null,
        detail: parsed[moduleName]?.location ?? null,
      },
    ]));
  } catch (error) {
    return Object.fromEntries(moduleNames.map((moduleName) => [
      moduleName,
      {
        status: "unknown",
        executable: "python3",
        version: null,
        detail: error instanceof Error ? error.message : String(error),
      },
    ]));
  }
}

async function pathObservation(candidatePath: string): Promise<PathObservation> {
  return { path: candidatePath, exists: await pathExists(candidatePath) };
}

async function probeGltfTransform(): Promise<ToolObservation> {
  const localBinary = path.join(process.cwd(), "node_modules/.bin/gltf-transform");
  const binaryExists = await pathExists(localBinary);
  try {
    const result = await execFileAsync(localBinary, ["--version"], { timeout: 10_000, maxBuffer: 1024 * 1024 });
    const output = `${result.stdout}\n${result.stderr}`;
    return {
      status: "available",
      executable: localBinary,
      version: /([0-9]+\.[0-9]+\.[0-9]+)/u.exec(output)?.[1] ?? output.trim().split("\n").at(0) ?? null,
      detail: null,
    };
  } catch (error) {
    return {
      status: binaryExists ? "unknown" : "missing",
      executable: localBinary,
      version: null,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

function addonFromRows(rows: Array<Record<string, unknown>>, pattern: RegExp): BlenderAddonObservation {
  const row = rows.find((candidate) => pattern.test(String(candidate["name"] ?? "")) || pattern.test(String(candidate["file"] ?? "")));
  return row
    ? { status: "available", moduleName: String(row["name"] ?? ""), source: row["file"] === null ? null : String(row["file"] ?? "") }
    : { status: "missing", moduleName: null, source: null };
}

function missingAddons(): AnnySkinCagematchProbeReport["observations"]["blenderAddons"] {
  return {
    stablegen: { status: "missing", moduleName: null, source: null },
    cloudrig: { status: "missing", moduleName: null, source: null },
    rigify: { status: "missing", moduleName: null, source: null },
  };
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    validateLatest: false,
    blenderExecutable: process.env.BLENDER_PATH ?? "blender",
    comfyUrl: process.env.COMFYUI_URL ?? defaultComfyUrl,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--output") options.outputPath = requireNext(args, ++index, arg);
    else if (arg === "--validate") options.validatePath = requireNext(args, ++index, arg);
    else if (arg === "--validate-latest") options.validateLatest = true;
    else if (arg === "--blender") options.blenderExecutable = requireNext(args, ++index, arg);
    else if (arg === "--comfy-url") options.comfyUrl = requireNext(args, ++index, arg);
    else throw new Error(`Unknown argument: ${arg ?? ""}`);
  }
  return options;
}

async function latestPath(pattern: string): Promise<string | undefined> {
  const paths = await globFiles(pattern);
  return paths.sort().at(-1);
}

function validateCandidate(value: unknown, pointer: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${pointer} must be object`);
    return;
  }
  requireString(value["id"], `${pointer}/id`, errors);
  if (!["ready_for_local_cagematch", "blocked", "advisory_only"].includes(String(value["status"]))) errors.push(`${pointer}/status invalid`);
  requireStringArray(value["blockers"], `${pointer}/blockers`, errors);
  requireString(value["nextSafeStep"], `${pointer}/nextSafeStep`, errors);
  requireStringArray(value["notEvidenceFor"], `${pointer}/notEvidenceFor`, errors);
  requireStringArrayIncludes(value["notEvidenceFor"], "production_asset_readiness", `${pointer}/notEvidenceFor`, errors);
}

function validateToolObservation(value: unknown, pointer: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${pointer} must be object`);
    return;
  }
  if (!["available", "missing", "unknown"].includes(String(value["status"]))) errors.push(`${pointer}/status invalid`);
}

function validateAddonObservation(value: unknown, pointer: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${pointer} must be object`);
    return;
  }
  if (!["available", "missing", "unknown"].includes(String(value["status"]))) errors.push(`${pointer}/status invalid`);
  if (value["moduleName"] !== null && typeof value["moduleName"] !== "string") errors.push(`${pointer}/moduleName must be string or null`);
  if (value["source"] !== null && typeof value["source"] !== "string") errors.push(`${pointer}/source must be string or null`);
}

function validateComfyObservation(value: unknown, pointer: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${pointer} must be object`);
    return;
  }
  if (!["available", "missing", "unknown"].includes(String(value["status"]))) errors.push(`${pointer}/status invalid`);
  requireLiteral(value["endpoint"], "/system_stats", `${pointer}/endpoint`, errors);
  requireString(value["url"], `${pointer}/url`, errors);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, pointer: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) errors.push(`${pointer} required`);
}

function requireLiteral(value: unknown, expected: unknown, pointer: string, errors: string[]): void {
  if (value !== expected) errors.push(`${pointer} must be ${JSON.stringify(expected)}`);
}

function requireStringArray(value: unknown, pointer: string, errors: string[]): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) errors.push(`${pointer} must be string array`);
}

function requireStringArrayIncludes(value: unknown, expected: string, pointer: string, errors: string[]): void {
  if (!Array.isArray(value) || !value.includes(expected)) errors.push(`${pointer} must include ${expected}`);
}

function requireNext(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string"))];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
