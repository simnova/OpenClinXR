import type { ActorCard, Scenario } from "@openclinxr/shared-schemas";

export type MultiActorStateOptionId = "custom-domain-state-baseline" | "colyseus" | "colyseus-schema" | "bitecs";

export type ActorMemory = {
  visibleFacts: string[];
  privateFacts: string[];
  relationshipToLearner: string;
  emotionalState: string;
};

export type ActorRuntimeState = {
  actorId: string;
  role: ActorCard["role"];
  displayName: string;
  demeanor: string;
  memory: ActorMemory;
  conversationTurn: number;
};

export type Vector3 = {
  x: number;
  y: number;
  z: number;
};

export type ActorInteractionState =
  | "idle"
  | "addressed"
  | "speaking"
  | "holding_equipment"
  | "performing_task";

export type ActorTransformState = {
  actorId: string;
  position: Vector3;
  rotationYRadians: number;
  interactionState: ActorInteractionState;
  lastUpdatedAtSecond: number;
};

export type ClinicalOrderState = {
  orderId: string;
  traceTag: string;
  label: string;
  actorId: string;
  atSecond: number;
  status: "requested" | "completed" | "cancelled";
};

export type TextInteractionSource = {
  kind: "text";
  provenanceRefs?: string[];
};

export type VoiceTranscriptInteractionSource = {
  kind: "voice_transcript";
  streamId: string;
  transcriptSegmentId: string;
  finalTranscriptText: string;
  provider: string;
  provenanceRefs: string[];
  rawAudioStored: false;
};

export type InteractionTurnSource = TextInteractionSource | VoiceTranscriptInteractionSource;

export type RouteActorInteractionSourceInput =
  | TextInteractionSource
  | (Omit<VoiceTranscriptInteractionSource, "rawAudioStored"> & {
      rawAudioStored?: false;
    });

export type InteractionLogEntry = {
  atSecond: number;
  learnerUtterance: string;
  routedActorId: string;
  routingReason: InteractionRoutingReason;
  traceContextTags: string[];
  source?: InteractionTurnSource;
};

export type MultiActorClinicalSession = {
  stationRunId: string;
  scenarioId: string;
  scenarioVersion: number;
  actors: ActorRuntimeState[];
  clinicalState: {
    requiredTraceTags: string[];
    completedTraceTags: string[];
    orders: ClinicalOrderState[];
    findings: Array<{
      findingId: string;
      actorId: string;
      label: string;
      atSecond: number;
    }>;
  };
  spatialState: {
    actorTransforms: Record<string, ActorTransformState>;
    objectTransforms: Record<string, ActorTransformState>;
  };
  interactionLog: InteractionLogEntry[];
  evidence: {
    architecture: "custom-domain-state-baseline";
    dependencyPosture: "no_new_runtime_dependencies";
    readyForProductionAdoption: false;
    notEvidenceFor: readonly [
      "production_realtime_state_sync",
      "llm_actor_quality",
      "quest_spatial_sync",
      "clinical_assessment_validity",
    ];
  };
};

export type InteractionRoutingReason =
  | "addressed_actor_name"
  | "addressed_role_keyword"
  | "single_patient_default"
  | "fallback_first_actor";

export type CreateMultiActorClinicalSessionInput = {
  scenario: Scenario;
  stationRunId: string;
};

export type RouteActorInteractionInput = {
  atSecond: number;
  learnerUtterance: string;
  traceContextTags?: string[];
  source?: RouteActorInteractionSourceInput;
};

export type RouteActorInteractionResult = {
  routedActorId: string;
  routingReason: InteractionRoutingReason;
  updatedSession: MultiActorClinicalSession;
};

export type ActorModelContext = {
  actorId: string;
  actorRole: ActorCard["role"];
  displayName: string;
  conversationTurn: number;
  visibleMemory: {
    facts: string[];
    emotionalState: string;
    relationshipToLearner: string;
  };
  privateMemory: {
    factRefs: string[];
    factsForServerModelOnly: string[];
  };
  clinicalState: {
    completedTraceTags: string[];
    openOrders: ClinicalOrderState[];
  };
  spatialState: ActorTransformState;
  retrievedMemoryIds: string[];
};

export type RecordClinicalActionInput = {
  atSecond: number;
  actorId: string;
  traceTag: string;
  actionType: "order_requested" | "finding_observed";
  label: string;
};

