/**
 * Faculty debrief causal-chain projection.
 *
 * Internal to review-workflow. Not on the package entrypoint. Reads trace /
 * hypothesis / note / actor-response data as plain structural types — no
 * telemetry import. Every link cites a source event id that exists in the
 * input; a link with no source event is a failure.
 *
 * Statements are copied from the source payload. The projector never invents
 * reasoning that is not present on the cited events.
 */

export const FACULTY_CAUSAL_CHAIN_CLAIM_SCOPE = "faculty_causal_chain_not_score_use" as const;

export const FACULTY_CAUSAL_CHAIN_NOT_EVIDENCE_FOR = [
  "exam_equivalence",
  "clinical_validity",
  "scoring_validity",
  "autonomous_score",
  "diagnosis_correctness",
  "generative_summary_without_review",
] as const;

const REQUIRED_SOURCE_EVENT_TYPES = new Set([
  "learner.hypothesis",
  "learner.hypothesis.changed",
  "learner.observation",
]);

const PROJECTED_EVENT_TYPES = new Set([
  ...REQUIRED_SOURCE_EVENT_TYPES,
  "note.submitted",
  "actor.response.generated",
]);

export type FacultyCausalChainSourceEvent = {
  eventId?: string;
  sequence?: number;
  atSecond: number;
  eventType?: string;
  source?: string;
  payload?: Record<string, unknown>;
};

export type FacultyCausalChainLinkKind =
  | "hypothesis"
  | "hypothesis_change"
  | "supporting_observation"
  | "contradicting_observation"
  | "note"
  | "actor_response";

export type FacultyCausalChainMissingKind =
  | "missing_supporting_observation"
  | "missing_note"
  | "missing_actor_response";

export type FacultyCausalChainLink = {
  sourceEventId: string;
  citedEventIds: readonly string[];
  atSecond: number;
  sequence: number;
  kind: FacultyCausalChainLinkKind;
  statement: string;
};

export type FacultyCausalChainMissingEvidence = {
  sourceEventId: string;
  hypothesisEventId: string;
  kind: FacultyCausalChainMissingKind;
};

export type FacultyCausalChain = {
  links: readonly FacultyCausalChainLink[];
  missingEvidence: readonly FacultyCausalChainMissingEvidence[];
  claimScope: typeof FACULTY_CAUSAL_CHAIN_CLAIM_SCOPE;
  scoringValidityClaimed: false;
  notEvidenceFor: typeof FACULTY_CAUSAL_CHAIN_NOT_EVIDENCE_FOR;
};

export function projectFacultyCausalChain(
  events: readonly FacultyCausalChainSourceEvent[],
): FacultyCausalChain {
  const knownIds = new Set<string>();
  for (const event of events) {
    const eventId = sourceEventId(event);
    if (eventId) {
      knownIds.add(eventId);
    }
  }

  const projected: IndexedEvent[] = [];
  for (const event of events) {
    const eventType = event.eventType;
    if (!eventType || !PROJECTED_EVENT_TYPES.has(eventType)) {
      continue;
    }
    const eventId = sourceEventId(event);
    if (!eventId) {
      if (REQUIRED_SOURCE_EVENT_TYPES.has(eventType)) {
        throw new Error("causal chain link requires source event id");
      }
      continue;
    }
    projected.push({ event, eventId, eventType });
  }

  projected.sort(compareIndexedEvents);

  const links: FacultyCausalChainLink[] = [];
  let previousHypothesis: IndexedEvent | undefined;

  for (const item of projected) {
    const citations = uniquePreserve([item.eventId, ...citedEventIdsFromPayload(item.event.payload)]);
    rejectUnknownCitations(citations, knownIds);

    if (item.eventType === "learner.hypothesis") {
      const statement = payloadString(item.event.payload, "hypothesis");
      links.push(linkFrom(item, "hypothesis", statement, citations));
      if (previousHypothesis && payloadString(previousHypothesis.event.payload, "hypothesis") !== statement) {
        links.push(linkFrom(item, "hypothesis_change", statement, uniquePreserve([
          item.eventId,
          previousHypothesis.eventId,
        ])));
      }
      previousHypothesis = item;
      continue;
    }

    if (item.eventType === "learner.hypothesis.changed") {
      const statement = payloadString(item.event.payload, "hypothesis");
      links.push(linkFrom(item, "hypothesis_change", statement, citations));
      previousHypothesis = item;
      continue;
    }

    if (item.eventType === "learner.observation") {
      const relation = payloadString(item.event.payload, "relation");
      if (relation !== "supports" && relation !== "contradicts") {
        continue;
      }
      const kind = relation === "supports" ? "supporting_observation" : "contradicting_observation";
      links.push(linkFrom(item, kind, payloadString(item.event.payload, "observation"), citations));
      continue;
    }

    if (item.eventType === "note.submitted") {
      links.push(linkFrom(item, "note", payloadString(item.event.payload, "noteSummary"), citations));
      continue;
    }

    links.push(linkFrom(item, "actor_response", payloadString(item.event.payload, "responseKind"), citations));
  }

  for (const chainLink of links) {
    rejectLinkWithoutSource(chainLink, knownIds);
    rejectHallucinatedStatement(chainLink, events);
  }

  return {
    links,
    missingEvidence: missingEvidenceFor(links),
    claimScope: FACULTY_CAUSAL_CHAIN_CLAIM_SCOPE,
    scoringValidityClaimed: false,
    notEvidenceFor: FACULTY_CAUSAL_CHAIN_NOT_EVIDENCE_FOR,
  };
}

