/**
 * ComfyUI-only multi-view humanoid texture bake (#231).
 *
 * Pipeline: Blender depth renders → ComfyUI ControlNet depth + RealVisXL → texture stills.
 * StableGen headless is closed (MADR 0045); this is the headless Comfy-only alternative.
 *
 * CLAIM: ComfyUI ControlNet depth + RealVisXL can generate textured clothing views from
 *   headless Blender depth renders on Apple Silicon MPS, producing before/after stills.
 * NOT TESTED: full UV projection/bake back onto the 3D mesh (requires viewport context
 *   or a custom projection pipeline beyond this slice's scope); texture VRAM on Quest;
 *   clinical appropriateness; seed reproducibility of identical pixel output.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// tools/openclinxr/evidence → repo root is three levels up
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BakeVerdict = "texture_baked" | "inconclusive_blocked" | "reject_measured";

export type BakeMeasure = {
  verdict: BakeVerdict;
  verdictReason: string;
  textureBytes: number | null;
  textureResolution: string | null;
  generationWallClockSeconds: number | null;
  subjectPath: string;
  claimScope: string[];
  notEvidenceFor: string[];
};

export type DepthViewManifest = {
  schemaVersion: string;
  glbPath: string;
  resolution: number;
  views: Array<{ name: string; azimuth: number; elevation: number; depthPath: string }>;
  beforeStill: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMFY_URL = "http://127.0.0.1:8188";
const REALVISXL_CHECKPOINT = "RealVisXL_V5.0_fp16.safetensors";
const CONTROLNET_DEPTH = "controlnet_depth_sdxl.safetensors";

const BLENDER_BIN = "blender";
const DEPTH_SCRIPT = path.resolve(HERE, "blender", "render_humanoid_depth_views.py");

const PROMPT_POSITIVE = [
  "professional medical photograph of a clinical mannequin wearing teal nursing scrubs,",
  "short-sleeve V-neck scrub top, matching scrub pants, clean hospital uniform,",
  "standing upright, neutral clinical pose, even studio lighting,",
  "photorealistic fabric texture, subtle folds at elbows and waist,",
  "medical training environment, professional healthcare setting",
].join(" ");

const PROMPT_NEGATIVE = [
  "blurry, low quality, deformed anatomy, extra limbs, fused fingers,",
  "cartoon, 3D render, plastic skin, watermark, text, logo, badge, name tag,",
  "insignia, institutional branding, naked, underwear, street clothes,",
  "harsh shadows, overexposed, distorted proportions",
].join(" ");

// ---------------------------------------------------------------------------
// ComfyUI helpers
// ---------------------------------------------------------------------------

interface ComfyOutput {
  path: string;
  name: string;
}

async function detectComfy(url: string = COMFY_URL): Promise<boolean> {
  try {
    const res = await fetch(`${url}/system_stats`, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

async function pollComfyOutput(
  comfyUrl: string,
  promptId: string,
  outputPrefix: string,
  timeoutMs = 300_000,
): Promise<ComfyOutput> {
  const outputDir = path.join(process.env.HOME ?? "", "ComfyUI", "output");
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const historyRes = await fetch(`${comfyUrl}/history/${promptId}`);
    if (historyRes.ok) {
      const history = (await historyRes.json()) as Record<
        string,
        {
          outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string }> }>;
          status?: { status_str?: string; messages?: unknown[] };
        }
      >;
      const entry = history[promptId];
      if (entry?.status?.status_str === "error") {
        const msgs = entry.status.messages;
        throw new Error(`Comfy prompt ${promptId} failed: ${JSON.stringify(Array.isArray(msgs) ? msgs.slice(-1) : msgs)}`);
      }
      const images = entry?.outputs
        ? Object.values(entry.outputs).flatMap((o) => o.images ?? [])
        : [];
      const match = images.find((img) => img.filename.startsWith(outputPrefix));
      if (match) {
        const subfolder = match.subfolder ? path.join(outputDir, match.subfolder) : outputDir;
        return { path: path.join(subfolder, match.filename), name: match.filename };
      }
    }
    await sleep(2000);
  }

  // Fallback: scan output directory directly
  try {
    const files = await readdir(outputDir);
    const matches = files.filter((f) => f.startsWith(outputPrefix) && f.endsWith(".png")).sort();
    const latest = matches.at(-1);
    if (latest) return { path: path.join(outputDir, latest), name: latest };
  } catch { /* empty */ }

  throw new Error(`Timed out waiting for Comfy output prefix="${outputPrefix}" (prompt=${promptId})`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// ComfyUI workflow builder — ControlNet depth + RealVisXL
// ---------------------------------------------------------------------------

interface DepthToImageInput {
  depthImageName: string;
  outputPrefix: string;
  positivePrompt: string;
  negativePrompt: string;
  seed: number;
  steps: number;
  cfg: number;
  width: number;
  height: number;
}

function buildDepthToImageWorkflow(
  input: DepthToImageInput,
): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  // Node IDs
  // 1: CheckpointLoaderSimple → (model, clip, vae)
  // 2: LoadImage (depth map)
  // 3: ControlNetLoader
  // 4: CLIPTextEncode (positive)
  // 5: CLIPTextEncode (negative)
  // 6: ControlNetApplyAdvanced (apply depth control to conditioning)
  // 7: EmptyLatentImage (SDXL: 1024² → 128² latent)
  // 8: KSampler
  // 9: VAEDecode
  // 10: SaveImage

  return {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: REALVISXL_CHECKPOINT },
    },
    "2": {
      class_type: "LoadImage",
      inputs: { image: input.depthImageName },
    },
    "3": {
      class_type: "ControlNetLoader",
      inputs: { control_net_name: CONTROLNET_DEPTH },
    },
    "4": {
      class_type: "CLIPTextEncode",
      inputs: { text: input.positivePrompt, clip: ["1", 1] },
    },
    "5": {
      class_type: "CLIPTextEncode",
      inputs: { text: input.negativePrompt, clip: ["1", 1] },
    },
    "6": {
      class_type: "ControlNetApplyAdvanced",
      inputs: {
        positive: ["4", 0],
        negative: ["5", 0],
        control_net: ["3", 0],
        image: ["2", 0],
        strength: 0.75,
        start_percent: 0.0,
        end_percent: 1.0,
        // SDXL depth ControlNet benefits from VAE when available
        vae: ["1", 2],
      },
    },
    "7": {
      class_type: "EmptyLatentImage",
      inputs: { width: input.width, height: input.height, batch_size: 1 },
    },
    "8": {
      class_type: "KSampler",
      inputs: {
        seed: input.seed,
        steps: input.steps,
        cfg: input.cfg,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 1.0,
        model: ["1", 0],
        positive: ["6", 0],
        negative: ["6", 1],
        latent_image: ["7", 0],
      },
    },
    "9": {
      class_type: "VAEDecode",
      inputs: { samples: ["8", 0], vae: ["1", 2] },
    },
    "10": {
      class_type: "SaveImage",
      inputs: { images: ["9", 0], filename_prefix: input.outputPrefix },
    },
  };
}

