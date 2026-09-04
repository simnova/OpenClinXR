import type { Hono } from "hono";
import { hasFacultyAccess } from "@openclinxr/auth";
import {
  buildOpenClinXrCapabilityRoutingMatrix,
  createDeterministicDialogueAdapter,
  type AuthoredDialogueActor,
  type AuthoredDialogueCatalog,
  type AuthoredDialogueSeed,
  type DeterministicDialogueRequestPayload,
  type DialogueEmotion,
  type DialogueSafetyExpectation,
  type FrozenActorTurnPlan,
} from "@openclinxr/capability-gateway";
import type { ApiAppContext } from "../api-app-context.js";
import type { ApiAppVariables } from "../api-types.js";

export type ApiDialogueSeedAuthoringPreviewSuccess = {
  ok: true;
  preview: FrozenActorTurnPlan;
  catalog: {
    scenarioId: string;
    version: number;
    actorIds: string[];
    seedIds: string[];
  };
  liveProviderEnabled: false;
  providerExecutionAllowed: false;
  claimBoundary: "authored_dialogue_catalog_preview_not_live_provider";
};

export type ApiDialogueSeedAuthoringPreviewFailure = {
  ok: false;
  error:
    | "forbidden"
    | "invalid_body"
    | "unknown_actor"
    | "unknown_scenario"
    | "ambiguous_dialogue_seed"
    | "hidden_fact_leakage"
    | "fabricated_provider_claim"
    | "no_matching_dialogue_seed";
  reason: string;
};

/** Faculty-gated authored dialogue catalog validation/preview (no live provider). */
export const DIALOGUE_SEED_AUTHORING_PREVIEW_PATH = "/internal/authored-dialogue-catalogs/preview";

export const DIALOGUE_SEED_AUTHORING_CLAIM_BOUNDARY =
  "authored_dialogue_catalog_preview_not_live_provider" as const;

const SAFETY_EXPECTATIONS = new Set<DialogueSafetyExpectation>([
  "responds_from_visible_facts",
  "blocks_hidden_truth_probe",
]);

const DIALOGUE_EMOTIONS = new Set<DialogueEmotion>([
  "anxious",
  "concerned",
  "reassured",
  "neutral",
]);

export function registerDialogueSeedAuthoringRoutes(
  app: Hono<{ Variables: ApiAppVariables }>,
  _ctx: ApiAppContext,
): void {
  app.post(DIALOGUE_SEED_AUTHORING_PREVIEW_PATH, async (context) => {
    if (!hasFacultyAccess(context.get("identity"))) {
      return context.json(
        { ok: false, error: "forbidden", reason: "faculty_role_required" } satisfies ApiDialogueSeedAuthoringPreviewFailure,
        403,
      );
    }

    const body = await context.req.json().catch(() => ({}));
    const parsed = parsePreviewBody(body);
    if (!parsed.ok) {
      return context.json(parsed.failure, 400);
    }

    const catalog = authoredDialogueCatalogFromActorLocalSeeds(parsed.input);
    const payload: DeterministicDialogueRequestPayload = {
      scenarioId: parsed.input.scenarioId,
      actorId: parsed.input.request.actorId,
      learnerUtterance: parsed.input.request.learnerUtterance,
      turnIndex: parsed.input.request.turnIndex,
      ...(parsed.input.request.stationRunId ? { stationRunId: parsed.input.request.stationRunId } : {}),
      ...(parsed.input.request.claimLiveProvider !== undefined
        ? { claimLiveProvider: parsed.input.request.claimLiveProvider }
        : {}),
      ...(parsed.input.request.providerId !== undefined ? { providerId: parsed.input.request.providerId } : {}),
    };

    try {
      const preview = await resolvePreviewPlan(payload, catalog);
      const success: ApiDialogueSeedAuthoringPreviewSuccess = {
        ok: true,
        preview,
        catalog: {
          scenarioId: parsed.input.scenarioId,
          version: parsed.input.version,
          actorIds: parsed.input.actors.map((actor) => actor.actorId),
          seedIds: parsed.input.seeds.map((seed) => seed.seedId),
        },
        liveProviderEnabled: false,
        providerExecutionAllowed: false,
        claimBoundary: DIALOGUE_SEED_AUTHORING_CLAIM_BOUNDARY,
      };
      return context.json(success);
    } catch (error) {
      return context.json(mapGatewayFailure(error), 400);
    }
  });
}

