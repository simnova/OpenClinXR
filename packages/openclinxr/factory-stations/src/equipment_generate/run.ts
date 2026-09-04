import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
  /** Bake export file name inside outputDir (`<subjectId>.glb`, deterministic at plan time). */
  glbExportName: string;
  /** Per-subject freeze JSON path under the freeze root. */
  freezeRecordPath: string;
  /** Runtime asset URL for the declared subject, or null when unfrozen or not publish-backed. */
  runtimeAssetUrl: string | null;
};

/** Per-subject freeze record: declared equipment subject -> runtime asset URL contract. */
export const EQUIPMENT_RUNTIME_FREEZE_SCHEMA_VERSION = "openclinxr.equipment-runtime-freeze.v1" as const;

/** Tracked freeze-record root (relative to the repo root). */
export const EQUIPMENT_FREEZE_DIR_REL = "tools/openclinxr/asset-pipeline/trellis/equipment-freezes" as const;

/** Runtime public root (relative to repo root) whose `/xr-assets/...` subtree serves recorded runtime URLs. */
export const EQUIPMENT_PUBLIC_ROOT_REL = "apps/ui-xr/public" as const;

/** URL namespace prefix under which declared-equipment bake GLBs are served. */
export const EQUIPMENT_RUNTIME_ASSET_URL_PREFIX = "/xr-assets/medical-equipment/" as const;

/**
 * Catalog-safe grammar for declared equipment subject ids (all
 * KNOWN_EQUIPMENT_SUBJECTS in subjects.ts): lowercase alphanumerics
 * with internal hyphens — no dots, separators, or percent-encoding.
 */
export const EQUIPMENT_SUBJECT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** True when subjectId matches the catalog-safe grammar (safe for paths/URLs). */
export function isCatalogSafeEquipmentSubjectId(subjectId: string): boolean {
  return EQUIPMENT_SUBJECT_ID_PATTERN.test(subjectId);
}

function assertCatalogSafeEquipmentSubjectId(subjectId: string): void {
  if (!isCatalogSafeEquipmentSubjectId(subjectId)) {
    throw new Error(`equipment subject id ${JSON.stringify(subjectId)} is not catalog-safe`);
  }
}

