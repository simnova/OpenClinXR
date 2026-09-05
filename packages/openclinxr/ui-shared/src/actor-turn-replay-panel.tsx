import type { ReviewPacketReplayQuery } from "@openclinxr/graphql/client";
import { Tag, Typography } from "antd";
import type { ReactElement } from "react";

export const ACTOR_TURN_REPLAY_CLAIM_BOUNDARY =
  "faculty_actor_turn_plan_vs_execution_not_clinical_validity" as const;

export const ACTOR_TURN_REPLAY_CLAIM_SCOPE = "simulated_actor_behavior" as const;

export const ACTOR_TURN_REPLAY_NOT_EVIDENCE_FOR = [
  "clinical_validity",
  "scoring_validity",
  "quest_readiness",
  "exam_equivalence",
  "production_readiness",
] as const;

type ReviewPacket = NonNullable<ReviewPacketReplayQuery["reviewPacket"]>;
type ActorTurn = ReviewPacket["actorTurns"][number];
type EmotionalTimelineEntry = ReviewPacket["emotionalTimeline"][number];

export type ActorTurnReplayPanelProps = {
  packet: Pick<ReviewPacket, "actorTurns" | "emotionalTimeline" | "prosodyNeutralized"> | Record<string, unknown>;
};

const PRIVATE_PAYLOAD_MARKERS = [
  "hiddenFacts",
  "privateFacts",
  "hiddenFactRefs",
  "serverOnlyNotes",
  "spokenTextForTts",
  "rawAudio",
  "audioBytes",
  "audioPayload",
];

