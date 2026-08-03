import { Alert, Button, Space, Tag, Typography } from "antd";
import type { ChangeEvent, ReactElement } from "react";
import { useEffect, useState } from "react";

/**
 * Admin UI bind surface for `openclinxr.admin-replay-from-emission.v1`
 * (from `pnpm encounter:admin-replay-from-emission` / mapEmissionToAdminReplayProps).
 * Real turns only — not seeds-only. No clinical/scoring/Quest/production claims.
 *
 * Projection sources:
 * - embedded_sample: in-module SAMPLE (default)
 * - cli_latest_fixture: static Vite asset from public/fixtures (CLI latest snapshot)
 * - user_file: client-side .json file pick
 */

export type EmissionReplayTimelineEntry = {
  sequence: number;
  atSecond: number;
  eventType: string;
  source: string;
  actorId?: string;
  tag?: string;
  summary: string;
};

export type AdminReplayFromEmissionV1 = {
  schemaVersion: "openclinxr.admin-replay-from-emission.v1";
  generatedAt: string;
  sourceEmissionPath: string;
  sourceEmissionSchemaVersion: string;
  stationRunId: string;
  scenarioId: string;
  scenarioVersion: number;
  phase: string;
  learnerId: string;
  actorTurnRefs: string[];
  actorTurnCount: number;
  timeline: EmissionReplayTimelineEntry[];
  timelineEntryCount: number;
  traceEventTypes: string[];
  reviewPacket: {
    stationRunId: string;
    scenarioId: string;
    eventCount: number;
    observedTraceTags: string[];
    missingRequiredTraceTags: string[];
  };
  privatePayloadRedacted: true;
  turnSource: "runtime_emission_real_turns";
  wiring?: {
    input: string;
    projection: string;
    path: string;
  };
  claimBoundary: "admin_replay_from_runtime_emission_not_clinical_validity";
  notEvidenceFor: readonly [
    "clinical_validity",
    "scoring_validity",
    "quest_readiness",
    "production_readiness",
  ];
};

/** Active projection origin for faculty-facing source badge. */
export type EmissionReplayProjectionSource =
  | "embedded_sample"
  | "cli_latest_fixture"
  | "user_file";

/** Static Vite asset path for CLI `admin-replay-from-emission-latest.json` snapshot. */
export const CLI_LATEST_FIXTURE_URL = "/fixtures/admin-replay-from-emission-latest.json";

/** Sample projection aligned with tools/openclinxr/admin-replay-from-emission.test.ts (mapEmissionToAdminReplayProjection). */
export const SAMPLE_ADMIN_REPLAY_FROM_EMISSION_V1: AdminReplayFromEmissionV1 = {
  schemaVersion: "openclinxr.admin-replay-from-emission.v1",
  generatedAt: "2026-08-02T12:00:00.000Z",
  sourceEmissionPath: "(embedded-sample-from-admin-replay-from-emission.test)",
  sourceEmissionSchemaVersion: "openclinxr.encounter-runtime-emission.v1",
  stationRunId: "run_ed_chest_pain_priority_v1_test",
  scenarioId: "ed_chest_pain_priority_v1",
  scenarioVersion: 1,
  phase: "review",
  learnerId: "runtime_emission_learner_001",
  actorTurnRefs: [
    "actor_turn:run_ed_chest_pain_priority_v1_test:turn_1_patient_robert_hayes_v1_120",
    "actor_turn:run_ed_chest_pain_priority_v1_test:turn_2_patient_robert_hayes_v1_210",
  ],
  actorTurnCount: 2,
  timeline: [
    {
      sequence: 0,
      atSecond: 120,
      eventType: "learner.utterance",
      source: "learner",
      actorId: "patient_robert_hayes_v1",
      tag: "history_opqrst",
      summary: "Learner utterance: When did the chest pressure start?",
    },
    {
      sequence: 1,
      atSecond: 120,
      eventType: "actor.response.generated",
      source: "runtime_emission",
      actorId: "patient_robert_hayes_v1",
      tag: "history_opqrst",
      summary:
        "Actor response (spoken_actor_response): Robert Hayes: Demeanor: anxious, diaphoretic, protective of chest",
    },
    {
      sequence: 2,
      atSecond: 210,
      eventType: "clinical.touch.guarding",
      source: "runtime_emission",
      actorId: "patient_robert_hayes_v1",
      tag: "clinical_touch_guard_rlq",
      summary:
        "touch→guard→dialogue at abdomen_rlq; kind guarding; dialogue Ow— that hurts a lot, please don't push there.; notEvidenceFor clinical_validity/scoring",
    },
  ],
  timelineEntryCount: 3,
  traceEventTypes: [
    "station.started",
    "consent.accepted",
    "encounter.started",
    "learner.utterance",
    "actor.response.generated",
    "clinical.touch.guarding",
  ],
  reviewPacket: {
    stationRunId: "run_ed_chest_pain_priority_v1_test",
    scenarioId: "ed_chest_pain_priority_v1",
    eventCount: 8,
    observedTraceTags: ["history_opqrst", "ecg_request", "clinical_touch_guard_rlq"],
    missingRequiredTraceTags: ["risk_factor_question"],
  },
  privatePayloadRedacted: true,
  turnSource: "runtime_emission_real_turns",
  wiring: {
    input: "encounter-runtime-emission.v1",
    projection: "admin_replay_review_packet_summary",
    path: "loadEmission→mapActorTurns+clinicalTouch→writeAdminReplay",
  },
  claimBoundary: "admin_replay_from_runtime_emission_not_clinical_validity",
  notEvidenceFor: [
    "clinical_validity",
    "scoring_validity",
    "quest_readiness",
    "production_readiness",
  ],
};

