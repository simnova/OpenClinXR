/**
 * Scenario-derived learner Trace Actions + remote actor turns (#106).
 *
 * SSOT for the conversation surface the running app offers: each station's own
 * `requiredTraceTags` and cast — never a silent ED chest-pain fallback.
 *
 * Decisions (named in the commit message):
 * 1. Seeds do not cover every tag → prefer seed bank utterances, then synthesize
 *    a plain learner utterance for the residual tags (rejected: factory
 *    scenarioDialogueText — lives in tools/, not importable by ui-xr, and is
 *    actor-reply shaped rather than learnerUtterance).
 * 2. Resolver lives in ui-xr (this module) so evidence inspect + runtime-state
 *    share one path; main.ts stays shrink-only (call-site scenarioId only).
 * 3. The 9-entry ED table is demoted to ED-only data (cold-boot / ED bay polish),
 *    not a global fallback.
 * 4. scenarioId absent from the bank → empty action set / no turns (visible
 *    failure) rather than a plausible wrong ED surface.
 */

import type { LearnerRuntimeAssetBundle } from "@openclinxr/asset-registry/runtime-bundles";
import {
  findScenarioFixtureById,
  scenarioBank,
  scenarioDialogueSeedBank,
} from "@openclinxr/scenario-fixtures/scenario-bank";
import type { Scenario } from "@openclinxr/shared-schemas";

export type ScenarioRemoteActorTurnPlan = {
  actorId: string;
  voiceId: string;
  learnerUtterance: string;
  traceContextTags: string[];
};

/** ED chest-pain learner utterances — demoted to ED-only; not a global map. */
const ED_TRACE_ACTION_TURNS: Record<string, ScenarioRemoteActorTurnPlan> = {
  history_opqrst: edPatientTurn(
    "history_opqrst",
    "Can you describe the chest pain, when it started, what you were doing, and what makes it better or worse?",
  ),
  risk_factor_question: edPatientTurn(
    "risk_factor_question",
    "Do you have any heart risk factors or family history I should know about?",
  ),
  associated_symptom_question: edPatientTurn(
    "associated_symptom_question",
    "Are you short of breath, nauseated, sweaty, or having pain anywhere else?",
  ),
  vitals_review: edNurseTurn(
    "vitals_review",
    "Maria, please repeat the vitals now and call out any concerning changes.",
  ),
  ecg_request: edNurseTurn(
    "ecg_request",
    "Please obtain a 12-lead ECG now and let me know when it is ready.",
  ),
  urgent_escalation: edNurseTurn(
    "urgent_escalation",
    "Please notify the senior physician now; I am concerned about acute coronary syndrome.",
  ),
  team_communication: edNurseTurn(
    "team_communication",
    "Maria, the immediate plan is ECG, IV access, cardiac monitoring, and senior escalation.",
  ),
  family_communication: {
    actorId: "spouse_anna_hayes_v1",
    voiceId: "mock-anna-hayes",
    learnerUtterance: "Anna, I know this is frightening. I will explain what we are doing and keep you updated.",
    traceContextTags: ["family_communication"],
  },
  empathy_statement: edPatientTurn(
    "empathy_statement",
    "Robert, I can see you are uncomfortable. We are going to treat this urgently and keep you informed.",
  ),
};

const ED_SCENARIO_ID = "ed_chest_pain_priority_v1";

/**
 * Learner Trace Action tags for a station.
 * When the scenario is in the bank, authored `requiredTraceTags` win (set equality).
 * dialogueTurns never override authored tags — OB/psych-class shipped manifests can carry
 * wrong or partial turns (measured: OB still ships ED chest-pain tags in dialogueTurns).
 * Unknown scenarioId: tags from dialogueTurns only, never silent ED.
 */
export function deriveScenarioTraceActionTags(input: {
  scenarioId: string;
  dialogueTurns?: ReadonlyArray<{ traceTag?: string | null }> | null;
}): string[] {
  const authored = authoredTraceTagsForScenario(input.scenarioId);
  if (authored.length > 0) {
    return authored;
  }
  // dialogueTurns consulted only when scenarioId is not in the bank.
  void input.dialogueTurns;
  const fromTurns = uniqueNonEmptyTags(
    (input.dialogueTurns ?? [])
      .map((turn) => turn.traceTag)
      .filter((tag): tag is string => typeof tag === "string"),
  );
  return fromTurns;
}

export function authoredTraceTagsForScenario(scenarioId: string): string[] {
  const scenario = findScenarioFixtureById(scenarioId, scenarioBank);
  return scenario ? [...scenario.requiredTraceTags] : [];
}

export function authoredSafetyCriticalTraceTagsForScenario(scenarioId: string): string[] {
  const scenario = findScenarioFixtureById(scenarioId, scenarioBank);
  return scenario ? [...(scenario.governance.safetyCriticalTraceTags ?? [])] : [];
}

export function scenarioActorIdsForScenario(scenarioId: string): string[] {
  const scenario = findScenarioFixtureById(scenarioId, scenarioBank);
  return scenario ? scenario.actors.map((actor) => actor.actorId) : [];
}

/**
 * Bundle → Trace Action tags (same path createRuntimeStateFromBundle uses).
 */
export function deriveRuntimeTraceActionTagsFromBundle(bundle: LearnerRuntimeAssetBundle): string[] {
  return deriveScenarioTraceActionTags({
    scenarioId: bundle.scenarioId,
    dialogueTurns: bundle.sceneManifest.dialogueTurns ?? null,
  });
}