function assertResolvedPathWithinRoot(candidate: string, root: string, what: string): void {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${what} escapes public root ${resolvedRoot}: ${resolved}`);
  }
}

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
  assertCatalogSafeEquipmentSubjectId(subjectId);
  return path.join(equipmentFreezeDir(root), `${subjectId}.freeze.json`);
}

/** Runtime public root: OPENCLINXR_EQUIPMENT_PUBLIC_ROOT override, else the tracked apps/ui-xr/public dir. */
export function equipmentPublicRoot(root = repoRoot()): string {
  const env = process.env["OPENCLINXR_EQUIPMENT_PUBLIC_ROOT"];
  if (env && env.length > 0) return env;
  return path.join(root, EQUIPMENT_PUBLIC_ROOT_REL);
}

/** Map a recorded /xr-assets/... runtime URL to the file serving it under a public root. */
export function equipmentRuntimeUrlToPublishedFile(runtimeAssetUrl: string, publicRoot: string): string {
  const publishedAbsPath = path.join(publicRoot, runtimeAssetUrl.replace(/^\/+/, ""));
  assertResolvedPathWithinRoot(publishedAbsPath, publicRoot, `runtime asset URL ${JSON.stringify(runtimeAssetUrl)}`);
  return publishedAbsPath;
}

/** Deterministic runtime URL for a declared subject's tracked promote target. */
export function runtimeAssetUrlForSubject(subjectId: string): string {
  assertCatalogSafeEquipmentSubjectId(subjectId);
  return `${EQUIPMENT_RUNTIME_ASSET_URL_PREFIX}${subjectId}.glb`;
}

/**
 * Read the subject's freeze record. Missing/malformed records and non-catalog
 * subject ids return null (fail closed, no throw); whether the recorded URL is
 * backed by published bytes is checked by the plan/resolution surfaces.
 */
export function readEquipmentRuntimeFreeze(
  subjectId: string,
  opts: { root?: string } = {},
): EquipmentRuntimeFreezeRecord | null {
  if (!isCatalogSafeEquipmentSubjectId(subjectId)) return null;
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
  // Exact runtimeAssetUrlForSubject(subjectId) equality: a prefix-only match would admit traversal or another subject's URL.
  if (typeof rec.runtimeAssetUrl !== "string" || rec.runtimeAssetUrl !== runtimeAssetUrlForSubject(subjectId)) return null;
  if (typeof rec.generatedAt !== "string" || rec.generatedAt.length === 0) return null;
  return rec as EquipmentRuntimeFreezeRecord;
}

/** Write the subject's freeze record (called only after the GLB is published). */
export function writeEquipmentRuntimeFreeze(
  input: Omit<EquipmentRuntimeFreezeRecord, "schemaVersion" | "generatedAt">,
  opts: { root?: string } = {},
): EquipmentRuntimeFreezeRecord {
  assertCatalogSafeEquipmentSubjectId(input.subjectId);
  const record: EquipmentRuntimeFreezeRecord = {
    schemaVersion: EQUIPMENT_RUNTIME_FREEZE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    ...input,
  };
  mkdirSync(equipmentFreezeDir(opts.root), { recursive: true });
  writeFileSync(equipmentFreezeRecordPath(record.subjectId, opts.root), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return record;
}

export type EquipmentGlbPublication =
  | { ok: true; runtimeAssetUrl: string; publishedAbsPath: string; glbSha256: string }
  | {
      ok: false;
      reason: "source_glb_missing" | "source_sha_mismatch" | "publish_write_failed";
      detail?: string;
    };

/**
 * Atomically publish a hash-verified bake GLB under the runtime public root:
 * same-dir temp copy + atomic rename, source sha verified before and published
 * sha after. Any failure removes the temp file and returns { ok:false }. A
 * non-catalog subject id throws before any fs access.
 */
export function publishEquipmentRuntimeGlb(
  input: { subjectId: string; sourceGlbAbsPath: string; glbSha256: string; publicRoot?: string },
  opts: { root?: string } = {},
): EquipmentGlbPublication {
  assertCatalogSafeEquipmentSubjectId(input.subjectId);
  if (!existsSync(input.sourceGlbAbsPath)) {
    return { ok: false, reason: "source_glb_missing", detail: input.sourceGlbAbsPath };
  }
  const sourceSha = sha256File(input.sourceGlbAbsPath);
  if (!sourceSha || sourceSha !== input.glbSha256) {
    return {
      ok: false,
      reason: "source_sha_mismatch",
      detail: `recorded ${input.glbSha256} vs source ${sourceSha ?? "unreadable"}`,
    };
  }
  const runtimeAssetUrl = runtimeAssetUrlForSubject(input.subjectId);
  const publicRoot = input.publicRoot ?? equipmentPublicRoot(opts.root);
  const targetAbs = equipmentRuntimeUrlToPublishedFile(runtimeAssetUrl, publicRoot);
  const tmpAbs = path.join(path.dirname(targetAbs), `.${path.basename(targetAbs)}.publish-${process.pid}.tmp`);
  try {
    mkdirSync(path.dirname(targetAbs), { recursive: true });
    copyFileSync(input.sourceGlbAbsPath, tmpAbs);
    renameSync(tmpAbs, targetAbs);
  } catch (error) {
    try {
      rmSync(tmpAbs, { force: true });
    } catch {
      // best-effort cleanup; the target itself was never written
    }
    return { ok: false, reason: "publish_write_failed", detail: error instanceof Error ? error.message : String(error) };
  }
  const publishedSha = sha256File(targetAbs);
  if (!publishedSha || publishedSha !== input.glbSha256) {
    try {
      rmSync(targetAbs, { force: true });
    } catch {
      // best-effort cleanup of a target that failed post-copy verification
    }
    return { ok: false, reason: "publish_write_failed", detail: "published target sha mismatch after copy" };
  }
  return { ok: true, runtimeAssetUrl, publishedAbsPath: targetAbs, glbSha256: input.glbSha256 };
}

export type EquipmentFreezePublication =
  | {
      ok: true;
      freezeRecord: EquipmentRuntimeFreezeRecord;
      runtimeAssetUrl: string;
      publishedAbsPath: string;
      freezeRecordPath: string;
    }
  | {
      ok: false;
      reason: "source_glb_missing" | "source_sha_mismatch" | "publish_write_failed";
      detail?: string;
      freezeRecordPath: string;
    };

/**
 * Publish-then-freeze after a mesh_exported bake: the hash-verified GLB is
 * atomically published FIRST, and the freeze JSON is written only after the
 * publish succeeds. A failed publish returns { ok:false } and writes no freeze;
 * a non-catalog subject id throws before any path is built.
 */
export function publishAndFreezeEquipmentBake(
  input: {
    subjectId: string;
    displayName: string;
    seed: number;
    remesh: boolean;
    decimationTarget: number;
    bakeOutputDir: string;
    glbExportName: string;
    publicRoot?: string;
    claimScope?: string[];
    notEvidenceFor?: string[];
  },
  opts: { root?: string } = {},
): EquipmentFreezePublication {
  assertCatalogSafeEquipmentSubjectId(input.subjectId);
  const glbAbs = path.join(input.bakeOutputDir, input.glbExportName);
  const glbSha256 = sha256File(glbAbs);
  const freezeRecordPath = equipmentFreezeRecordPath(input.subjectId, opts.root);
  if (!glbSha256) {
    return { ok: false, reason: "source_glb_missing", detail: glbAbs, freezeRecordPath };
  }
  const publication = publishEquipmentRuntimeGlb(
    {
      subjectId: input.subjectId,
      sourceGlbAbsPath: glbAbs,
      glbSha256,
      ...(input.publicRoot !== undefined ? { publicRoot: input.publicRoot } : {}),
    },
    opts,
  );
  if (!publication.ok) {
    return {
      ok: false,
      reason: publication.reason,
      freezeRecordPath,
      ...(publication.detail !== undefined ? { detail: publication.detail } : {}),
    };
  }
  const freezeRecord = writeEquipmentRuntimeFreeze(
    {
      subjectId: input.subjectId,
      displayName: input.displayName,
      seed: input.seed,
      remesh: input.remesh,
      decimationTarget: input.decimationTarget,
      bakeOutputDir: input.bakeOutputDir,
      glbExportName: input.glbExportName,
      glbSha256,
      runtimeAssetUrl: publication.runtimeAssetUrl,
      claimScope: input.claimScope ?? ["equipment_generate_station_publishes_hash_verified_glb_before_freeze"],
      notEvidenceFor: input.notEvidenceFor ?? [
        "quest_readiness",
        "clinical_accuracy_or_device_equivalence",
        "production_asset_readiness",
        "replacement_of_parametric_equipment_builders",
      ],
    },
    opts,
  );
  return {
    ok: true,
    freezeRecord,
    runtimeAssetUrl: publication.runtimeAssetUrl,
    publishedAbsPath: publication.publishedAbsPath,
    freezeRecordPath,
  };
}

/** True when the freeze's runtime URL is backed by published bytes whose sha256 matches (fail closed otherwise). */
export function equipmentFreezeIsPublishVerified(
  freeze: EquipmentRuntimeFreezeRecord,
  publicRoot?: string,
): boolean {
  const targetSha = sha256File(equipmentRuntimeUrlToPublishedFile(freeze.runtimeAssetUrl, publicRoot ?? equipmentPublicRoot()));
  return targetSha !== null && targetSha === freeze.glbSha256;
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
  const freezeUrlIsBacked = freeze !== null && equipmentFreezeIsPublishVerified(freeze);

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
    runtimeAssetUrl: freezeUrlIsBacked ? (freeze?.runtimeAssetUrl ?? null) : null,
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
      // Publish-then-freeze: the hash-verified GLB is published before the freeze JSON records its URL.
      const publication = publishAndFreezeEquipmentBake({
        subjectId: plan.subjectId,
        displayName: findEquipmentSubject(plan.subjectId)?.displayName ?? plan.subjectId,
        seed: plan.seed,
        remesh: plan.remesh,
        decimationTarget: plan.decimationTarget,
        bakeOutputDir: plan.outputDir,
        glbExportName: plan.glbExportName,
      });
      if (publication.ok) {
        return {
          ...report,
          subjectId: plan.subjectId,
          runtimeAssetUrl: publication.runtimeAssetUrl,
          freezeRecordPath,
          glbSha256: publication.freezeRecord.glbSha256,
          publishStatus: "published",
        };
      }
      return {
        ...report,
        subjectId: plan.subjectId,
        runtimeAssetUrl: null,
        freezeRecordPath,
        publishStatus: "failed",
        publishFailureReason: publication.reason,
        ...(publication.detail ? { publishFailureDetail: publication.detail } : {}),
      };
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
