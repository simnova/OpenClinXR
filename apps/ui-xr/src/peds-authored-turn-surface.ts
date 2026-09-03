import {
  firstNameFromDisplayName,
  learnerVisibleAuthoredCaption,
  PEDS_ASTHMA_SCENARIO_ID,
  resolveAuthoredUtteranceRecord,
} from "@openclinxr/scenario-fixtures/authored-utterance-record";
import {
  pediatricAsthmaDialogueSeeds,
  pediatricAsthmaScenario,
} from "@openclinxr/scenario-fixtures/pediatric-asthma";

export { PEDS_ASTHMA_SCENARIO_ID };

export type LearnerVisiblePedsTurn = {
  actorId: string;
  displayName: string;
  authoredBindingId: string;
  spokenText: string;
  caption: string;
  affect: string;
  learnerVisibleText: string;
  learnerUtterance: string;
};

const PEDS_ACTORS = pediatricAsthmaScenario.actors;

export function isPedsAsthmaScenario(scenarioId: string): boolean {
  return scenarioId === PEDS_ASTHMA_SCENARIO_ID;
}

export function learnerVisiblePedsDialogueForTraceTag(tag: string): string | undefined {
  const seed = pediatricAsthmaDialogueSeeds.find(
    (candidate) =>
      candidate.safetyExpectation !== "blocks_hidden_truth_probe"
      && candidate.expectedTraceTags.includes(tag)
      && candidate.spokenText,
  );
  if (!seed) {
    return undefined;
  }
  const actor = PEDS_ACTORS.find((candidate) => candidate.actorId === seed.actorId);
  const record = resolveAuthoredUtteranceRecord({
    scenarioId: PEDS_ASTHMA_SCENARIO_ID,
    seedId: seed.seedId,
  });
  if (!record || !actor) {
    return undefined;
  }
  return learnerVisibleAuthoredCaption(record, actor.displayName);
}

export function resolvePedsTurnByAddress(learnerUtterance: string): LearnerVisiblePedsTurn | undefined {
  const record = resolveAuthoredUtteranceRecord({
    scenarioId: PEDS_ASTHMA_SCENARIO_ID,
    learnerUtterance,
  });
  if (!record) {
    return undefined;
  }
  const actor = PEDS_ACTORS.find((candidate) => candidate.actorId === record.speakerActorId);
  if (!actor) {
    return undefined;
  }
  const seed = pediatricAsthmaDialogueSeeds.find((candidate) => candidate.seedId === record.seedId);
  return {
    actorId: actor.actorId,
    displayName: actor.displayName,
    authoredBindingId: record.authoredBindingId,
    spokenText: record.spokenText,
    caption: record.caption,
    affect: record.affect,
    learnerVisibleText: learnerVisibleAuthoredCaption(record, actor.displayName),
    learnerUtterance: seed?.learnerUtterance ?? learnerUtterance,
  };
}

export function pedsAddressableFirstNames(): string[] {
  return PEDS_ACTORS.map((actor) => firstNameFromDisplayName(actor.displayName));
}
