import { Alert, Button, Card, Input, InputNumber, Select, Space, Tag, Typography } from "antd";
import { type ReactElement, useEffect, useMemo, useState } from "react";
import type { AdminControlPlaneClientOptions } from "./api-client-types.js";

export const AUTHORED_LOCAL_FIXTURE_PROVIDER_ID = "authored-local-fixture" as const;
export const ACTOR_TURN_PLAN_CLAIM_SCOPE = "simulated_actor_behavior" as const;
export const DIALOGUE_SEED_AUTHORING_PREVIEW_PATH = "/internal/authored-dialogue-catalogs/preview";
export const DIALOGUE_SEED_AUTHORING_CLAIM_BOUNDARY =
  "authored_dialogue_catalog_preview_not_live_provider" as const;
export const REQUIRED_NOT_EVIDENCE_FOR = [
  "live_provider_readiness",
  "clinical_validity",
  "exam_equivalence",
] as const;

export type DialogueSafetyExpectation = "responds_from_visible_facts" | "blocks_hidden_truth_probe";
export type DialogueEmotion = "anxious" | "concerned" | "reassured" | "neutral";

export type DialogueSeedActor = {
  actorId: string;
  displayName: string;
  role: string;
  age?: number;
  communicationIntensity?: number;
  hiddenFacts?: readonly string[];
};

export type AuthoredDialogueSeedDraft = {
  seedId: string;
  actorId: string;
  turnIndex: number;
  learnerUtterance: string;
  visibleFacts: readonly string[];
  hiddenFactCanaries: readonly string[];
  safetyExpectation: DialogueSafetyExpectation;
  spokenText?: string;
  affect?: DialogueEmotion;
};

export type DialogueSeedDisclosurePolicy = {
  learnerView: string;
  disclosureRequiresTrigger: boolean;
};

export type FrozenActorTurnPlanPreview = {
  planId: string;
  planVersion: number;
  turnId: string;
  stationRunId: string;
  actorId: string;
  respondingActorId: string;
  turnIndex: number;
  spokenText: string;
  spokenTextForTts: string;
  dialogueEmotionFrom: DialogueEmotion;
  dialogueEmotionTo: DialogueEmotion;
  somaticEmotion: null;
  eventKind: string;
  eventKindSource: string;
  intensityBucket: "low" | "mid" | "high";
  ageBand: "child" | "adolescent" | "adult" | "adult-parent";
  performancePlanId: string;
  facePresetId: string;
  posePresetId: string;
  gestureClipIds: string[];
  prosody: { wrapTags: string[]; inlineTags: string[]; speed: number; droppedTags: string[] };
  voiceId: string;
  languageProvenance: { fallbackUsed: boolean; providerId: typeof AUTHORED_LOCAL_FIXTURE_PROVIDER_ID };
  claimScope: typeof ACTOR_TURN_PLAN_CLAIM_SCOPE;
  notEvidenceFor: string[];
};

export type DialogueSeedFailureCode =
  | "ambiguous_dialogue_seed"
  | "hidden_fact_leakage"
  | "unknown_actor"
  | "no_matching_dialogue_seed"
  | "fabricated_provider_claim"
  | "unknown_scenario"
  | "forbidden"
  | "invalid_body";

export type DialogueSeedFailure = {
  code: DialogueSeedFailureCode;
  seedId?: string;
  detail: string;
};

export type DialogueSeedPublicationGate = {
  canPublish: boolean;
  liveProviderEnabled: false;
  failures: DialogueSeedFailure[];
  previews: FrozenActorTurnPlanPreview[];
};

export type DialogueSeedAuthoringPreviewRequest = {
  scenarioId: string;
  version: number;
  actors: readonly DialogueSeedActor[];
  seeds: readonly AuthoredDialogueSeedDraft[];
  request: {
    actorId: string;
    learnerUtterance: string;
    turnIndex: number;
    stationRunId?: string;
    claimLiveProvider?: boolean;
    providerId?: string;
  };
};

export type DialogueSeedAuthoringPreviewSuccess = {
  ok: true;
  preview: FrozenActorTurnPlanPreview;
  catalog: {
    scenarioId: string;
    version: number;
    actorIds: string[];
    seedIds: string[];
  };
  liveProviderEnabled: false;
  providerExecutionAllowed: false;
  claimBoundary: typeof DIALOGUE_SEED_AUTHORING_CLAIM_BOUNDARY;
};

