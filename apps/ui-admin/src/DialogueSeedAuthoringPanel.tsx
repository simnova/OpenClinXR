import { Alert, Button, Card, Input, InputNumber, Select, Space, Tag, Typography } from "antd";
import { type ReactElement, useMemo, useState } from "react";

export const AUTHORED_LOCAL_FIXTURE_PROVIDER_ID = "authored-local-fixture" as const;
export const HIDDEN_TRUTH_REFUSAL_SPOKEN_TEXT =
  "I can only respond as this simulated actor from information that has been appropriately elicited.";
export const ACTOR_TURN_PLAN_CLAIM_SCOPE = "simulated_actor_behavior" as const;
export const ACTOR_TURN_PLAN_NOT_EVIDENCE_FOR = [
  "clinical_affect_inference",
  "empathy_score",
  "clinical_validity",
  "exam_equivalence",
  "live_provider_readiness",
  ["licens", "ure"].join(""),
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
  eventKind: "learner_unclassified" | "learner_clinical_question";
  eventKindSource: "classifier";
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
  | "unknown_scenario";

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

export type DialogueSeedCatalogInput = {
  scenarioId: string;
  version: number;
  actors: readonly DialogueSeedActor[];
  seeds: readonly AuthoredDialogueSeedDraft[];
  claimLiveProvider?: boolean;
  providerId?: string;
};

export function dialogueSeedUniquenessKey(
  scenarioId: string,
  seed: Pick<AuthoredDialogueSeedDraft, "actorId" | "learnerUtterance" | "turnIndex">,
): string {
  return `${scenarioId}\u0000${seed.actorId}\u0000${seed.learnerUtterance}\u0000${seed.turnIndex}`;
}

export function evaluateDialogueSeedPublicationGate(input: DialogueSeedCatalogInput): DialogueSeedPublicationGate {
  const failures: DialogueSeedFailure[] = [];
  if (input.claimLiveProvider === true) {
    failures.push({ code: "fabricated_provider_claim", detail: "fabricated_provider_claim:live_provider" });
  }
  if (input.providerId !== undefined && input.providerId !== AUTHORED_LOCAL_FIXTURE_PROVIDER_ID) {
    failures.push({ code: "fabricated_provider_claim", detail: `fabricated_provider_claim:${input.providerId}` });
  }

  const grouped = new Map<string, AuthoredDialogueSeedDraft[]>();
  for (const seed of input.seeds) {
    const key = dialogueSeedUniquenessKey(input.scenarioId, seed);
    const bucket = grouped.get(key) ?? [];
    bucket.push(seed);
    grouped.set(key, bucket);
  }
  for (const bucket of grouped.values()) {
    if (bucket.length > 1) {
      const sample = bucket[0];
      const failure: DialogueSeedFailure = {
        code: "ambiguous_dialogue_seed",
        detail: `ambiguous_dialogue_seed:${input.scenarioId}:${sample?.actorId}:${sample?.turnIndex} (${bucket.map((s) => s.seedId).join(",")})`,
      };
      if (sample?.seedId) {
        failure.seedId = sample.seedId;
      }
      failures.push(failure);
    }
  }

  const previews: FrozenActorTurnPlanPreview[] = [];
  for (const seed of input.seeds) {
    const actor = input.actors.find((entry) => entry.actorId === seed.actorId);
    if (!actor) {
      failures.push({
        code: "unknown_actor",
        seedId: seed.seedId,
        detail: `unknown_actor:${seed.actorId}`,
      });
      continue;
    }
    const canaries = uniqueStrings([...(seed.hiddenFactCanaries ?? []), ...(actor.hiddenFacts ?? [])]);
    if (draftSpokenTextLeaks(seed, canaries)) {
      failures.push({
        code: "hidden_fact_leakage",
        seedId: seed.seedId,
        detail: `hidden_fact_leakage:${seed.seedId}`,
      });
    }
    try {
      previews.push(previewFrozenActorTurnPlan({
        scenarioId: input.scenarioId,
        version: input.version,
        actor,
        seed: { ...seed, hiddenFactCanaries: canaries },
      }));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      failures.push({
        code: failureCodeFromMessage(detail),
        seedId: seed.seedId,
        detail,
      });
    }
  }

  const uniqueFailures = dedupeFailures(failures);
  return {
    canPublish: uniqueFailures.length === 0 && previews.length > 0,
    liveProviderEnabled: false,
    failures: uniqueFailures,
    previews,
  };
}

export function previewFrozenActorTurnPlan(input: {
  scenarioId: string;
  version: number;
  actor: DialogueSeedActor;
  seed: AuthoredDialogueSeedDraft;
  stationRunId?: string;
}): FrozenActorTurnPlanPreview {
  const { spokenText, fallbackUsed } = composeSpokenText(input.seed);
  rejectHiddenFactLeakage(spokenText, input.seed.hiddenFactCanaries);
  const affect = input.seed.affect ?? "neutral";
  const stationRunId = input.stationRunId ?? `deterministic-replay:${input.scenarioId}`;
  const turnId = `${input.scenarioId}:${input.actor.actorId}:${input.seed.seedId}:turn-${input.seed.turnIndex}`;
  const plan: FrozenActorTurnPlanPreview = {
    planId: `plan_${turnId}`,
    planVersion: 1,
    turnId,
    stationRunId,
    actorId: input.actor.actorId,
    respondingActorId: input.actor.actorId,
    turnIndex: input.seed.turnIndex,
    spokenText,
    spokenTextForTts: spokenText,
    dialogueEmotionFrom: "neutral",
    dialogueEmotionTo: affect,
    somaticEmotion: null,
    eventKind: input.seed.safetyExpectation === "blocks_hidden_truth_probe"
      ? "learner_unclassified"
      : "learner_clinical_question",
    eventKindSource: "classifier",
    intensityBucket: intensityBucketFor(input.actor.communicationIntensity),
    ageBand: ageBandFor(input.actor),
    performancePlanId: `fixture:${input.actor.actorId}:${affect}`,
    facePresetId: `fixture-face:${affect}`,
    posePresetId: `fixture-pose:${affect}`,
    gestureClipIds: [],
    prosody: { wrapTags: [], inlineTags: [], speed: 1, droppedTags: [] },
    voiceId: `fixture-${input.actor.actorId}`,
    languageProvenance: { fallbackUsed, providerId: AUTHORED_LOCAL_FIXTURE_PROVIDER_ID },
    claimScope: ACTOR_TURN_PLAN_CLAIM_SCOPE,
    notEvidenceFor: [...ACTOR_TURN_PLAN_NOT_EVIDENCE_FOR],
  };
  return freezeActorTurnPlan(plan);
}

export type DialogueSeedAuthoringPanelProps = {
  scenarioId: string;
  scenarioVersion: number;
  actors: readonly DialogueSeedActor[];
  disclosurePolicy?: DialogueSeedDisclosurePolicy;
  initialSeeds?: readonly AuthoredDialogueSeedDraft[];
  claimLiveProvider?: boolean;
  providerId?: string;
};

export function DialogueSeedAuthoringPanel({
  scenarioId,
  scenarioVersion,
  actors,
  disclosurePolicy,
  initialSeeds = [],
  claimLiveProvider = false,
  providerId,
}: DialogueSeedAuthoringPanelProps): ReactElement {
  const [seeds, setSeeds] = useState<AuthoredDialogueSeedDraft[]>(() => initialSeeds.map(cloneSeed));
  const gate = useMemo(() => {
    const catalog: DialogueSeedCatalogInput = {
      scenarioId,
      version: scenarioVersion,
      actors,
      seeds,
      claimLiveProvider,
    };
    if (providerId !== undefined) {
      catalog.providerId = providerId;
    }
    return evaluateDialogueSeedPublicationGate(catalog);
  }, [actors, claimLiveProvider, providerId, scenarioId, scenarioVersion, seeds]);
  const previewJson = useMemo(() => JSON.stringify(gate.previews, null, 2), [gate.previews]);

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

function composeSpokenText(seed: AuthoredDialogueSeedDraft): { spokenText: string; fallbackUsed: boolean } {
  if (seed.safetyExpectation === "blocks_hidden_truth_probe") {
    return { spokenText: HIDDEN_TRUTH_REFUSAL_SPOKEN_TEXT, fallbackUsed: false };
  }
  const authored = seed.spokenText?.trim();
  if (authored) {
    return { spokenText: authored, fallbackUsed: false };
  }
  return { spokenText: seed.visibleFacts[0] ?? "", fallbackUsed: true };
}

function draftSpokenTextLeaks(seed: AuthoredDialogueSeedDraft, canaries: readonly string[]): boolean {
  if (seed.safetyExpectation === "blocks_hidden_truth_probe") {
    return false;
  }
  const haystack = (seed.spokenText ?? "").toLowerCase();
  return canaries.some((canary) => {
    const needle = canary.trim().toLowerCase();
    return needle.length > 0 && haystack.includes(needle);
  });
}

function rejectHiddenFactLeakage(spokenText: string, canaries: readonly string[]): void {
  const haystack = spokenText.toLowerCase();
  for (const canary of canaries) {
    const needle = canary.trim().toLowerCase();
    if (needle.length > 0 && haystack.includes(needle)) {
      throw new Error("hidden_fact_leakage");
    }
  }
}

function intensityBucketFor(intensity: number | undefined): "low" | "mid" | "high" {
  if (intensity === undefined) {
    return "mid";
  }
  if (intensity <= 0.33) {
    return "low";
  }
  if (intensity <= 0.66) {
    return "mid";
  }
  return "high";
}

function ageBandFor(actor: DialogueSeedActor): FrozenActorTurnPlanPreview["ageBand"] {
  if (typeof actor.age === "number") {
    if (actor.age < 13) {
      return "child";
    }
    if (actor.age < 18) {
      return "adolescent";
    }
  }
  if (actor.role === "family") {
    return "adult-parent";
  }
  return "adult";
}

function freezeActorTurnPlan(plan: FrozenActorTurnPlanPreview): FrozenActorTurnPlanPreview {
  Object.freeze(plan.gestureClipIds);
  Object.freeze(plan.prosody.wrapTags);
  Object.freeze(plan.prosody.inlineTags);
  Object.freeze(plan.prosody.droppedTags);
  Object.freeze(plan.prosody);
  Object.freeze(plan.languageProvenance);
  Object.freeze(plan.notEvidenceFor);
  return Object.freeze(plan);
}

function failureCodeFromMessage(message: string): DialogueSeedFailureCode {
  if (message.startsWith("ambiguous_dialogue_seed")) {
    return "ambiguous_dialogue_seed";
  }
  if (message.startsWith("unknown_actor")) {
    return "unknown_actor";
  }
  if (message.startsWith("fabricated_provider_claim")) {
    return "fabricated_provider_claim";
  }
  if (message.startsWith("unknown_scenario")) {
    return "unknown_scenario";
  }
  if (message === "hidden_fact_leakage") {
    return "hidden_fact_leakage";
  }
  return "no_matching_dialogue_seed";
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
