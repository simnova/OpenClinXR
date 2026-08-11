/**
 * issue-291 — drift guard for the committed actor-phenotype export.
 *
 * The asset factory's Python generator reads the committed
 * packages/openclinxr/scenario-fixtures/generated/actor-phenotype.v1.json.
 * Authoring a phenotype on a fixture actor is the way to add a case; the export
 * must be regenerated (pnpm exec tsx tools/openclinxr/dark-factory/export-actor-phenotype.ts).
 * This test refuses a stale export: a regeneration must be byte-identical.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildActorPhenotypeExport,
  serializeActorPhenotypeExport,
} from "./actor-phenotype-export.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMITTED_EXPORT = path.resolve(HERE, "..", "generated", "actor-phenotype.v1.json");

describe("actor phenotype export (issue-291)", () => {
  it("the committed export matches a deterministic regeneration from the fixtures", () => {
    const committed = readFileSync(COMMITTED_EXPORT, "utf8");
    const regenerated = serializeActorPhenotypeExport();
    expect(regenerated).toBe(committed);
  });

  it("the migrated peds case carries a full authored phenotype per actor", () => {
    const exported = buildActorPhenotypeExport();
    const peds = exported.entries["peds_asthma_parent_anxiety_v1"];
    expect(peds).toBeDefined();
    const actorIds = Object.keys(peds ?? {}).sort();
    expect(actorIds).toEqual(["nurse_kevin_lee_v1", "parent_tara_johnson_v1", "patient_maya_johnson_v1"]);
    // Clinical scalars must be authored — never defaulted to a generic adult (#276).
    for (const actorId of actorIds) {
      const authored = peds?.[actorId]?.phenotype ?? {};
      expect(typeof authored["age"]).toBe("number");
      expect(typeof authored["height_cm"]).toBe("number");
      expect(typeof authored["build"]).toBe("string");
    }
    // Pipeline-only knobs deliberately stay OUT of the case definition.
    const patient = peds?.["patient_maya_johnson_v1"]?.phenotype ?? {};
    expect(patient["seed"]).toBeUndefined();
    expect(patient["output_name"]).toBeUndefined();
    expect(patient["sleeveGeometryExpansion"]).toBeUndefined();
  });
});
