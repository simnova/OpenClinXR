/**
 * StableGen humanoid clothing/skin texture cagematch probe (#132).
 *
 * OUT-OF-REPO authoring tool only: this script does not import or vendor
 * StableGen. It measures local availability, records a generation attempt
 * against a shipped humanoid GLB, writes probe-report.json, and validates it.
 *
 * Licence position (operator 2026-08-07): try regardless of GPL-3; to be revisited.
 */
import { execFile } from "node:child_process";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const EVIDENCE_DIR = ".openclinxr/evidence/stablegen-humanoid-texture/latest";
const REPORT_NAME = "probe-report.json";
const SCHEMA = "openclinxr.stablegen-humanoid-texture-probe.v1" as const;

const VERDICTS = [
  "adopt_candidate",
  "reject_measured",
  "inconclusive_blocked",
  "other",
] as const;

type Verdict = (typeof VERDICTS)[number];

export type StablegenHumanoidTextureProbeReport = {
  schemaVersion: typeof SCHEMA;
  generatedAt: string;
  claimScope: "stablegen_humanoid_texture_cagematch_local_measurement_only";
  issue: "#132";
  targetAsset: {
    path: string;
    role: "peds_nurse_kevin";
    rationale: string;
    sourceBytes: number | null;
  };
  licence: {
    stablegen: "GPL-3.0-or-later";
    comfyui: "GPL-3.0";
    checkpoint: "CreativeML Open RAIL++-M";
    operatorClearance: string;
    deferred: true;
    toBeRevisited: true;
    outOfRepoAuthoringToolOnly: true;
    notVendored: true;
    notImportedByRepoCode: true;
    notShipped: true;
  };
  stack: {
    blender: { version: string | null; executable: string; available: boolean; detail: string | null };
    stablegen: {
      version: "0.3.0";
      blenderVersionMin: "4.2.0";
      path: string;
      enabledOnBlender51: boolean;
      connectToComfy: boolean;
      detail: string | null;
    };
    comfyui: {
      available: boolean;
      url: string;
      version: string | null;
      startCommandObserved: string;
      startVenvPath: string;
      startVenvHealthyOnDisk: boolean;
      startVenvNote: string;
      cwd: string;
      detail: string | null;
    };
    models: {
      checkpoint: { name: string; path: string; exists: boolean; sizeBytes: number | null };
      controlnet: { name: string; path: string; exists: boolean; sizeBytes: number | null };
      ipAdapter: { name: string; path: string; exists: boolean; sizeBytes: number | null };
      clipVision: { name: string; path: string; exists: boolean; sizeBytes: number | null };
    };
  };
  generationAttempt: {
    attempted: boolean;
    command: string;
    exactErrors: string[];
    pollOk: boolean | null;
    enteredRunningModal: boolean;
    comfyQueueReceivedPrompt: boolean;
    timeoutSeconds: number | null;
    wallClockSeconds: number | null;
    headlessNote: string;
  };
  /** Required measurement fields (null when generation did not produce a texture). */
  textureResolution: string | null;
  textureBytes: number | null;
  totalAssetBytes: number | null;
  generationWallClockSeconds: number | null;
  reproducibleFromSeed: { value: boolean; how: string };
  drivableFromPhenotype: { value: boolean; how: string };
  uvLayoutPreserved: boolean | null;
  provenance: {
    checkpointName: string;
    prompt: string;
    negativePrompt: string;
    seed: number;
    controlnet: string;
    note: string;
  };
  visual: {
    inScope: {
      garmentSurface: string;
      skin: string;
      face: string;
      seamsAndFolds: string;
      anyLetteringOrInsignia: string;
    };
    contractMetVisual:
      | "clearly_better"
      | "comparable"
      | "clearly_worse"
      | `not_comparable:${string}`;
    beforeRender: { path: string; renderer: string; exists: boolean; bytes: number | null };
    afterRender: { path: string; renderer: string; exists: boolean; bytes: number | null };
    threeJsUiXrRender: { attempted: boolean; reason: string };
    outOfScopeWrongness: string[];
  };
  verdict: Verdict;
  verdictFreeText: string;
  providerBoundary: {
    localOnly: true;
    modelDownloadsUsed: false;
    externalNetworkUsed: false;
    paidApiUsed: false;
    credentialsUsed: false;
    stablegenVendored: false;
    runtimePromotionAllowed: false;
    productionAssetReadinessClaimed: false;
  };
  notEvidenceFor: string[];
  artifacts: Record<string, string | null>;
};

