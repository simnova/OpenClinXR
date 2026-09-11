
/**
 * Reads the recorded factory run table (GET /internal/factory-run-table).
 *
 * Lives beside the panel it feeds rather than in apps/ui-admin/src, because the
 * thin-app ratchet caps that directory at 40 non-test sources and api-client.ts is
 * already at 586 of its 600-line budget. The caller supplies baseUrl, so this module
 * carries no app-specific import.meta.env read.
 *
 * Fails soft on purpose. The panel this feeds renders "no factory runs recorded"
 * for an empty record, so a network error, a non-JSON body, or a malformed
 * document is reported as an empty record rather than as an exception that would
 * take the admin shell down. The route itself already answers 200-with-empty for
 * an absent rollup, so an empty record here is not distinguishable from "the
 * factory has not run", and neither is a claim that it has.
 */
export type FactoryRunStationClassification = "deterministic" | "not_run" | "absent" | "error";

export type FactoryRunTableStation = {
  stationId: string;
  classification: FactoryRunStationClassification;
  artifactPaths?: string[];
  notes?: string[];
};

export type FactoryRunTableCase = {
  caseId: string;
  stations: FactoryRunTableStation[];
};

export type FactoryRunTable = {
  cases: FactoryRunTableCase[];
  generatedAt?: string;
  reason?: string;
};

const EMPTY: FactoryRunTable = { cases: [] };

export type FetchFactoryRunTableOptions = {
  baseUrl?: string;
  fetch?: typeof fetch;
  accessToken?: string;
  getAccessToken?: () => Promise<string | undefined> | string | undefined;
};

export async function fetchFactoryRunTable(
  options: FetchFactoryRunTableOptions = {},
): Promise<FactoryRunTable> {
  const baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
  const fetcher = options.fetch ?? fetch;
  try {
    const token = options.getAccessToken ? await options.getAccessToken() : options.accessToken;
    const authHeaders =
      typeof token === "string" && token.trim().length > 0
        ? { authorization: `Bearer ${token.trim()}` }
        : {};
    const response = await fetcher(`${baseUrl}/internal/factory-run-table`, {
      method: "GET",
      headers: { accept: "application/json", ...authHeaders },
    });
    if (!response.ok) return EMPTY;
    const body = (await response.json()) as Partial<FactoryRunTable>;
    if (!Array.isArray(body.cases)) return EMPTY;
    return {
      cases: body.cases,
      ...(typeof body.generatedAt === "string" ? { generatedAt: body.generatedAt } : {}),
      ...(typeof body.reason === "string" ? { reason: body.reason } : {}),
    };
  } catch {
    return EMPTY;
  }
}