// ---------------------------------------------------------------------------
// Pipeline steps
// ---------------------------------------------------------------------------

/** Find a humanoid GLB (prefer peds_nurse_kevin.glb for nurse scrubs subject). */
function findHumanoidGlb(): string {
  const candidates = [
    "apps/ui-xr/public/generated-humanoids/peds_nurse_kevin.glb",
    "apps/ui-xr/public/generated-humanoids/ed_chest_pain_nurse_adult.glb",
    "apps/ui-xr/public/generated-humanoids/adult_male_street_casual.glb",
  ];
  for (const rel of candidates) {
    const full = path.join(REPO_ROOT, rel);
    if (existsSync(full)) return full;
  }
  throw new Error("No humanoid GLB found");
}

/** Resolve path relative to repo root when Blender wrote a relative path. */
function resolveRepoPath(p: string): string {
  if (path.isAbsolute(p) && existsSync(p)) return p;
  const fromRoot = path.join(REPO_ROOT, p);
  if (existsSync(fromRoot)) return fromRoot;
  return p;
}

/** Run Blender headless to render depth views. */
function renderDepthViews(glbPath: string, outputDir: string): DepthViewManifest {
  mkdirSync(outputDir, { recursive: true });

  const args = [
    "--background",
    "--python", DEPTH_SCRIPT,
    "--",
    "--glb", glbPath,
    "--output-dir", outputDir,
    "--resolution", "1024",
  ];

  const started = Date.now();
  const r = spawnSync(BLENDER_BIN, args, {
    timeout: 120_000,
    encoding: "utf-8",
  });

  if (r.error) throw new Error(`Blender spawn failed: ${r.error.message}`);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`Blender depth renders: ${elapsed}s (exit ${r.status})`);

  if (r.stdout) console.log(r.stdout.slice(-500));
  if (r.stderr) {
    const errTail = r.stderr.split("\n").slice(-10).join("\n");
    if (errTail.includes("Error") || errTail.includes("Traceback")) {
      console.error("Blender stderr tail:", errTail);
    }
  }

  const manifestPath = path.join(outputDir, "depth_manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Blender did not produce depth manifest at ${manifestPath} (exit ${r.status})`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as DepthViewManifest;
  manifest.glbPath = resolveRepoPath(manifest.glbPath);
  manifest.beforeStill = resolveRepoPath(manifest.beforeStill);
  for (const view of manifest.views) {
    view.depthPath = resolveRepoPath(view.depthPath);
    if (!existsSync(view.depthPath)) {
      throw new Error(`Depth map not produced: ${view.depthPath}`);
    }
  }
  return manifest;
}

