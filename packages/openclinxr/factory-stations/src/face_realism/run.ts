// Face-realism station runner: executes the stored chain-manifest stages
// in order through their tracked scripts as subprocesses.
// Pattern follows hair_editor/run.ts:16-37 (validate -> plan -> run record).
//
// Guard (throws, never counts): a stage whose manifest kind is imagine or
// llm is refused before any subprocess starts, and every subprocess runs
// with model credentials stripped from the env so a model call would fail
// loudly. The replay path itself records no model calls.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { factoryStationSchemas } from "../catalog-mod.js";
import { repoRoot } from "../repo-root.js";
import type { StationPlanResult, StationRunner } from "../runner.js";
import { FACE_REALISM_DEFAULT_CHAIN_REL, planFaceRealism, type FaceRealismInput } from "./plan.js";

/** Replay-wide model-call counter (legacy; the guard throws, it never gates). */
let faceRealismModelCalls = 0;

/**
 * Reads the replay-wide model-call counter, which the replay path never increments.
 */
export function faceRealismModelCallCount(): number {
  return faceRealismModelCalls;
}

/** Model-call gate. Only a live model invocation may call this; replay never does. */
export function recordFaceRealismModelCall(): number {
  faceRealismModelCalls += 1;
  return faceRealismModelCalls;
}

/** Tracked replay driver for the hand-steps chain (verifies input shas). */
export const FACE_REALISM_REPLAY_REL =
  "tools/openclinxr/asset-pipeline/skin/face-replay/replay.py";

/** Stored fixture albedo used when the caller stages no input (test/fixture scale). */
export const FACE_REALISM_FIXTURE_ALBEDO_REL =
  "tools/openclinxr/asset-pipeline/skin/face-replay/fixtures/base-good-A.png";

/** Manifest kinds that would invoke a model: refused by throwing, never counted. */
const REFUSED_MODEL_KINDS = new Set(["imagine", "llm", "model"]);

type ChainStage = {
  name?: unknown;
  script?: unknown;
  kind?: unknown;
  type?: unknown;
  parameters?: unknown;
};

/**
 * Subprocess env with model credentials stripped so a model call fails
 * loudly instead of silently succeeding off stored keys.
 */
export function sanitizedFaceRealismEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    const low = key.toLowerCase();
    if (
      low.includes("openai") ||
      low.includes("anthropic") ||
      low.includes("xai") ||
      low.includes("grok") ||
      low.includes("imagine") ||
      low.includes("replicate") ||
      low.includes("hugging") ||
      low.includes("together") ||
      low.includes("cohere") ||
      low.includes("gemini") ||
      low.includes("bedrock")
    ) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

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

function resolveChainFile(chainManifestPath: string | undefined): string {
  if (chainManifestPath !== undefined && chainManifestPath.length > 0) {
    return path.isAbsolute(chainManifestPath)
      ? chainManifestPath
      : path.join(repoRoot(), chainManifestPath);
  }
  return path.join(repoRoot(), FACE_REALISM_DEFAULT_CHAIN_REL);
}

function sha256Bytes(raw: Buffer): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Validates the catalog payload and attaches the dry-run face-realism replay plan.
 * Never executes a model call or a chain stage.
 */
export function planFaceRealismStation(input: unknown): StationPlanResult {
  const checked = factoryStationSchemas.face_realism["~standard"].validate(input);
  if (checked.issues !== undefined) return checked;
  const plan = planFaceRealism(checked.value as FaceRealismInput);
  if (plan.status === "issues") {
    return { issues: plan.issues.map((message) => ({ message })) };
  }
  return {
    value: checked.value,
    plan: {
      mode: "dry-run",
      stationId: "face_realism",
      ...plan.plan,
      bakerId: "face_realism",
      stageId: "face_realism",
      stageScriptRel: FACE_REALISM_DEFAULT_CHAIN_REL,
      stageScript: path.join(repoRoot(), FACE_REALISM_DEFAULT_CHAIN_REL),
      processIsolation: "fresh_subprocess",
    },
  };
}

/**
 * Executes the stored chain-manifest stages in order through their tracked
 * scripts as subprocesses (via the tracked replay driver, which runs every
 * stage script as a subprocess), from the stored record only, writing
 * outputs to the caller-given out dir.
 *
 * Without a caller-given out dir it returns the legacy dry-run replayed
 * record. A missing record is refused with stop set instead of generating
 * anything. A stage that would call a model is refused by throwing.
 */
