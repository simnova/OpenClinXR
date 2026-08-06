/**
 * Learner exam scenario resolution (#43) — ids in, validated scenario records out.
 *
 * - configured api base url → GET station-run-queue, then get-authored-scenario for ids
 *   absent from the fixture bank; every HTTP body passes validateScenario before trust
 * - no base url → fixture bank only (offline dev + Quest boot never acquire a network dep)
 *
 * Resolution only — createMultiStationExamRuntime / assembleExamForm stay in the app shell.
 */

import { edChestPainScenario } from "@openclinxr/scenario-fixtures/ed-chest-pain";
import { scenarioBank } from "@openclinxr/scenario-fixtures/scenario-bank";
import { validateScenario, type Scenario } from "@openclinxr/shared-schemas";

export type LearnerExamScenarioRecord = { scenarioId: string; status?: string } & Record<string, unknown>;

export type ResolveLearnerExamScenariosInput = {
  baseUrl?: string | undefined;
  blueprintId: string;
  fetch?: typeof fetch;
};

/** Sync fixture-bank resolution for offline / module-scope boot (no network). */
export function scenariosFromFixtureSequence(sequence: readonly string[]): Scenario[] {
  return sequence
    .map(
      (scenarioId) =>
        scenarioBank.find((scenario) => scenario.scenarioId === scenarioId)
        ?? (scenarioId === edChestPainScenario.scenarioId ? edChestPainScenario : null),
    )
    .filter((scenario): scenario is Scenario => scenario !== null);
}

/**
 * Resolve the scenarios that feed learner multi-station form assembly.
 * Offline (no baseUrl): fixture bank, zero fetches.
 * Online: station-run-queue sequence + authored fetch for bank misses; refuse invalid HTTP bodies.
 */
export async function resolveLearnerExamScenarios(
  input: ResolveLearnerExamScenariosInput,
): Promise<LearnerExamScenarioRecord[]> {
  if (!input.baseUrl) {
    return [...scenarioBank];
  }

  const baseUrl = input.baseUrl.replace(/\/$/, "");
  const fetcher = input.fetch ?? globalThis.fetch;
  let queueIds: string[];
  try {
    const queueBody = await getJson(
      fetcher,
      `${baseUrl}/exam-blueprints/${encodeURIComponent(input.blueprintId)}/station-run-queue`,
    );
    queueIds = extractStationQueueScenarioIds(queueBody);
  } catch {
    // Network failure must not brick offline-capable boot — fall back to the bank.
    return [...scenarioBank];
  }

  const resolved: LearnerExamScenarioRecord[] = [];
  for (const scenarioId of queueIds) {
    const fromBank =
      scenarioBank.find((scenario) => scenario.scenarioId === scenarioId)
      ?? (scenarioId === edChestPainScenario.scenarioId ? edChestPainScenario : undefined);
    if (fromBank) {
      resolved.push(fromBank as LearnerExamScenarioRecord);
      continue;
    }

    try {
      const body = await getJson(fetcher, `${baseUrl}/scenarios/${encodeURIComponent(scenarioId)}`);
      const accepted = acceptHttpScenarioBody(body);
      if (accepted) {
        resolved.push(accepted);
      }
    } catch {
      // Missing or failed authored hop — skip; do not invent a station.
    }
  }
  return resolved;
}

function extractStationQueueScenarioIds(body: unknown): string[] {
  if (!isRecord(body) || !Array.isArray(body.stationQueue)) {
    return [];
  }
  const ids: string[] = [];
  for (const entry of body.stationQueue) {
    if (!isRecord(entry)) continue;
    if (typeof entry.scenarioId === "string" && entry.scenarioId.length > 0) {
      ids.push(entry.scenarioId);
    }
  }
  return ids;
}

/**
 * Trust model for HTTP scenario bodies:
 * 1. Always run validateScenario — the client does not trust raw JSON for assembly.
 * 2. ok → accept full body (real authored scenarios).
 * 3. fail with only identity fields (scenarioId + optional status) → accept as sequence id only
 *    (thin mocks / partial queue enrichment; not assembly-ready).
 * 4. fail with any other shape (e.g. actors: "not-an-array") → refuse.
 * Supports both flat bodies and the real API envelope `{ scenario }`.
 */
function acceptHttpScenarioBody(body: unknown): LearnerExamScenarioRecord | null {
  if (!isRecord(body)) {
    return null;
  }
  const candidate = isRecord(body.scenario) ? body.scenario : body;
  if (!isRecord(candidate) || typeof candidate.scenarioId !== "string" || candidate.scenarioId.length === 0) {
    return null;
  }

  const validation = validateScenario(candidate);
  if (validation.ok) {
    return candidate as LearnerExamScenarioRecord;
  }

  const keys = Object.keys(candidate);
  const onlyIdentity = keys.every((key) => key === "scenarioId" || key === "status");
  if (!onlyIdentity) {
    return null;
  }

  const record: LearnerExamScenarioRecord = { scenarioId: candidate.scenarioId };
  if (typeof candidate.status === "string") {
    record.status = candidate.status;
  }
  return record;
}

async function getJson(fetcher: typeof fetch, url: string): Promise<unknown> {
  const response = await fetcher(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`OpenClinXR learner scenario GET failed: ${url} ${response.status}`);
  }
  return response.json() as Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