type IndexedEvent = {
  event: FacultyCausalChainSourceEvent;
  eventId: string;
  eventType: string;
};

function linkFrom(
  item: IndexedEvent,
  kind: FacultyCausalChainLinkKind,
  statement: string,
  citedEventIds: readonly string[],
): FacultyCausalChainLink {
  return {
    sourceEventId: item.eventId,
    citedEventIds,
    atSecond: item.event.atSecond,
    sequence: item.event.sequence ?? Number.MAX_SAFE_INTEGER,
    kind,
    statement,
  };
}

function sourceEventId(event: FacultyCausalChainSourceEvent): string | undefined {
  const topLevel = trimmed(event.eventId);
  if (topLevel) {
    return topLevel;
  }
  return trimmed(payloadString(event.payload, "eventId"))
    ?? trimmed(payloadString(event.payload, "durableEventRef"));
}

function citedEventIdsFromPayload(payload: Record<string, unknown> | undefined): string[] {
  const ids: string[] = [];
  const relatedHypothesisEventId = trimmed(payloadString(payload, "relatedHypothesisEventId"));
  if (relatedHypothesisEventId) {
    ids.push(relatedHypothesisEventId);
  }
  const previousHypothesisEventId = trimmed(payloadString(payload, "previousHypothesisEventId"));
  if (previousHypothesisEventId) {
    ids.push(previousHypothesisEventId);
  }
  const cited = payload?.["citedEventIds"];
  if (Array.isArray(cited)) {
    for (const value of cited) {
      if (typeof value === "string") {
        const eventId = value.trim();
        if (eventId.length > 0) {
          ids.push(eventId);
        }
      }
    }
  }
  return ids;
}

function rejectUnknownCitations(citedEventIds: readonly string[], knownIds: ReadonlySet<string>): void {
  for (const eventId of citedEventIds) {
    if (!knownIds.has(eventId)) {
      throw new Error(`causal chain cites unknown event ${eventId}`);
    }
  }
}

function rejectLinkWithoutSource(chainLink: FacultyCausalChainLink, knownIds: ReadonlySet<string>): void {
  if (chainLink.sourceEventId.trim().length === 0 || !knownIds.has(chainLink.sourceEventId)) {
    throw new Error("causal chain link requires source event id");
  }
}

function rejectHallucinatedStatement(
  chainLink: FacultyCausalChainLink,
  events: readonly FacultyCausalChainSourceEvent[],
): void {
  if (chainLink.statement.length === 0) {
    return;
  }
  const source = events.find((event) => sourceEventId(event) === chainLink.sourceEventId);
  if (!source || !payloadContainsString(source.payload, chainLink.statement)) {
    throw new Error("causal chain statement is not present on the source event");
  }
}

function missingEvidenceFor(links: readonly FacultyCausalChainLink[]): FacultyCausalChainMissingEvidence[] {
  const hypotheses = links.filter((chainLink) => chainLink.kind === "hypothesis" || chainLink.kind === "hypothesis_change");
  const missing: FacultyCausalChainMissingEvidence[] = [];
  const seen = new Set<string>();

  for (const hypothesis of hypotheses) {
    const hypothesisEventId = hypothesis.sourceEventId;
    if (seen.has(hypothesisEventId)) {
      continue;
    }
    seen.add(hypothesisEventId);

    if (!links.some((chainLink) =>
      (chainLink.kind === "supporting_observation" || chainLink.kind === "contradicting_observation")
      && chainLink.citedEventIds.includes(hypothesisEventId)
    )) {
      missing.push({
        sourceEventId: hypothesisEventId,
        hypothesisEventId,
        kind: "missing_supporting_observation",
      });
    }
    if (!links.some((chainLink) => chainLink.kind === "note" && chainLink.citedEventIds.includes(hypothesisEventId))) {
      missing.push({
        sourceEventId: hypothesisEventId,
        hypothesisEventId,
        kind: "missing_note",
      });
    }
    if (!links.some((chainLink) =>
      chainLink.kind === "actor_response" && chainLink.citedEventIds.includes(hypothesisEventId)
    )) {
      missing.push({
        sourceEventId: hypothesisEventId,
        hypothesisEventId,
        kind: "missing_actor_response",
      });
    }
  }

  return missing;
}

function compareIndexedEvents(left: IndexedEvent, right: IndexedEvent): number {
  const leftSequence = left.event.sequence ?? Number.MAX_SAFE_INTEGER;
  const rightSequence = right.event.sequence ?? Number.MAX_SAFE_INTEGER;
  return leftSequence - rightSequence
    || left.event.atSecond - right.event.atSecond
    || left.eventId.localeCompare(right.eventId);
}

function payloadString(payload: Record<string, unknown> | undefined, key: string): string {
  const value = payload?.[key];
  return typeof value === "string" ? value : "";
}

function payloadContainsString(payload: Record<string, unknown> | undefined, expected: string): boolean {
  if (!payload) {
    return false;
  }
  const stack: unknown[] = [payload];
  while (stack.length > 0) {
    const value = stack.pop();
    if (value === expected) {
      return true;
    }
    if (Array.isArray(value)) {
      stack.push(...value);
      continue;
    }
    if (typeof value === "object" && value !== null) {
      stack.push(...Object.values(value));
    }
  }
  return false;
}

function uniquePreserve(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const eventId of ids) {
    if (seen.has(eventId)) {
      continue;
    }
    seen.add(eventId);
    out.push(eventId);
  }
  return out;
}

function trimmed(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next && next.length > 0 ? next : undefined;
}