export type DialogueSeedAuthoringPreviewFailure = {
  ok: false;
  error: DialogueSeedFailureCode;
  reason: string;
};

export type DialogueSeedAuthoringPreviewResult =
  | DialogueSeedAuthoringPreviewSuccess
  | DialogueSeedAuthoringPreviewFailure;

export type DialogueSeedCatalogPreviewFn = (
  input: DialogueSeedAuthoringPreviewRequest,
) => Promise<DialogueSeedAuthoringPreviewResult>;

export async function previewAuthoredDialogueCatalog(
  input: DialogueSeedAuthoringPreviewRequest,
  options: Pick<AdminControlPlaneClientOptions, "baseUrl" | "fetch" | "accessToken" | "getAccessToken"> = {},
): Promise<DialogueSeedAuthoringPreviewResult> {
  const baseUrl = (options.baseUrl ?? import.meta.env["VITE_OPENCLINXR_API_BASE_URL"] ?? "").replace(/\/$/, "");
  const fetcher = options.fetch ?? fetch;
  const token = options.getAccessToken ? await options.getAccessToken() : options.accessToken;
  const authHeaders =
    typeof token === "string" && token.trim().length > 0
      ? { authorization: `Bearer ${token.trim()}` }
      : {};
  const url = `${baseUrl}${DIALOGUE_SEED_AUTHORING_PREVIEW_PATH}`;
  const response = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders },
    body: JSON.stringify({
      scenarioId: input.scenarioId,
      version: input.version,
      actors: input.actors.map(actorToCatalogPayload),
      seeds: input.seeds.map((seed) => seedToCatalogPayload(seed, input.actors)),
      request: input.request,
    }),
  });
  const json = await response.json().catch(() => ({}));
  return validateAuthoredDialoguePreviewResponse(json, input);
}

export function validateAuthoredDialoguePreviewResponse(
  json: unknown,
  input: DialogueSeedAuthoringPreviewRequest,
): DialogueSeedAuthoringPreviewResult {
  if (!isRecord(json)) {
    return invalidBody("preview_response_object_required");
  }
  if (json["ok"] !== true) {
    const error = typeof json["error"] === "string" ? json["error"] : "invalid_body";
    const reason = typeof json["reason"] === "string" ? json["reason"] : "dialogue_preview_failed";
    return {
      ok: false,
      error: isFailureCode(error) ? error : "invalid_body",
      reason,
    };
  }
  const mismatch = previewSuccessMismatch(json, input);
  if (mismatch) {
    return invalidBody(mismatch);
  }
  return json as DialogueSeedAuthoringPreviewSuccess;
}

export type DialogueSeedAuthoringPanelProps = {
  scenarioId: string;
  scenarioVersion: number;
  actors: readonly DialogueSeedActor[];
  disclosurePolicy?: DialogueSeedDisclosurePolicy;
  initialSeeds?: readonly AuthoredDialogueSeedDraft[];
  claimLiveProvider?: boolean;
  providerId?: string;
  previewCatalog?: DialogueSeedCatalogPreviewFn;
};

const EMPTY_GATE: DialogueSeedPublicationGate = {
  canPublish: false,
  liveProviderEnabled: false,
  failures: [],
  previews: [],
};

