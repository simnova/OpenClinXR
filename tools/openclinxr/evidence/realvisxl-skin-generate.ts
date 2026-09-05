#!/usr/bin/env npx tsx
/**
 * Real working ComfyUI RealVisXL SDXL skin-albedo texture generator.
 *
 * Builds a standard SDXL txt2img API workflow, POSTs to a local ComfyUI
 * instance (default http://127.0.0.1:8188), polls history, downloads the
 * output image via /view, and writes it to disk.
 *
 * Usage:
 *   npx tsx tools/openclinxr/evidence/realvisxl-skin-generate.ts \
 *     [--skin-tone <tone>] [--age <age>] [--out <path>] \
 *     [--comfy-url <url>] [--seed <n>] [--timeout-ms <ms>]
 *
 * Defaults:
 *   --skin-tone medium
 *   --age adult
 *   --out apps/ui-xr/public/_regen-preview/skin_albedo.png
 *   --comfy-url http://127.0.0.1:8188
 *
 * Aesthetic-only evidence. notEvidenceFor: ["aesthetic_only"] and related
 * readiness / clinical claims.
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const REALVISXL_CKPT = "RealVisXL_V5.0_fp16.safetensors";
export const DEFAULT_COMFY_URL = "http://127.0.0.1:8188";
export const DEFAULT_OUT = "apps/ui-xr/public/_regen-preview/skin_albedo.png";
export const FILENAME_PREFIX = "openclinxr_skin_albedo";
export const SCHEMA_VERSION = "openclinxr.realvisxl-skin-generate.v1";

const IMAGE_SIZE = 1024;
const STEPS = 24;
const CFG = 5;
const SAMPLER = "dpmpp_2m";
const SCHEDULER = "karras";
const DENOISE = 1;
const DEFAULT_TIMEOUT_MS = 300_000;
const POLL_INTERVAL_MS = 1_500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CliOptions = {
  skinTone: string;
  age: string;
  out: string;
  comfyUrl: string;
  seed: number;
  timeoutMs: number;
};

export type ComfyWorkflow = Record<
  string,
  { class_type: string; inputs: Record<string, unknown> }
>;

export type ComfyHistoryImage = {
  filename: string;
  subfolder?: string;
  type?: string;
};

export type GenerateSummary = {
  schemaVersion: string;
  generatedAt: string;
  ok: true;
  savedPath: string;
  promptId: string;
  comfyUrl: string;
  checkpoint: string;
  skinTone: string;
  age: string;
  seed: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  width: number;
  height: number;
  positivePrompt: string;
  negativePrompt: string;
  outputImage: ComfyHistoryImage;
  imageSha256: string;
  bytes: number;
  claimScope: string;
  notEvidenceFor: string[];
  providerBoundary: {
    localOnly: true;
    externalNetworkUsed: false;
    paidApiUsed: false;
    credentialsUsed: false;
    comfyWorkflowQueued: true;
    diffusionRan: true;
    runtimePromotionAllowed: false;
    productionAssetReadinessClaimed: false;
    questReadinessClaimed: false;
    learnerReadinessClaimed: false;
    clinicalValidityClaimed: false;
    scoringValidityClaimed: false;
  };
};

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

export function buildPositivePrompt(skinTone: string, age: string): string {
  const tone = skinTone.trim() || "medium";
  const ageLabel = age.trim() || "adult";
  return [
    "photoreal human skin albedo map, dermal texture only",
    `${tone} natural skin tone`,
    `${ageLabel} skin surface`,
    "seamless tileable texture, even flat studio lighting, orthographic",
    "visible pores, fine dermal microdetail, subsurface scatter look in albedo",
    "no face, no eyes, no nose, no mouth, no body silhouette, no clothing",
    "no seams, no wrinkles from expression, pure skin material reference",
    "8k uhd, sharp focus, PBR basecolor style",
  ].join(", ");
}

export function buildNegativePrompt(): string {
  return [
    "plastic",
    "cartoon",
    "anime",
    "illustration",
    "painting",
    "seams",
    "tiling artifacts",
    "text",
    "watermark",
    "logo",
    "face",
    "eyes",
    "portrait",
    "person",
    "body",
    "hands",
    "clothing",
    "jewelry",
    "makeup",
    "blurry",
    "low quality",
    "oversaturated",
    "dirty",
    "bruises",
    "scars",
    "tattoos",
    "3d render artifacts",
  ].join(", ");
}

// ---------------------------------------------------------------------------
// ComfyUI API workflow (node_id → class_type + inputs; links = [id, out_idx])
// ---------------------------------------------------------------------------

/**
 * Standard SDXL txt2img graph:
 *   CheckpointLoaderSimple → CLIPTextEncode×2 + KSampler + VAEDecode
 *   EmptyLatentImage → KSampler → VAEDecode → SaveImage
 *
 * CheckpointLoaderSimple outputs: 0=MODEL, 1=CLIP, 2=VAE
 */
