/**
 * Public entry: keep-only re-exports. Implementation lives in
 * `@openclinxr/factory-station-core/catalog` (browser-safe: catalog-mod only,
 * no runner/spawn-blender/repo-root, no compute-slots); this module
 * re-exports it so the `./catalog` subpath keeps its names.
 */

export type {
  ProductionStationId,
} from "@openclinxr/factory-station-core/catalog";
export {
  factoryStationSchemas,
  productionStationIds,
} from "@openclinxr/factory-station-core/catalog";
