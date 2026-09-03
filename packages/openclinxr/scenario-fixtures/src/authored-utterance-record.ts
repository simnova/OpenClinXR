import type { DialogueFixtureSeed } from "./ed-chest-pain.js";
import { pediatricAsthmaDialogueSeeds, pediatricAsthmaScenario } from "./pediatric-asthma.js";

export const PEDS_ASTHMA_SCENARIO_ID = "peds_asthma_parent_anxiety_v1";

export const PEDS_CREDIBILITY_VETO_ROLES = ["pediatrician", "psychometrician", "simulation_qa"] as const;

export type AuthoredDialogueAffect = NonNullable<DialogueFixtureSeed["affect"]>;

/**
 * One persisted Peds utterance record. Exactly one identifier (seedId or planId)
 * binds speaker, spokenText, caption, and affect. Keyword-affect fallback is not
 * a source of truth for these fields.
 */
export type AuthoredUtteranceRecord = {
  authoredBindingId: string;
  bindingKind: "seed" | "plan";
  speakerActorId: string;
  spokenText: string;
  caption: string;
  affect: AuthoredDialogueAffect;
  seedId?: string;
  planId?: string;
};

export function keywordAffectFallbackFromText(text: string): string {
  const normalized = text.toLowerCase();
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

/** Authored affect wins; keyword/demeanor inference never overrides it. */
export function affectForAuthoredRecord(
  authoredAffect: AuthoredDialogueAffect,
  _keywordFallback: string,
): AuthoredDialogueAffect {
  void _keywordFallback;
  return authoredAffect;
}

export function pedsCastActorIds(): readonly string[] {
  return pediatricAsthmaScenario.actors.map((actor) => actor.actorId);
}

export function firstNameFromDisplayName(displayName: string): string {
  return displayName.trim().split(/\s+/u)[0] ?? "";
}

export function resolveAuthoredUtteranceRecord(input: {
  scenarioId: string;
  actorId?: string;
  learnerUtterance?: string;
  traceTags?: readonly string[];
  seedId?: string;
  planId?: string;
}): AuthoredUtteranceRecord | undefined {
  const seeds = seedsForScenario(input.scenarioId);
  if (seeds.length === 0) {
    return undefined;
  }

  const bySeedId = input.seedId
    ? seeds.find((seed) => seed.seedId === input.seedId)
    : undefined;
  if (bySeedId) {
    return recordFromSeed(bySeedId);
  }

  const planSeedId = planIdToSeedId(input.planId);
  if (planSeedId) {
    const byPlan = seeds.find((seed) => seed.seedId === planSeedId);
    if (byPlan) {
      return recordFromSeed(byPlan, "plan");
    }
  }

  const addressed = addressedSeed(seeds, input.scenarioId, input.learnerUtterance);
  if (addressed) {
    return recordFromSeed(addressed);
  }

  const byActorAndTag = matchSeedByActorAndTag(seeds, input.actorId, input.traceTags);
  if (byActorAndTag) {
    return recordFromSeed(byActorAndTag);
  }

  if (input.actorId) {
    const byActor = seeds.find(
      (seed) => seed.actorId === input.actorId && seed.safetyExpectation !== "blocks_hidden_truth_probe",
    );
    if (byActor) {
      return recordFromSeed(byActor);
    }
  }

  return undefined;
}

export function learnerVisibleAuthoredCaption(record: AuthoredUtteranceRecord, displayName: string): string {
  const name = displayName.trim() || record.speakerActorId;
  return `${name}: ${record.caption}`;
}

function seedsForScenario(scenarioId: string): readonly DialogueFixtureSeed[] {
  if (scenarioId === PEDS_ASTHMA_SCENARIO_ID) {
    return pediatricAsthmaDialogueSeeds;
  }
  return [];
}

function recordFromSeed(seed: DialogueFixtureSeed, bindingKind: "seed" | "plan" = "seed"): AuthoredUtteranceRecord | undefined {
  const spokenText = seed.spokenText?.trim();
  const affect = seed.affect;
  if (!spokenText || !affect) {
    return undefined;
  }
  const caption = (seed.caption?.trim() || spokenText);
  const planId = `plan:${seed.seedId}`;
  return {
    authoredBindingId: bindingKind === "plan" ? planId : seed.seedId,
    bindingKind,
    speakerActorId: seed.actorId,
    spokenText,
    caption,
    affect,
    seedId: seed.seedId,
    planId,
  };
}

function planIdToSeedId(planId: string | undefined): string | undefined {
  if (!planId?.startsWith("plan:")) {
    return undefined;
  }
  const seedId = planId.slice("plan:".length);
  return seedId.length > 0 ? seedId : undefined;
}

function addressedSeed(
  seeds: readonly DialogueFixtureSeed[],
  scenarioId: string,
  learnerUtterance: string | undefined,
): DialogueFixtureSeed | undefined {
  const utterance = learnerUtterance?.toLowerCase() ?? "";
  if (!utterance) {
    return undefined;
  }
  const actors = scenarioId === PEDS_ASTHMA_SCENARIO_ID ? pediatricAsthmaScenario.actors : [];
  for (const actor of actors) {
    const firstName = firstNameFromDisplayName(actor.displayName).toLowerCase();
    if (!firstName || !utterance.includes(firstName)) {
      continue;
    }
    return seeds.find(
      (seed) => seed.actorId === actor.actorId && seed.safetyExpectation !== "blocks_hidden_truth_probe",
    );
  }
  return undefined;
}

function matchSeedByActorAndTag(
  seeds: readonly DialogueFixtureSeed[],
  actorId: string | undefined,
  traceTags: readonly string[] | undefined,
): DialogueFixtureSeed | undefined {
  if (!traceTags || traceTags.length === 0) {
    return undefined;
  }
  return seeds.find((seed) => {
    if (seed.safetyExpectation === "blocks_hidden_truth_probe") {
      return false;
    }
    if (actorId && seed.actorId !== actorId) {
      return false;
    }
    return seed.expectedTraceTags.some((tag) => traceTags.includes(tag));
  });
}