export function buildSkinAlbedoWorkflow(input: {
  positivePrompt: string;
  negativePrompt: string;
  seed: number;
  filenamePrefix?: string;
}): ComfyWorkflow {
  const prefix = input.filenamePrefix ?? FILENAME_PREFIX;
  return {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: {
        ckpt_name: REALVISXL_CKPT,
      },
    },
    "2": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: input.positivePrompt,
        clip: ["1", 1],
      },
    },
    "3": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: input.negativePrompt,
        clip: ["1", 1],
      },
    },
    "4": {
      class_type: "EmptyLatentImage",
      inputs: {
        width: IMAGE_SIZE,
        height: IMAGE_SIZE,
        batch_size: 1,
      },
    },
    "5": {
      class_type: "KSampler",
      inputs: {
        seed: input.seed,
        steps: STEPS,
        cfg: CFG,
        sampler_name: SAMPLER,
        scheduler: SCHEDULER,
        denoise: DENOISE,
        model: ["1", 0],
        positive: ["2", 0],
        negative: ["3", 0],
        latent_image: ["4", 0],
      },
    },
    "6": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["5", 0],
        vae: ["1", 2],
      },
    },
    "7": {
      class_type: "SaveImage",
      inputs: {
        images: ["6", 0],
        filename_prefix: prefix,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `ComfyUI unreachable at ${url}: ${message}. Is ComfyUI running on ${DEFAULT_COMFY_URL}?`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ComfyUI HTTP ${res.status} for ${url}: ${body.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

export async function detectComfy(comfyUrl: string): Promise<void> {
  const base = comfyUrl.replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/system_stats`, { method: "GET" });
    if (!res.ok) {
      throw new Error(`status ${res.status}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `ComfyUI unreachable at ${base} (${message}). Start ComfyUI on port 8188 and ensure RealVisXL_V5.0_fp16.safetensors is installed.`,
    );
  }
}

export async function queuePrompt(
  comfyUrl: string,
  workflow: ComfyWorkflow,
): Promise<string> {
  const base = comfyUrl.replace(/\/$/, "");
  const clientId = `openclinxr-skin-${Date.now()}`;
  type PromptResponse = {
    prompt_id?: string;
    number?: number;
    node_errors?: Record<string, unknown>;
    error?: unknown;
  };

  let res: Response;
  try {
    res = await fetch(`${base}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`ComfyUI /prompt unreachable: ${message}`);
  }

  const text = await res.text();
  let body: PromptResponse;
  try {
    body = JSON.parse(text) as PromptResponse;
  } catch {
    throw new Error(`ComfyUI /prompt returned non-JSON (${res.status}): ${text.slice(0, 400)}`);
  }

  if (!res.ok) {
    throw new Error(
      `ComfyUI /prompt failed (${res.status}): ${JSON.stringify(body.error ?? body).slice(0, 800)}`,
    );
  }

  if (body.node_errors && Object.keys(body.node_errors).length > 0) {
    throw new Error(
      `ComfyUI workflow node_errors: ${JSON.stringify(body.node_errors).slice(0, 800)}`,
    );
  }

  if (!body.prompt_id) {
    throw new Error(`ComfyUI /prompt missing prompt_id: ${JSON.stringify(body).slice(0, 500)}`);
  }

  return body.prompt_id;
}

export async function pollHistoryForImage(
  comfyUrl: string,
  promptId: string,
  filenamePrefix: string,
  timeoutMs: number,
): Promise<ComfyHistoryImage> {
  const base = comfyUrl.replace(/\/$/, "");
  const started = Date.now();

  type HistoryEntry = {
    outputs?: Record<
      string,
      { images?: ComfyHistoryImage[] }
    >;
    status?: {
      status_str?: string;
      completed?: boolean;
      messages?: unknown[];
    };
  };

  while (Date.now() - started < timeoutMs) {
    let history: Record<string, HistoryEntry>;
    try {
      history = await fetchJson<Record<string, HistoryEntry>>(
        `${base}/history/${promptId}`,
      );
    } catch (err) {
      // Transient poll errors — keep waiting until timeout.
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("unreachable")) {
        throw err;
      }
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const entry = history[promptId];
    if (entry) {
      const statusStr = entry.status?.status_str;
      if (statusStr === "error") {
        const lastMsg = entry.status?.messages?.slice(-3) ?? [];
        throw new Error(
          `ComfyUI prompt ${promptId} failed: ${JSON.stringify(lastMsg).slice(0, 800)}`,
        );
      }

      const images = entry.outputs
        ? Object.values(entry.outputs).flatMap((o) => o.images ?? [])
        : [];
      const match =
        images.find((img) => img.filename.startsWith(filenamePrefix)) ??
        images[0];
      if (match?.filename) {
        return {
          filename: match.filename,
          subfolder: match.subfolder ?? "",
          type: match.type ?? "output",
        };
      }
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ComfyUI output (prompt_id=${promptId}, prefix=${filenamePrefix}). Check ComfyUI console for sampler/checkpoint errors.`,
  );
}

export async function downloadComfyImage(
  comfyUrl: string,
  image: ComfyHistoryImage,
): Promise<Buffer> {
  const base = comfyUrl.replace(/\/$/, "");
  const params = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder ?? "",
    type: image.type ?? "output",
  });
  const url = `${base}/view?${params.toString()}`;

  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`ComfyUI /view unreachable for ${image.filename}: ${message}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `ComfyUI /view failed (${res.status}) for ${image.filename}: ${body.slice(0, 400)}`,
    );
  }

  const arrayBuffer = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);
  if (buf.byteLength === 0) {
    throw new Error(`ComfyUI /view returned empty body for ${image.filename}`);
  }
  // PNG magic or JPEG magic — soft check
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  if (!isPng && !isJpeg) {
    throw new Error(
      `ComfyUI /view returned non-image data for ${image.filename} (${buf.byteLength} bytes, head=${buf.subarray(0, 8).toString("hex")})`,
    );
  }
  return buf;
}

// ---------------------------------------------------------------------------
// End-to-end generate
// ---------------------------------------------------------------------------

export async function generateSkinAlbedo(
  options: CliOptions,
): Promise<GenerateSummary> {
  const comfyUrl = options.comfyUrl.replace(/\/$/, "");
  const positivePrompt = buildPositivePrompt(options.skinTone, options.age);
  const negativePrompt = buildNegativePrompt();
  const workflow = buildSkinAlbedoWorkflow({
    positivePrompt,
    negativePrompt,
    seed: options.seed,
    filenamePrefix: FILENAME_PREFIX,
  });

  await detectComfy(comfyUrl);
  const promptId = await queuePrompt(comfyUrl, workflow);
  const outputImage = await pollHistoryForImage(
    comfyUrl,
    promptId,
    FILENAME_PREFIX,
    options.timeoutMs,
  );
  const imageBytes = await downloadComfyImage(comfyUrl, outputImage);

  const outPath = path.resolve(options.out);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, imageBytes);

  const imageSha256 = createHash("sha256").update(imageBytes).digest("hex");

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    ok: true,
    savedPath: outPath,
    promptId,
    comfyUrl,
    checkpoint: REALVISXL_CKPT,
    skinTone: options.skinTone,
    age: options.age,
    seed: options.seed,
    steps: STEPS,
    cfg: CFG,
    sampler: SAMPLER,
    scheduler: SCHEDULER,
    width: IMAGE_SIZE,
    height: IMAGE_SIZE,
    positivePrompt,
    negativePrompt,
    outputImage,
    imageSha256,
    bytes: imageBytes.byteLength,
    claimScope: "local_comfy_realvisxl_skin_albedo_txt2img_aesthetic_only",
    notEvidenceFor: [
      "aesthetic_only",
      "runtime_promotion",
      "production_asset_readiness",
      "quest_readiness",
      "learner_readiness",
      "clinical_validity",
      "scoring_validity",
      "scene_placement_readiness",
    ],
    providerBoundary: {
      localOnly: true,
      externalNetworkUsed: false,
      paidApiUsed: false,
      credentialsUsed: false,
      comfyWorkflowQueued: true,
      diffusionRan: true,
      runtimePromotionAllowed: false,
      productionAssetReadinessClaimed: false,
      questReadinessClaimed: false,
      learnerReadinessClaimed: false,
      clinicalValidityClaimed: false,
      scoringValidityClaimed: false,
    },
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    skinTone: "medium",
    age: "adult",
    out: DEFAULT_OUT,
    comfyUrl: process.env.COMFYUI_URL?.trim() || DEFAULT_COMFY_URL,
    seed: 606_060_724,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    const take = (): string => {
      if (!next || next.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      i += 1;
      return next;
    };

    switch (arg) {
      case "--skin-tone":
        options.skinTone = take();
        break;
      case "--age":
        options.age = take();
        break;
      case "--out":
        options.out = take();
        break;
      case "--comfy-url":
        options.comfyUrl = take();
        break;
      case "--seed": {
        const n = Number(take());
        if (!Number.isFinite(n) || n < 0) {
          throw new Error(`Invalid --seed: expected non-negative number`);
        }
        options.seed = Math.floor(n);
        break;
      }
      case "--timeout-ms": {
        const n = Number(take());
        if (!Number.isFinite(n) || n < 1_000) {
          throw new Error(`Invalid --timeout-ms: expected >= 1000`);
        }
        options.timeoutMs = Math.floor(n);
        break;
      }
      case "--help":
      // biome-ignore lint/suspicious/noFallthroughSwitchClause: process.exit(0) terminates; default still handles unknown args
      case "-h":
        printHelp();
        process.exit(0);
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown argument: ${arg}`);
        }
        break;
    }
  }

  return options;
}