export type UpdateActorSpatialStateInput = {
  atSecond: number;
  actorId: string;
  position: Vector3;
  rotationYRadians: number;
  interactionState: ActorInteractionState;
};

export type MultiActorStateOption = {
  id: MultiActorStateOptionId;
  packageName: string | null;
  observedVersion: string | null;
  licensePosture: string;
  productionFit: "high" | "medium" | "low" | "license_gated";
  realtimeStateSyncFit: "high" | "medium" | "baseline_only";
  bunHonoAzureFit: "high" | "medium" | "low";
  recommendation:
    | "recommended_first"
    | "install_backed_followup_candidate"
    | "defer_until_need_is_proven"
    | "defer_until_license_accepted_or_replaced";
  notes: string[];
};

export type MultiActorStateOptionEvaluation = {
  generatedAt: "2026-05-05";
  approvedProposal: "proposals/approved/proposal-server-side-multi-actor-state-context.md";
  recommendedFirstImplementation: "custom-domain-state-baseline";
  options: MultiActorStateOption[];
};

export function createMultiActorClinicalSession(
  input: CreateMultiActorClinicalSessionInput,
): MultiActorClinicalSession {
  return {
    stationRunId: input.stationRunId,
    scenarioId: input.scenario.scenarioId,
    scenarioVersion: input.scenario.version,
    actors: input.scenario.actors.map((actor) => createActorRuntimeState(actor)),
    clinicalState: {
      requiredTraceTags: [...input.scenario.requiredTraceTags],
      completedTraceTags: [],
      orders: [],
      findings: [],
    },
    spatialState: {
      actorTransforms: Object.fromEntries(input.scenario.actors.map((actor, index) => [
        actor.actorId,
        initialActorTransform(actor.actorId, index),
      ])),
      objectTransforms: {},
    },
    interactionLog: [],
    evidence: {
      architecture: "custom-domain-state-baseline",
      dependencyPosture: "no_new_runtime_dependencies",
      readyForProductionAdoption: false,
      notEvidenceFor: [
        "production_realtime_state_sync",
        "llm_actor_quality",
        "quest_spatial_sync",
        "clinical_assessment_validity",
      ],
    },
  };
}

export function routeActorInteraction(
  session: MultiActorClinicalSession,
  input: RouteActorInteractionInput,
): RouteActorInteractionResult {
  const decision = decideActorRoute(session.actors, input.learnerUtterance);
  const updatedActors = session.actors.map((actor) =>
    actor.actorId === decision.actor.actorId
      ? { ...actor, conversationTurn: actor.conversationTurn + 1 }
      : actor
  );
  const currentTransform = requireActorTransform(session, decision.actor.actorId);
  const updatedTransforms = {
    ...session.spatialState.actorTransforms,
    [decision.actor.actorId]: {
      ...currentTransform,
      interactionState: "addressed" as const,
      lastUpdatedAtSecond: input.atSecond,
    },
  };

  return {
    routedActorId: decision.actor.actorId,
    routingReason: decision.reason,
    updatedSession: {
      ...session,
      actors: updatedActors,
      spatialState: {
        ...session.spatialState,
        actorTransforms: updatedTransforms,
      },
      interactionLog: [
        ...session.interactionLog,
        withOptionalSource({
          atSecond: input.atSecond,
          learnerUtterance: input.learnerUtterance,
          routedActorId: decision.actor.actorId,
          routingReason: decision.reason,
          traceContextTags: [...(input.traceContextTags ?? [])],
        }, input.source),
      ],
    },
  };
}

export function buildActorModelContext(
  session: MultiActorClinicalSession,
  actorId: string,
): ActorModelContext {
  const actor = requireActor(session, actorId);
  const privateFactRefs = actor.memory.privateFacts.map((_, index) => `fact:${actor.actorId}:${index}`);

  return {
    actorId: actor.actorId,
    actorRole: actor.role,
    displayName: actor.displayName,
    conversationTurn: actor.conversationTurn,
    visibleMemory: {
      facts: [...actor.memory.visibleFacts],
      emotionalState: actor.memory.emotionalState,
      relationshipToLearner: actor.memory.relationshipToLearner,
    },
    privateMemory: {
      factRefs: privateFactRefs,
      factsForServerModelOnly: [...actor.memory.privateFacts],
    },
    clinicalState: {
      completedTraceTags: [...session.clinicalState.completedTraceTags],
      openOrders: session.clinicalState.orders.filter((order) => order.status === "requested"),
    },
    spatialState: requireActorTransform(session, actorId),
    retrievedMemoryIds: [
      `scenario:${session.scenarioId}:v${session.scenarioVersion}`,
      `actor:${actor.actorId}`,
      ...privateFactRefs,
    ],
  };
}

