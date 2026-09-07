import { edChestPainScenario } from "@openclinxr/scenario-fixtures/ed-chest-pain";
import { scenarioBank } from "@openclinxr/scenario-fixtures/scenario-bank";
import { actorIdForTraceTag as packageActorIdForTraceTag } from "@openclinxr/xr-runtime-state";
import type {
  HumanoidDialogueEmotionContext,
  HumanoidDialogueGazeTarget,
  HumanoidExpressionEmotion,
} from "@openclinxr/xr-humanoid-animation";
import type { ActorDialogueDeps, ActorDialogueSpeechDeps } from "./types.js";

export function runtimeDialogueTurnForTraceTag(
  deps: Pick<ActorDialogueSpeechDeps, "encounterBundle">,
  tag: string,
) {
  return deps.encounterBundle().sceneManifest.dialogueTurns?.find((turn) => turn.traceTag === tag);
}

export function localDialogueActorIdForTraceTag(
  deps: Pick<
    ActorDialogueSpeechDeps,
    "encounterBundle" | "selectedScenarioId" | "runtimePatientActorId" | "runtimeClinicalTeamActorId" | "runtimeFamilyActorId" | "actorIdForTraceTag"
  >,
  tag: string,
): string | undefined {
  const runtimeTurn = runtimeDialogueTurnForTraceTag(deps, tag);
  if (runtimeTurn) return runtimeTurn.actorId;
  const actorIds: Record<string, string | undefined> = {
    history_opqrst: deps.runtimePatientActorId(),
    risk_factor_question: deps.runtimePatientActorId(),
    associated_symptom_question: deps.runtimePatientActorId(),
    vitals_review: deps.runtimeClinicalTeamActorId(),
    ecg_request: deps.runtimeClinicalTeamActorId(),
    urgent_escalation: deps.runtimeFamilyActorId(),
    team_communication: deps.runtimeClinicalTeamActorId(),
    family_communication: deps.runtimeFamilyActorId(),
    empathy_statement: deps.runtimePatientActorId(),
  };
  return actorIds[tag] ?? packageActorIdForTraceTag(tag, deps.selectedScenarioId());
}

export function localDialogueGazeTargetForTraceTag(
  deps: Pick<
    ActorDialogueSpeechDeps,
    "encounterBundle" | "runtimeClinicalTeamActorId" | "runtimeFamilyActorId"
  >,
  tag: string,
): HumanoidDialogueGazeTarget {
  const runtimeTurn = runtimeDialogueTurnForTraceTag(deps, tag);
  if (runtimeTurn) {
    return {
      kind: runtimeTurn.gazeTargetKind,
      actorId: runtimeTurn.gazeTargetActorId,
    };
  }
  const actorTargets: Record<string, string | undefined> = {
    team_communication: deps.runtimeClinicalTeamActorId(),
    family_communication: deps.runtimeFamilyActorId(),
  };
  const actorTarget = actorTargets[tag];
  return actorTarget
    ? { kind: "actor", actorId: actorTarget }
    : { kind: "learner_camera", actorId: null };
}

export function scenarioDialogueEmotionContext(
  deps: Pick<ActorDialogueDeps, "encounterBundle" | "selectedScenarioId">,
  actorId: string,
  _text: string,
  explicitEmotion?: HumanoidExpressionEmotion,
  emotionSource?: HumanoidDialogueEmotionContext["source"],
): HumanoidDialogueEmotionContext {
  const scenario = scenarioBank.find((candidate) => candidate.scenarioId === deps.encounterBundle().scenarioId)
    ?? scenarioBank.find((candidate) => candidate.scenarioId === deps.selectedScenarioId())
    ?? edChestPainScenario;
  const actor = scenario.actors.find((candidate) => candidate.actorId === actorId);
  const baselineMood = actor?.communicationProfile?.baselineMood ?? [];
  if (explicitEmotion) {
    return {
      emotion: explicitEmotion,
      source: emotionSource ?? "runtime_affect_timeline",
      baselineMood,
      cueIds: [
        "plan_dialogue_emotion_to_expression_weights",
        "scenario_dialogue_emotion_transition_cue",
        "case_definition_driven_expression_selection",
      ],
    };
  }
  return {
    emotion: "neutral",
    source: "plan_missing",
    baselineMood,
    cueIds: [
      "live_face_requires_actor_turn_plan_dialogue_emotion_to",
      "scenario_dialogue_emotion_transition_cue",
    ],
  };
}
