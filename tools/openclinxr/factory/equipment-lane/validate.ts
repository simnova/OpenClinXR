/**
 * Fail-closed validation for equipment catalogue (MADR 0055).
 */

import type { EquipmentCatalogDocument } from "./types.js";
import { EQUIPMENT_CATALOG_SCHEMA } from "./types.js";

export type ValidateResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

export function validateEquipmentCatalog(doc: EquipmentCatalogDocument): ValidateResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (doc.schemaVersion !== EQUIPMENT_CATALOG_SCHEMA) {
    errors.push(`schemaVersion ${doc.schemaVersion} !== ${EQUIPMENT_CATALOG_SCHEMA}`);
  }
  if (!Array.isArray(doc.rows) || doc.rows.length === 0) {
    errors.push("rows empty");
  }

  const ids = new Set<string>();
  for (const row of doc.rows) {
    if (ids.has(row.equipmentId)) errors.push(`duplicate equipmentId ${row.equipmentId}`);
    ids.add(row.equipmentId);

    if (!["bank", "thin_parametric", "modular_kit"].includes(row.lane)) {
      errors.push(`${row.equipmentId}: invalid lane ${row.lane}`);
    }
    if (row.lane === "bank" && !row.gltfFileName) {
      errors.push(`${row.equipmentId}: bank lane requires gltfFileName`);
    }
    if (row.lane === "modular_kit" && !row.kitRecipeId) {
      warnings.push(`${row.equipmentId}: modular_kit without kitRecipeId`);
    }
    if (row.runtimeSource === "gltf" && !row.gltfFileName) {
      errors.push(`${row.equipmentId}: runtimeSource gltf without file`);
    }
    if (row.runtimeSource === "unknown") {
      warnings.push(`${row.equipmentId}: runtimeSource unknown`);
    }
  }

  for (const missing of doc.summary.gltfMissingOnDisk) {
    errors.push(`gltf missing on disk: ${missing}`);
  }

  // Soft: unmapped prose is warning until allowlist emptied (iter 1 closes)
  for (const u of doc.unmappedProse) {
    warnings.push(
      `unmapped prose "${u.prose}" in ${u.scenarioIds.join(",")}: ${u.reason}`,
    );
  }

  if (doc.scenarioCount < 10) {
    errors.push(`scenarioCount ${doc.scenarioCount} < 10 (expected full bank)`);
  }

  return { ok: errors.length === 0, errors, warnings };
}