/**
 * Resolve a remote actor turn for a learner Trace Action.
 * @param scenarioId station in play; omit only for ED cold-boot unit tests (defaults to ED).
 */
export function resolveRemoteActorTurnForTraceTag(
  tag: string,
  scenarioId: string = ED_SCENARIO_ID,
): ScenarioRemoteActorTurnPlan | undefined {
  if (tag === "patient_note_submitted") {
    return undefined;
  }

  if (scenarioId === ED_SCENARIO_ID) {
    const edTurn = ED_TRACE_ACTION_TURNS[tag];
    if (edTurn) {
      return edTurn;
    }
  }

  const scenario = findScenarioFixtureById(scenarioId, scenarioBank);
  if (!scenario) {
    return undefined;
  }

  const fromSeed = turnFromSeedBank(scenarioId, tag);
  if (fromSeed) {
    return fromSeed;
  }

  return synthesizeTurnForTag(scenario, tag);
}

export function resolveActorIdForTraceTag(
  tag: string,
  scenarioId: string = ED_SCENARIO_ID,
): string | undefined {
  return resolveRemoteActorTurnForTraceTag(tag, scenarioId)?.actorId;
}

function turnFromSeedBank(scenarioId: string, tag: string): ScenarioRemoteActorTurnPlan | undefined {
  const entry = scenarioDialogueSeedBank.find((candidate) => candidate.scenarioId === scenarioId);
  if (!entry) {
    return undefined;
  }
  const seed = entry.seeds.find(
    (candidate) =>
      candidate.safetyExpectation !== "blocks_hidden_truth_probe"
      && candidate.expectedTraceTags.includes(tag),
  );
  if (!seed) {
    return undefined;
  }
  return {
    actorId: seed.actorId,
    voiceId: mockVoiceIdForActor(seed.actorId),
    learnerUtterance: seed.learnerUtterance,
    traceContextTags: [tag],
  };
}

function synthesizeTurnForTag(
  scenario: Scenario,
  tag: string,
): ScenarioRemoteActorTurnPlan | undefined {
  const actor = pickActorForTraceTag(scenario, tag);
  if (!actor) {
    return undefined;
  }
  const displayName = actor.displayName?.trim() || actor.actorId;
  const objective = scenario.reviewRubric.find((rubric) => rubric.requiredTraceTags.includes(tag))?.label
    ?? tag.replaceAll("_", " ");
  return {
    actorId: actor.actorId,
    voiceId: mockVoiceIdForActor(actor.actorId),
    learnerUtterance: `${displayName}, I need to cover ${objective.toLowerCase()} now.`,
    traceContextTags: [tag],
  };
}

function pickActorForTraceTag(scenario: Scenario, tag: string): Scenario["actors"][number] | undefined {
  const scheduledActorId = scenario.eventSchedule.find((event) => event.tag === tag)?.actorId;
  if (scheduledActorId) {
    const scheduled = scenario.actors.find((actor) => actor.actorId === scheduledActorId);
    if (scheduled) {
      return scheduled;
    }
  }

  const byRoles = (...roles: string[]) =>
    scenario.actors.find((actor) => roles.includes(actor.role));

  if (/empathy/i.test(tag)) {
    return byRoles("patient") ?? scenario.actors[0];
  }
  if (/parent|family|partner|spouse|guardian|collateral/i.test(tag)) {
    return byRoles("family", "family_member", "parent", "spouse")
      ?? scenario.actors[2]
      ?? scenario.actors[1]
      ?? scenario.actors[0];
  }
  if (
    /oxygen|bronchodilator|vitals|team|escalation|note|observation|safety_plan|order|request|interpreter|ecg|management|activation|handoff/i
      .test(tag)
  ) {
    return byRoles("nurse", "respiratory_therapist", "consultant", "interpreter")
      ?? scenario.actors[1]
      ?? scenario.actors[0];
  }
  return byRoles("patient") ?? scenario.actors[0];
}

function mockVoiceIdForActor(actorId: string): string {
  if (actorId === "patient_robert_hayes_v1") return "mock-robert-hayes";
  if (actorId === "nurse_maria_alvarez_v1") return "mock-maria-alvarez";
  if (actorId === "spouse_anna_hayes_v1") return "mock-anna-hayes";
  const withoutVersion = actorId.replace(/_v\d+$/u, "");
  const parts = withoutVersion.split("_").filter(Boolean);
  const drop = new Set([
    "patient",
    "nurse",
    "spouse",
    "partner",
    "parent",
    "behavioral",
    "health",
    "rt",
    "interpreter",
    "consultant",
    "family",
    "respiratory",
    "therapist",
  ]);
  while (parts.length > 1 && drop.has(parts[0]!)) {
    parts.shift();
  }
  return `mock-${parts.join("-") || withoutVersion}`;
}

function uniqueNonEmptyTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const trimmed = tag.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function edPatientTurn(traceTag: string, learnerUtterance: string): ScenarioRemoteActorTurnPlan {
  return {
    actorId: "patient_robert_hayes_v1",
    voiceId: "mock-robert-hayes",
    learnerUtterance,
    traceContextTags: [traceTag],
  };
}

function edNurseTurn(traceTag: string, learnerUtterance: string): ScenarioRemoteActorTurnPlan {
  return {
    actorId: "nurse_maria_alvarez_v1",
    voiceId: "mock-maria-alvarez",
    learnerUtterance,
    traceContextTags: [traceTag],
  };
}
