/**
 * Factory run-rollup validation (moved from apps/api composition root).
 *
 * Validator-only module: parseFactoryRunRollup plus the FactoryRunRollupValue
 * shape it returns. The route constant FACTORY_RUN_ROLLUP_REL stays with the
 * route; import it from the app instead.
 */

export type FactoryRunStationRow = {
  stationId: string;
  classification: string;
  artifactPaths?: string[];
  notes?: string[];
};

export type FactoryRunCaseRow = {
  caseId: string;
  stations: FactoryRunStationRow[];
};

export type FactoryRunRollupValue = {
  generatedAt: string;
  cases: FactoryRunCaseRow[];
};

const FACTORY_RUN_ROLLUP_SCHEMA_VERSION = "openclinxr.dark-factory-multi-case-rollup.v1";

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
