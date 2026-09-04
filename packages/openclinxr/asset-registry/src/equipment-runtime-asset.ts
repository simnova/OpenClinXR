/**
 * resolveDeclaredEquipmentRuntimeAsset — asset-registry resolution for a declared
 * equipment subject that returns the TRELLIS bake URL recorded by the
 * equipment_generate station instead of only a parametric builder name.
 *
 * The station (packages/openclinxr/factory-stations/src/equipment_generate/run.ts)
 * publishes a per-subject freeze JSON after a mesh_exported bake:
 *
 *   <freezeRoot>/<subjectId>.freeze.json       (schema openclinxr.equipment-runtime-freeze.v1)
 *
 * freezeRoot = OPENCLINXR_EQUIPMENT_FREEZE_DIR, else
 * <repo>/tools/openclinxr/asset-pipeline/trellis/equipment-freezes (a TRACKED dir).
 * The freeze records glbSha256 + runtimeAssetUrl for the bake. GLBs themselves may
 * stay gitignored — the freeze JSON, never GLB presence, is the unit of truth, so a
 * clone resolves without the gitignored bake and a GLB without a freeze fails closed.
 *
 * NODE-ONLY (node:fs). Not value-reachable from the "." client entry — consumers
 * import this module directly or via a package subpath, mirroring
 * measured-station-geometry-freshness.ts (#715).
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EQUIPMENT_RUNTIME_FREEZE_SCHEMA_VERSION = "openclinxr.equipment-runtime-freeze.v1" as const;

/** Tracked freeze-record root (relative to the repo root). Mirrors the station. */
export const EQUIPMENT_FREEZE_DIR_REL = "tools/openclinxr/asset-pipeline/trellis/equipment-freezes" as const;

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
    }
  | {
      status: "miss";
      subjectId: string;
      reason: "no_freeze_record" | "malformed_freeze_record";
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
  return path.join(equipmentFreezeRoot(freezeRoot), `${subjectId}.freeze.json`);
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
  if (typeof rec.runtimeAssetUrl !== "string" || !rec.runtimeAssetUrl.startsWith("/xr-assets/medical-equipment/")) return null;
  if (typeof rec.generatedAt !== "string" || rec.generatedAt.length === 0) return null;
  return rec as EquipmentRuntimeFreezeRecord;
}

/**
 * Resolve the declared equipment subject's runtime asset URL from its freeze
 * record. A present, schema-valid freeze resolves; a missing freeze or a GLB-only
 * land path is a TYPED miss (no throw-as-success). Never stats the GLB.
 */
export function resolveDeclaredEquipmentRuntimeAsset(
  subjectId: string,
  options: { freezeRoot?: string } = {},
): EquipmentRuntimeAssetResolution {
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
  return {
    status: "resolved",
    subjectId: record.subjectId,
    runtimeAssetUrl: record.runtimeAssetUrl,
    glbSha256: record.glbSha256,
    glbExportName: record.glbExportName,
    freezeRecordPath,
  };
}
