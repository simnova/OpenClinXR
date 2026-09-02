import type { CompileGraphNode } from "./encounter-materialization-evidence.js";

const HEX64 = /^[a-f0-9]{64}$/;

/**
 * Map compiled World Compile Graph nodes onto generation-plan recipeCacheKeys.
 * EquipVariant → medical_equipment_glb (shared-library equipment work order).
 * Wardrobe split nodes → role_specific_humanoid_glb::<actorId>.
 * Skip SSOT stays on compile wouldInvoke; these keys only name Azurite prefixes.
 */
export function recipeCacheKeysFromCompileNodes(
  nodes: readonly CompileGraphNode[],
): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const node of nodes) {
    const cacheKey = node.cacheKey;
    if (typeof cacheKey !== "string" || !HEX64.test(cacheKey)) continue;
    if (node.family === "EquipVariant") {
      keys.medical_equipment_glb = cacheKey;
    }
    if (node.bakerId === "wardrobe_character") {
      const actorId = node.spec.actorId;
      if (typeof actorId === "string" && actorId.length > 0) {
        keys[`role_specific_humanoid_glb::${actorId}`] = cacheKey;
      }
    }
  }
  return keys;
}
