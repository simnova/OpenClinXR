/**
 * Environment spatial-zone planner (#44).
 *
 * Zones come from the shared environment shell descriptor (keyed by environmentId),
 * not from a hard-coded ED bay table. Replaces buildEdBaySpatialZones.
 */

import {
  type EnvironmentShellDescriptor,
  resolveEnvironmentShellDescriptor,
} from "./environment-descriptors.js";

export type EnvironmentSpatialZone = {
  zoneId: "learner_entry" | "patient_bedside" | "nurse_workflow" | "family_interrupt" | "diagnostic_equipment";
  label: string;
  purpose: string;
  assetIds: string[];
  spatialAnchors: string[];
  clinicalFidelityNotes: string[];
};

export function buildSpatialZonesForEnvironment(
  environmentId: string,
  environmentAssetId: string,
  requiredAssetIds: readonly string[],
  optionalContextAssetIds: readonly string[],
): EnvironmentSpatialZone[] {
  const resolved = resolveEnvironmentShellDescriptor(environmentId);
  return materializeZones(
    resolved.descriptor,
    environmentAssetId,
    requiredAssetIds,
    optionalContextAssetIds,
  );
}

function materializeZones(
  descriptor: EnvironmentShellDescriptor,
  environmentAssetId: string,
  requiredAssetIds: readonly string[],
  optionalContextAssetIds: readonly string[],
): EnvironmentSpatialZone[] {
  const hasRequired = (assetId: string) => requiredAssetIds.includes(assetId);
  const hasOptional = (assetId: string) => optionalContextAssetIds.includes(assetId);
  const includeExisting = (assetIds: readonly string[]) =>
    assetIds.filter(
      (assetId) => assetId === environmentAssetId || hasRequired(assetId) || hasOptional(assetId),
    );

  return descriptor.zoneTemplates.map((template) => ({
    zoneId: template.zoneId,
    label: template.label,
    purpose: template.purpose,
    assetIds: includeExisting([environmentAssetId, ...template.preferredAssetIds]),
    spatialAnchors: [...template.spatialAnchors],
    clinicalFidelityNotes: [...template.clinicalFidelityNotes],
  }));
}
