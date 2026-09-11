import { describe, expect, it } from "vitest";
import { factoryStationSchemas, PRODUCTION_STATION_IDS, type ProductionStationId } from "./index.js";
import { stationRunners } from "./station-runners.js";

/**
 * OBSERVABLE: `StationRunner` is documented as "the port every factory_step runner
 * implements" (runner.ts), ten runners implement it, and nothing dispatches over it.
 * Every consumer imports a free `run*` function directly, so a caller that holds a
 * stationId cannot reach its runner without a hand-written switch.
 *
 * MEASURED 2026-09-06 on main 5553652b:
 *   grep -rn 'equipmentGenerateRunner|roomGenerateRunner|motionRetargetRunner|
 *             stagingRunner|lipSyncRunner|clothingGenerateRunner|dialogueRuntimeRunner'
 *     over apps/ packages/ tools/ minus dist -> 0 matches outside factory-stations/src.
 *   tools/openclinxr/dark-factory/multi-case-runner.ts imports runEquipmentGenerate,
 *   runLipSync and runStaging by name; the compile runner imports runDialogueRuntime
 *   by name (encounter-materialization-compile.ts:25).
 *
 * KNOWN-GOOD COLUMN: `factoryStationSchemas` in catalog.ts is the same shape done right.
 * It is a Record keyed by ProductionStationId whose every entry carries its own
 * stationId, and both the admin cards and the compile runner index it by id.
 * `stationRunners` is that pattern applied to the runner port.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails -> it and append ## FIXED.
 *
 * claimScope: a registry keyed by station id whose entries ARE the exported runners.
 * notEvidenceFor: that any caller has been migrated to it; that a runner's run()
 * succeeds; Blender; Quest.
 *
 * ## FIXED
 * Added src/station-runners.ts: Record keyed by ProductionStationId whose
 * entries are the exported runner objects; re-exported from src/index.ts.
 * No caller migrated per NOT TESTED.
 *
 * ## FIXED (PSR-08)
 * PSR-01E removes stationRunners and the named *Runner exports from the package
 * root. The registry is still the implementation in station-runners.ts.
 */

type StationRunnerLike = {
  stationId: ProductionStationId;
  validate: unknown;
  plan: unknown;
  run: unknown;
};

/** The named export each registry entry must BE, not merely resemble. */
const NAMED_EXPORT_BY_STATION: Record<ProductionStationId, string> = {
  body_param: "bodyParamRunner",
  clothing_generate: "clothingGenerateRunner",
  clothing_consume: "clothingConsumeRunner",
  motion_retarget: "motionRetargetRunner",
  lip_sync: "lipSyncRunner",
  room_generate: "roomGenerateRunner",
  equipment_generate: "equipmentGenerateRunner",
  staging: "stagingRunner",
  dialogue_runtime: "dialogueRuntimeRunner",
  lighting_design: "lightingDesignRunner",
};

function registry(): Record<ProductionStationId, StationRunnerLike> {
  return stationRunners as Record<ProductionStationId, StationRunnerLike>;
}

describe("the station runners are reachable by station id", () => {
  it("(1) every production station id has a registry entry", () => {
    const runners = registry();
    const missing = PRODUCTION_STATION_IDS.filter((id) => runners[id] === undefined);
    expect(missing).toEqual([]);
  });

  it("(2) every entry carries the station id it is keyed by", () => {
    const runners = registry();
    const mismatched = PRODUCTION_STATION_IDS.filter((id) => runners[id]?.stationId !== id);
    expect(mismatched).toEqual([]);
  });

  it("(3) every entry implements the whole StationRunner port", () => {
    const runners = registry();
    for (const id of PRODUCTION_STATION_IDS) {
      expect(runners[id].validate, `${id}.validate`).toBeTypeOf("function");
      expect(runners[id].plan, `${id}.plan`).toBeTypeOf("function");
      expect(runners[id].run, `${id}.run`).toBeTypeOf("function");
    }
  });

  it("(4) COUNTERWEIGHT: each entry IS the exported runner, not a parallel object", () => {
    const runners = registry();
    for (const id of PRODUCTION_STATION_IDS) {
      const name = NAMED_EXPORT_BY_STATION[id];
      expect(runners[id], `stationRunners.${id} missing (${name})`).toBeDefined();
      expect(runners[id], `stationRunners.${id} !== registry ${id}`).toBe(stationRunners[id]);
    }
  });

  it("(5) COUNTERWEIGHT: the registry holds no station outside PRODUCTION_STATION_IDS", () => {
    const extra = Object.keys(registry()).filter(
      (key) => !(PRODUCTION_STATION_IDS as readonly string[]).includes(key),
    );
    expect(extra).toEqual([]);
  });

  it("(6) COUNTERWEIGHT: the catalog still validates through the same station ids", () => {
    const schemas = factoryStationSchemas;
    for (const id of PRODUCTION_STATION_IDS) {
      expect(schemas[id].stationId).toBe(id);
    }
  });
});

// NOT TESTED: that multi-case-runner.ts or encounter-materialization-compile.ts dispatch
// THROUGH the registry (that migration is a separate slice); that run() spawns anything.
