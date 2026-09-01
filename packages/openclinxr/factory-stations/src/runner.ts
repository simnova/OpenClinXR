import { factoryStationSchemas, type ProductionStationId, type StandardIssue, type StandardResult } from "./catalog.js";

/** Dry-run record. No GPU, no Blender. */
export type StationPlan = Record<string, unknown> & { mode: "dry-run"; stationId: ProductionStationId };

export type StationPlanResult =
  | { issues: readonly StandardIssue[] }
  | { value: Record<string, unknown>; plan: StationPlan };

/**
 * Port every factory_step runner implements. Admin cards call validate.
 * CLI / world-compile call plan (no GPU) or run (may spawn).
 */
export type StationRunner = {
  stationId: ProductionStationId;
  validate: (value: unknown) => StandardResult;
  plan: (value: unknown) => StationPlanResult;
  run: (value: unknown) => Promise<Record<string, unknown>> | Record<string, unknown>;
};

/** Catalog validate then attach dry-run plan fields. Never execs. */
export function planFromCatalog(
  stationId: ProductionStationId,
  input: unknown,
  fields: (value: Record<string, unknown>) => Record<string, unknown>,
): StationPlanResult {
  const checked = factoryStationSchemas[stationId]["~standard"].validate(input);
  if ("issues" in checked) return checked;
  return {
    value: checked.value,
    plan: { mode: "dry-run", stationId, ...fields(checked.value) },
  };
}
