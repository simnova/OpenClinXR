import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  /**
   * Bake export file name inside outputDir (run_bake_isolated.py exports
   * `<subjectId>.glb`). Deterministic at plan time.
   */
  glbExportName: string;
  /**
   * Per-subject freeze JSON path. The freeze records the declared subject's
   * runtime asset URL after a mesh_exported bake (tracked location).
   */
  freezeRecordPath: string;
  /** Runtime asset URL recorded in the subject's freeze, or null when unfrozen. */
  runtimeAssetUrl: string | null;
};

/**
 * Per-subject freeze record: the declared equipment subject -> runtime asset URL
 * contract published by this station and consumed by asset-registry resolution.
 * Written after a mesh_exported bake; GLBs themselves may stay gitignored, so the
 * freeze JSON (not GLB presence) is the unit of truth for URL resolution.
 */
export const EQUIPMENT_RUNTIME_FREEZE_SCHEMA_VERSION = "openclinxr.equipment-runtime-freeze.v1" as const;

/** Tracked freeze-record root (relative to the repo root). */
export const EQUIPMENT_FREEZE_DIR_REL = "tools/openclinxr/asset-pipeline/trellis/equipment-freezes" as const;

export type EquipmentRuntimeFreezeRecord = {
  schemaVersion: typeof EQUIPMENT_RUNTIME_FREEZE_SCHEMA_VERSION;
  subjectId: string;
  displayName: string;
  seed: number;
  remesh: boolean;
  decimationTarget: number;
  /** Bake output dir (absolute) that produced the frozen GLB. */
  bakeOutputDir: string;
  /** Export file name inside bakeOutputDir, e.g. `wall-clock.glb`. */
  glbExportName: string;
  /** sha256 hex of the frozen GLB at record time. */
  glbSha256: string;
  /** Runtime URL the declared subject resolves to under the tracked medical-equipment namespace. */
  runtimeAssetUrl: string;
  generatedAt: string;
  claimScope: string[];
  notEvidenceFor: string[];
};

function trellisOutRoot(root: string): string {
  return process.env["OPENCLINXR_TRELLIS_OUT"] ?? path.join(root, ".openclinxr/evidence/trellis-bake");
}

/** Freeze-record root: OPENCLINXR_EQUIPMENT_FREEZE_DIR override, else the tracked tools dir. */
export function equipmentFreezeDir(root = repoRoot()): string {
  const env = process.env["OPENCLINXR_EQUIPMENT_FREEZE_DIR"];
  if (env && env.length > 0) return env;
  return path.join(root, EQUIPMENT_FREEZE_DIR_REL);
}

export function equipmentFreezeRecordPath(subjectId: string, root?: string): string {
  return path.join(equipmentFreezeDir(root), `${subjectId}.freeze.json`);
}

/** Deterministic runtime URL for a declared subject's tracked promote target. */
export function runtimeAssetUrlForSubject(subjectId: string): string {
  return `/xr-assets/medical-equipment/${subjectId}.glb`;
}

/**
 * Read the subject's freeze record. Missing or malformed records return null
 * (fail closed, no throw) — a GLB on disk without a freeze JSON never resolves.
 */
export function readEquipmentRuntimeFreeze(
  subjectId: string,
  opts: { root?: string } = {},
): EquipmentRuntimeFreezeRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(equipmentFreezeRecordPath(subjectId, opts.root), "utf8")) as unknown;
  } catch {
    return null;
  }
  const rec = (typeof raw === "object" && raw !== null ? raw : null) as Partial<EquipmentRuntimeFreezeRecord> | null;
  if (!rec) return null;
  if (rec.schemaVersion !== EQUIPMENT_RUNTIME_FREEZE_SCHEMA_VERSION) return null;
  if (rec.subjectId !== subjectId) return null;
  if (typeof rec.displayName !== "string" || rec.displayName.length === 0) return null;
  if (typeof rec.bakeOutputDir !== "string" || rec.bakeOutputDir.length === 0) return null;
  if (typeof rec.glbExportName !== "string" || rec.glbExportName.length === 0) return null;
  if (typeof rec.glbSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(rec.glbSha256)) return null;
  if (typeof rec.runtimeAssetUrl !== "string" || !rec.runtimeAssetUrl.startsWith("/xr-assets/medical-equipment/")) return null;
  if (typeof rec.generatedAt !== "string" || rec.generatedAt.length === 0) return null;
  return rec as EquipmentRuntimeFreezeRecord;
}