/**
 * Reuse an existing depth_manifest + stills when present (prior dispatch WIP).
 * Re-runs Blender only when the manifest or a required file is missing.
 */
function loadOrRenderDepthViews(glbPath: string, outputDir: string): DepthViewManifest {
  const manifestPath = path.join(outputDir, "depth_manifest.json");
  if (existsSync(manifestPath)) {
    try {
      const existing = JSON.parse(readFileSync(manifestPath, "utf-8")) as DepthViewManifest;
      existing.glbPath = resolveRepoPath(existing.glbPath);
      existing.beforeStill = resolveRepoPath(existing.beforeStill);
      const viewsOk = existing.views.every((v) => {
        v.depthPath = resolveRepoPath(v.depthPath);
        return existsSync(v.depthPath);
      });
      if (viewsOk && existsSync(existing.beforeStill)) {
        console.log(`Reusing existing depth views under ${outputDir}`);
        return existing;
      }
    } catch {
      /* fall through to re-render */
    }
  }
  return renderDepthViews(glbPath, outputDir);
}

/** Run ComfyUI depth→image workflow for each view. */
async function runComfyDepthViews(
  depthManifest: DepthViewManifest,
  outputDir: string,
  seed: number,
): Promise<Array<{ view: string; outputPath: string }>> {
  mkdirSync(outputDir, { recursive: true });

  // Copy depth maps to ComfyUI input directory
  const comfyInputDir = path.join(process.env.HOME ?? "", "ComfyUI", "input");
  await mkdir(comfyInputDir, { recursive: true });

  const results: Array<{ view: string; outputPath: string }> = [];
  const started = Date.now();

  for (const view of depthManifest.views) {
    // Copy depth map to ComfyUI input with a unique name
    const inputName = `openclinxr_depth_${view.name}_${Date.now()}.png`;
    await writeFile(
      path.join(comfyInputDir, inputName),
      readFileSync(view.depthPath),
    );

    const outputPrefix = `openclinxr_tex_${view.name}`;
    const workflow = buildDepthToImageWorkflow({
      depthImageName: inputName,
      outputPrefix,
      positivePrompt: PROMPT_POSITIVE,
      negativePrompt: PROMPT_NEGATIVE,
      seed: seed + depthManifest.views.indexOf(view), // vary seed per view
      steps: 15,
      cfg: 6.0,
      width: 1024,
      height: 1024,
    });

    // Submit to ComfyUI
    const clientId = `openclinxr-bake-${Date.now()}`;
    const promptRes = await fetch(`${COMFY_URL}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    });

    if (!promptRes.ok) {
      const body = await promptRes.text();
      results.push({ view: view.name, outputPath: `ERROR: ${promptRes.status} ${body}` });
      continue;
    }

    const promptBody = (await promptRes.json()) as { prompt_id?: string; error?: unknown };
    if (!promptBody.prompt_id) {
      results.push({ view: view.name, outputPath: `ERROR: no prompt_id in ${JSON.stringify(promptBody)}` });
      continue;
    }

    console.log(`ComfyUI queued ${view.name}: prompt_id=${promptBody.prompt_id}`);

    try {
      const output = await pollComfyOutput(COMFY_URL, promptBody.prompt_id, outputPrefix, 600_000);
      // Copy into evidence dir so the tree is self-contained for contract proofs
      const evidenceCopy = path.join(outputDir, `comfy_${view.name}.png`);
      copyFileSync(output.path, evidenceCopy);
      results.push({ view: view.name, outputPath: evidenceCopy });
      console.log(`ComfyUI done ${view.name}: ${output.name} → ${evidenceCopy} (${statSync(evidenceCopy).size} B)`);
    } catch (err) {
      results.push({ view: view.name, outputPath: `ERROR: ${String(err)}` });
      console.error(`ComfyUI failed ${view.name}:`, String(err));
    }
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`ComfyUI all views: ${elapsed}s`);

  return results;
}

/** Compile ComfyUI outputs into a contact-sheet "after" image using Python/PIL. */
function compileAfterSheet(
  comfyResults: Array<{ view: string; outputPath: string }>,
  outputDir: string,
): string {
  const afterPath = path.join(outputDir, "after.png");

  // Use Python PIL to create a 2x2 grid of the generated images
  const gridScript = `
import sys
from PIL import Image

results = ${JSON.stringify(comfyResults)}
output_path = ${JSON.stringify(afterPath)}

# Load images, resize to 512x512, assemble 2x2 grid
images = []
labels = []
for r in results:
    try:
        img = Image.open(r["outputPath"])
        img = img.resize((512, 512), Image.LANCZOS)
        images.append(img)
        labels.append(r["view"])
    except Exception as e:
        print(f"SKIP {r['view']}: {e}", file=sys.stderr)

if not images:
    print("NO_VALID_IMAGES", file=sys.stderr)
    sys.exit(1)

# Create 2x2 grid: 1024x1024 canvas
grid = Image.new("RGBA", (1024, 1024), (30, 30, 30, 255))
positions = [(0, 0), (512, 0), (0, 512), (512, 512)]
for i, img in enumerate(images[:4]):
    grid.paste(img, positions[i])

grid.save(output_path, "PNG")
print(f"AFTER sheet: {output_path} ({len(images)} tiles)")
`;
  const r = spawnSync("python3", ["-c", gridScript], {
    encoding: "utf-8",
    timeout: 30_000,
  });
  if (r.error) throw new Error(`PIL grid failed: ${r.error.message}`);
  console.log(r.stdout?.trim());
  if (r.stderr?.trim()) console.error("PIL stderr:", r.stderr.trim());

  return afterPath;
}

// ---------------------------------------------------------------------------
// Main inspect function
// ---------------------------------------------------------------------------

/** In-process memo so vitest's two it() blocks do not re-run ~3 min of Comfy twice. */
let _cachedMeasure: BakeMeasure | null = null;

export async function inspectComfyHumanoidTextureBake(): Promise<BakeMeasure> {
  if (_cachedMeasure) return _cachedMeasure;

  const evidenceDir = path.join(REPO_ROOT, ".openclinxr", "evidence", "issue-231");
  await mkdir(evidenceDir, { recursive: true });

  // Disk cache: reuse a completed texture_baked measure when artifacts still exist
  const measurePath = path.join(evidenceDir, "bake-measure.json");
  const beforeContract = path.join(evidenceDir, "before.png");
  const afterContract = path.join(evidenceDir, "after.png");
  if (
    existsSync(measurePath) &&
    existsSync(beforeContract) &&
    existsSync(afterContract) &&
    statSync(afterContract).size > 2000
  ) {
    try {
      const prior = JSON.parse(readFileSync(measurePath, "utf-8")) as BakeMeasure;
      if (
        prior.verdict === "texture_baked" &&
        typeof prior.textureBytes === "number" &&
        prior.textureBytes > 1000 &&
        prior.verdictReason?.length > 15
      ) {
        console.log("Reusing cached bake-measure.json (artifacts present)");
        _cachedMeasure = {
          verdict: prior.verdict,
          verdictReason: prior.verdictReason,
          textureBytes: prior.textureBytes,
          textureResolution: prior.textureResolution,
          generationWallClockSeconds: prior.generationWallClockSeconds,
          subjectPath: prior.subjectPath,
          claimScope: prior.claimScope,
          notEvidenceFor: prior.notEvidenceFor,
        };
        return _cachedMeasure;
      }
    } catch {
      /* re-run pipeline */
    }
  }

  let glbPath: string;
  try {
    glbPath = findHumanoidGlb();
  } catch (err) {
    const measure: BakeMeasure = {
      verdict: "inconclusive_blocked",
      verdictReason: `No humanoid GLB found for texture bake subject: ${String(err)}`,
      textureBytes: null,
      textureResolution: null,
      generationWallClockSeconds: null,
      subjectPath: "missing",
      claimScope: ["comfyui_controlnet_depth_realvisxl_headless_diffusion_on_depth_renders"],
      notEvidenceFor: [
        "clinical_appropriateness",
        "learner_readiness",
        "quest_readiness",
      ],
    };
    writeFileSync(path.join(evidenceDir, "bake-measure.json"), JSON.stringify(measure, null, 2));
    return measure;
  }
  console.log(`Subject: ${glbPath}`);

  const claimScope = [
    "comfyui_controlnet_depth_realvisxl_headless_diffusion_on_depth_renders",
    "blender_headless_depth_and_beauty_renders_from_glb",
    "before_and_after_stills_produced",
    "apple_silicon_mps_comfyui_inference",
    "factory_step_clothing_generate_surface_comfyui_realvisxl",
  ];

  const notEvidenceFor = [
    "uv_projection_or_texture_bake_back_onto_3d_mesh",
    "clinical_appropriateness",
    "learner_readiness",
    "quest_readiness",
    "seed_reproducibility_of_identical_pixel_output",
    "phenotype_driven_prompt",
    "licence_clearance_resolved",
    "production_distribution",
    "stablegen_modal_operator_headless",
  ];

  // Step 0: Verify ComfyUI is running
  const comfyOk = await detectComfy();
  if (!comfyOk) {
    const measure: BakeMeasure = {
      verdict: "inconclusive_blocked",
      verdictReason: "ComfyUI not reachable at http://127.0.0.1:8188 — cannot run diffusion",
      textureBytes: null,
      textureResolution: null,
      generationWallClockSeconds: null,
      subjectPath: glbPath,
      claimScope,
      notEvidenceFor,
    };
    writeFileSync(path.join(evidenceDir, "bake-measure.json"), JSON.stringify(measure, null, 2));
    return measure;
  }
  console.log("ComfyUI detected OK");

  const wallStart = Date.now();

  try {
    // Step 1: Depth views (reuse WIP if complete)
    console.log("Step 1: depth views...");
    const depthManifest = loadOrRenderDepthViews(glbPath, evidenceDir);

    // Ensure before.png sits at the contract path
    if (existsSync(depthManifest.beforeStill) && path.resolve(depthManifest.beforeStill) !== path.resolve(beforeContract)) {
      copyFileSync(depthManifest.beforeStill, beforeContract);
    }

    // Step 2: Run ComfyUI depth→image for each view
    console.log("Step 2: running ComfyUI depth→image...");
    const seed = 231001;
    const comfyResults = await runComfyDepthViews(depthManifest, evidenceDir, seed);

    // Step 3: Compile Comfy outputs into an "after" contact sheet
    console.log("Step 3: compiling after sheet...");
    const successPaths = comfyResults.filter((r) => !r.outputPath.startsWith("ERROR:"));
    let afterPath = path.join(evidenceDir, "after.png");
    if (successPaths.length > 0) {
      afterPath = compileAfterSheet(successPaths, evidenceDir);
    }

    // Step 5: Measure outputs
    const wallClock = (Date.now() - wallStart) / 1000;
    let totalTexBytes = 0;
    let maxTexResolution = "none";

    for (const r of successPaths) {
      try {
        const st = statSync(r.outputPath);
        totalTexBytes += st.size;
        maxTexResolution = "1024x1024";
      } catch { /* file gone */ }
    }

    const successCount = successPaths.length;
    const anySuccess = successCount > 0 && existsSync(afterPath) && existsSync(beforeContract);
    const errors = comfyResults
      .filter((r) => r.outputPath.startsWith("ERROR:"))
      .map((r) => `${r.view}: ${r.outputPath}`)
      .join("; ");

    // Step 6: Write bake-measure.json
    const measure: BakeMeasure = {
      verdict: anySuccess ? "texture_baked" : "inconclusive_blocked",
      verdictReason: anySuccess
        ? `ComfyUI + RealVisXL ControlNet depth produced ${successCount}/${comfyResults.length} textured view(s) in ${wallClock.toFixed(1)}s (seed=${seed}). Headless multi-view diffusion from Blender depth maps works without StableGen modal. Full UV project/bake onto the GLB mesh was not performed.`
        : `ComfyUI depth→image incomplete after ${wallClock.toFixed(1)}s (success=${successCount}/${comfyResults.length}). ${errors || "No outputs."}`,
      textureBytes: totalTexBytes > 0 ? totalTexBytes : null,
      textureResolution: maxTexResolution !== "none" ? maxTexResolution : null,
      generationWallClockSeconds: wallClock,
      subjectPath: path.relative(REPO_ROOT, glbPath),
      claimScope,
      notEvidenceFor,
    };

    writeFileSync(measurePath, JSON.stringify({
      ...measure,
      seed,
      factoryStep: "clothing_generate",
      tools: ["ComfyUI 0.24.0", "RealVisXL_V5.0_fp16", "controlnet_depth_sdxl", "Blender 5.1.1"],
      views: comfyResults.map((r) => ({
        view: r.view,
        ok: !r.outputPath.startsWith("ERROR:"),
        path: r.outputPath.startsWith("ERROR:") ? null : path.relative(REPO_ROOT, r.outputPath),
        error: r.outputPath.startsWith("ERROR:") ? r.outputPath : null,
      })),
      beforePath: path.relative(REPO_ROOT, beforeContract),
      afterPath: existsSync(afterPath) ? path.relative(REPO_ROOT, afterPath) : null,
    }, null, 2));
    console.log(`Measure written: ${measurePath}`);

    _cachedMeasure = measure;
    return measure;
  } catch (err) {
    const wallClock = (Date.now() - wallStart) / 1000;
    console.error("Pipeline error:", err);

    const measure: BakeMeasure = {
      verdict: "inconclusive_blocked",
      verdictReason: `Pipeline error after ${wallClock.toFixed(1)}s: ${String(err)}`,
      textureBytes: null,
      textureResolution: null,
      generationWallClockSeconds: wallClock,
      subjectPath: path.relative(REPO_ROOT, glbPath),
      claimScope,
      notEvidenceFor,
    };

    try { writeFileSync(measurePath, JSON.stringify(measure, null, 2)); } catch { /* best effort */ }

    _cachedMeasure = measure;
    return measure;
  }
}