export type EmissionReplayBindPanelProps = {
  /** CLI projection or embedded sample; defaults to SAMPLE_ADMIN_REPLAY_FROM_EMISSION_V1. */
  projection?: AdminReplayFromEmissionV1;
};

export function parseAdminReplayFromEmissionV1(value: unknown): AdminReplayFromEmissionV1 {
  if (!value || typeof value !== "object") {
    throw new Error("Admin replay projection is not an object");
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== "openclinxr.admin-replay-from-emission.v1") {
    throw new Error(
      `Unexpected schemaVersion: ${String(record.schemaVersion)} (expected openclinxr.admin-replay-from-emission.v1)`,
    );
  }
  if (record.turnSource !== "runtime_emission_real_turns") {
    throw new Error(
      `Unexpected turnSource: ${String(record.turnSource)} (expected runtime_emission_real_turns, not seeds-only)`,
    );
  }
  if (!Array.isArray(record.actorTurnRefs) || record.actorTurnRefs.length < 1) {
    throw new Error("Admin replay projection requires actorTurnRefs (≥1 real turn)");
  }
  if (record.privatePayloadRedacted !== true) {
    throw new Error("Admin replay projection requires privatePayloadRedacted=true");
  }
  if (record.claimBoundary !== "admin_replay_from_runtime_emission_not_clinical_validity") {
    throw new Error(
      `Unexpected claimBoundary: ${String(record.claimBoundary)}`,
    );
  }
  return value as AdminReplayFromEmissionV1;
}