function authoredDialogueCatalogFromActorLocalSeeds(input: ParsedPreviewBody): AuthoredDialogueCatalog {
  return {
    scenarios: [
      {
        scenarioId: input.scenarioId,
        version: input.version,
        actors: input.actors,
        seeds: input.seeds,
      },
    ],
  };
}

async function resolvePreviewPlan(
  payload: DeterministicDialogueRequestPayload,
  catalog: AuthoredDialogueCatalog,
): Promise<FrozenActorTurnPlan> {
  const adapter = createDeterministicDialogueAdapter(localDevelopmentModelDialogueBinding(), catalog);
  return adapter.execute({
    profile: "local-development",
    capabilityId: "model-dialogue",
    payload,
  });
}

function localDevelopmentModelDialogueBinding() {
  const binding = buildOpenClinXrCapabilityRoutingMatrix().bindings.find(
    (entry) => entry.profile === "local-development" && entry.capabilityId === "model-dialogue",
  );
  if (!binding) {
    throw new Error("missing_local_development_model_dialogue_binding");
  }
  return binding;
}

type ParsedPreviewBody = {
  scenarioId: string;
  version: number;
  actors: AuthoredDialogueActor[];
  seeds: AuthoredDialogueSeed[];
  request: {
    actorId: string;
    learnerUtterance: string;
    turnIndex: number;
    stationRunId?: string;
    claimLiveProvider?: boolean;
    providerId?: string;
  };
};

function parsePreviewBody(
  value: unknown,
): { ok: true; input: ParsedPreviewBody } | { ok: false; failure: ApiDialogueSeedAuthoringPreviewFailure } {
  if (!isRecord(value)) {
    return invalidBody("object_required");
  }
  const scenarioId = requiredString(value["scenarioId"]);
  if (!scenarioId) {
    return invalidBody("scenarioId_required");
  }
  if (typeof value["version"] !== "number" || !Number.isInteger(value["version"])) {
    return invalidBody("version_integer_required");
  }
  if (!Array.isArray(value["actors"]) || value["actors"].length === 0) {
    return invalidBody("actors_required");
  }
  if (!Array.isArray(value["seeds"]) || value["seeds"].length === 0) {
    return invalidBody("seeds_required");
  }
  const actors: AuthoredDialogueActor[] = [];
  for (const actorValue of value["actors"]) {
    const actor = parseActor(actorValue);
    if (!actor) {
      return invalidBody("actor_invalid");
    }
    actors.push(actor);
  }
  const actorIds = new Set(actors.map((actor) => actor.actorId));
  const seeds: AuthoredDialogueSeed[] = [];
  for (const seedValue of value["seeds"]) {
    const seed = parseSeed(seedValue);
    if (!seed) {
      return invalidBody("seed_invalid");
    }
    if (!actorIds.has(seed.actorId)) {
      return {
        ok: false,
        failure: { ok: false, error: "unknown_actor", reason: `unknown_actor:${seed.actorId}` },
      };
    }
    seeds.push(seed);
  }
  const requestValue = value["request"];
  if (!isRecord(requestValue)) {
    return invalidBody("request_required");
  }
  const requestActorId = requiredString(requestValue["actorId"]);
  if (!requestActorId || typeof requestValue["learnerUtterance"] !== "string") {
    return invalidBody("request_actor_and_utterance_required");
  }
  if (typeof requestValue["turnIndex"] !== "number" || !Number.isInteger(requestValue["turnIndex"])) {
    return invalidBody("request_turnIndex_integer_required");
  }
  if (typeof requestValue["claimLiveProvider"] !== "undefined" && typeof requestValue["claimLiveProvider"] !== "boolean") {
    return invalidBody("request_claimLiveProvider_boolean_required");
  }
  if (typeof requestValue["providerId"] !== "undefined" && typeof requestValue["providerId"] !== "string") {
    return invalidBody("request_providerId_string_required");
  }
  const stationRunId = typeof requestValue["stationRunId"] === "string" ? requestValue["stationRunId"] : undefined;
  return {
    ok: true,
    input: {
      scenarioId,
      version: value["version"],
      actors,
      seeds,
      request: {
        actorId: requestActorId,
        learnerUtterance: requestValue["learnerUtterance"],
        turnIndex: requestValue["turnIndex"],
        ...(stationRunId ? { stationRunId } : {}),
        ...(typeof requestValue["claimLiveProvider"] === "boolean"
          ? { claimLiveProvider: requestValue["claimLiveProvider"] }
          : {}),
        ...(typeof requestValue["providerId"] === "string" ? { providerId: requestValue["providerId"] } : {}),
      },
    },
  };
}

