// Face-realism skin-chain replay: the tracked chain driver plus the
// fixture-scale input staging (synthetic subject, flat AO) behind it.
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "@openclinxr/factory-station-core/runner";
import {
  type ChainStage,
  readJsonFile,
  runMisePython,
  sha256File,
} from "./shared.js";
import type { SubStage } from "./stages-c.js";

/** Tracked replay driver for the hand-steps chain (verifies input shas). */
export const FACE_REALISM_REPLAY_REL =
  "tools/openclinxr/asset-pipeline/skin/face-replay/replay.py";

/** Stored fixture albedo used when the caller stages no input (test/fixture scale). */
export const FACE_REALISM_FIXTURE_ALBEDO_REL =
  "tools/openclinxr/asset-pipeline/skin/face-replay/fixtures/base-good-A.png";

/** Manifest kinds that would invoke a model: refused by throwing, never counted. */
const REFUSED_MODEL_KINDS = new Set(["imagine", "llm", "model"]);

/**
 * Refuses (by throwing) any chain stage that would invoke a model, and any
 * stage that records no parameters (mirrors the replay driver refusal).
 */
export function assertNoModelStage(chain: { stages?: ChainStage[] }): void {
  const stages = chain.stages ?? [];
  for (const stage of stages) {
    const name = String(stage.name ?? "unnamed");
    const kind = String(stage.kind ?? stage.type ?? "").toLowerCase();
    const script = String(stage.script ?? "").toLowerCase();
    if (REFUSED_MODEL_KINDS.has(kind) || script.includes("imagine")) {
      throw new Error(`refused model stage: ${name} (kind=${kind || "none"})`);
    }
    if (
      stage.parameters === undefined ||
      stage.parameters === null ||
      typeof stage.parameters !== "object" ||
      Object.keys(stage.parameters as Record<string, unknown>).length === 0
    ) {
      throw new Error(`refused stage with no parameters: ${name}`);
    }
  }
}

/**
 * Stages the deterministic synthetic fixture subject GLB (plane + eye/brow
 * blobs, same recipe as the chain-execution test) for fixture-scale replays.
 */
export function stageSyntheticFixtureGlb(glbPath: string): void {
  const genPath = path.join(path.dirname(glbPath), "gen_glb.py");
  writeFileSync(
    genPath,
    [
      "import numpy as np, trimesh",
      "from trimesh.creation import icosphere",
      `OUT=${JSON.stringify(glbPath)}`,
      "XMIN,XMAX,YMIN,YMAX=-0.030,0.030,-0.160,0.100",
      "HX,HY,HW,HH=0.0,-0.100,0.020,0.008",
      "xs=np.linspace(XMIN,XMAX,61)",
      "ys=np.linspace(YMIN,YMAX,261)",
      "xv,yv=np.meshgrid(xs,ys)",
      "hole=(np.abs(xv-HX)<HW)&(np.abs(yv-HY)<HH)",
      "keep=~hole",
      "idx=np.full(xv.shape,-1,int)",
      "idx[keep]=np.arange(int(keep.sum()))",
      "v=np.column_stack([xv[keep],yv[keep],np.zeros(int(keep.sum()))])",
      "faces=[]",
      "for j in range(len(ys)-1):",
      " for i in range(len(xs)-1):",
      "  q=idx[j:j+2,i:i+2]",
      "  if (q>=0).all():",
      "   a,b,c,d=q[0,0],q[0,1],q[1,0],q[1,1]",
      "   faces+=[[a,b,c],[b,d,c]]",
      "faces=np.array(faces)",
      "uv=np.column_stack([(v[:,0]-XMIN)/(XMAX-XMIN),(v[:,1]-YMIN)/(YMAX-YMIN)])",
      "skin=trimesh.Trimesh(vertices=v,faces=faces,process=False)",
      "skin.visual=trimesh.visual.TextureVisuals(uv=uv.copy())",
      "parts={'fixture_body.001_skin':skin}",
      "eye_xy=[(1.0,'L'),(-1.0,'R')]",
      "for sx,side in eye_xy:",
      " e=icosphere(subdivisions=2,radius=0.012)",
      " e.apply_translation([sx*0.015,0.0,-0.010])",
      " eu=np.column_stack([(e.vertices[:,0]-e.vertices[:,0].min())/0.024,(e.vertices[:,1]-e.vertices[:,1].min())/0.024])",
      " e.visual=trimesh.visual.TextureVisuals(uv=eu)",
      " parts['fixture_eyes_low_poly_'+side]=e",
      " b=icosphere(subdivisions=1,radius=0.008)",
      " b.apply_scale([1.5,0.6,0.4])",
      " b.apply_translation([sx*0.015,0.014,0.002])",
      " bu=np.column_stack([(b.vertices[:,0]-b.vertices[:,0].min())/0.024,(b.vertices[:,1]-b.vertices[:,1].min())/0.010])",
      " b.visual=trimesh.visual.TextureVisuals(uv=bu)",
      " parts['fixture_eyebrow_'+side]=b",
      "trimesh.Scene(parts).export(OUT)",
    ].join("\n"),
  );
  runMisePython([genPath], 300_000);
}

