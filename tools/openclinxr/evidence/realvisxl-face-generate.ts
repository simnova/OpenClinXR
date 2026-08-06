#!/usr/bin/env npx tsx
/**
 * RealVisXL frontal clinical face generator (ComfyUI :8188).
 *
 * Produces a neutral front-facing photoreal clinical face portrait per role
 * for UV projection onto Anny head face islands. SERIALIZE calls — single
 * ComfyUI instance.
 *
 * Usage:
 *   npx tsx tools/openclinxr/evidence/realvisxl-face-generate.ts \
 *     --role adult|child|parent|nurse [--out path] [--seed n]
 *
 * Aesthetic-only. notEvidenceFor readiness / clinical claims.
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  REALVISXL_CKPT,
  DEFAULT_COMFY_URL,
  detectComfy,
  queuePrompt,
  pollHistoryForImage,
  downloadComfyImage,
  type ComfyWorkflow,
  type ComfyHistoryImage,
} from "./realvisxl-skin-generate.js";

export const SCHEMA_VERSION = "openclinxr.realvisxl-face-generate.v1";
export const FILENAME_PREFIX = "openclinxr_face_portrait";
const IMAGE_SIZE = 1024;
const STEPS = 28;
const CFG = 5.5;
const SAMPLER = "dpmpp_2m";
const SCHEDULER = "karras";
const DEFAULT_TIMEOUT_MS = 360_000;

export type RoleId = "adult" | "child" | "parent" | "nurse";

export type RoleFaceSpec = {
  role: RoleId;
  ageLabel: string;
  ageYears: number;
  skinTone: string;
  sexPresentation: string;
  hairHint: string;
  seed: number;
  defaultOut: string;
};

export const ROLE_FACE_SPECS: Record<RoleId, RoleFaceSpec> = {
  adult: {
    role: "adult",
    ageLabel: "middle-aged adult",
    ageYears: 52,
    skinTone: "warm medium Caucasian",
    sexPresentation: "male",
    hairHint: "short brown hair, receding slightly, natural clinical patient",
    seed: 520_018_101,
    defaultOut: "apps/ui-xr/public/_regen-preview/face_adult_patient.png",
  },
  child: {
    role: "child",
    ageLabel: "school-age child about 8 years old",
    ageYears: 8,
    skinTone: "warm light child",
    sexPresentation: "child",
    hairHint: "short light brown hair, pediatric patient",
    seed: 808_018_202,
    defaultOut: "apps/ui-xr/public/_regen-preview/face_child_patient.png",
  },
  parent: {
    role: "parent",
    ageLabel: "adult parent about 34 years old",
    ageYears: 34,
    skinTone: "warm light",
    sexPresentation: "female",
    hairHint: "dark brown shoulder-length hair, concerned parent",
    seed: 340_018_303,
    defaultOut: "apps/ui-xr/public/_regen-preview/face_parent.png",
  },
  nurse: {
    role: "nurse",
    ageLabel: "adult clinical nurse about 29 years old",
    ageYears: 29,
    skinTone: "medium warm",
    sexPresentation: "male",
    hairHint: "short black hair, professional nurse",
    seed: 290_018_404,
    defaultOut: "apps/ui-xr/public/_regen-preview/face_nurse.png",
  },
};

export function buildFacePositivePrompt(spec: RoleFaceSpec): string {
  return [
    "photorealistic clinical training standardized patient face portrait",
    "neutral frontal view, front-facing camera, looking at camera",
    "even soft studio medical exam lighting, no harsh shadows",
    `${spec.ageLabel}, ${spec.sexPresentation}`,
    `${spec.skinTone} natural skin tone`,
    "visible pores, realistic skin microdetail, natural lips closed gently",
    "natural eyes open, soft expression, calm cooperative",
    spec.hairHint,
    "head and shoulders only, centered face fills frame",
    "closed mouth, no open mouth cavity, no teeth showing",
    "no makeup, no jewelry, no glasses, no watermark, no text",
    "8k uhd, sharp focus, DSLR portrait, true-to-life human face",
  ].join(", ");
}

export function buildFaceNegativePrompt(): string {
  return [
    "profile view",
    "side view",
    "three-quarter",
    "looking away",
    "open mouth",
    "mouth agape",
    "teeth",
    "tongue",
    "screaming",
    "mannequin",
    "plastic",
    "doll",
    "cgi",
    "3d render",
    "cartoon",
    "anime",
    "illustration",
    "painting",
    "blurry",
    "low quality",
    "deformed",
    "extra limbs",
    "duplicate face",
    "split face",
    "asymmetric melt",
    "text",
    "watermark",
    "logo",
    "medical mask",
    "gloves",
    "stethoscope covering face",
  ].join(", ");
}

export function buildFaceWorkflow(input: {
  positivePrompt: string;
  negativePrompt: string;
  seed: number;
  filenamePrefix?: string;
}): ComfyWorkflow {
  const prefix = input.filenamePrefix ?? FILENAME_PREFIX;
  return {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: REALVISXL_CKPT },
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
      inputs: { width: IMAGE_SIZE, height: IMAGE_SIZE, batch_size: 1 },
    },
    "5": {
      class_type: "KSampler",
      inputs: {
        seed: input.seed,
        steps: STEPS,
        cfg: CFG,
        sampler_name: SAMPLER,
        scheduler: SCHEDULER,
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
      inputs: { images: ["6", 0], filename_prefix: prefix },
    },
  };
}

export type FaceGenerateSummary = {
  schemaVersion: string;
  generatedAt: string;
  ok: true;
  role: RoleId;
  savedPath: string;
  promptId: string;
  comfyUrl: string;
  checkpoint: string;
  seed: number;
  positivePrompt: string;
  negativePrompt: string;
  imageSha256: string;
  bytes: number;
  claimScope: string;
  notEvidenceFor: string[];
};

export async function generateRoleFace(input: {
  role: RoleId;
  out?: string;
  comfyUrl?: string;
  seed?: number;
  timeoutMs?: number;
}): Promise<FaceGenerateSummary> {
  const spec = ROLE_FACE_SPECS[input.role];
  if (!spec) throw new Error(`Unknown role: ${input.role}`);
  const comfyUrl = (input.comfyUrl ?? process.env.COMFYUI_URL ?? DEFAULT_COMFY_URL).replace(
    /\/$/,
    "",
  );
  const seed = input.seed ?? spec.seed;
  const outPath = path.resolve(input.out ?? spec.defaultOut);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const positivePrompt = buildFacePositivePrompt(spec);
  const negativePrompt = buildFaceNegativePrompt();
  const prefix = `${FILENAME_PREFIX}_${input.role}_${Date.now()}`;

  const workflow = buildFaceWorkflow({
    positivePrompt,
    negativePrompt,
    seed,
    filenamePrefix: prefix,
  });

  await detectComfy(comfyUrl);
  const promptId = await queuePrompt(comfyUrl, workflow);
  const outputImage = await pollHistoryForImage(comfyUrl, promptId, prefix, timeoutMs);
  const imageBytes = await downloadComfyImage(comfyUrl, outputImage);

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, imageBytes);

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    ok: true,
    role: input.role,
    savedPath: outPath,
    promptId,
    comfyUrl,
    checkpoint: REALVISXL_CKPT,
    seed,
    positivePrompt,
    negativePrompt,
    imageSha256: createHash("sha256").update(imageBytes).digest("hex"),
    bytes: imageBytes.byteLength,
    claimScope: "local_comfy_realvisxl_frontal_clinical_face_aesthetic_only",
    notEvidenceFor: [
      "aesthetic_only",
      "runtime_promotion",
      "production_asset_readiness",
      "quest_readiness",
      "learner_readiness",
      "clinical_validity",
      "scoring_validity",
    ],
  };
}

function parseArgs(argv: string[]): {
  role: RoleId;
  out?: string;
  comfyUrl?: string;
  seed?: number;
  timeoutMs?: number;
} {
  let role: RoleId | undefined;
  let out: string | undefined;
  let comfyUrl: string | undefined;
  let seed: number | undefined;
  let timeoutMs: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = argv[i + 1];
    const take = (): string => {
      if (!next || next.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return next;
    };
    switch (arg) {
      case "--role":
        role = take() as RoleId;
        break;
      case "--out":
        out = take();
        break;
      case "--comfy-url":
        comfyUrl = take();
        break;
      case "--seed":
        seed = Math.floor(Number(take()));
        break;
      case "--timeout-ms":
        timeoutMs = Math.floor(Number(take()));
        break;
      case "--help":
      case "-h":
        process.stdout.write(
          "realvisxl-face-generate — --role adult|child|parent|nurse [--out path] [--seed n]\n",
        );
        process.exit(0);
        break;
      default:
        break;
    }
  }
  if (!role || !ROLE_FACE_SPECS[role]) {
    throw new Error("Required: --role adult|child|parent|nurse");
  }
  return { role, out, comfyUrl, seed, timeoutMs };
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const summary = await generateRoleFace(options);
  process.stdout.write(`${summary.savedPath}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

const isDirectRun =
  typeof process.argv[1] === "string" &&
  (import.meta.url === pathToFileURL(process.argv[1]).href ||
    import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/")) ||
    process.argv[1].includes("realvisxl-face-generate"));

if (isDirectRun) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`realvisxl-face-generate failed: ${message}\n`);
    process.exit(1);
  });
}