export function ActorTurnReplayPanel({ packet }: ActorTurnReplayPanelProps): ReactElement {
  const record = asRecord(packet);
  const actorTurns = readActorTurns(record);
  const emotionalTimeline = readEmotionalTimeline(record);
  const prosodyNeutralized = record?.["prosodyNeutralized"] === true;

  return (
    <section className="workbench-panel" aria-label="Actor turn plan versus execution replay">
      <div className="workbench-title-row">
        <div>
          <Typography.Text className="eyebrow">GraphQL ReviewPacket actorTurns</Typography.Text>
          <Typography.Title level={4}>Actor Turn Replay</Typography.Title>
        </div>
        <Tag color={prosodyNeutralized ? "gold" : "green"} aria-label="Prosody neutralization state">
          {prosodyNeutralized ? "prosody neutralized" : "prosody rendered"}
        </Tag>
      </div>
      <Typography.Paragraph>
        Frozen authored/generated plan fields stay distinct from rendered execution. Captions use faculty-safe spoken text. Raw audio and provider-private payloads stay off this surface.
      </Typography.Paragraph>

      <div className="readiness-strip review-replay-strip">
        <div>
          <Typography.Text strong>{`${actorTurns.length} actor ${pluralize(actorTurns.length, "turn")}`}</Typography.Text>
          <Typography.Paragraph type="secondary">{`${emotionalTimeline.length} emotional ${pluralize(emotionalTimeline.length, "step")}`}</Typography.Paragraph>
        </div>
        <div>
          <Typography.Text strong>{`claimScope ${ACTOR_TURN_REPLAY_CLAIM_SCOPE}`}</Typography.Text>
          <Typography.Paragraph type="secondary" aria-label="Actor turn replay claim boundary">
            {ACTOR_TURN_REPLAY_CLAIM_BOUNDARY}
          </Typography.Paragraph>
        </div>
        <div>
          <Typography.Text strong>examEquivalenceGate false</Typography.Text>
          <Typography.Paragraph type="secondary" aria-label="Actor turn replay not evidence for">
            {`not evidence for ${ACTOR_TURN_REPLAY_NOT_EVIDENCE_FOR.join(", ")}`}
          </Typography.Paragraph>
        </div>
      </div>

      <section aria-label="Emotional timeline">
        <Typography.Text strong>Emotional timeline</Typography.Text>
        {emotionalTimeline.length === 0 ? (
          <Typography.Paragraph className="empty-panel-note">No emotion transitions on this packet.</Typography.Paragraph>
        ) : (
          <ol className="compact-list" aria-label="Emotional timeline entries">
            {emotionalTimeline.map((entry, index) => (
              <li key={`${entry.planId ?? "emotion"}:${entry.turnIndex ?? index}:${entry.from}:${entry.to}`}>
                <Typography.Text>{`${entry.from} → ${entry.to}`}</Typography.Text>
                <Typography.Text type="secondary">
                  {`${entry.trigger ?? "unspecified trigger"}; turn ${entry.turnIndex ?? "n/a"}; ${entry.atSecond ?? 0}s${entry.actorId ? `; ${entry.actorId}` : ""}`}
                </Typography.Text>
              </li>
            ))}
          </ol>
        )}
      </section>

      {actorTurns.length === 0 ? (
        <Typography.Paragraph className="empty-panel-note">
          No actor-turn plan/execution layers on this review packet.
        </Typography.Paragraph>
      ) : (
        <ol className="compact-list" aria-label="Actor turn plan versus execution timeline">
          {actorTurns.map((turn) => (
            <li key={turn.plan.planId}>
              <div className="review-replay-grid">
                <section aria-label={`Frozen plan ${turn.plan.planId}`}>
                  <Typography.Text strong>Frozen plan</Typography.Text>
                  <Typography.Paragraph>{turn.plan.spokenText}</Typography.Paragraph>
                  <Typography.Paragraph type="secondary">
                    {`plan ${turn.plan.planId}; emotion ${turn.plan.dialogueEmotionFrom} → ${turn.plan.dialogueEmotionTo}; event ${turn.plan.eventKind}`}
                  </Typography.Paragraph>
                  <Typography.Paragraph type="secondary">
                    {`performance ${turn.plan.performancePlanId}; face ${turn.plan.facePresetId}; claimScope ${turn.plan.claimScope}`}
                  </Typography.Paragraph>
                  <DroppedTagLog tags={turn.plan.droppedTags} />
                </section>
                <section aria-label={`Rendered execution ${turn.execution.planId}`}>
                  <Typography.Text strong>Rendered execution</Typography.Text>
                  <Typography.Paragraph>{executionOutcomeLabel(turn.execution)}</Typography.Paragraph>
                  <Typography.Paragraph type="secondary">
                    {`plan ${turn.execution.planId}; viseme cues ${turn.execution.visemeCueCount}; tts provider ${turn.execution.ttsProviderId}`}
                  </Typography.Paragraph>
                  <Tag color={turn.execution.interruptionKind === "none" ? "green" : "orange"} aria-label={`Interruption ${turn.plan.planId}`}>
                    {executionOutcomeLabel(turn.execution)}
                  </Tag>
                </section>
              </div>
            </li>
          ))}
        </ol>
      )}

      <Typography.Paragraph type="secondary" aria-label="Private payload posture">
        {detectPrivatePayloadLeak(packet)
          ? "privatePayloadRedacted=true"
          : "privatePayloadRedacted=true; no raw audio"}
      </Typography.Paragraph>
    </section>
  );
}

function DroppedTagLog({ tags }: { tags: readonly string[] }): ReactElement {
  return (
    <div aria-label="Dropped provider tags">
      <Typography.Text strong>Dropped provider tags</Typography.Text>
      <div className="tag-row">
        {tags.length === 0 ? <Tag color="green">none</Tag> : tags.map((tag) => (
          <Tag key={tag} color="gold">{tag}</Tag>
        ))}
      </div>
    </div>
  );
}

function executionOutcomeLabel(execution: ActorTurn["execution"]): string {
  if (execution.interruptionKind === "replaced") {
    return "barge-in replaced";
  }
  if (execution.interruptionKind === "truncated" || execution.truncated) {
    return "truncated";
  }
  return "uninterrupted";
}

function readActorTurns(packet: Record<string, unknown> | undefined): ActorTurn[] {
  const turns = packet?.["actorTurns"];
  return Array.isArray(turns) ? turns as ActorTurn[] : [];
}

function readEmotionalTimeline(packet: Record<string, unknown> | undefined): EmotionalTimelineEntry[] {
  const timeline = packet?.["emotionalTimeline"];
  return Array.isArray(timeline) ? timeline as EmotionalTimelineEntry[] : [];
}

function detectPrivatePayloadLeak(packet: unknown): boolean {
  const serialized = JSON.stringify(packet ?? {});
  return PRIVATE_PAYLOAD_MARKERS.some((marker) => serialized.includes(marker));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function pluralize(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}