/** Write the subject's freeze record (the station publish step after a bake). */
export function writeEquipmentRuntimeFreeze(
  input: Omit<EquipmentRuntimeFreezeRecord, "schemaVersion" | "generatedAt">,
  opts: { root?: string } = {},
): EquipmentRuntimeFreezeRecord {
  const record: EquipmentRuntimeFreezeRecord = {
    schemaVersion: EQUIPMENT_RUNTIME_FREEZE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    ...input,
  };
  mkdirSync(equipmentFreezeDir(opts.root), { recursive: true });
  writeFileSync(equipmentFreezeRecordPath(record.subjectId, opts.root), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return record;
}

function sha256File(absPath: string): string | null {
  try {
    if (!existsSync(absPath)) return null;
    return createHash("sha256").update(readFileSync(absPath)).digest("hex");
  } catch {
    return null;
  }
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

  const freeze = readEquipmentRuntimeFreeze(entry.subjectId);

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
    glbExportName: `${entry.subjectId}.glb`,
    freezeRecordPath: equipmentFreezeRecordPath(entry.subjectId),
    runtimeAssetUrl: freeze?.runtimeAssetUrl ?? null,
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
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as Record<string, unknown>;
    const freezeRecordPath = equipmentFreezeRecordPath(plan.subjectId);
    if (report["verdict"] === "mesh_exported") {
      // The station records a tracked runtime asset URL for the declared subject:
      // freeze the bake artifact (sha256) against its deterministic runtime URL.
      const glbAbs = path.join(plan.outputDir, plan.glbExportName);
      const glbSha256 = sha256File(glbAbs);
      if (glbSha256) {
        const freeze = writeEquipmentRuntimeFreeze({
          subjectId: plan.subjectId,
          displayName: findEquipmentSubject(plan.subjectId)?.displayName ?? plan.subjectId,
          seed: plan.seed,
          remesh: plan.remesh,
          decimationTarget: plan.decimationTarget,
          bakeOutputDir: plan.outputDir,
          glbExportName: plan.glbExportName,
          glbSha256,
          runtimeAssetUrl: runtimeAssetUrlForSubject(plan.subjectId),
          claimScope: ["equipment_generate_station_records_declared_subject_runtime_asset_url"],
          notEvidenceFor: [
            "quest_readiness",
            "clinical_accuracy_or_device_equivalence",
            "production_asset_readiness",
            "replacement_of_parametric_equipment_builders",
          ],
        });
        return {
          ...report,
          subjectId: plan.subjectId,
          runtimeAssetUrl: freeze.runtimeAssetUrl,
          freezeRecordPath,
          glbSha256: freeze.glbSha256,
        };
      }
    }
    return { ...report, subjectId: plan.subjectId, runtimeAssetUrl: null, freezeRecordPath };
  }
  return {
    subjectId: plan.subjectId,
    status: "spawned_without_report",
    runtimeAssetUrl: null,
    freezeRecordPath: equipmentFreezeRecordPath(plan.subjectId),
  };
}

export const equipmentGenerateRunner: StationRunner = {
  stationId: "equipment_generate",
  validate: (value) => factoryStationSchemas.equipment_generate["~standard"].validate(value),
  plan: (value) => planEquipmentGenerate(value),
  run: runEquipmentGenerate,
};