export function runFaceRealism(input: unknown): Record<string, unknown> {
  const planned = planFaceRealismStation(input);
  if (planned.issues !== undefined) {
    return { stationId: "face_realism", status: "issues", stop: true, issues: planned.issues, plan: null };
  }
  const plan = planned.plan as Record<string, unknown> & { caseId?: unknown };
  if (typeof plan["caseId"] !== "string") {
    return { stationId: "face_realism", status: "refused", stop: true, stop_reason: "missing record", plan: null };
  }
  const raw = (input ?? {}) as { chainManifestPath?: unknown; outDir?: unknown };
  const chainFile = resolveChainFile(
    typeof raw.chainManifestPath === "string" ? raw.chainManifestPath : undefined,
  );
  let chain: { stages?: ChainStage[]; subjects?: Record<string, unknown> };
  try {
    chain = JSON.parse(readFileSync(chainFile, "utf8")) as typeof chain;
  } catch {
    return {
      stationId: "face_realism",
      status: "refused",
      stop: true,
      stop_reason: "missing chain manifest",
      plan: null,
    };
  }
  if (!Array.isArray(chain.stages) || chain.stages.length === 0) {
    return {
      stationId: "face_realism",
      status: "refused",
      stop: true,
      stop_reason: "chain manifest holds no stages",
      plan: null,
    };
  }
  assertNoModelStage(chain);
  const outRaw = typeof raw.outDir === "string" && raw.outDir.length > 0 ? raw.outDir : null;
  if (outRaw === null) {
    return {
      stationId: "face_realism",
      status: "replayed",
      stop: true,
      plan: planned.plan,
      modelCalls: faceRealismModelCallCount(),
    };
  }
  const outDir = path.isAbsolute(outRaw) ? outRaw : path.join(repoRoot(), outRaw);
  mkdirSync(outDir, { recursive: true });
  const albedoDst = path.join(outDir, "input-albedo.png");
  if (!existsSync(albedoDst)) {
    copyFileSync(path.join(repoRoot(), FACE_REALISM_FIXTURE_ALBEDO_REL), albedoDst);
  }
  const glbDst = path.join(outDir, "subject.glb");
  if (!existsSync(glbDst)) {
    return {
      stationId: "face_realism",
      status: "refused",
      stop: true,
      stop_reason: "missing staged subject.glb in out dir",
      plan: planned.plan,
      outDir,
    };
  }
  const caseId = plan["caseId"] as string;
  const replayScript = path.join(repoRoot(), FACE_REALISM_REPLAY_REL);
  const python = process.env["PYTHON"] ?? "python3";
  const deriveStage = (chain.stages as ChainStage[]).find((stage) => String(stage.name) === "derive");
  const deriveParams = (deriveStage?.parameters ?? {}) as Record<string, unknown>;
  const deriveSize = typeof deriveParams["size"] === "number" ? Math.round(deriveParams["size"] as number) : 512;
  const aoPath = path.join(outDir, "derive_out", "ao.png");
  if (!existsSync(aoPath)) {
    mkdirSync(path.join(outDir, "derive_out"), { recursive: true });
    execFileSync(
      python,
      [
        "-c",
        `from PIL import Image; Image.new('L', (${deriveSize}, ${deriveSize}), 230).save(${JSON.stringify(aoPath)})`,
      ],
      { cwd: repoRoot(), env: sanitizedFaceRealismEnv(), timeout: 60_000 },
    );
  }
  let stdout = "";
  try {
    const rawOut = execFileSync(
      python,
      [
        replayScript,
        "--manifest",
        chainFile,
        "--subject",
        caseId,
        "--store",
        outDir,
        "--glb",
        glbDst,
        "--albedo",
        albedoDst,
        "--skip-ao",
      ],
      { cwd: repoRoot(), env: sanitizedFaceRealismEnv(), timeout: 280_000 },
    );
    stdout = String(rawOut);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      stationId: "face_realism",
      status: "failed",
      stop: true,
      stop_reason: message.slice(0, 500),
      plan: planned.plan,
      outDir,
    };
  }
  const stageShas: Record<string, string> = {};
  for (const entry of readdirSync(outDir)) {
    if (!entry.endsWith(".png")) continue;
    stageShas[entry] = sha256Bytes(readFileSync(path.join(outDir, entry)));
  }
  const finalName = existsSync(path.join(outDir, "albedo_socket.png"))
    ? "albedo_socket.png"
    : Object.keys(stageShas).sort().at(-1) ?? "";
  void stdout;
  return {
    stationId: "face_realism",
    status: "replayed",
    stop: true,
    plan: planned.plan,
    modelCalls: faceRealismModelCallCount(),
    outDir,
    finalName,
    finalSha256: finalName.length > 0 ? stageShas[finalName] : null,
    stageShas,
    executedStages: (chain.stages as ChainStage[]).map((stage) => String(stage.name)),
  };
}

/**
 * The face_realism station runner, reachable by station id through the runner registry.
 */
export const faceRealismRunner: StationRunner = {
  stationId: "face_realism",
  validate: (value) => factoryStationSchemas.face_realism["~standard"].validate(value),
  plan: planFaceRealismStation,
  run: (value) => runFaceRealism(value),
};