function parseActor(value: unknown): AuthoredDialogueActor | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const actorId = requiredString(value["actorId"]);
  const displayName = requiredString(value["displayName"]);
  const role = requiredString(value["role"]);
  if (!actorId || !displayName || !role) {
    return undefined;
  }
  return {
    actorId,
    displayName,
    role,
    ...(typeof value["age"] === "number" ? { age: value["age"] } : {}),
    ...(typeof value["communicationIntensity"] === "number"
      ? { communicationIntensity: value["communicationIntensity"] }
      : {}),
  };
}

function parseSeed(value: unknown): AuthoredDialogueSeed | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const seedId = requiredString(value["seedId"]);
  const actorId = requiredString(value["actorId"]);
  const safetyExpectation = value["safetyExpectation"];
  if (!seedId || !actorId || typeof value["learnerUtterance"] !== "string") {
    return undefined;
  }
  if (typeof value["turnIndex"] !== "number" || !Number.isInteger(value["turnIndex"])) {
    return undefined;
  }
  if (typeof safetyExpectation !== "string" || !SAFETY_EXPECTATIONS.has(safetyExpectation as DialogueSafetyExpectation)) {
    return undefined;
  }
  const visibleFacts = parseStringArray(value["visibleFacts"]);
  const hiddenFactCanaries = parseStringArray(value["hiddenFactCanaries"]);
  if (!visibleFacts || !hiddenFactCanaries) {
    return undefined;
  }
  const affect = value["affect"];
  if (affect !== undefined && (typeof affect !== "string" || !DIALOGUE_EMOTIONS.has(affect as DialogueEmotion))) {
    return undefined;
  }
  const spokenText = typeof value["spokenText"] === "string" ? value["spokenText"] : undefined;
  return {
    seedId,
    actorId,
    turnIndex: value["turnIndex"],
    learnerUtterance: value["learnerUtterance"],
    visibleFacts,
    hiddenFactCanaries,
    safetyExpectation: safetyExpectation as DialogueSafetyExpectation,
    ...(spokenText !== undefined ? { spokenText } : {}),
    ...(typeof affect === "string" ? { affect: affect as DialogueEmotion } : {}),
  };
}

function mapGatewayFailure(error: unknown): ApiDialogueSeedAuthoringPreviewFailure {
  const message = error instanceof Error ? error.message : "unknown_dialogue_preview_error";
  if (message.startsWith("unknown_actor:")) {
    return { ok: false, error: "unknown_actor", reason: message };
  }
  if (message.startsWith("unknown_scenario:")) {
    return { ok: false, error: "unknown_scenario", reason: message };
  }
  if (message.startsWith("ambiguous_dialogue_seed:")) {
    return { ok: false, error: "ambiguous_dialogue_seed", reason: message };
  }
  if (message === "hidden_fact_leakage") {
    return { ok: false, error: "hidden_fact_leakage", reason: "hidden_fact_leakage" };
  }
  if (message.startsWith("fabricated_provider_claim:")) {
    return { ok: false, error: "fabricated_provider_claim", reason: message };
  }
  if (message.startsWith("no_matching_dialogue_seed:")) {
    return { ok: false, error: "no_matching_dialogue_seed", reason: message };
  }
  return { ok: false, error: "invalid_body", reason: "dialogue_preview_failed" };
}

function invalidBody(reason: string): { ok: false; failure: ApiDialogueSeedAuthoringPreviewFailure } {
  return { ok: false, failure: { ok: false, error: "invalid_body", reason } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    return undefined;
  }
  return value;
}