export function recordClinicalAction(
  session: MultiActorClinicalSession,
  input: RecordClinicalActionInput,
): MultiActorClinicalSession {
  requireActor(session, input.actorId);
  const completedTraceTags = unique([...session.clinicalState.completedTraceTags, input.traceTag]);

  if (input.actionType === "order_requested") {
    const order: ClinicalOrderState = {
      orderId: `order_${session.clinicalState.orders.length + 1}_${input.traceTag}`,
      traceTag: input.traceTag,
      label: input.label,
      actorId: input.actorId,
      atSecond: input.atSecond,
      status: "requested",
    };

    return {
      ...session,
      clinicalState: {
        ...session.clinicalState,
        completedTraceTags,
        orders: [...session.clinicalState.orders, order],
      },
    };
  }

  return {
    ...session,
    clinicalState: {
      ...session.clinicalState,
      completedTraceTags,
      findings: [
        ...session.clinicalState.findings,
        {
          findingId: `finding_${session.clinicalState.findings.length + 1}_${input.traceTag}`,
          actorId: input.actorId,
          label: input.label,
          atSecond: input.atSecond,
        },
      ],
    },
  };
}

export function updateActorSpatialState(
  session: MultiActorClinicalSession,
  input: UpdateActorSpatialStateInput,
): MultiActorClinicalSession {
  requireActor(session, input.actorId);

  return {
    ...session,
    spatialState: {
      ...session.spatialState,
      actorTransforms: {
        ...session.spatialState.actorTransforms,
        [input.actorId]: {
          actorId: input.actorId,
          position: { ...input.position },
          rotationYRadians: input.rotationYRadians,
          interactionState: input.interactionState,
          lastUpdatedAtSecond: input.atSecond,
        },
      },
    },
  };
}

export function evaluateMultiActorStateOptions(): MultiActorStateOptionEvaluation {
  return {
    generatedAt: "2026-05-05",
    approvedProposal: "proposals/approved/proposal-server-side-multi-actor-state-context.md",
    recommendedFirstImplementation: "custom-domain-state-baseline",
    options: [
      {
        id: "custom-domain-state-baseline",
        packageName: null,
        observedVersion: null,
        licensePosture: "internal_no_new_runtime_dependency",
        productionFit: "high",
        realtimeStateSyncFit: "baseline_only",
        bunHonoAzureFit: "high",
        recommendation: "recommended_first",
        notes: [
          "Fastest way to prove actor routing, memory boundaries, clinical state, and spatial state contracts.",
          "Can move stable APIs into scenario-runtime after spike evidence is reviewed.",
        ],
      },
      {
        id: "colyseus",
        packageName: "colyseus",
        observedVersion: "0.17.10",
        licensePosture: "MIT_package_metadata",
        productionFit: "medium",
        realtimeStateSyncFit: "high",
        bunHonoAzureFit: "low",
        recommendation: "install_backed_followup_candidate",
        notes: [
          "Mature realtime room framework, but heavier than this first baseline.",
          "Best evaluated as a sidecar if rooms, presence, and matchmaking become product requirements.",
        ],
      },
      {
        id: "colyseus-schema",
        packageName: "@colyseus/schema",
        observedVersion: "4.0.21",
        licensePosture: "MIT_package_metadata",
        productionFit: "medium",
        realtimeStateSyncFit: "high",
        bunHonoAzureFit: "medium",
        recommendation: "defer_until_need_is_proven",
        notes: [
          "Likely lighter follow-up if schema/delta synchronization becomes the bottleneck.",
          "Avoid adopting decorator/schema conventions before the domain state is stable.",
        ],
      },
      {
        id: "bitecs",
        packageName: "bitecs",
        observedVersion: "0.4.0",
        licensePosture: "MPL-2.0_package_metadata_license_gated",
        productionFit: "license_gated",
        realtimeStateSyncFit: "medium",
        bunHonoAzureFit: "high",
        recommendation: "defer_until_license_accepted_or_replaced",
        notes: [
          "Technically aligned with ECS thinking, but package metadata is MPL-2.0.",
          "Also solves entity/system modeling, not network replication by itself.",
        ],
      },
    ],
  };
}

