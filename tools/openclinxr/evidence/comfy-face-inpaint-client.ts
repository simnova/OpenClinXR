import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const REALVISXL_CHECKPOINT = "RealVisXL_V5.0_fp16.safetensors";
export const REALVISXL_CHECKPOINT_SHA = "6a35a7855770ae9820a3c931d4964c3817b6d9e3c6f9c4dabb5b3a94e5643b80";

export type ComfyFaceInpaintInput = {
  comfyUrl: string;
  baseAlbedoPath: string;
  faceMaskPath: string;
  outputPrefix: string;
  positivePrompt: string;
  negativePrompt?: string;
  seed?: number;
  steps?: number;
  cfg?: number;
  denoise?: number;
};

export type ComfyFaceInpaintResult = {
  promptId: string;
  outputImagePath: string;
  outputImageName: string;
  workflowQueued: true;
  diffusionWeightsLoaded: true;
};

export async function detectComfy(comfyUrl = "http://127.0.0.1:8188"): Promise<boolean> {
  try {
    const res = await fetch(`${comfyUrl}/system_stats`, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function runComfyFaceText2Img(input: ComfyFaceInpaintInput): Promise<ComfyFaceInpaintResult> {
  const comfyUrl = input.comfyUrl.replace(/\/$/, "");
  const workflow = buildText2ImgWorkflow({
    outputPrefix: input.outputPrefix,
    positivePrompt: input.positivePrompt,
    negativePrompt: input.negativePrompt ?? defaultNegativePrompt(),
    seed: input.seed ?? 6060607,
    steps: input.steps ?? 8,
    cfg: input.cfg ?? 5.5,
    width: 512,
    height: 512,
  });

  const clientId = `openclinxr-${Date.now()}`;
  const promptRes = await fetch(`${comfyUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });
  if (!promptRes.ok) {
    throw new Error(`Comfy /prompt failed: ${promptRes.status} ${await promptRes.text()}`);
  }
  const promptBody = (await promptRes.json()) as { prompt_id?: string; error?: unknown };
  if (!promptBody.prompt_id) {
    throw new Error(`Comfy /prompt missing prompt_id: ${JSON.stringify(promptBody)}`);
  }

  const outputImage = await pollComfyOutput(comfyUrl, promptBody.prompt_id, input.outputPrefix);
  return {
    promptId: promptBody.prompt_id,
    outputImagePath: outputImage.path,
    outputImageName: outputImage.name,
    workflowQueued: true,
    diffusionWeightsLoaded: true,
  };
}

export async function runComfyMaskedFaceInpaint(input: ComfyFaceInpaintInput): Promise<ComfyFaceInpaintResult> {
  const comfyUrl = input.comfyUrl.replace(/\/$/, "");
  const comfyInputDir = path.join(process.env.HOME ?? "", "ComfyUI", "input");
  await mkdir(comfyInputDir, { recursive: true });

  const baseName = `openclinxr_base_${Date.now()}.png`;
  const maskName = `openclinxr_face_mask_${Date.now()}.png`;
  await copyFile(input.baseAlbedoPath, path.join(comfyInputDir, baseName));
  await copyFile(input.faceMaskPath, path.join(comfyInputDir, maskName));

  const workflow = buildMaskedInpaintWorkflow({
    baseImageName: baseName,
    maskImageName: maskName,
    outputPrefix: input.outputPrefix,
    positivePrompt: input.positivePrompt,
    negativePrompt: input.negativePrompt ?? defaultNegativePrompt(),
    seed: input.seed ?? 6060607,
    steps: input.steps ?? 12,
    cfg: input.cfg ?? 5.5,
    denoise: input.denoise ?? 0.55,
  });

  const clientId = `openclinxr-${Date.now()}`;
  const promptRes = await fetch(`${comfyUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });
  if (!promptRes.ok) {
    throw new Error(`Comfy /prompt failed: ${promptRes.status} ${await promptRes.text()}`);
  }
  const promptBody = (await promptRes.json()) as { prompt_id?: string; error?: unknown };
  if (!promptBody.prompt_id) {
    throw new Error(`Comfy /prompt missing prompt_id: ${JSON.stringify(promptBody)}`);
  }

  const outputImage = await pollComfyOutput(comfyUrl, promptBody.prompt_id, input.outputPrefix);
  return {
    promptId: promptBody.prompt_id,
    outputImagePath: outputImage.path,
    outputImageName: outputImage.name,
    workflowQueued: true,
    diffusionWeightsLoaded: true,
  };
}

export function buildText2ImgWorkflow(input: {
  outputPrefix: string;
  positivePrompt: string;
  negativePrompt: string;
  seed: number;
  steps: number;
  cfg: number;
  width: number;
  height: number;
}): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  return {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: REALVISXL_CHECKPOINT },
    },
    "2": {
      class_type: "CLIPTextEncode",
      inputs: { text: input.positivePrompt, clip: ["1", 1] },
    },
    "3": {
      class_type: "CLIPTextEncode",
      inputs: { text: input.negativePrompt, clip: ["1", 1] },
    },
    "4": {
      class_type: "EmptyLatentImage",
      inputs: { width: input.width, height: input.height, batch_size: 1 },
    },
    "5": {
      class_type: "KSampler",
      inputs: {
        seed: input.seed,
        steps: input.steps,
        cfg: input.cfg,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 1,
        model: ["1", 0],
        positive: ["2", 0],
        negative: ["3", 0],
        latent_image: ["4", 0],
      },
    },
    "6": {
      class_type: "VAEDecode",
      inputs: { samples: ["5", 0], vae: ["1", 2] },
    },
    "7": {
      class_type: "SaveImage",
      inputs: { images: ["6", 0], filename_prefix: input.outputPrefix },
    },
  };
}

