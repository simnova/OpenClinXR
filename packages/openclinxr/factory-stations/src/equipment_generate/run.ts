import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { factoryStationSchemas } from "../catalog.js";
import type { StationPlan, StationPlanResult, StationRunner } from "../runner.js";
import {
  findEquipmentSubject,
  repoRoot,
  resolveExistingViewPaths,
} from "./subjects.js";

export type EquipmentGeneratePlan = StationPlan & {
  subjectId: string;
  packId: string;
  requestedViewCount: number;
  viewCount: number;
  inputImagePaths: string[];
  inputImagePath: string | null;
  remesh: boolean;
  seed: number;
  decimationTarget: number;
  outputDir: string;
  processIsolation: "fresh_subprocess";
  conditioning: "single-view" | "multi-view" | "no-images";
};

function trellisOutRoot(root: string): string {
  return process.env["OPENCLINXR_TRELLIS_OUT"] ?? path.join(root, ".openclinxr/evidence/trellis-bake");
}

export function planEquipmentGenerate(
  input: unknown,
): { issues: readonly import("../catalog.js").StandardIssue[] } | { value: Record<string, unknown>; plan: EquipmentGeneratePlan } {
  const checked = factoryStationSchemas.equipment_generate["~standard"].validate(input);
  if ("issues" in checked) return checked;

  const subjectId = String(checked.value["subjectId"]);
  const packId = String(checked.value["packId"]);
  const entry = findEquipmentSubject(subjectId) ?? findEquipmentSubject(packId);
  if (!entry) {
    return { issues: [{ message: `unknown subjectId ${subjectId}`, path: ["subjectId"] }] };
  }

  const root = repoRoot();
  const inputImagePaths = resolveExistingViewPaths(entry, root);
  const viewCount = inputImagePaths.length;
  const requestedViewCount = Number(checked.value["viewCount"]);
  const remesh = Boolean(checked.value["remesh"]);
  const seed = Number(checked.value["seed"]);
  const decimationTarget = Number(checked.value["decimationTarget"]);

  const plan: EquipmentGeneratePlan = {
    mode: "dry-run",
    stationId: "equipment_generate",
    subjectId: entry.subjectId,
    packId,
    requestedViewCount,
    viewCount,
    inputImagePaths,
    inputImagePath: inputImagePaths[0] ?? null,
    remesh,
    seed,
    decimationTarget,
    outputDir: path.join(trellisOutRoot(root), entry.subjectId),
    processIsolation: "fresh_subprocess",
    conditioning: viewCount === 0 ? "no-images" : viewCount === 1 ? "single-view" : "multi-view",
  };
  return { value: checked.value, plan };
}

export type EquipmentGenerateRunOptions = {
  extraArgv?: string[];
  hfDemo?: boolean;
  noRemesh?: boolean;
  textureSize?: number | null;
};

/**
 * Spawns run_bake_isolated.py in a fresh subprocess. Tests must call plan(), not run().
 */
export function runEquipmentGenerate(input: unknown, options: EquipmentGenerateRunOptions = {}): Record<string, unknown> {
  const planned = planEquipmentGenerate(input);
  if ("issues" in planned) {
    throw new Error(planned.issues.map((issue) => issue.message).join("; "));
  }
  const plan: EquipmentGeneratePlan = planned.plan;
  if (plan.viewCount === 0) {
    throw new Error(`No input images found for subject ${plan.subjectId}`);
  }

  const root = repoRoot();
  const home = process.env["HOME"] ?? "/Users/patrick";
  const venvPython = path.resolve(home, ".openclinxr-tools/trellis2-apple/venv/bin/python3");
  const trellisRoot = path.resolve(home, ".openclinxr-tools/trellis2-apple/src");
  const weightsPath = path.resolve(home, "ComfyUI/models/trellis2");
  const dinov3Path = path.resolve(home, "ComfyUI/models/dinov3");
  const bakeScript = path.join(root, "tools/openclinxr/evidence/blender/run_bake_isolated.py");
  mkdirSync(plan.outputDir, { recursive: true });

  const argv: string[] = [
    bakeScript,
    "--subject-id",
    plan.subjectId,
    "--display-name",
    findEquipmentSubject(plan.subjectId)?.displayName ?? plan.subjectId,
    "--output-dir",
    plan.outputDir,
    "--weights-path",
    weightsPath,
    "--dinov3-path",
    dinov3Path,
    "--trellis-root",
    trellisRoot,
    "--seed",
    String(plan.seed),
  ];
  if (plan.remesh) argv.push("--remesh");
  if (options.noRemesh) argv.push("--no-remesh");
  if (options.hfDemo) argv.push("--hf-demo");
  if (options.textureSize != null) argv.push("--texture-size", String(options.textureSize));
  argv.push("--decimation-target", String(plan.decimationTarget));
  if (options.extraArgv) argv.push(...options.extraArgv);
  for (const img of plan.inputImagePaths) argv.push("--input-image", img);

  execFileSync(venvPython, argv, {
    encoding: "utf8",
    cwd: root,
    timeout: 3_600_000,
    env: { ...process.env, PYTHONUNBUFFERED: "1", PYTORCH_ENABLE_MPS_FALLBACK: "1" },
    maxBuffer: 10 * 1024 * 1024,
  });

  const reportPath = path.join(plan.outputDir, "bake-measure.json");
  if (existsSync(reportPath)) {
    return JSON.parse(readFileSync(reportPath, "utf8")) as Record<string, unknown>;
  }
  return { subjectId: plan.subjectId, status: "spawned_without_report" };
}

export const equipmentGenerateRunner: StationRunner = {
  stationId: "equipment_generate",
  validate: (value) => factoryStationSchemas.equipment_generate["~standard"].validate(value),
  plan: (value) => planEquipmentGenerate(value),
  run: runEquipmentGenerate,
};
