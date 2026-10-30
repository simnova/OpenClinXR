/**
 * Public entry: keep-only re-exports. Implementation lives in
 * `@openclinxr/factory-station-core/runner`; this module re-exports it so the
 * `./catalog` subpath keeps its names.
 */

export type {
  ProductionStationId,
} from "@openclinxr/factory-station-core/runner";
export {
  factoryStationSchemas,
  productionStationIds,
} from "@openclinxr/factory-station-core/runner";