export function DialogueSeedAuthoringPanel({
  scenarioId,
  scenarioVersion,
  actors,
  disclosurePolicy,
  initialSeeds = [],
  claimLiveProvider = false,
  providerId,
  previewCatalog = previewAuthoredDialogueCatalog,
}: DialogueSeedAuthoringPanelProps): ReactElement {
  const [seeds, setSeeds] = useState<AuthoredDialogueSeedDraft[]>(() => initialSeeds.map(cloneSeed));
  const [gate, setGate] = useState<DialogueSeedPublicationGate>(EMPTY_GATE);
  const previewJson = useMemo(() => JSON.stringify(gate.previews, null, 2), [gate.previews]);

  useEffect(() => {
    let cancelled = false;
    if (seeds.length === 0) {
      setGate(EMPTY_GATE);
      return;
    }
    const catalogActors = actors.map(actorToCatalogPayload);
    const catalogSeeds = seeds.map((seed) => seedToCatalogPayload(seed, actors));
    void (async () => {
      const results = await Promise.all(
        seeds.map(async (seed) => {
          const request = {
            actorId: seed.actorId,
            learnerUtterance: seed.learnerUtterance,
            turnIndex: seed.turnIndex,
            ...(claimLiveProvider ? { claimLiveProvider: true as const } : {}),
            ...(providerId !== undefined ? { providerId } : {}),
          };
          const catalogRequest: DialogueSeedAuthoringPreviewRequest = {
            scenarioId,
            version: scenarioVersion,
            actors: catalogActors,
            seeds: catalogSeeds,
            request,
          };
          const raw = await previewCatalog(catalogRequest).catch((): DialogueSeedAuthoringPreviewFailure => ({
            ok: false,
            error: "invalid_body",
            reason: "dialogue_preview_failed",
          }));
          return validateAuthoredDialoguePreviewResponse(raw, catalogRequest);
        }),
      );
      if (cancelled) {
        return;
      }
      setGate(publicationGateFromPreviewResults(results, seeds));
    })();
    return () => {
      cancelled = true;
    };
  }, [actors, claimLiveProvider, previewCatalog, providerId, scenarioId, scenarioVersion, seeds]);

  const addSeed = () => {
    const actorId = actors[0]?.actorId ?? "";
    const nextIndex = nextActorLocalTurnIndex(seeds, actorId);
    setSeeds((current) => [
      ...current,
      {
        seedId: `seed_${current.length + 1}`,
        actorId,
        turnIndex: nextIndex,
        learnerUtterance: "",
        visibleFacts: [],
        hiddenFactCanaries: [],
        safetyExpectation: "responds_from_visible_facts",
      },
    ]);
  };

  const patchSeed = (index: number, patch: Partial<AuthoredDialogueSeedDraft>) => {
    setSeeds((current) => current.map((seed, i) => (i === index ? { ...seed, ...patch } : seed)));
  };

  return (
    <Card aria-label="Deterministic dialogue seed authoring">
      <Typography.Title level={3}>Deterministic dialogue seeds</Typography.Title>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <div aria-label="Dialogue seed claim boundary">
          Authored local-fixture preview only. claimScope {ACTOR_TURN_PLAN_CLAIM_SCOPE}. notEvidenceFor{" "}
          clinical_validity, exam_equivalence, live_provider_readiness. Live provider disabled.
        </div>
        <div aria-label="Disclosure rules">
          learnerView {disclosurePolicy?.learnerView ?? "redact_hidden_facts"}; disclosureRequiresTrigger{" "}
          {String(disclosurePolicy?.disclosureRequiresTrigger ?? true)}
        </div>
        <div aria-label="Scenario actors">
          {actors.map((actor) => (
            <Tag key={actor.actorId}>{actor.actorId}</Tag>
          ))}
        </div>
        {seeds.map((seed, index) => (
          <Card key={`${seed.seedId}-${index}`} size="small" aria-label={`Dialogue seed ${seed.seedId}`}>
            <Space direction="vertical" style={{ width: "100%" }}>
              <Input
                aria-label={`${seed.seedId} seed id`}
                value={seed.seedId}
                onChange={(event) => patchSeed(index, { seedId: fieldValue(event) })}
              />
              <Select
                aria-label={`${seed.seedId} actor`}
                value={seed.actorId}
                options={actors.map((actor) => ({ label: actor.displayName, value: actor.actorId }))}
                onChange={(value) => patchSeed(index, { actorId: value, turnIndex: nextActorLocalTurnIndex(seeds.filter((_, i) => i !== index), value) })}
                style={{ width: "100%" }}
              />
              <InputNumber
                aria-label={`${seed.seedId} actor-local turn index`}
                min={0}
                value={seed.turnIndex}
                onChange={(value) => patchSeed(index, { turnIndex: typeof value === "number" ? value : 0 })}
              />
              <Input
                aria-label={`${seed.seedId} learner utterance`}
                value={seed.learnerUtterance}
                onChange={(event) => patchSeed(index, { learnerUtterance: fieldValue(event) })}
              />
              <Input.TextArea
                aria-label={`${seed.seedId} spoken text`}
                value={seed.spokenText ?? ""}
                onChange={(event) => patchSeed(index, { spokenText: fieldValue(event) })}
              />
              <Input
                aria-label={`${seed.seedId} visible facts`}
                value={seed.visibleFacts.join(", ")}
                onChange={(event) => patchSeed(index, { visibleFacts: splitList(fieldValue(event)) })}
              />
              <Input
                aria-label={`${seed.seedId} hidden fact canaries`}
                value={seed.hiddenFactCanaries.join(", ")}
                onChange={(event) => patchSeed(index, { hiddenFactCanaries: splitList(fieldValue(event)) })}
              />
              <Select
                aria-label={`${seed.seedId} safety expectation`}
                value={seed.safetyExpectation}
                options={[
                  { label: "responds_from_visible_facts", value: "responds_from_visible_facts" },
                  { label: "blocks_hidden_truth_probe", value: "blocks_hidden_truth_probe" },
                ]}
                onChange={(value) => patchSeed(index, { safetyExpectation: value })}
                style={{ width: "100%" }}
              />
            </Space>
          </Card>
        ))}
        <Button onClick={addSeed}>Add dialogue seed</Button>
        <div aria-label="Seed validation failures">
          {gate.failures.length === 0 ? "none" : gate.failures.map((failure) => failure.detail).join(" | ")}
        </div>
        <Input.TextArea aria-label="Frozen ActorTurnPlan preview" readOnly value={previewJson} rows={12} />
        <Alert
          aria-label="Dialogue seed publication gate"
          type={gate.canPublish ? "success" : "error"}
          message={gate.canPublish
            ? "ready for review (authored-local-fixture only)"
            : `blocked: ${gate.failures.map((failure) => failure.code).join(", ") || "no_matching_dialogue_seed"}`}
          description="Publication stays on the authored seed contract. Unreviewed live providers stay disabled."
        />
      </Space>
    </Card>
  );
}