function createActorRuntimeState(actor: ActorCard): ActorRuntimeState {
  return {
    actorId: actor.actorId,
    role: actor.role,
    displayName: actor.displayName,
    demeanor: actor.demeanor ?? "",
    memory: {
      visibleFacts: actor.demeanor ? [`Demeanor: ${actor.demeanor}`] : [],
      privateFacts: [...(actor.hiddenFacts ?? [])],
      relationshipToLearner: relationshipForRole(actor.role),
      emotionalState: emotionalStateFromDemeanor(actor.demeanor ?? ""),
    },
    conversationTurn: 0,
  };
}

function initialActorTransform(actorId: string, index: number): ActorTransformState {
  const positions: Vector3[] = [
    { x: 0, y: 0, z: -1.15 },
    { x: -0.9, y: 0, z: -0.8 },
    { x: 0.9, y: 0, z: -0.8 },
    { x: 0, y: 0, z: -2.0 },
  ];
  return {
    actorId,
    position: positions[index] ?? { x: index * 0.45, y: 0, z: -1.5 },
    rotationYRadians: 0,
    interactionState: "idle",
    lastUpdatedAtSecond: 0,
  };
}

function decideActorRoute(
  actors: ActorRuntimeState[],
  learnerUtterance: string,
): { actor: ActorRuntimeState; reason: InteractionRoutingReason } {
  const normalized = learnerUtterance.toLowerCase();
  const namedActor = actors.find((actor) => {
    const firstName = actor.displayName.toLowerCase().split(" ")[0];
    return firstName ? normalized.includes(firstName) : false;
  });
  if (namedActor) {
    return { actor: namedActor, reason: "addressed_actor_name" };
  }

  const roleActor = actors.find((actor) => roleKeywords(actor.role).some((keyword) => normalized.includes(keyword)));
  if (roleActor) {
    return { actor: roleActor, reason: "addressed_role_keyword" };
  }

  const patient = actors.find((actor) => actor.role === "patient");
  if (patient) {
    return { actor: patient, reason: "single_patient_default" };
  }

  const fallback = actors[0];
  if (!fallback) {
    throw new Error("Cannot route interaction without actors");
  }
  return { actor: fallback, reason: "fallback_first_actor" };
}

function withOptionalSource(
  entry: Omit<InteractionLogEntry, "source">,
  source: RouteActorInteractionSourceInput | undefined,
): InteractionLogEntry {
  if (!source) {
    return entry;
  }

  if (source.kind === "voice_transcript") {
    return {
      ...entry,
      source: {
        ...source,
        provenanceRefs: [...source.provenanceRefs],
        rawAudioStored: false,
      },
    };
  }

  return {
    ...entry,
    source: {
      ...source,
      provenanceRefs: [...(source.provenanceRefs ?? [])],
    },
  };
}

function requireActor(session: MultiActorClinicalSession, actorId: string): ActorRuntimeState {
  const actor = session.actors.find((candidate) => candidate.actorId === actorId);
  if (!actor) {
    throw new Error(`Actor not found: ${actorId}`);
  }
  return actor;
}

function requireActorTransform(
  session: MultiActorClinicalSession,
  actorId: string,
): ActorTransformState {
  const transform = session.spatialState.actorTransforms[actorId];
  if (!transform) {
    throw new Error(`Actor transform not found: ${actorId}`);
  }
  return transform;
}

function roleKeywords(role: ActorCard["role"]): string[] {
  switch (role) {
    case "family":
      return ["family", "spouse", "wife", "husband", "partner"];
    case "physician":
      return ["doctor", "physician", "attending"];
    case "nurse":
      return ["nurse", "rn"];
    case "patient":
      return ["patient"];
    default:
      return [role.replace(/_/g, " ")];
  }
}

function relationshipForRole(role: ActorCard["role"]): string {
  switch (role) {
    case "patient":
      return "primary patient in the encounter";
    case "family":
      return "family member advocating for the patient";
    case "nurse":
      return "clinical teammate supporting the learner";
    case "physician":
      return "supervising physician or consultant";
    default:
      return "scenario participant";
  }
}

function emotionalStateFromDemeanor(demeanor: string): string {
  const normalized = demeanor.toLowerCase();
  if (normalized.includes("worried") || normalized.includes("anxious")) {
    return "anxious";
  }
  if (normalized.includes("urgent") || normalized.includes("escalating")) {
    return "urgent";
  }
  if (normalized.includes("focused")) {
    return "focused";
  }
  return "neutral";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
