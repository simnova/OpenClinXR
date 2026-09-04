/**
 * resolveDeclaredEquipmentRuntimeAsset — asset-registry resolution for a declared
 * equipment subject that returns the TRELLIS bake URL recorded by the
 * equipment_generate station instead of only a parametric builder name.
 *
 * The station (packages/openclinxr/factory-stations/src/equipment_generate/run.ts)
 * publishes a per-subject freeze JSON after a mesh_exported bake whose GLB was
 * hash-verified and atomically copied into the runtime public root FIRST:
 *
 *   <freezeRoot>/<subjectId>.freeze.json       (schema openclinxr.equipment-runtime-freeze.v1)
 *
 * freezeRoot = OPENCLINXR_EQUIPMENT_FREEZE_DIR, else
 * <repo>/tools/openclinxr/asset-pipeline/trellis/equipment-freezes (a TRACKED dir).
 * The freeze records glbSha256 + runtimeAssetUrl for the bake. Resolution
 * resolves ONLY when the URL's published bytes exist under the runtime public
 * root (OPENCLINXR_EQUIPMENT_PUBLIC_ROOT, else <repo>/apps/ui-xr/public) AND
 * their sha256 matches the freeze — a freeze whose published target is missing
 * or re-baked (SHA mismatch) is a typed miss, never a URL pointing at bytes
 * that are not there. The gitignored bake GLB is never consulted.
 *
 * TRAVERSAL CLOSURES (review 2026-09-04): a requested subject id is validated
 * against the declared catalog-safe grammar before ANY freeze path is built (a
 * non-catalog id is a typed miss, never a path lookup); a freeze record only
 * resolves when its runtimeAssetUrl EXACTLY equals runtimeAssetUrlForSubject(
 * subjectId) — prefix-only matches that smuggle `..` segments, percent-encoding,
 * or another subject's URL are malformed; and the URL -> published-file mapping
 * asserts the published path stays beneath the resolved public root.
 *
 * NODE-ONLY (node:fs). Not value-reachable from the "." client entry — consumers
 * import this module directly or via a package subpath, mirroring
 * measured-station-geometry-freshness.ts (#715).
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EQUIPMENT_RUNTIME_FREEZE_SCHEMA_VERSION = "openclinxr.equipment-runtime-freeze.v1" as const;

/** Tracked freeze-record root (relative to the repo root). Mirrors the station. */
export const EQUIPMENT_FREEZE_DIR_REL = "tools/openclinxr/asset-pipeline/trellis/equipment-freezes" as const;

/**
 * Runtime public root (relative to the repo root) whose `/xr-assets/...` subtree
 * serves the recorded runtime URLs. Mirrors the station.
 */
export const EQUIPMENT_PUBLIC_ROOT_REL = "apps/ui-xr/public" as const;

/** URL namespace prefix under which declared-equipment bake GLBs are served. */
export const EQUIPMENT_RUNTIME_ASSET_URL_PREFIX = "/xr-assets/medical-equipment/" as const;

/**
 * Catalog-safe grammar for declared equipment subject ids: lowercase
 * alphanumerics with internal hyphens. Every id in the declared equipment
 * catalog (factory-stations equipment_generate/subjects.ts
 * KNOWN_EQUIPMENT_SUBJECTS) matches; dot segments, path separators, and
 * percent-encoding all fail, so a subject id can never alter the freeze path,
 * public path, or runtime URL it is interpolated into. Mirrors the station.
 */
export const EQUIPMENT_SUBJECT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** Whether a subject id is safe to interpolate into freeze/public paths and runtime URLs. */
export function isCatalogSafeEquipmentSubjectId(subjectId: string): boolean {
  return EQUIPMENT_SUBJECT_ID_PATTERN.test(subjectId);
}

function assertCatalogSafeEquipmentSubjectId(subjectId: string): void {
  if (!isCatalogSafeEquipmentSubjectId(subjectId)) {
    throw new Error(
      `equipment subject id ${JSON.stringify(subjectId)} is not catalog-safe (lowercase alphanumerics with internal hyphens)`,
    );
  }
}

/** Deterministic runtime URL for a declared subject's tracked promote target. Mirrors the station. */
export function runtimeAssetUrlForSubject(subjectId: string): string {
  assertCatalogSafeEquipmentSubjectId(subjectId);
  return `${EQUIPMENT_RUNTIME_ASSET_URL_PREFIX}${subjectId}.glb`;
}

