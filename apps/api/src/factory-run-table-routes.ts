import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Hono } from "hono";
import type { ApiAppContext } from "@openclinxr/rest";
import type { ApiAppVariables } from "@openclinxr/rest";
import { repoRoot } from "./scenario-promotion-io.js";

/**
 * Factory run-table route (faculty panel -> API).
 *
 * The dark-factory multi-case runner writes a per-case station-table rollup
 * (`openclinxr.dark-factory-multi-case-rollup.v1`) to a fixed published path;
 * this route serves that recorded table over HTTP so faculty can see whether
 * the factory ran and where it stopped. Read-only — it never runs a station,
 * never spawns Blender, and never throws: an absent or unparseable rollup is
 * 200 with an empty `cases` array plus a `reason` the panel renders.
 */
export const FACTORY_RUN_ROLLUP_REL = ".openclinxr/evidence/factory-run/multi-case-rollup.json";

const FACTORY_RUN_ROLLUP_SCHEMA_VERSION = "openclinxr.dark-factory-multi-case-rollup.v1";

const FACTORY_RUN_CLAIM_BOUNDARY = "recorded_factory_run_table_only";

const FACTORY_RUN_NOT_EVIDENCE_FOR = ["live_blender_bake", "current_tree_state", "clinical_validity"];

type FactoryRunStationRow = {
  stationId: string;
  classification: string;
  artifactPaths?: string[];
  notes?: string[];
};

type FactoryRunCaseRow = {
  caseId: string;
  stations: FactoryRunStationRow[];
};

type FactoryRunRollupValue = {
  generatedAt: string;
  cases: FactoryRunCaseRow[];
};

/** Parse a raw rollup document into per-case station rows, refusing anything else. */
export function parseFactoryRunRollup(
  raw: unknown,
): { ok: true; value: FactoryRunRollupValue } | { ok: false; reason: string } {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, reason: "rollup_not_an_object" };
  }
  const doc = raw as Record<string, unknown>;
  if (doc["schemaVersion"] !== FACTORY_RUN_ROLLUP_SCHEMA_VERSION) {
    return { ok: false, reason: `unexpected_schema_version: ${String(doc["schemaVersion"] ?? "missing")}` };
  }
  if (!Array.isArray(doc["cases"])) {
    return { ok: false, reason: "missing_cases_array" };
  }
  const cases: FactoryRunCaseRow[] = (doc["cases"] as unknown[]).map((entry) => {
    const row = (
      typeof entry === "object" && entry !== null ? entry : {}
    ) as Record<string, unknown>;
    const stations = Array.isArray(row["stations"]) ? row["stations"] : [];
    return {
      caseId: typeof row["caseId"] === "string" ? row["caseId"] : "unknown_case",
      stations: (stations as unknown[]).map((station) => {
        const stationRow = (
          typeof station === "object" && station !== null ? station : {}
        ) as Record<string, unknown>;
        const parsed: FactoryRunStationRow = {
          stationId:
            typeof stationRow["stationId"] === "string" ? stationRow["stationId"] : "unknown_station",
          classification:
            typeof stationRow["classification"] === "string"
              ? stationRow["classification"]
              : "unknown",
        };
        if (Array.isArray(stationRow["artifactPaths"])) {
          parsed.artifactPaths = stationRow["artifactPaths"].filter(
            (path): path is string => typeof path === "string",
          );
        }
        if (Array.isArray(stationRow["notes"])) {
          parsed.notes = stationRow["notes"].filter(
            (note): note is string => typeof note === "string",
          );
        }
        return parsed;
      }),
    };
  });
  return {
    ok: true,
    value: {
      generatedAt: typeof doc["generatedAt"] === "string" ? doc["generatedAt"] : "",
      cases,
    },
  };
}

export function registerFactoryRunTableRoutes(
  app: Hono<{ Variables: ApiAppVariables }>,
  _ctx: ApiAppContext,
): void {
  app.get("/internal/factory-run-table", async (context) => {
    try {
      const absolute = join(repoRoot(), FACTORY_RUN_ROLLUP_REL);
      let rawText: string;
      try {
        rawText = await readFile(absolute, "utf8");
      } catch {
        return context.json({
          cases: [],
          reason: "no_recorded_run",
          claimBoundary: FACTORY_RUN_CLAIM_BOUNDARY,
          notEvidenceFor: FACTORY_RUN_NOT_EVIDENCE_FOR,
        });
      }
      let raw: unknown;
      try {
        raw = JSON.parse(rawText) as unknown;
      } catch {
        return context.json({
          cases: [],
          reason: "rollup_unparseable_json",
          claimBoundary: FACTORY_RUN_CLAIM_BOUNDARY,
          notEvidenceFor: FACTORY_RUN_NOT_EVIDENCE_FOR,
        });
      }
      const parsed = parseFactoryRunRollup(raw);
      if (!parsed.ok) {
        return context.json({
          cases: [],
          reason: parsed.reason,
          claimBoundary: FACTORY_RUN_CLAIM_BOUNDARY,
          notEvidenceFor: FACTORY_RUN_NOT_EVIDENCE_FOR,
        });
      }
      return context.json({
        schemaVersion: FACTORY_RUN_ROLLUP_SCHEMA_VERSION,
        generatedAt: parsed.value.generatedAt,
        cases: parsed.value.cases,
        claimBoundary: FACTORY_RUN_CLAIM_BOUNDARY,
        notEvidenceFor: FACTORY_RUN_NOT_EVIDENCE_FOR,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown_factory_run_table_error";
      return context.json({
        cases: [],
        reason,
        claimBoundary: FACTORY_RUN_CLAIM_BOUNDARY,
        notEvidenceFor: FACTORY_RUN_NOT_EVIDENCE_FOR,
      });
    }
  });
}
