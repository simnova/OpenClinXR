/**
 * Rebuild equipment catalogue from scenario bank + builders + GLB map (MADR 0055).
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scenarioBank } from "../../../../packages/openclinxr/scenario-fixtures/src/scenario-bank.ts";
import { resolveProseToEquipmentId } from "./prose-map.js";
import {
  defaultBuilderSymbol,
  defaultLaneFor,
  defaultMidbandStatus,
} from "./lane-policy.js";
import {
  EQUIPMENT_CATALOG_SCHEMA,
  type EquipmentCatalogDocument,
  type EquipmentCatalogRow,
  type EquipmentLane,
  type EquipmentRuntimeSource,
} from "./types.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function parseBuilderCases(buildersPath: string): string[] {
  const src = readFileSync(buildersPath, "utf8");
  const ids = [...src.matchAll(/case "([a-z0-9_]+_equipment)":/g)].map((m) => m[1]!);
  return [...new Set(ids)].sort();
}

function parseGlbMap(stationEquipmentPath: string): Record<string, string> {
  const src = readFileSync(stationEquipmentPath, "utf8");
  const map: Record<string, string> = {};
  const block = src.match(/REAL_EQUIPMENT_GLTF_BY_ID[^=]*=\s*\{([^}]+)\}/s);
  if (!block) return map;
  for (const m of block[1]!.matchAll(/([a-z0-9_]+)\s*:\s*"([^"]+\.glb)"/g)) {
    map[m[1]!] = m[2]!;
  }
  return map;
}

function medicalEquipmentDir(): string {
  return path.join(REPO_ROOT, "apps/ui-xr/public/xr-assets/medical-equipment");
}

export function rebuildEquipmentCatalog(repoRoot: string = REPO_ROOT): EquipmentCatalogDocument {
  const buildersPath = path.join(repoRoot, "apps/ui-xr/src/station-equipment-builders.ts");
  const stationPath = path.join(repoRoot, "apps/ui-xr/src/station-equipment.ts");
  const builderIds = parseBuilderCases(buildersPath);
  const glbMap = parseGlbMap(stationPath);
  const glbDir = path.join(repoRoot, "apps/ui-xr/public/xr-assets/medical-equipment");

  // prose → scenarios
  const proseScenarios = new Map<string, string[]>();
  for (const scenario of scenarioBank) {
    const list = (scenario as { equipment?: string[] }).equipment ?? [];
    for (const prose of list) {
      const key = prose.trim();
      const arr = proseScenarios.get(key) ?? [];
      arr.push(scenario.scenarioId);
      proseScenarios.set(key, arr);
    }
  }

  // equipmentId → prose aliases + scenarios
  const idAliases = new Map<string, Set<string>>();
  const idScenarios = new Map<string, Set<string>>();
  const unmappedProse: EquipmentCatalogDocument["unmappedProse"] = [];

  for (const [prose, scenarioIds] of proseScenarios) {
    const resolved = resolveProseToEquipmentId(prose);
    if (!resolved) {
      unmappedProse.push({
        prose,
        scenarioIds: [...scenarioIds].sort(),
        recommendedEquipmentId: null,
        reason: "no prose-map entry",
      });
      continue;
    }
    if (!idAliases.has(resolved)) idAliases.set(resolved, new Set());
    if (!idScenarios.has(resolved)) idScenarios.set(resolved, new Set());
    idAliases.get(resolved)!.add(prose);
    for (const sid of scenarioIds) idScenarios.get(resolved)!.add(sid);
  }

  // Include all builder ids and glb map keys
  const allIds = new Set<string>([...builderIds, ...Object.keys(glbMap), ...idAliases.keys()]);

  const rows: EquipmentCatalogRow[] = [];
  const gltfMissingOnDisk: string[] = [];

  for (const equipmentId of [...allIds].sort()) {
    const gltfFileName = glbMap[equipmentId] ?? null;
    const hasGlbFile =
      gltfFileName != null && existsSync(path.join(glbDir, gltfFileName));
    if (gltfFileName && !hasGlbFile) {
      gltfMissingOnDisk.push(`${equipmentId}→${gltfFileName}`);
    }

    // Alias: 12_lead shares cart glb conceptually but map uses ecg_cart_equipment
    let effectiveGlb: string | null = gltfFileName;
    let runtimeSource: EquipmentRuntimeSource = "parametric";
    if (hasGlbFile) {
      runtimeSource = "gltf";
    } else if (equipmentId === "12_lead_ecg_machine_equipment" && glbMap.ecg_cart_equipment) {
      // separate builder id; cart glb is related bank asset
      effectiveGlb = null;
      runtimeSource = "parametric";
    } else if (!builderIds.includes(equipmentId) && !gltfFileName) {
      runtimeSource = "unknown";
    }

    const lane = defaultLaneFor(equipmentId, hasGlbFile);
    const midbandStatus = defaultMidbandStatus(equipmentId, hasGlbFile, lane);

    // kit presence: worktree or main
    const kitOnMain = existsSync(
      path.join(repoRoot, "apps/ui-xr/src/equipment-kit/recipes/ecg-cart.ts"),
    );
    let kitRecipeId: string | null = null;
    let notes = "";
    if (lane === "modular_kit") {
      kitRecipeId = kitOnMain ? "ecg_cart" : "ecg_cart_midband_v1_pending_merge";
      notes = kitOnMain
        ? "kit present on tree"
        : "kit on feature/equipment-kit-approach-b — catalogue provisional modular_kit";
    }
    if (equipmentId === "medication_cart" || (idAliases.get(equipmentId)?.has("medication cart") ?? false)) {
      notes = (notes ? notes + "; " : "") + "prose 'medication cart' provisionally mapped to ECG cart class — replace with dedicated recipe";
    }

    rows.push({
      equipmentId,
      lane,
      runtimeSource,
      gltfFileName: effectiveGlb ?? gltfFileName,
      builderSymbol: builderIds.includes(equipmentId)
        ? defaultBuilderSymbol(equipmentId)
        : null,
      kitRecipeId,
      proseAliases: [...(idAliases.get(equipmentId) ?? [])].sort(),
      scenarioIds: [...(idScenarios.get(equipmentId) ?? [])].sort(),
      midbandStatus,
      licenceStatus: hasGlbFile ? "internal" : "n/a",
      provenancePath: hasGlbFile
        ? `apps/ui-xr/public/xr-assets/medical-equipment/${gltfFileName}`
        : null,
      ledgerSource: null,
      claimScope: "factory routing + runtime equipment identity",
      notEvidenceFor: ["clinical_accuracy", "quest_readiness", "exam_equivalence"],
      notes,
    });
  }

  const byLane: Record<EquipmentLane, number> = {
    bank: 0,
    thin_parametric: 0,
    modular_kit: 0,
  };
  const byRuntimeSource: Record<string, number> = {};
  for (const r of rows) {
    byLane[r.lane] += 1;
    byRuntimeSource[r.runtimeSource] = (byRuntimeSource[r.runtimeSource] ?? 0) + 1;
  }

  const scenariosWithUnmappedProse = [
    ...new Set(unmappedProse.flatMap((u) => u.scenarioIds)),
  ].sort();

  return {
    schemaVersion: EQUIPMENT_CATALOG_SCHEMA,
    measuredAt: new Date().toISOString(),
    claimScope:
      "equipment three-lane catalogue over scenario-bank blueprints + runtime builders (MADR 0054/0055)",
    notEvidenceFor: [
      "clinical_accuracy",
      "quest_readiness",
      "exam_equivalence",
      "photoreal_match",
    ],
    madr: ["0054", "0055"],
    scenarioCount: scenarioBank.length,
    equipmentCount: rows.length,
    rows,
    unmappedProse: unmappedProse.sort((a, b) => a.prose.localeCompare(b.prose)),
    summary: {
      byLane,
      byRuntimeSource,
      gltfMissingOnDisk,
      scenariosWithUnmappedProse,
    },
  };
}

/** Tracked SSOT path (`.openclinxr/` is gitignored in this repo). */
export function catalogPath(repoRoot: string = REPO_ROOT): string {
  return path.join(repoRoot, "docs/openclinxr/equipment-catalog.v1.json");
}

export { medicalEquipmentDir, REPO_ROOT };