export type ReplayChainOptions = {
  subject: string;
  manifestFile: string;
  glbFile: string;
  albedoFile: string;
  storeDir: string;
  skipAo: boolean;
  skipStages: string[];
};

export type ManifestStagePlan = {
  name: string;
  outputPng: string | null;
  skipped: boolean;
};

export type ChainManifestPlan = {
  /** Manifest stage names minus the declared skips, in manifest order (what the replay runs). */
  executed: string[];
  /** Output PNG of the last executed manifest stage (null when none declares one). */
  finalOutput: string | null;
  /** Every manifest stage in manifest order, with skip flags (what the station chains). */
  ordered: ManifestStagePlan[];
  stages: ManifestStagePlan[];
};

/**
 * Manifest-driven stage plan: execution order and the final albedo file
 * both derive from the manifest's stage list and output_paths, minus the
 * case's declared skips. No stage name or output filename is hard-coded
 * here: appending a stage to the manifest changes the plan with no code
 * change. The albedo_ preference mirrors the chain convention that the
 * carried texture is the albedo_* product (roughness/derive maps never
 * advance the chain albedo).
 */
export function planChainManifest(
  manifest: { stages?: Array<{ name?: unknown; output_paths?: unknown }> },
  skipStages: string[],
): ChainManifestPlan {
  const skipped = new Set(skipStages);
  const ordered: ManifestStagePlan[] = [];
  for (const stage of manifest.stages ?? []) {
    const name = String(stage.name ?? "");
    if (name.length === 0) continue;
    const paths = stage.output_paths as Record<string, unknown> | undefined;
    const pngs =
      paths !== undefined && paths !== null && typeof paths === "object"
        ? Object.values(paths).filter((value): value is string => typeof value === "string" && value.endsWith(".png"))
        : [];
    const outputPng = pngs.find((value) => value.startsWith("albedo_")) ?? pngs[0] ?? null;
    ordered.push({ name, outputPng, skipped: skipped.has(name) });
  }
  const stages = ordered.filter((stage) => !stage.skipped);
  const finalOutput = [...stages].reverse().find((stage) => stage.outputPng !== null)?.outputPng ?? null;
  return { executed: stages.map((stage) => stage.name), finalOutput, ordered, stages };
}

/**
 * Runs the tracked skin-chain replay driver as a subprocess and returns the
 * per-output shas. The caller stages inputs and (for fixture scale) the flat
 * AO + size override manifest; this helper only runs and measures.
 */
export function runReplayChain(options: ReplayChainOptions): {
  finalName: string;
  finalSha256: string | null;
  stageShas: Record<string, string>;
  executedChainStages: string[];
  manifestSha256: string;
} {
  const chain = readJsonFile(options.manifestFile) as { stages?: ChainStage[] };
  if (!Array.isArray(chain.stages) || chain.stages.length === 0) {
    throw new Error("chain manifest holds no stages: refused");
  }
  assertNoModelStage(chain);
  const replayScript = path.join(repoRoot(), FACE_REALISM_REPLAY_REL);
  const argv = [
    replayScript,
    "--manifest",
    options.manifestFile,
    "--subject",
    options.subject,
    "--store",
    options.storeDir,
    "--glb",
    options.glbFile,
    "--albedo",
    options.albedoFile,
  ];
  if (options.skipAo) argv.push("--skip-ao");
  if (options.skipStages.length > 0) argv.push("--skip-stages", options.skipStages.join(","));
  runMisePython(argv, 1_800_000);
  const stageShas: Record<string, string> = {};
  for (const entry of readdirSync(options.storeDir)) {
    if (!entry.endsWith(".png")) continue;
    stageShas[entry] = sha256File(path.join(options.storeDir, entry));
  }
  const plan = planChainManifest(chain as { stages?: Array<{ name?: unknown; output_paths?: unknown }> }, options.skipStages);
  const finalName =
    plan.finalOutput ??
    (existsSync(path.join(options.storeDir, "albedo_socket.png"))
      ? "albedo_socket.png"
      : (Object.keys(stageShas).sort().at(-1) ?? ""));
  return {
    finalName,
    finalSha256: finalName.length > 0 ? (stageShas[finalName] ?? null) : null,
    stageShas,
    executedChainStages: plan.executed,
    manifestSha256: sha256File(options.manifestFile),
  };
}

