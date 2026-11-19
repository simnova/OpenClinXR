/**
 * Station-agnostic half of the factory stations: the Standard Schema catalog all station
 * payloads validate against, the StationRunner port every station implements, the repo-root
 * and blender-spawn helpers stations build on, and the compile-spec payload writer.
 * No station directory lives here; each station package depends on this `./runner`
 * subpath only. The root entrypoint publishes nothing (precedent: compute-slots,
 * compute-services-spec, service-local-compute), so the measured root surface
 * stays at the reviewed count.
 */

/** Persist a validated station payload onto a compile-node spec. No baker spawn. */
export {
  applyStationPayloadToCompileSpec,
} from "./apply-station-payload.js";
/**
 * The shape of one production station's contract: its id, its Standard Schema validator,
 * and the JSON Schemas admin cards are derived from.
 */
export type {
  FactoryStationSchema,
  ProductionStationId,
  StandardFailureResult,
  StandardIssue,
  StandardResult,
  StationJsonSchema,
  StationPropertySchema,
} from "./catalog-mod.js";
/**
 * The catalog itself: every production station id, the schema record keyed by id,
 * and the id list in catalog order.
 */
export {
  factoryStationSchemas,
  PRODUCTION_STATION_IDS,
  productionStationIds,
} from "./catalog-mod.js";
/** Workspace root (pnpm-workspace.yaml), found by walking up from this package. */
export {
  repoRoot,
} from "./repo-root.js";
/** Blender run spawned through the local compute services gate. */
export {
  spawnBlenderProcess,
} from "./spawn-blender.js";
/**
 * The port every factory_step runner implements: validate a payload, plan a dry run
 * without spawning anything, or run for real. CLI and world-compile call plan or run.
 */
export type {
  StationPlan,
  StationPlanResult,
  StationRunner,
} from "./station-runner.js";
/** Catalog validate then attach dry-run plan fields. Never execs. */
export {
  planFromCatalog,
} from "./station-runner.js";
/**
 * Shared teeth-swap byte-lineage continuity rule (kevin-collar s10h4 B2): the
 * junction rule validateT3 enforces, extracted so trellis-evidence enforces the
 * same rule without importing from a test file. Both readers resolve recorded
 * stage domains through the post-export registry.
 */
export type {
  ByteLineageLevel,
  NeckChainSidecar,
  TeethSwapBlock,
} from "./teeth-swap-lineage.js";
export {
  assertLineageContinuity,
  lineageLevels,
  validateT3LineageChain,
} from "./teeth-swap-lineage.js";

/** Historical label retained for runner API compatibility. */
export const P2E_CHAIN_SCRIPT = "nurse-vneck-chain.py";

/** Mutation and preservation contract for one recorded post-export tool. */
export type {
  PostExportStage,
} from "./post-export-stage-registry.js";
/** Registry of post-export stage mutation and preservation contracts. */
export {
  POST_EXPORT_STAGE_REGISTRY,
  postExportLevelPreserves,
  postExportLevelStages,
} from "./post-export-stage-registry.js";
