/**
 * Learner exam scenario resolution (#43 / #53 / #57 / #88) — ids in, validated scenario records out.
 *
 * - no baseUrl → fixture_offline (deliberate mode, not a fallback), zero fetches
 * - baseUrl + reachable queue → api_queue, fallbackActive false
 * - baseUrl + transport failure → fixture_fallback, fallbackActive true + reason (degrade with label)
 * - baseUrl + malformed 200 body → throw (#53 fail-closed; never a labelled fallback)
 * - per queue id (#88): GET /scenarios/:id first (authored wins); bank residual on GET miss only
 *
 * Resolution only — createMultiStationExamRuntime / assembleExamForm stay in the app shell.
 */

import { parseExamStationRunQueueScenarioIds } from "@openclinxr/exam-assembly";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures/ed-chest-pain";
import { scenarioBank } from "@openclinxr/scenario-fixtures/scenario-bank";
import { validateScenario, type Scenario } from "@openclinxr/shared-schemas";

/**
 * Where a single resolved record's BODY came from (#88) — not where the queue came from.
 * scenarioSource remains the queue-mode label; body provenance is per-record.
 */
export type LearnerExamScenarioBodySource = "api_authored" | "bank_residual";

export type LearnerExamScenarioRecord = {
  scenarioId: string;
  status?: string;
  /** Present on api_queue resolution when body provenance is known (#88). */
  bodySource?: LearnerExamScenarioBodySource;
} & Record<string, unknown>;

export type ResolveLearnerExamScenariosInput = {
  baseUrl?: string | undefined;
  blueprintId: string;
  fetch?: typeof fetch;
};

/**
 * How scenarios were acquired for learner form assembly (QUEUE mode).
 * Mirrors asset-path vocabulary (fallbackActive / local_fixture_fallback | api_bundle).
 * Offline is NOT a fallback — it is the supported zero-network mode.
 * Does not describe per-station body provenance — see bodySource on each record (#88).
 */
export type LearnerExamScenarioSource = "fixture_offline" | "fixture_fallback" | "api_queue";

export type ResolveLearnerExamScenariosResult = {
  scenarios: LearnerExamScenarioRecord[];
  scenarioSource: LearnerExamScenarioSource;
  fallbackActive: boolean;
  /** Present when fallbackActive; human/tool-readable reason (not stuffed into other fields). */
  fallbackReason?: string;
};

function lookupBankScenario(scenarioId: string): Scenario | undefined {
  return (
    scenarioBank.find((scenario) => scenario.scenarioId === scenarioId)
    ?? (scenarioId === edChestPainScenario.scenarioId ? edChestPainScenario : undefined)
  );
}

/** Sync fixture-bank resolution for offline / module-scope boot (no network). */
export function scenariosFromFixtureSequence(sequence: readonly string[]): Scenario[] {
  return sequence
    .map((scenarioId) => lookupBankScenario(scenarioId) ?? null)
    .filter((scenario): scenario is Scenario => scenario !== null);
}

/**
 * Resolve the scenarios that feed learner multi-station form assembly.
 * Returns a labelled result object (never a bare array) so callers cannot ignore source/fallback.
 *
 * Authored wins (#88): with baseUrl, each queue id is fetched via GET /scenarios/:id before any
 * bank residual. A GET miss (404 / transport) still yields the fixture when present so seed exams
 * are not emptied. Malformed 200 bodies are refused (accept null → skip), never bank-relabelled.
 * Queue shape drift still throws outside the transport catch (#53).
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
    // API first (authored wins on id clash). Bank residual only on GET miss — not on accept-null.
    try {
      const body = await getJson(fetcher, `${baseUrl}/scenarios/${encodeURIComponent(scenarioId)}`);
      const accepted = acceptHttpScenarioBody(body);
      if (accepted) {
        resolved.push({ ...accepted, bodySource: "api_authored" });
        continue;
      }
      // Malformed 200 body: refuse this station; do not silently re-label as bank residual.
      continue;
    } catch {
      // GET miss / transport on authored hop — bank residual when available (#88 counterweight).
    }

    const fromBank = lookupBankScenario(scenarioId);
    if (fromBank) {
      resolved.push({ ...(fromBank as LearnerExamScenarioRecord), bodySource: "bank_residual" });
    }
    // Authored-only id with GET miss and no bank row: skip; do not invent a station.
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
 * 4. fail with type errors on present fields (e.g. actors: "not-an-array") → refuse (#43).
 * 5. fail with missing-required only (plus optional non-schema markers) → accept candidate as-is
 *    so authored-wins can carry markers the fixture lacks (#88) without weakening type refuse.
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
  if (onlyIdentity) {
    const record: LearnerExamScenarioRecord = { scenarioId: candidate.scenarioId };
    if (typeof candidate.status === "string") {
      record.status = candidate.status;
    }
    return record;
  }

  // Present-field type/schema errors (e.g. "/actors must be array") → refuse. Missing-required
  // messages look like "must have required property '…'" and are not type refuse.
  const hasPresentFieldTypeError = validation.errors.some(
    (error) => error.startsWith("/") || /\bmust be\b/i.test(error) || /\bmust match\b/i.test(error),
  );
  if (hasPresentFieldTypeError) {
    return null;
  }

  // Incomplete authored body with non-schema extras (markers) — still an API body (#88).
  return candidate as LearnerExamScenarioRecord;
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