function pathIsWithinRoot(candidate: string, root: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`);
}

function assertPathWithinRoot(candidate: string, root: string, what: string): void {
  if (!pathIsWithinRoot(candidate, root)) {
    throw new Error(`${what} escapes public root ${path.resolve(root)}: ${path.resolve(candidate)}`);
  }
}

/** Matches the station's EquipmentRuntimeFreezeRecord shape. */
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

export type EquipmentRuntimeAssetResolution =
  | {
      status: "resolved";
      subjectId: string;
      runtimeAssetUrl: string;
      glbSha256: string;
      glbExportName: string;
      freezeRecordPath: string;
      /** Absolute path of the published file that backs the resolved URL. */
      publishedAbsPath: string;
    }
  | {
      status: "miss";
      subjectId: string;
      reason:
        | "no_freeze_record"
        | "malformed_freeze_record"
        | "published_target_missing"
        | "published_target_sha_mismatch"
        // The requested subject id fails the declared catalog-safe grammar; no
        // freeze path was built or consulted (freezeRecordPath is "").
        | "subject_id_not_catalog_safe";
      /** Freeze record path for the requested subject; "" when the subject id itself was refused. */
      freezeRecordPath: string;
    };

function repoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("workspace root (pnpm-workspace.yaml) not found");
}

/** Freeze-record root: explicit option, OPENCLINXR_EQUIPMENT_FREEZE_DIR, else the tracked tools dir. */
export function equipmentFreezeRoot(freezeRoot?: string): string {
  if (freezeRoot && freezeRoot.length > 0) return freezeRoot;
  const env = process.env["OPENCLINXR_EQUIPMENT_FREEZE_DIR"];
  if (env && env.length > 0) return env;
  return path.join(repoRoot(), EQUIPMENT_FREEZE_DIR_REL);
}

export function equipmentFreezeRecordPath(subjectId: string, freezeRoot?: string): string {
  assertCatalogSafeEquipmentSubjectId(subjectId);
  return path.join(equipmentFreezeRoot(freezeRoot), `${subjectId}.freeze.json`);
}

/** Runtime public root: explicit option, OPENCLINXR_EQUIPMENT_PUBLIC_ROOT, else the tracked apps/ui-xr/public dir. */
export function equipmentPublicRoot(publicRoot?: string): string {
  if (publicRoot && publicRoot.length > 0) return publicRoot;
  const env = process.env["OPENCLINXR_EQUIPMENT_PUBLIC_ROOT"];
  if (env && env.length > 0) return env;
  return path.join(repoRoot(), EQUIPMENT_PUBLIC_ROOT_REL);
}

/** Map a recorded /xr-assets/... runtime URL to the file serving it under a public root. */
export function equipmentRuntimeUrlToPublishedFile(runtimeAssetUrl: string, publicRoot: string): string {
  const publishedAbsPath = path.join(publicRoot, runtimeAssetUrl.replace(/^\/+/, ""));
  assertPathWithinRoot(publishedAbsPath, publicRoot, `runtime asset URL ${JSON.stringify(runtimeAssetUrl)}`);
  return publishedAbsPath;
}

function sha256File(absPath: string): string | null {
  try {
    if (!existsSync(absPath)) return null;
    return createHash("sha256").update(readFileSync(absPath)).digest("hex");
  } catch {
    return null;
  }
}

function isValidFreeze(subjectId: string, raw: unknown): EquipmentRuntimeFreezeRecord | null {
  const rec = (typeof raw === "object" && raw !== null ? raw : null) as Partial<EquipmentRuntimeFreezeRecord> | null;
  if (!rec) return null;
  if (rec.schemaVersion !== EQUIPMENT_RUNTIME_FREEZE_SCHEMA_VERSION) return null;
  if (rec.subjectId !== subjectId) return null;
  if (typeof rec.displayName !== "string" || rec.displayName.length === 0) return null;
  if (typeof rec.bakeOutputDir !== "string" || rec.bakeOutputDir.length === 0) return null;
  if (typeof rec.glbExportName !== "string" || rec.glbExportName.length === 0) return null;
  if (typeof rec.glbSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(rec.glbSha256)) return null;
  // The recorded URL must be the EXACT runtime URL of this subject — a prefix
  // match alone would admit `..` segments, percent-encoding, or a URL naming
  // another subject. Reached only with a grammar-safe subjectId (the resolver
  // pre-checks), so runtimeAssetUrlForSubject cannot throw here.
  if (typeof rec.runtimeAssetUrl !== "string" || rec.runtimeAssetUrl !== runtimeAssetUrlForSubject(subjectId)) return null;
  if (typeof rec.generatedAt !== "string" || rec.generatedAt.length === 0) return null;
  return rec as EquipmentRuntimeFreezeRecord;
}

/**
 * Resolve the declared equipment subject's runtime asset URL from its freeze
 * record. A present, schema-valid freeze whose URL is the subject's exact
 * runtime URL and is backed by published bytes (existing file under the runtime
 * public root, sha256 matching the freeze) resolves; anything else — a subject
 * id outside the declared catalog grammar, missing freeze, malformed freeze,
 * missing published target, or published bytes that do not match the recorded
 * sha — is a TYPED miss (no throw-as-success). The gitignored bake GLB is never
 * consulted.
 */
export function resolveDeclaredEquipmentRuntimeAsset(
  subjectId: string,
  options: { freezeRoot?: string; publicRoot?: string } = {},
): EquipmentRuntimeAssetResolution {
  if (!isCatalogSafeEquipmentSubjectId(subjectId)) {
    return { status: "miss", subjectId, reason: "subject_id_not_catalog_safe", freezeRecordPath: "" };
  }
  const freezeRecordPath = equipmentFreezeRecordPath(subjectId, options.freezeRoot);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(freezeRecordPath, "utf8")) as unknown;
  } catch {
    return { status: "miss", subjectId, reason: "no_freeze_record", freezeRecordPath };
  }
  const record = isValidFreeze(subjectId, raw);
  if (!record) {
    return { status: "miss", subjectId, reason: "malformed_freeze_record", freezeRecordPath };
  }
  const publicRoot = equipmentPublicRoot(options.publicRoot);
  const publishedAbsPath = equipmentRuntimeUrlToPublishedFile(record.runtimeAssetUrl, publicRoot);
  if (!existsSync(publishedAbsPath)) {
    return { status: "miss", subjectId, reason: "published_target_missing", freezeRecordPath };
  }
  const publishedSha = sha256File(publishedAbsPath);
  if (!publishedSha || publishedSha !== record.glbSha256) {
    return { status: "miss", subjectId, reason: "published_target_sha_mismatch", freezeRecordPath };
  }
  return {
    status: "resolved",
    subjectId: record.subjectId,
    runtimeAssetUrl: record.runtimeAssetUrl,
    glbSha256: record.glbSha256,
    glbExportName: record.glbExportName,
    freezeRecordPath,
    publishedAbsPath,
  };
}