export function publicationGateFromPreviewResults(
  results: readonly DialogueSeedAuthoringPreviewResult[],
  seeds: readonly AuthoredDialogueSeedDraft[],
): DialogueSeedPublicationGate {
  const failures: DialogueSeedFailure[] = [];
  const previews: FrozenActorTurnPlanPreview[] = [];
  results.forEach((result, index) => {
    if (result.ok) {
      previews.push(result.preview);
      return;
    }
    const failure: DialogueSeedFailure = {
      code: result.error,
      detail: result.reason,
    };
    const seedId = seeds[index]?.seedId;
    if (seedId) {
      failure.seedId = seedId;
    }
    failures.push(failure);
  });
  const uniqueFailures = dedupeFailures(failures);
  return {
    canPublish: uniqueFailures.length === 0 && previews.length > 0,
    liveProviderEnabled: false,
    failures: uniqueFailures,
    previews,
  };
}

function previewSuccessMismatch(
  json: Record<string, unknown>,
  input: DialogueSeedAuthoringPreviewRequest,
): string | undefined {
  if (json["liveProviderEnabled"] !== false) {
    return "live_provider_must_be_disabled";
  }
  if (json["providerExecutionAllowed"] !== false) {
    return "provider_execution_must_be_disabled";
  }
  if (json["claimBoundary"] !== DIALOGUE_SEED_AUTHORING_CLAIM_BOUNDARY) {
    return "claim_boundary_mismatch";
  }
  const catalog = json["catalog"];
  if (!isRecord(catalog)) {
    return "catalog_object_required";
  }
  if (catalog["scenarioId"] !== input.scenarioId) {
    return "catalog_scenario_mismatch";
  }
  if (catalog["version"] !== input.version) {
    return "catalog_version_mismatch";
  }
  const actorIds = stringArray(catalog["actorIds"]);
  const seedIds = stringArray(catalog["seedIds"]);
  if (!actorIds || !seedIds) {
    return "catalog_membership_required";
  }
  if (!actorIds.includes(input.request.actorId)) {
    return "requested_actor_not_in_catalog";
  }
  if (!input.actors.some((actor) => actor.actorId === input.request.actorId)) {
    return "requested_actor_not_in_catalog";
  }
  const requestedSeed = input.seeds.find((seed) =>
    seed.actorId === input.request.actorId
    && seed.learnerUtterance === input.request.learnerUtterance
    && seed.turnIndex === input.request.turnIndex
  );
  if (!requestedSeed || !seedIds.includes(requestedSeed.seedId)) {
    return "requested_seed_not_in_catalog";
  }
  const preview = json["preview"];
  if (!isRecord(preview)) {
    return "preview_object_required";
  }
  const identityFields = [
    "planId",
    "turnId",
    "stationRunId",
    "actorId",
    "respondingActorId",
    "spokenText",
    "spokenTextForTts",
    "voiceId",
    "performancePlanId",
  ] as const;
  for (const field of identityFields) {
    if (!nonblank(preview[field])) {
      return "preview_identity_blank";
    }
  }
  if (preview["actorId"] !== input.request.actorId || preview["respondingActorId"] !== input.request.actorId) {
    return "preview_actor_mismatch";
  }
  if (preview["turnIndex"] !== input.request.turnIndex) {
    return "preview_turn_mismatch";
  }
  if (preview["claimScope"] !== ACTOR_TURN_PLAN_CLAIM_SCOPE) {
    return "preview_claim_scope_mismatch";
  }
  const provenance = preview["languageProvenance"];
  if (!isRecord(provenance) || provenance["providerId"] !== AUTHORED_LOCAL_FIXTURE_PROVIDER_ID) {
    return "preview_provider_mismatch";
  }
  if (typeof provenance["fallbackUsed"] !== "boolean") {
    return "preview_identity_blank";
  }
  const notEvidenceFor = stringArray(preview["notEvidenceFor"]);
  if (!notEvidenceFor || REQUIRED_NOT_EVIDENCE_FOR.some((flag) => !notEvidenceFor.includes(flag))) {
    return "preview_not_evidence_for_mismatch";
  }
  return undefined;
}

