/**
 * Learner exam scenario resolution (#43 / #53 / #57) — ids in, validated scenario records out.
 *
 * - no baseUrl → fixture_offline (deliberate mode, not a fallback), zero fetches
 * - baseUrl + reachable queue → api_queue, fallbackActive false
 * - baseUrl + transport failure → fixture_fallback, fallbackActive true + reason (degrade with label)
 * - baseUrl + malformed 200 body → throw (#53 fail-closed; never a labelled fallback)
 *
 * Resolution only — createMultiStationExamRuntime / assembleExamForm stay in the app shell.
 */

import { parseExamStationRunQueueScenarioIds } from "@openclinxr/exam-assembly";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures/ed-chest-pain";
import { scenarioBank } from "@openclinxr/scenario-fixtures/scenario-bank";
import { validateScenario, type Scenario } from "@openclinxr/shared-schemas";

export type LearnerExamScenarioRecord = { scenarioId: string; status?: string } & Record<string, unknown>;

export type ResolveLearnerExamScenariosInput = {
  baseUrl?: string | undefined;
  blueprintId: string;
  fetch?: typeof fetch;
};

/**
 * How scenarios were acquired for learner form assembly.
 * Mirrors asset-path vocabulary (fallbackActive / local_fixture_fallback | api_bundle).
 * Offline is NOT a fallback — it is the supported zero-network mode.
 */
export type LearnerExamScenarioSource = "fixture_offline" | "fixture_fallback" | "api_queue";

export type ResolveLearnerExamScenariosResult = {
  scenarios: LearnerExamScenarioRecord[];
  scenarioSource: LearnerExamScenarioSource;
  fallbackActive: boolean;
  /** Present when fallbackActive; human/tool-readable reason (not stuffed into other fields). */
  fallbackReason?: string;
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
 * Returns a labelled result object (never a bare array) so callers cannot ignore source/fallback.
 */
export async function resolveLearnerExamScenarios(
  input: ResolveLearnerExamScenariosInput,
): Promise<ResolveLearnerExamScenariosResult> {
  if (!input.baseUrl) {
    return {
      scenarios: [...scenarioBank],
      scenarioSource: "fixture_offline",
      fallbackActive: false,
    };
  }

  const baseUrl = input.baseUrl.replace(/\/$/, "");
  const fetcher = input.fetch ?? globalThis.fetch;

  // Transport failure only: degrade with label. Shape drift on a successful response must NOT
  // fall through here — parse throws outside this catch (#53 fail-closed, #57 does not relabel).
  let queueBody: unknown;
  try {
    queueBody = await getJson(
      fetcher,
      `${baseUrl}/exam-blueprints/${encodeURIComponent(input.blueprintId)}/station-run-queue`,
    );
  } catch (error) {
    const reason =
      error instanceof Error && error.message.length > 0
        ? error.message
        : "station_run_queue_unreachable";
    return {
      scenarios: [...scenarioBank],
      scenarioSource: "fixture_fallback",
      fallbackActive: true,
      fallbackReason: reason,
    };
  }

  // Throws on unparseable shape — never converted into fixture_fallback.
  const queueIds = parseExamStationRunQueueScenarioIds(queueBody);

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
      // Missing or failed authored hop — skip; do not invent a station. (Partial-queue residual out of #57.)
    }
  }

  return {
    scenarios: resolved,
    scenarioSource: "api_queue",
    fallbackActive: false,
  };
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
