export * from "./schemas.js";
export * from "./runtime-schemas.js";
export * from "./schema-types.js";
export * from "./validators.js";
// Compat re-export is type-only: factory-stations pulls node:fs (repo-root)
// into the browser bundle via the "." client entry. Value consumers import
// "@openclinxr/factory-stations" directly.
export type {
  FactoryStationSchema,
  ProductionStationId,
  StandardIssue,
  StandardResult,
  StationJsonSchema,
  StationPropertySchema,
} from "./factory-stations.js";