export function EmissionReplayBindPanel({
  projection: controlledProjection,
}: EmissionReplayBindPanelProps): ReactElement {
  const [projection, setProjection] = useState<AdminReplayFromEmissionV1>(
    controlledProjection ?? SAMPLE_ADMIN_REPLAY_FROM_EMISSION_V1,
  );
  const [source, setSource] = useState<EmissionReplayProjectionSource>("embedded_sample");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingCli, setLoadingCli] = useState(false);

  const safe = parseAdminReplayFromEmissionV1(projection);

  async function loadCliLatest(): Promise<void> {
    setLoadingCli(true);
    setLoadError(null);
    try {
      const response = await fetch(CLI_LATEST_FIXTURE_URL);
      if (!response.ok) {
        throw new Error(`Failed to load CLI latest fixture (HTTP ${response.status})`);
      }
      const json: unknown = await response.json();
      const parsed = parseAdminReplayFromEmissionV1(json);
      setProjection(parsed);
      setSource("cli_latest_fixture");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingCli(false);
    }
  }

  useEffect(() => {
    if (controlledProjection === undefined) {
      void loadCliLatest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onUserFileSelected(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setLoadError(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? "");
        const json: unknown = JSON.parse(text);
        const parsed = parseAdminReplayFromEmissionV1(json);
        setProjection(parsed);
        setSource("user_file");
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : String(error));
      }
    };
    reader.onerror = () => {
      setLoadError(`Failed to read file: ${file.name}`);
    };
    reader.readAsText(file);
  }

  return (
    <section className="workbench-panel" aria-label="Runtime emission admin replay bind">
      <div className="workbench-title-row">
        <div>
          <Typography.Text className="eyebrow">Runtime emission → faculty replay (Q4)</Typography.Text>
          <Typography.Title level={4}>Emission Replay Bind</Typography.Title>
        </div>
        <Space wrap>
          <Tag color="cyan" aria-label="Turn source badge">
            turnSource={safe.turnSource}
          </Tag>
          <Tag color="blue" aria-label="Projection source badge">
            source={source}
          </Tag>
        </Space>
      </div>
      <Typography.Paragraph>
        Faculty review surface bound to real actor turns from{" "}
        <Typography.Text code>pnpm encounter:admin-replay-from-emission</Typography.Text>
        {" "}
        (<Typography.Text code>{safe.schemaVersion}</Typography.Text>
        ). Not seeds-only.
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary">
        Local review/replay projection only; this does not establish clinical validity, scoring validity,
        Quest readiness, or production readiness.
      </Typography.Paragraph>

      <Space wrap style={{ marginBottom: 12 }} aria-label="Emission projection load controls">
        <Button
          type="primary"
          loading={loadingCli}
          onClick={() => {
            void loadCliLatest();
          }}
          aria-label="Load CLI latest"
        >
          Load CLI latest
        </Button>
        <label>
          <Typography.Text type="secondary" style={{ marginRight: 8 }}>
            Load projection file
          </Typography.Text>
          <input
            type="file"
            accept="application/json,.json"
            aria-label="Load projection JSON file"
            onChange={onUserFileSelected}
          />
        </label>
      </Space>
      {loadError ? (
        <Alert
          type="error"
          showIcon
          message="Projection load failed"
          description={loadError}
          aria-label="Emission projection load error"
          style={{ marginBottom: 12 }}
        />
      ) : null}

      <div className="readiness-strip review-replay-strip" aria-label="Emission replay summary metrics">
        <EmissionReplayMetric
          label={safe.scenarioId}
          detail={safe.stationRunId}
        />
        <EmissionReplayMetric
          label={`${safe.actorTurnCount} real actor ${pluralize(safe.actorTurnCount, "turn")}`}
          detail={`${safe.timelineEntryCount} timeline ${pluralize(safe.timelineEntryCount, "entry")}`}
        />
        <EmissionReplayMetric
          label={safe.privatePayloadRedacted ? "Private payload redacted" : "Private payload visible"}
          detail="summary-only projection"
        />
        <EmissionReplayMetric
          label={`${safe.traceEventTypes.length} trace event types`}
          detail={safe.phase}
        />
      </div>

      <Typography.Text strong>Claim boundary</Typography.Text>
      <Typography.Paragraph type="secondary" aria-label="Emission replay claim boundary">
        {safe.claimBoundary}
      </Typography.Paragraph>
      <Typography.Text strong>Not evidence for</Typography.Text>
      <ul className="compact-list" aria-label="Emission replay not evidence for">
        {safe.notEvidenceFor.map((item) => (
          <li key={item}>
            <Typography.Text type="secondary">{item}</Typography.Text>
          </li>
        ))}
      </ul>

      <Typography.Text strong>Actor turn refs (runtime emission real turns)</Typography.Text>
      <ul className="compact-list" aria-label="Emission actor turn refs">
        {safe.actorTurnRefs.map((ref) => (
          <li key={ref}>
            <Typography.Text code>{ref}</Typography.Text>
          </li>
        ))}
      </ul>

      <Typography.Text strong>Timeline (summary-only; private payloads redacted)</Typography.Text>
      <ol className="compact-list" aria-label="Emission replay timeline">
        {safe.timeline.map((entry) => (
          <li key={`${entry.sequence}-${entry.eventType}`}>
            <Typography.Text>
              {`#${entry.sequence} @${entry.atSecond}s · ${entry.eventType} · ${entry.source}`}
              {entry.actorId ? ` · ${entry.actorId}` : ""}
              {entry.tag ? ` · ${entry.tag}` : ""}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ display: "block" }}>
              {entry.summary}
            </Typography.Text>
          </li>
        ))}
      </ol>

      <Typography.Text strong>Review packet summary (from emission)</Typography.Text>
      <div className="readiness-strip review-replay-strip" aria-label="Emission review packet summary">
        <EmissionReplayMetric
          label={`${safe.reviewPacket.eventCount} events`}
          detail={safe.reviewPacket.scenarioId}
        />
        <EmissionReplayMetric
          label={`${safe.reviewPacket.observedTraceTags.length} observed tags`}
          detail={safe.reviewPacket.observedTraceTags.join(", ") || "none"}
        />
        <EmissionReplayMetric
          label={`${safe.reviewPacket.missingRequiredTraceTags.length} missing required`}
          detail={safe.reviewPacket.missingRequiredTraceTags.join(", ") || "none"}
        />
      </div>

      <Typography.Paragraph type="secondary" aria-label="Emission private payload posture">
        privatePayloadRedacted={String(safe.privatePayloadRedacted)}; raw learner/actor payloads are not shown.
      </Typography.Paragraph>
    </section>
  );
}

function EmissionReplayMetric({ label, detail }: { label: string; detail: string }): ReactElement {
  return (
    <div className="readiness-metric">
      <Typography.Text strong>{label}</Typography.Text>
      <Typography.Text type="secondary">{detail}</Typography.Text>
    </div>
  );
}

function pluralize(count: number, noun: string): string {
  if (count === 1) {
    return noun;
  }
  if (noun === "entry") {
    return "entries";
  }
  return `${noun}s`;
}