type CliOptions = {
  validateLatest: boolean;
  validatePath?: string;
  writeReport: boolean;
  evidenceDir: string;
};

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.validatePath || options.validateLatest) {
    const validatePath =
      options.validatePath
      ?? path.join(options.evidenceDir, REPORT_NAME);
    try {
      await access(validatePath);
    } catch {
      throw new Error(`Missing probe report to validate: ${validatePath}`);
    }
    const raw = JSON.parse(await readFile(validatePath, "utf8")) as unknown;
    const validation = validateStablegenHumanoidTextureProbeReport(raw);
    if (validation.ok) {
      console.log(`Validated ${validatePath}`);
      return;
    }
    for (const error of validation.errors) console.error(error);
    process.exitCode = 1;
    return;
  }

  if (!options.writeReport) {
    throw new Error("Pass --write-report to build the probe report, or --validate-latest to validate.");
  }

  const report = await buildProbeReport(options.evidenceDir);
  await mkdir(options.evidenceDir, { recursive: true });
  const outPath = path.join(options.evidenceDir, REPORT_NAME);
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outPath}`);
  const validation = validateStablegenHumanoidTextureProbeReport(report);
  if (!validation.ok) {
    for (const error of validation.errors) console.error(error);
    process.exitCode = 1;
  }
}

export async function buildProbeReport(evidenceDir: string): Promise<StablegenHumanoidTextureProbeReport> {
  const home = os.homedir();
  const repoRoot = process.cwd();
  const targetRel = "apps/ui-xr/public/generated-humanoids/peds_nurse_kevin.glb";
  const targetAbs = path.join(repoRoot, targetRel);
  const sourceBytes = await fileSizeOrNull(targetAbs);

  const comfyUrl = process.env.COMFYUI_URL ?? "http://127.0.0.1:8188";
  const blenderExe = process.env.BLENDER_PATH ?? "blender";
  const stablegenPath = path.join(
    home,
    "Library/Application Support/Blender/5.1/scripts/addons/stablegen",
  );

  const [blender, comfy, models] = await Promise.all([
    probeBlender(blenderExe),
    probeComfy(comfyUrl),
    probeModels(home),
  ]);

  const attempt1 = await readJsonIfPresent(path.join(evidenceDir, "blender-attempt.json"));
  const attempt2 = await readJsonIfPresent(path.join(evidenceDir, "blender-attempt2.json"));
  const beforePath = path.join(evidenceDir, "before_blender_eevee.png");
  const afterPath = path.join(evidenceDir, "after_blender_eevee.png");
  const candidateGlb = path.join(evidenceDir, "peds_nurse_kevin_stablegen_candidate.glb");

  const attempt2Errors = asStringArray(attempt2?.["errors"]);
  const attempt1Errors = asStringArray(attempt1?.["errors"]);
  const generationWall =
    typeof attempt2?.["wallClockSeconds"] === "number"
      ? attempt2["wallClockSeconds"]
      : typeof attempt1?.["wallClockSeconds"] === "number"
        ? attempt1["wallClockSeconds"]
        : null;

  const prompt =
    "adult male pediatric nurse in solid teal medical scrubs, plain fabric, "
    + "subtle natural cloth folds and soft shading, no text, no logo, no badge, "
    + "no name tag, no insignia, no institutional branding, photoreal clinical training figure";
  const negativePrompt =
    "text, letters, words, logo, badge, name tag, insignia, watermark, "
    + "writing, numbers, institutional branding, hospital name";
  const seed = 132042;

  const uvBefore = attempt1?.["uvLayersBefore"] ?? attempt2?.["uvLayersBefore"] ?? null;
  const uvAfter = attempt1?.["uvLayersAfter"] ?? attempt2?.["uvLayersAfter"] ?? null;
  const uvPreserved =
    uvBefore && uvAfter
      ? JSON.stringify(uvBefore) === JSON.stringify(uvAfter)
      : null;

  const candidateBytes = await fileSizeOrNull(candidateGlb);
  const beforeBytes = await fileSizeOrNull(beforePath);
  const afterBytes = await fileSizeOrNull(afterPath);

  // ComfyUI never received a prompt from this attempt (queue empty throughout).
  const comfyQueued = false;
  const enteredModal = attempt2?.["generationResult"] != null
    && JSON.stringify(attempt2["generationResult"]).includes("RUNNING_MODAL");

  const exactErrors = [
    ...attempt1Errors.map((e) => `attempt1: ${e}`),
    ...attempt2Errors.map((e) => `attempt2: ${e}`),
    "attempt2: bpy.ops.object.test_stable returned RUNNING_MODAL then hung 600s with ComfyUI queue empty",
    "attempt2: controlnet unit model_name remained 'REFRESH' (not controlnet_depth_sdxl.safetensors)",
    "attempt1: Operator bpy.ops.object.test_stable.poll() Blender's online access is disabled (File → Preferences → System)",
    "attempt1: add_cameras AttributeError: 'NoneType' object has no attribute 'view_perspective' (headless, no rv3d)",
  ];

  const verdict: Verdict = "inconclusive_blocked";
  const verdictFreeText =
    "StableGen v0.3.0 enables on Blender 5.1.1 and pings local ComfyUI successfully. "
    + "Generation operator poll passes after use_online_access=True and checkpoint cache seed, "
    + "enters RUNNING_MODAL for 4 cameras, but under blender -b headless the modal never completes "
    + "within 600s and ComfyUI /queue stayed empty — no texture was produced. "
    + "This is a measured headless/modal-completion block, not a licence block and not a missing-weights block. "
    + "GUI generation was not tested. Do not adopt as a factory authoring path until a non-modal or GUI path produces a textured humanoid.";

  return {
    schemaVersion: SCHEMA,
    generatedAt: new Date().toISOString(),
    claimScope: "stablegen_humanoid_texture_cagematch_local_measurement_only",
    issue: "#132",
    targetAsset: {
      path: targetRel,
      role: "peds_nurse_kevin",
      rationale: "Scrubs read clearest for flat single-colour fabric defect after #121/#124 geometry fixes.",
      sourceBytes,
    },
    licence: {
      stablegen: "GPL-3.0-or-later",
      comfyui: "GPL-3.0",
      checkpoint: "CreativeML Open RAIL++-M",
      operatorClearance:
        "2026-08-07 operator direction, verbatim: \"Let's try stablegen regardless of license.. we will revisit.\"",
      deferred: true,
      toBeRevisited: true,
      outOfRepoAuthoringToolOnly: true,
      notVendored: true,
      notImportedByRepoCode: true,
      notShipped: true,
    },
    stack: {
      blender: {
        version: blender.version,
        executable: blenderExe,
        available: blender.available,
        detail: blender.detail,
      },
      stablegen: {
        version: "0.3.0",
        blenderVersionMin: "4.2.0",
        path: stablegenPath,
        enabledOnBlender51: true,
        connectToComfy: true,
        detail:
          "addon_enable OK; check_server_availability(127.0.0.1:8188)=true; "
          + "declared min 4.2.0 is not the same as tested on 5.1 — enable works, headless generate hangs",
      },
      comfyui: {
        available: comfy.available,
        url: comfyUrl,
        version: comfy.version,
        startCommandObserved:
          "cd ~/ComfyUI && /tmp/openclinxr-comfy-venv/bin/python main.py --listen 127.0.0.1 --port 8188",
        startVenvPath: "/tmp/openclinxr-comfy-venv",
        startVenvHealthyOnDisk: false,
        startVenvNote:
          "Process PID still running (started 2026-08-02 from that path, cwd=~/ComfyUI). "
          + "On disk the venv is hollow: python3 → mise 3.13, no torch import. "
          + "No venv beside main.py. Do not pip install a new env without operator approval. "
          + "If the live process dies, restart path is unknown without re-provisioning.",
        cwd: "/Users/patrick/ComfyUI",
        detail: comfy.detail,
      },
      models,
    },
    generationAttempt: {
      attempted: true,
      command:
        "OPENCLINXR_REPO=<repo> blender -b --python /tmp/ocxr132_stablegen/stablegen_attempt2.py "
        + "(enable online access; seed checkpoints from /models/checkpoints; import peds_nurse_kevin.glb; "
        + "bpy.ops.object.test_stable('EXEC_DEFAULT'))",
      exactErrors,
      pollOk: attempt2?.["pollOk"] === true,
      enteredRunningModal: Boolean(enteredModal),
      comfyQueueReceivedPrompt: comfyQueued,
      timeoutSeconds: 600,
      wallClockSeconds: generationWall,
      headlessNote:
        "StableGen ComfyUIGenerate is a modal operator (object.test_stable). "
        + "Headless blender -b can start it (RUNNING_MODAL) but does not complete the websocket/timer pipeline; "
        + "add_cameras also requires a 3D view region (rv3d).",
    },
    textureResolution: null,
    textureBytes: null,
    totalAssetBytes: candidateBytes ?? sourceBytes,
    generationWallClockSeconds: generationWall,
    reproducibleFromSeed: {
      value: false,
      how:
        "No texture produced. Seed+prompt were set (seed=132042, RealVisXL_V5.0_fp16) but generation never finished; "
        + "reproducibility unproven. StableGen exposes scene.seed so seed-driven runs are plausible if generation completes.",
    },
    drivableFromPhenotype: {
      value: false,
      how:
        "StableGen is hand-prompted (scene.comfyui_prompt). No wiring from phenotype.garmentLayers or role was found or attempted. "
        + "A factory driver would need a separate prompt builder; not present.",
    },
    uvLayoutPreserved: uvPreserved,
    provenance: {
      checkpointName: "RealVisXL_V5.0_fp16.safetensors",
      prompt,
      negativePrompt,
      seed,
      controlnet: "controlnet_depth_sdxl.safetensors (unit configured; model_name stayed REFRESH)",
      note:
        "No generated texture artifact exists. Provenance records the intended inputs only. "
        + "Per MADR 0016: local authoring candidate; no runtime promotion.",
    },
    visual: {
      inScope: {
        garmentSurface:
          "flat solid teal scrubs shell — single colour, no weave/fold shading, no seams (unchanged after attempt)",
        skin: "flat flesh-tone limbs; no skin microtexture applied by StableGen",
        face: "not in frame — camera framed mid-torso to feet (before and after)",
        seamsAndFolds: "none — garment remains smooth plastic/fixture fabric",
        anyLetteringOrInsignia: "none observed (no diffusion texture applied)",
      },
      contractMetVisual: "not_comparable:no_texture_produced_after_equals_before_flat_scrubs",
      beforeRender: {
        path: path.relative(repoRoot, beforePath),
        renderer: "BLENDER_EEVEE",
        exists: beforeBytes != null,
        bytes: beforeBytes,
      },
      afterRender: {
        path: path.relative(repoRoot, afterPath),
        renderer: "BLENDER_EEVEE",
        exists: afterBytes != null,
        bytes: afterBytes,
      },
      threeJsUiXrRender: {
        attempted: false,
        reason:
          "No textured GLB delta to load — candidate export is geometry-only re-export (~10.4 MB) with no StableGen bake. "
          + "three.js/ui-xr capture deferred until a real textured asset exists.",
      },
      outOfScopeWrongness: [
        "head and neck cropped out of frame by front camera placement (mid-torso to feet only)",
        "bare feet with no shoes or socks — flesh-tone mesh ending at ankles",
        "painted lower-body clothing (teal tights continuous with top) with no fabric break at waist",
        "hands are blunt mitten shapes with no finger separation",
        "small dark speck artifacts on upper arms near sleeve openings",
      ],
    },
    verdict,
    verdictFreeText,
    providerBoundary: {
      localOnly: true,
      modelDownloadsUsed: false,
      externalNetworkUsed: false,
      paidApiUsed: false,
      credentialsUsed: false,
      stablegenVendored: false,
      runtimePromotionAllowed: false,
      productionAssetReadinessClaimed: false,
    },
    notEvidenceFor: [
      "generated_clothing_quality",
      "generated_skin_quality",
      "stablegen_gui_generation_success",
      "b_plus_visual_realism_gate",
      "production_asset_readiness",
      "quest_readiness",
      "learner_readiness",
      "clinical_validity",
      "scoring_validity",
      "licence_clearance_resolved",
      "phenotype_driven_texture_pipeline",
    ],
    artifacts: {
      probeReport: path.join(evidenceDir, REPORT_NAME),
      beforeRender: beforeBytes != null ? beforePath : null,
      afterRender: afterBytes != null ? afterPath : null,
      blenderAttempt1: path.join(evidenceDir, "blender-attempt.json"),
      blenderAttempt2: path.join(evidenceDir, "blender-attempt2.json"),
      candidateGlb: candidateBytes != null ? candidateGlb : null,
      madr: "docs/madr/0045-stablegen-humanoid-texture-cagematch.md",
    },
  };
}

export function validateStablegenHumanoidTextureProbeReport(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be object"] };

  requireLiteral(value["schemaVersion"], SCHEMA, "/schemaVersion", errors);
  requireLiteral(value["claimScope"], "stablegen_humanoid_texture_cagematch_local_measurement_only", "/claimScope", errors);
  requireLiteral(value["issue"], "#132", "/issue", errors);
  requireString(value["generatedAt"], "/generatedAt", errors);

  // Required measurement field names (may be null)
  for (const key of [
    "textureResolution",
    "textureBytes",
    "totalAssetBytes",
    "generationWallClockSeconds",
    "uvLayoutPreserved",
  ]) {
    if (!(key in value)) errors.push(`/${key} missing`);
  }

  const repro = value["reproducibleFromSeed"];
  if (!isRecord(repro)) errors.push("/reproducibleFromSeed must be object");
  else {
    if (typeof repro["value"] !== "boolean") errors.push("/reproducibleFromSeed/value must be boolean");
    requireString(repro["how"], "/reproducibleFromSeed/how", errors);
  }

  const pheno = value["drivableFromPhenotype"];
  if (!isRecord(pheno)) errors.push("/drivableFromPhenotype must be object");
  else {
    if (typeof pheno["value"] !== "boolean") errors.push("/drivableFromPhenotype/value must be boolean");
    requireString(pheno["how"], "/drivableFromPhenotype/how", errors);
  }

  const provenance = value["provenance"];
  if (!isRecord(provenance)) errors.push("/provenance must be object");
  else {
    requireString(provenance["checkpointName"], "/provenance/checkpointName", errors);
    requireString(provenance["prompt"], "/provenance/prompt", errors);
  }

  const licence = value["licence"];
  if (!isRecord(licence)) errors.push("/licence must be object");
  else {
    requireLiteral(licence["stablegen"], "GPL-3.0-or-later", "/licence/stablegen", errors);
    requireLiteral(licence["toBeRevisited"], true, "/licence/toBeRevisited", errors);
    requireLiteral(licence["deferred"], true, "/licence/deferred", errors);
    requireLiteral(licence["outOfRepoAuthoringToolOnly"], true, "/licence/outOfRepoAuthoringToolOnly", errors);
    requireLiteral(licence["notVendored"], true, "/licence/notVendored", errors);
    requireString(licence["operatorClearance"], "/licence/operatorClearance", errors);
    if (!String(licence["operatorClearance"]).toLowerCase().includes("revisit")) {
      errors.push("/licence/operatorClearance must include revisit language");
    }
  }

  const verdict = value["verdict"];
  if (!VERDICTS.includes(verdict as Verdict)) {
    errors.push(`/verdict must be one of ${VERDICTS.join("|")}`);
  }
  requireString(value["verdictFreeText"], "/verdictFreeText", errors);
  if (typeof value["verdictFreeText"] === "string" && value["verdictFreeText"].trim().length < 40) {
    errors.push("/verdictFreeText must be non-trivial free text");
  }

  const visual = value["visual"];
  if (!isRecord(visual)) errors.push("/visual must be object");
  else {
    const inScope = visual["inScope"];
    if (!isRecord(inScope)) errors.push("/visual/inScope must be object");
    else {
      for (const k of ["garmentSurface", "skin", "face", "seamsAndFolds", "anyLetteringOrInsignia"]) {
        requireString(inScope[k], `/visual/inScope/${k}`, errors);
      }
    }
    requireString(visual["contractMetVisual"], "/visual/contractMetVisual", errors);
  }

  const boundary = value["providerBoundary"];
  if (!isRecord(boundary)) errors.push("/providerBoundary must be object");
  else {
    requireLiteral(boundary["localOnly"], true, "/providerBoundary/localOnly", errors);
    requireLiteral(boundary["modelDownloadsUsed"], false, "/providerBoundary/modelDownloadsUsed", errors);
    requireLiteral(boundary["stablegenVendored"], false, "/providerBoundary/stablegenVendored", errors);
    requireLiteral(boundary["runtimePromotionAllowed"], false, "/providerBoundary/runtimePromotionAllowed", errors);
    requireLiteral(boundary["productionAssetReadinessClaimed"], false, "/providerBoundary/productionAssetReadinessClaimed", errors);
  }

  requireStringArrayIncludes(value["notEvidenceFor"], "licence_clearance_resolved", "/notEvidenceFor", errors);
  requireStringArrayIncludes(value["notEvidenceFor"], "production_asset_readiness", "/notEvidenceFor", errors);
  requireStringArrayIncludes(value["notEvidenceFor"], "clinical_validity", "/notEvidenceFor", errors);

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

async function probeBlender(executable: string): Promise<{ available: boolean; version: string | null; detail: string | null }> {
  try {
    const result = await execFileAsync(executable, ["--version"], { timeout: 8_000, maxBuffer: 1024 * 1024 });
    const version = result.stdout.split("\n").find((line) => /^Blender\s+/u.test(line))?.trim() ?? null;
    return { available: true, version, detail: null };
  } catch (error) {
    return { available: false, version: null, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function probeComfy(comfyUrl: string): Promise<{ available: boolean; version: string | null; detail: string | null }> {
  const url = new URL("/system_stats", comfyUrl).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = (await response.json().catch(() => null)) as { system?: { comfyui_version?: string } } | null;
    return {
      available: response.ok,
      version: body?.system?.comfyui_version ?? null,
      detail: response.ok ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    return { available: false, version: null, detail: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function probeModels(home: string): Promise<StablegenHumanoidTextureProbeReport["stack"]["models"]> {
  const base = path.join(home, "ComfyUI/models");
  const entries = {
    checkpoint: {
      name: "RealVisXL_V5.0_fp16.safetensors",
      path: path.join(base, "checkpoints/RealVisXL_V5.0_fp16.safetensors"),
    },
    controlnet: {
      name: "controlnet_depth_sdxl.safetensors",
      path: path.join(base, "controlnet/controlnet_depth_sdxl.safetensors"),
    },
    ipAdapter: {
      name: "ip-adapter-plus_sdxl_vit-h.safetensors",
      path: path.join(base, "ipadapter/ip-adapter-plus_sdxl_vit-h.safetensors"),
    },
    clipVision: {
      name: "CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors",
      path: path.join(base, "clip_vision/CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors"),
    },
  } as const;

  const out: StablegenHumanoidTextureProbeReport["stack"]["models"] = {
    checkpoint: { ...entries.checkpoint, exists: false, sizeBytes: null },
    controlnet: { ...entries.controlnet, exists: false, sizeBytes: null },
    ipAdapter: { ...entries.ipAdapter, exists: false, sizeBytes: null },
    clipVision: { ...entries.clipVision, exists: false, sizeBytes: null },
  };
  for (const key of Object.keys(entries) as Array<keyof typeof entries>) {
    const size = await fileSizeOrNull(entries[key].path);
    out[key] = { ...entries[key], exists: size != null, sizeBytes: size };
  }
  return out;
}

async function fileSizeOrNull(filePath: string): Promise<number | null> {
  try {
    const s = await stat(filePath);
    return s.isFile() ? s.size : null;
  } catch {
    return null;
  }
}

async function readJsonIfPresent(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    return isRecord(raw) ? raw : null;
  } catch {
    return null;
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    validateLatest: false,
    writeReport: false,
    evidenceDir: EVIDENCE_DIR,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--validate-latest") options.validateLatest = true;
    else if (arg === "--validate") options.validatePath = requireNext(args, ++index, arg);
    else if (arg === "--write-report") options.writeReport = true;
    else if (arg === "--evidence-dir") options.evidenceDir = requireNext(args, ++index, arg);
    else throw new Error(`Unknown argument: ${arg ?? ""}`);
  }
  // Default action when no flags: write then allow validate via separate invocation.
  if (!options.validateLatest && !options.validatePath && !options.writeReport) {
    options.writeReport = true;
  }
  return options;
}

function requireNext(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value after ${flag}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireLiteral(value: unknown, expected: unknown, pointer: string, errors: string[]): void {
  if (value !== expected) errors.push(`${pointer} must be ${JSON.stringify(expected)}`);
}

function requireString(value: unknown, pointer: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) errors.push(`${pointer} must be non-empty string`);
}

function requireStringArrayIncludes(value: unknown, needle: string, pointer: string, errors: string[]): void {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    errors.push(`${pointer} must be string[]`);
    return;
  }
  if (!value.includes(needle)) errors.push(`${pointer} must include ${needle}`);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
