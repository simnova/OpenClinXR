import { factoryStationSchemas, type ProductionStationId, type StandardFailureResult, type StandardResult } from "./catalog.js";

/** Dry-run record. No GPU, no Blender. */
export type StationPlan = Record<string, unknown> & { mode: "dry-run"; stationId: ProductionStationId };

/** Same discrimination as StandardResult: a falsy `issues` is success. */
export type StationPlanResult =
  | StandardFailureResult
  | { readonly value: Record<string, unknown>; readonly plan: StationPlan; readonly issues?: undefined };

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
  if (checked.issues !== undefined) return checked;
  return {
    value: checked.value,
    plan: { mode: "dry-run", stationId, ...fields(checked.value) },
  };
}