function stageFlatAo(outDir: string, size: number): string {
  const aoPath = path.join(outDir, "derive_out", "ao.png");
  if (!existsSync(aoPath)) {
    mkdirSync(path.join(outDir, "derive_out"), { recursive: true });
    runMisePython(
      [
        "-c",
        `from PIL import Image; Image.new('L', (${size}, ${size}), 230).save(${JSON.stringify(aoPath)})`,
      ],
      60_000,
    );
  }
  return aoPath;
}

/**
 * Stages a fixture-scale replay dir: fixture albedo copy, deterministic
 * synthetic subject GLB, and the flat-grey AO the human-run Blender bake
 * stands in for. Returns the staged { albedoFile, glbFile, aoFile }.
 */
export function prepareFixtureReplayDir(
  outDir: string,
  albedoRel: string,
  deriveSize: number,
): { albedoFile: string; glbFile: string; aoFile: string } {
  mkdirSync(outDir, { recursive: true });
  const albedoFile = path.join(outDir, "input-albedo.png");
  if (!existsSync(albedoFile)) {
    copyFileSync(path.join(repoRoot(), albedoRel), albedoFile);
  }
  const glbFile = path.join(outDir, "subject.glb");
  if (!existsSync(glbFile)) {
    stageSyntheticFixtureGlb(glbFile);
  }
  const aoFile = stageFlatAo(outDir, Math.round(deriveSize));
  return { albedoFile, glbFile, aoFile };
}

/**
 * Manifest stages the station chains itself, in manifest position, instead
 * of the replay (their standalone argv differs from replay.py's, so the
 * replay must skip them). Keyed by stage name per the card; the ORDER
 * still comes from the manifest plan.
 */
export const STATION_CHAINED_STAGES = ["beard_shadow", "detail_bands"] as const;

export type Stage3ManifestDoc = {
  stages?: Array<{ name?: unknown; output_paths?: unknown; parameters?: Record<string, unknown> }>;
  subjects?: Record<string, { overrides?: Record<string, Record<string, unknown>> }>;
};

// Manifest-driven output filename: the station never hard-codes which
// file a chain stage writes; the manifest's output_paths is the source.
export function manifestOutputPng(manifestDoc: Stage3ManifestDoc, stageName: string): string {
  const def = manifestDoc.stages?.find((stage) => String(stage.name ?? "") === stageName);
  const out = Object.values((def?.output_paths ?? {}) as Record<string, unknown>).find(
    (value): value is string => typeof value === "string" && value.endsWith(".png"),
  );
  if (def === undefined || out === undefined) {
    throw new Error(`chain manifest holds no png output for stage ${stageName}: refused`);
  }
  return out;
}

export type Stage3ChainOptions = {
  caseRec: Record<string, unknown>;
  manifestDoc: Stage3ManifestDoc;
  manifestAbs: string;
  chainSubject: string;
  glbAbs: string;
  /** Chain input albedo (stage-3 colour output in production). */
  albedoIn: string;
  storeDir: string;
  /** Full AO bake in the first segment (production); later segments reuse derive_out. */
  skipAo: boolean;
  skipStages: string[];
};

export type Stage3ChainResult = {
  plan: ChainManifestPlan;
  /** Replay segment records + standalone records, in manifest order. */
  records: SubStage[];
  manifestSha256: string;
  socketExpected: string;
  socketExpectedSource: string;
  socketActual: string;
  finalAbs: string;
  finalStageName: string;
  finalSha256: string;
};