function invalidBody(reason: string): DialogueSeedAuthoringPreviewFailure {
  return { ok: false, error: "invalid_body", reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    return undefined;
  }
  return value;
}

function actorToCatalogPayload(actor: DialogueSeedActor): DialogueSeedActor {
  return {
    actorId: actor.actorId,
    displayName: actor.displayName,
    role: actor.role,
    ...(typeof actor.age === "number" ? { age: actor.age } : {}),
    ...(typeof actor.communicationIntensity === "number"
      ? { communicationIntensity: actor.communicationIntensity }
      : {}),
  };
}

function seedToCatalogPayload(
  seed: AuthoredDialogueSeedDraft,
  actors: readonly DialogueSeedActor[],
): AuthoredDialogueSeedDraft {
  const actor = actors.find((entry) => entry.actorId === seed.actorId);
  const canaries = uniqueStrings([...(seed.hiddenFactCanaries ?? []), ...(actor?.hiddenFacts ?? [])]);
  return {
    seedId: seed.seedId,
    actorId: seed.actorId,
    turnIndex: seed.turnIndex,
    learnerUtterance: seed.learnerUtterance,
    visibleFacts: [...seed.visibleFacts],
    hiddenFactCanaries: canaries,
    safetyExpectation: seed.safetyExpectation,
    ...(seed.spokenText !== undefined ? { spokenText: seed.spokenText } : {}),
    ...(seed.affect !== undefined ? { affect: seed.affect } : {}),
  };
}

function isFailureCode(value: string): value is DialogueSeedFailureCode {
  return (
    value === "ambiguous_dialogue_seed"
    || value === "hidden_fact_leakage"
    || value === "unknown_actor"
    || value === "no_matching_dialogue_seed"
    || value === "fabricated_provider_claim"
    || value === "unknown_scenario"
    || value === "forbidden"
    || value === "invalid_body"
  );
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function splitList(value: string): string[] {
  return uniqueStrings(value.split(","));
}

function fieldValue(event: { target?: unknown }): string {
  const target = event.target;
  if (target && typeof target === "object" && "value" in target && typeof target.value === "string") {
    return target.value;
  }
  return "";
}

function cloneSeed(seed: AuthoredDialogueSeedDraft): AuthoredDialogueSeedDraft {
  return {
    ...seed,
    visibleFacts: [...seed.visibleFacts],
    hiddenFactCanaries: [...seed.hiddenFactCanaries],
  };
}

function nextActorLocalTurnIndex(seeds: readonly AuthoredDialogueSeedDraft[], actorId: string): number {
  const indexes = seeds.filter((seed) => seed.actorId === actorId).map((seed) => seed.turnIndex);
  return indexes.length === 0 ? 0 : Math.max(...indexes) + 1;
}

function dedupeFailures(failures: DialogueSeedFailure[]): DialogueSeedFailure[] {
  const seen = new Set<string>();
  const unique: DialogueSeedFailure[] = [];
  for (const failure of failures) {
    const key = `${failure.code}:${failure.seedId ?? ""}:${failure.detail}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(failure);
  }
  return unique;
}
