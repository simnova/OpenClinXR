/**
 * issue-286 — the dark-factory station table contract.
 *
 * D9 asks whether a case definition can go phenotype -> body -> garment -> rig ->
 * place -> render with no LLM-authored code in the loop. The deliverable is a
 * STATION TABLE (`.openclinxr/evidence/issue-286/pipeline-station-table.json`)
 * classifying every station in the D9 chain as `deterministic` | `llm_authored`
 * | `absent` | `not_run`.
 *
 * COUNTERWEIGHT: the cheap fix is a table asserting `deterministic` for a station
 * that was never executed. So every `deterministic` row must carry the artifact
 * path that proves it ran, and no row may claim `deterministic` without one:
 *   count(deterministic) == count(rows with an artifact)
 * `not_run` rows must carry a reason. `not_run` / `absent` are successful
 * outcomes — the report is the artifact.
 *
 * claimScope: the table is machine-checkable; it does not certify that any
 * station's output is learner-ready.
 * notEvidenceFor: clinical validity, scoring validity, Quest readiness,
 * production/learner readiness, B+ realism.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Repo root = three dirs up from tools/openclinxr/evidence/. */
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

const TABLE_PATH = path.join(
  REPO_ROOT,
  ".openclinxr/evidence/issue-286/pipeline-station-table.json",
);

/** The D9 chain, in order — the stations the issue's own table names. */
export const D9_CHAIN_STATIONS = [
  "case_to_actor_params",
  "body",
  "clothing",
  "rigging",
  "room",
  "equipment",
  "staging_placement",
  "render",
] as const;

export type StationClassification =
  | "deterministic"
  | "llm_authored"
  | "absent"
  | "not_run";

export type StationRow = {
  stationId: string;
  stationName?: string;
  classification: StationClassification;
  implementation?: string;
  artifactPaths?: string[];
  notes?: string[];
  reason?: string;
};

export type StationTable = {
  schemaVersion: string;
  caseId: string;
  chain: string[];
  stations: StationRow[];
};

export function loadStationTable(pathToTable: string = TABLE_PATH): StationTable {
  const raw = readFileSync(pathToTable, "utf8");
  const parsed = JSON.parse(raw) as StationTable;
  if (typeof parsed !== "object" || parsed === null || !Array.isArray(parsed.stations)) {
    throw new Error("dark-factory station table: malformed (missing stations array)");
  }
  return parsed;
}

describe("the dark-factory station table (#286)", () => {
  const table = loadStationTable();

  it("names every station in the D9 chain, and no extras", () => {
    expect(Array.isArray(table.chain)).toBe(true);
    expect(table.chain.length).toBe(D9_CHAIN_STATIONS.length);
    for (const station of D9_CHAIN_STATIONS) {
      expect(table.chain, `chain is missing ${station}`).toContain(station);
    }
    // No unknown stations: chain ⊆ D9 set.
    const allowed = new Set<string>(D9_CHAIN_STATIONS);
    for (const id of table.chain) {
      expect(allowed.has(id), `unknown station id in chain: ${id}`).toBe(true);
    }
  });

  it("has a row for every station in the D9 chain", () => {
    const byId = new Map(table.stations.map((s) => [s.stationId, s]));
    for (const station of D9_CHAIN_STATIONS) {
      expect(byId.has(station), `no row for station ${station}`).toBe(true);
    }
    for (const row of table.stations) {
      const allowed = new Set<string>(D9_CHAIN_STATIONS);
      expect(allowed.has(row.stationId), `unexpected row ${row.stationId}`).toBe(true);
    }
  });

  it("classifies every station with a valid classification", () => {
    const allowed = new Set<string>(["deterministic", "llm_authored", "absent", "not_run"]);
    for (const row of table.stations) {
      expect(
        allowed.has(row.classification),
        `row ${row.stationId} has invalid classification ${String(row.classification)}`,
      ).toBe(true);
    }
  });

  it("no row claims deterministic without an artifact path", () => {
    for (const row of table.stations) {
      if (row.classification === "deterministic") {
        expect(
          Array.isArray(row.artifactPaths) && row.artifactPaths!.length > 0,
          `row ${row.stationId} claims deterministic with no artifact path`,
        ).toBe(true);
        for (const p of row.artifactPaths!) {
          expect(typeof p).toBe("string");
          expect(p.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("every row carrying an artifact is classified deterministic (count equality)", () => {
    const deterministicCount = table.stations.filter(
      (s) => s.classification === "deterministic",
    ).length;
    const withArtifactCount = table.stations.filter(
      (s) => Array.isArray(s.artifactPaths) && s.artifactPaths!.length > 0,
    ).length;
    expect(deterministicCount, "deterministic rows must equal rows with an artifact").toBe(
      withArtifactCount,
    );
  });

  it("not_run rows carry a reason", () => {
    for (const row of table.stations) {
      if (row.classification === "not_run") {
        expect(
          typeof row.reason === "string" && row.reason.length > 0,
          `row ${row.stationId} is not_run with no reason`,
        ).toBe(true);
      }
    }
  });

  it("deterministic rows name the implementation", () => {
    for (const row of table.stations) {
      if (row.classification === "deterministic") {
        expect(
          typeof row.implementation === "string" && row.implementation.length > 0,
          `row ${row.stationId} is deterministic with no implementation reference`,
        ).toBe(true);
      }
    }
  });
});
