/**
 * The reviewed binding between a scenario's free-text `equipment` list and its structured
 * `assetNeeds`. Extracted from schemas.ts rather than added to it: that file was at 556 lines
 * against a 500-line zone budget, and file-size-budgets.ts says in its own header
 * "Do not add new entries to widen the gate; split the file instead."
 */

/**
 * Which list wins when the two disagree. EXECUTABLE, not a doc comment.
 * "assetNeeds" means assetNeeds is authoritative (structured with assetId, assetType, licenseStatus).
 * "equipment" means equipment strings are authoritative.
 */
export const EQUIPMENT_BINDING_PRECEDENCE: "assetNeeds" | "equipment" = "assetNeeds";

export type EquipmentBindingClassification =
  | { kind: "bound"; equipment: string; assetId: string }
  | { kind: "required-unbound"; equipment: string }
  | { kind: "intentionally-absent"; assetId: string };

/**
 * Normalize an equipment string to match assetId convention.
 * Lowercase, replace spaces and hyphens with underscores, add "_equipment" suffix.
 */
function normalizeEquipmentToAssetId(equipment: string): string {
  const normalized = equipment
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
  return normalized.endsWith("_equipment") ? normalized : `${normalized}_equipment`;
}

/**
 * Total classification of a scenario's equipment strings against its assetNeeds.
 * Every entry of `equipment` appears in exactly one bucket. Nothing is dropped.
 */
export function classifyScenarioEquipmentBinding(scenario: {
  equipment?: string[];
  assetNeeds?: Array<{ assetId: string; assetType?: string; licenseStatus?: string }>;
}
): EquipmentBindingClassification[] {
  const equipment = scenario.equipment ?? [];
  const assetNeeds = scenario.assetNeeds ?? [];

  const assetNeedById = new Map(assetNeeds.map((an) => [an.assetId, an]));
  const matchedAssetIds = new Set<string>();
  const result: EquipmentBindingClassification[] = [];

  // Classify each equipment string
  for (const equip of equipment) {
    const expectedAssetId = normalizeEquipmentToAssetId(equip);
    const assetNeed = assetNeedById.get(expectedAssetId);

    if (assetNeed) {
      result.push({ kind: "bound", equipment: equip, assetId: assetNeed.assetId });
      matchedAssetIds.add(assetNeed.assetId);
    } else {
      result.push({ kind: "required-unbound", equipment: equip });
    }
  }

  // Classify assetNeeds with no equipment match as intentionally-absent
  for (const assetNeed of assetNeeds) {
    if (!matchedAssetIds.has(assetNeed.assetId)) {
      result.push({ kind: "intentionally-absent", assetId: assetNeed.assetId });
    }
  }

  return result;
}