function printHelp(): void {
  process.stdout.write(`realvisxl-skin-generate — ComfyUI RealVisXL skin albedo generator

Usage:
  npx tsx tools/openclinxr/evidence/realvisxl-skin-generate.ts [options]

Options:
  --skin-tone <tone>   Skin tone for prompt (default: medium)
  --age <age>          Age descriptor for prompt (default: adult)
  --out <path>         Output PNG path (default: ${DEFAULT_OUT})
  --comfy-url <url>    ComfyUI base URL (default: ${DEFAULT_COMFY_URL})
  --seed <n>           Sampler seed (default: 606060724)
  --timeout-ms <ms>    Poll timeout (default: ${DEFAULT_TIMEOUT_MS})
  -h, --help           Show this help

Workflow: CheckpointLoaderSimple(${REALVISXL_CKPT})
  → CLIPTextEncode×2 → EmptyLatentImage(1024²)
  → KSampler(steps=${STEPS}, cfg=${CFG}, ${SAMPLER}/${SCHEDULER})
  → VAEDecode → SaveImage(${FILENAME_PREFIX})

Endpoints: POST /prompt · GET /history/<id> · GET /view
`);
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const summary = await generateSkinAlbedo(options);
  // Human-readable saved path first, then JSON summary on stdout.
  process.stdout.write(`${summary.savedPath}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

const isDirectRun =
  typeof process.argv[1] === "string" &&
  (import.meta.url === pathToFileURL(process.argv[1]).href ||
    import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/")) ||
    process.argv[1].includes("realvisxl-skin-generate"));

if (isDirectRun) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`realvisxl-skin-generate FAILED: ${message}\n`);
    process.exitCode = 1;
  });
}