export function buildMaskedInpaintWorkflow(input: {
  baseImageName: string;
  maskImageName: string;
  outputPrefix: string;
  positivePrompt: string;
  negativePrompt: string;
  seed: number;
  steps: number;
  cfg: number;
  denoise: number;
}): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  return {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: REALVISXL_CHECKPOINT },
    },
    "2": {
      class_type: "LoadImage",
      inputs: { image: input.baseImageName },
    },
    "3": {
      class_type: "LoadImage",
      inputs: { image: input.maskImageName },
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
      class_type: "VAEEncode",
      inputs: { pixels: ["2", 0], vae: ["1", 2] },
    },
    "7": {
      class_type: "ImageToMask",
      inputs: { image: ["3", 0], channel: "red" },
    },
    "8": {
      class_type: "SetLatentNoiseMask",
      inputs: { samples: ["6", 0], mask: ["7", 0] },
    },
    "9": {
      class_type: "KSampler",
      inputs: {
        seed: input.seed,
        steps: input.steps,
        cfg: input.cfg,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: input.denoise,
        model: ["1", 0],
        positive: ["4", 0],
        negative: ["5", 0],
        latent_image: ["8", 0],
      },
    },
    "10": {
      class_type: "VAEDecode",
      inputs: { samples: ["9", 0], vae: ["1", 2] },
    },
    "11": {
      class_type: "SaveImage",
      inputs: { images: ["10", 0], filename_prefix: input.outputPrefix },
    },
  };
}

async function pollComfyOutput(
  comfyUrl: string,
  promptId: string,
  outputPrefix: string,
  timeoutMs = 180_000,
): Promise<{ path: string; name: string }> {
  const outputDir = path.join(process.env.HOME ?? "", "ComfyUI", "output");
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const historyRes = await fetch(`${comfyUrl}/history/${promptId}`);
    if (historyRes.ok) {
      const history = (await historyRes.json()) as Record<
        string,
        {
          outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }>;
          status?: { status_str?: string; messages?: unknown[] };
        }
      >;
      const entry = history[promptId];
      if (entry?.status?.status_str === "error") {
        throw new Error(`Comfy prompt ${promptId} failed: ${JSON.stringify(entry.status.messages?.slice(-1))}`);
      }
      const images = entry?.outputs
        ? Object.values(entry.outputs).flatMap((output) => output.images ?? [])
        : [];
      const match = images.find((image) => image.filename.startsWith(outputPrefix));
      if (match) {
        const subfolder = match.subfolder ? path.join(outputDir, match.subfolder) : outputDir;
        return { path: path.join(subfolder, match.filename), name: match.filename };
      }
    }
    await sleep(1500);
  }

  const recent = await findRecentOutput(outputDir, outputPrefix);
  if (recent) return recent;
  throw new Error(`Timed out waiting for Comfy output with prefix ${outputPrefix} (prompt ${promptId})`);
}

async function findRecentOutput(outputDir: string, prefix: string): Promise<{ path: string; name: string } | null> {
  try {
    const files = await readdir(outputDir);
    const matches = files.filter((file) => file.startsWith(prefix) && file.endsWith(".png")).sort();
    const latest = matches.at(-1);
    return latest ? { path: path.join(outputDir, latest), name: latest } : null;
  } catch {
    return null;
  }
}

function defaultNegativePrompt(): string {
  return "blurry, low quality, deformed face, extra eyes, cross-eyed, cartoon, plastic, watermark, text, logo";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sha256File(filePath: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}