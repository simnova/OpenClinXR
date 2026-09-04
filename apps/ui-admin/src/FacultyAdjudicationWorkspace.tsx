/// <reference lib="dom" />
import { Alert, Button, Input, Space, Spin, Tag, Typography } from "antd";
import { type ReactElement, useEffect, useRef, useState } from "react";
import {
  type AdminAssembledExamReplayProjection,
  type AdminAssembledExamStationReplaySlice,
  ASSEMBLED_EXAM_PHASE_BY_TYPE,
  ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES,
  AssembledExamReplayTimeline,
  assembledExamStationReplayPosture,
} from "./AssembledExamReplayTimeline.js";
import {
  assembledExamReviewNotEvidenceFor,
  type AssembledExamReviewPacket,
} from "@openclinxr/review-workflow";
import { defaultAdminApiBaseUrl } from "./api-client.js";

export type AdminAssembledExamReviewPacket = AssembledExamReviewPacket;

export const ADMIN_ASSEMBLED_EXAM_REVIEW_PACKET_PATH = "/exam-runs/:examRunId/assembled-review-packet";

export function assembledExamReviewPacketPath(examRunId: string): string {
  return `/exam-runs/${encodeURIComponent(examRunId)}/assembled-review-packet`;
}

export const FACULTY_ADJUDICATION_DISPOSITIONS = [
  "hold_for_debrief",
  "ready_for_debrief",
  "needs_station_evidence",
] as const;

export type FacultyAdjudicationDisposition = (typeof FACULTY_ADJUDICATION_DISPOSITIONS)[number];

export type AdminFacultyAdjudicationDispositionRecord = {
  examRunId: string;
  disposition: FacultyAdjudicationDisposition;
  scoringValidityClaimed: false;
  examEquivalenceGate: false;
  clinicalValidityClaimed: false;
  claimBoundary: "faculty_adjudication_disposition_not_score_use_or_clinical_validity";
  notEvidenceFor: readonly string[];
};

export const FACULTY_ADJUDICATION_CLAIM_BOUNDARY =
  "faculty_adjudication_workspace_not_score_use_or_clinical_validity" as const;

export const FACULTY_ADJUDICATION_DISPOSITION_CLAIM_BOUNDARY =
  "faculty_adjudication_disposition_not_score_use_or_clinical_validity" as const;

const DISPOSITION_LABEL: Record<FacultyAdjudicationDisposition, string> = {
  hold_for_debrief: "Hold for debrief",
  ready_for_debrief: "Ready for debrief",
  needs_station_evidence: "Needs station evidence",
};

export type FacultyAdjudicationWorkspaceProps = {
  examRunId?: string;
  loadPacket?: (examRunId: string) => Promise<unknown>;
  onLoadExamRun?: (examRunId: string) => void;
};

type WorkspaceState =
  | { status: "idle" }
  | { status: "loading"; examRunId: string }
  | { status: "error"; examRunId: string; message: string }
  | { status: "ready"; examRunId: string; packet: AdminAssembledExamReviewPacket };

export function actorTurnDurableRef(stationRunId: string, planId: string): string {
  return `durable://station-runs/${stationRunId}/actor-turns/${planId}`;
}

export function patientNoteDurableRef(stationRunId: string, submittedAtSecond: number): string {
  return `durable://station-runs/${stationRunId}/patient-notes/${submittedAtSecond}`;
}

export function assembledExamStationReplaySliceFromPacketStation(
  station: AdminAssembledExamReviewPacket["stations"][number],
): AdminAssembledExamStationReplaySlice {
  return {
    examRunId: station.identity.examRunId,
    stationRunId: station.identity.stationRunId,
    scenarioId: station.identity.scenarioId,
    stationOrder: station.identity.stationOrder,
    advanceReason: station.advanceReason,
    blockers: station.blockers,
    omissions: station.omissions,
    patientNoteSubmitted: station.patientNoteSubmitted,
    phaseTransitions: station.phaseTransitions.map((event) => ({
      ...event,
      advanceReason: event.eventType === "station.advanced" ? event.advanceReason : null,
    })),
  };
}

export function assembledExamReplayProjectionFromReviewPacket(
  packet: AdminAssembledExamReviewPacket,
): AdminAssembledExamReplayProjection {
  const stations = packet.stations.map(assembledExamStationReplaySliceFromPacketStation);
  return {
    schemaVersion: "openclinxr.assembled-exam-replay-projection.v1",
    examRunId: packet.examRunId,
    stations,
    claimBoundary: "summary_only_assembled_exam_phase_timeline_not_score_use_or_clinical_validity",
    examEquivalenceGate: false,
    scoringValidityClaimed: false,
    clinicalValidityClaimed: false,
    rawPayloadDisplayed: false,
    notEvidenceFor: packet.notEvidenceFor,
  };
}

type AssembledExamReviewPacketFetcher = (
  input: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const ASSEMBLED_PACKET_CLAIM_BOUNDARY = "assembled_exam_review_packet_not_exam_equivalence";
const REQUIRED_NOT_EVIDENCE_FOR = assembledExamReviewNotEvidenceFor;
const PHASE_TYPES = ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES;

export function parseAssembledExamReviewPacket(
  value: unknown,
  expectedExamRunId: string,
): AdminAssembledExamReviewPacket {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    throw new Error("assembled_exam_review_packet_invalid:empty_object");
  }
  const examRunId = nonemptyString(value["examRunId"]);
  if (!examRunId || examRunId !== expectedExamRunId.trim()) {
    throw new Error("stale_identity:exam_run_mismatch");
  }
  if (value["claimBoundary"] !== ASSEMBLED_PACKET_CLAIM_BOUNDARY) {
    throw new Error("assembled_exam_review_packet_invalid:claim_boundary");
  }
  if (value["examEquivalenceGate"] !== false) {
    throw new Error("assembled_exam_review_packet_invalid:exam_equivalence_gate");
  }
  if (value["scoringValidityClaimed"] === true || value["clinicalValidityClaimed"] === true) {
    throw new Error("assembled_exam_review_packet_invalid:claim_boundary");
  }
  const omissions = stringArray(value["omissions"]);
  const notEvidenceFor = stringArray(value["notEvidenceFor"]);
  if (!omissions || !notEvidenceFor) {
    throw new Error("assembled_exam_review_packet_invalid:empty_object");
  }
  for (const flag of REQUIRED_NOT_EVIDENCE_FOR) {
    if (!notEvidenceFor.includes(flag)) {
      throw new Error("assembled_exam_review_packet_invalid:claim_boundary");
    }
  }
  const stations = value["stations"];
  if (!Array.isArray(stations)) {
    throw new Error("assembled_exam_review_packet_invalid:malformed_station");
  }
  for (const station of stations) {
    parseStation(station, examRunId);
  }
  return value as AdminAssembledExamReviewPacket;
}

function parseStation(station: unknown, examRunId: string): void {
  if (!isRecord(station)) {
    throw new Error("assembled_exam_review_packet_invalid:malformed_station");
  }
  const identity = station["identity"];
  if (!isRecord(identity)) {
    throw new Error("assembled_exam_review_packet_invalid:malformed_station");
  }
  if (
    nonemptyString(identity["examRunId"]) !== examRunId
    || !nonemptyString(identity["stationRunId"])
    || !nonemptyString(identity["scenarioId"])
    || !isNonNegativeInteger(identity["stationOrder"])
  ) {
    throw new Error("assembled_exam_review_packet_invalid:malformed_station");
  }
  if (typeof station["patientNoteSubmitted"] !== "boolean") {
    throw new Error("assembled_exam_review_packet_invalid:malformed_station");
  }
  if (station["advanceReason"] !== null && typeof station["advanceReason"] !== "string") {
    throw new Error("assembled_exam_review_packet_invalid:malformed_station");
  }
  if (!stringArray(station["blockers"]) || !stringArray(station["omissions"])) {
    throw new Error("assembled_exam_review_packet_invalid:malformed_station");
  }
  const transitions = station["phaseTransitions"];
  if (!Array.isArray(transitions)) {
    throw new Error("assembled_exam_review_packet_invalid:malformed_station");
  }
  for (const event of transitions) {
    parsePhaseTransition(event);
  }
  const reviewPacket = station["reviewPacket"];
  if (!isRecord(reviewPacket)) {
    throw new Error("assembled_exam_review_packet_invalid:malformed_station");
  }
  parsePatientNote(reviewPacket["patientNote"]);
  parseActorTurnReplays(reviewPacket["actorTurnReplays"]);
}

function parsePhaseTransition(event: unknown): void {
  if (!isRecord(event)) {
    throw new Error("assembled_exam_review_packet_invalid:malformed_station");
  }
  const eventType = event["eventType"];
  if (typeof eventType !== "string" || !(PHASE_TYPES as readonly string[]).includes(eventType)) {
    throw new Error("assembled_exam_review_packet_invalid:malformed_station");
  }
  const expectedPhase = ASSEMBLED_EXAM_PHASE_BY_TYPE[eventType as keyof typeof ASSEMBLED_EXAM_PHASE_BY_TYPE];
  if (
    event["phase"] !== expectedPhase
    || !isNonNegativeInteger(event["sequence"])
    || !isNonNegativeInteger(event["atSecond"])
    || !isNonNegativeInteger(event["formAtSecond"])
    || !nonemptyString(event["durableEventRef"])
    || (event["advanceReason"] !== null && typeof event["advanceReason"] !== "string")
  ) {
    throw new Error("assembled_exam_review_packet_invalid:malformed_station");
  }
}

function parsePatientNote(note: unknown): void {
  if (note === null || note === undefined) {
    return;
  }
  if (
    !isRecord(note)
    || !isNonNegativeInteger(note["submittedAtSecond"])
    || typeof note["text"] !== "string"
  ) {
    throw new Error("assembled_exam_review_packet_invalid:malformed_station");
  }
}

function parseActorTurnReplays(replays: unknown): void {
  if (!Array.isArray(replays)) {
    throw new Error("assembled_exam_review_packet_invalid:malformed_station");
  }
  for (const replay of replays) {
    if (!isRecord(replay) || !nonemptyString(replay["planId"]) || !nonemptyString(replay["turnId"]) || typeof replay["caption"] !== "string") {
      throw new Error("assembled_exam_review_packet_invalid:malformed_station");
    }
    const plan = replay["plan"];
    if (!isRecord(plan) || !nonemptyString(plan["actorId"])) {
      throw new Error("assembled_exam_review_packet_invalid:malformed_station");
    }
    const execution = replay["execution"];
    if (execution === null) {
      continue;
    }
    if (!isRecord(execution) || !isRecord(execution["interruption"]) || typeof execution["interruption"]["kind"] !== "string") {
      throw new Error("assembled_exam_review_packet_invalid:malformed_station");
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonemptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export async function fetchAssembledExamReviewPacket(
  examRunId: string,
  options: {
    baseUrl?: string;
    fetch?: AssembledExamReviewPacketFetcher;
    headers?: Record<string, string>;
  } = {},
): Promise<AdminAssembledExamReviewPacket> {
  const trimmed = examRunId.trim();
  if (!trimmed) {
    throw new Error("examRunId_required");
  }
  const fetcher = options.fetch ?? (globalThis.fetch as AssembledExamReviewPacketFetcher);
  const baseUrl = (options.baseUrl ?? defaultAdminApiBaseUrl).replace(/\/$/, "");
  const path = assembledExamReviewPacketPath(trimmed);
  const response = await fetcher(`${baseUrl}${path}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`assembled_exam_review_packet_fetch_failed:${response.status}`);
  }
  return parseAssembledExamReviewPacket(await response.json(), trimmed);
}

export function FacultyAdjudicationWorkspace({
  examRunId = "",
  loadPacket,
  onLoadExamRun,
}: FacultyAdjudicationWorkspaceProps): ReactElement {
  const [examRunIdInput, setExamRunIdInput] = useState(examRunId);
  const [requestedExamRunId, setRequestedExamRunId] = useState(examRunId.trim());
  const [state, setState] = useState<WorkspaceState>(examRunId.trim() ? { status: "loading", examRunId: examRunId.trim() } : { status: "idle" });
  const [disposition, setDisposition] = useState<AdminFacultyAdjudicationDispositionRecord | null>(null);
  const loadPacketRef = useRef(loadPacket);
  loadPacketRef.current = loadPacket;

  useEffect(() => {
    setExamRunIdInput(examRunId);
    if (examRunId.trim()) {
      setRequestedExamRunId(examRunId.trim());
    }
  }, [examRunId]);

  useEffect(() => {
    const trimmed = requestedExamRunId.trim();
    setDisposition(null);
    if (!trimmed) {
      setState({ status: "idle" });
      return;
    }

    let active = true;
    setState({ status: "loading", examRunId: trimmed });
    const loader = loadPacketRef.current ?? ((id: string) => fetchAssembledExamReviewPacket(id));
    loader(trimmed)
      .then((raw) => {
        if (!active) {
          return;
        }
        const packet = parseAssembledExamReviewPacket(raw, trimmed);
        setState({ status: "ready", examRunId: trimmed, packet: Object.freeze(packet) });
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            status: "error",
            examRunId: trimmed,
            message: error instanceof Error ? error.message : "Unknown assembled exam review packet error",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [requestedExamRunId]);

  const submitExamRun = () => {
    const trimmed = examRunIdInput.trim();
    if (!trimmed) {
      return;
    }
    onLoadExamRun?.(trimmed);
    setRequestedExamRunId(trimmed);
  };

  const recordDisposition = (next: FacultyAdjudicationDisposition) => {
    if (state.status !== "ready") {
      return;
    }
    setDisposition({
      examRunId: state.packet.examRunId,
      disposition: next,
      scoringValidityClaimed: false,
      examEquivalenceGate: false,
      clinicalValidityClaimed: false,
      claimBoundary: FACULTY_ADJUDICATION_DISPOSITION_CLAIM_BOUNDARY,
      notEvidenceFor: state.packet.notEvidenceFor,
    });
  };

  const packet = state.status === "ready" ? state.packet : null;
  const projection = packet ? assembledExamReplayProjectionFromReviewPacket(packet) : null;
  const examBlockers = packet ? uniquePreserve([
    ...packet.omissions,
    ...packet.stations.flatMap((station) => [...station.blockers, ...station.omissions]),
  ]) : [];

  return (
    <section className="workbench-panel" aria-label="Faculty adjudication workspace">
      <div className="workbench-title-row">
        <div>
          <Typography.Text className="eyebrow">Immutable assembled-exam packet</Typography.Text>
          <Typography.Title level={4}>Faculty Adjudication Workspace</Typography.Title>
        </div>
        <Tag color="gold">Summary-only faculty review</Tag>
      </div>
      <Typography.Paragraph type="secondary">
        One assembled exam run. Ordered station status, canonical encounter-to-note transitions, submitted notes,
        and actor plan/execution provenance with durable refs. Private trace payloads are not displayed.
        This does not approve score use, clinical validity, exam equivalence, or Quest readiness.
      </Typography.Paragraph>
      <Space wrap>
        <Input
          aria-label="Assembled exam run ID"
          id="faculty-adjudication-exam-run-id"
          name="examRunId"
          value={examRunIdInput}
          onChange={(event) => setExamRunIdInput(event.currentTarget.value)}
          onPressEnter={submitExamRun}
        />
        <Button type="primary" onClick={submitExamRun} disabled={examRunIdInput.trim().length === 0}>
          Load assembled packet
        </Button>
      </Space>

      {state.status === "idle" ? (
        <Alert
          type="info"
          title="Assembled exam run required"
          description="Enter an exam run ID to fetch the immutable assembled-review-packet from the production API."
          showIcon
        />
      ) : null}
      {state.status === "loading" ? <Spin /> : null}
      {state.status === "error" ? (
        <Alert type="error" title="Assembled exam review packet unavailable" description={state.message} showIcon />
      ) : null}

      {packet && projection ? (
        <>
          <fieldset className="readiness-strip review-replay-strip" aria-label="Assembled exam packet claim boundary">
            <div className="readiness-metric">
              <Typography.Text strong>{packet.examRunId}</Typography.Text>
              <Typography.Text type="secondary">{packet.claimBoundary}</Typography.Text>
            </div>
            <div className="readiness-metric">
              <Typography.Text strong>{FACULTY_ADJUDICATION_CLAIM_BOUNDARY}</Typography.Text>
              <Typography.Text type="secondary">{`examEquivalenceGate ${String(packet.examEquivalenceGate)}; scoring false; clinical false`}</Typography.Text>
            </div>
            <div className="readiness-metric">
              <Typography.Text strong>{`${packet.stations.length} stations in assembled order`}</Typography.Text>
              <Typography.Text type="secondary">{`not evidence for ${packet.notEvidenceFor.join(", ")}`}</Typography.Text>
            </div>
          </fieldset>

          <Typography.Text strong>Ordered station status</Typography.Text>
          <ol className="compact-list" aria-label="Ordered station status">
            {[...packet.stations]
              .sort((left, right) => left.identity.stationOrder - right.identity.stationOrder)
              .map((station) => {
                const slice = assembledExamStationReplaySliceFromPacketStation(station);
                const posture = assembledExamStationReplayPosture(slice);
                return (
                  <li key={station.identity.stationRunId}>
                    <Typography.Text>{`Station ${station.identity.stationOrder}: ${station.identity.scenarioId}`}</Typography.Text>
                    <Typography.Text type="secondary">
                      {`${station.identity.stationRunId}; ${posture}; note ${station.patientNoteSubmitted ? "submitted" : "missing"}`}
                    </Typography.Text>
                  </li>
                );
              })}
          </ol>

          <AssembledExamReplayTimeline projection={projection} />

          <section aria-label="Submitted notes">
            <Typography.Text strong>Submitted notes</Typography.Text>
            <ul className="compact-list" aria-label="Submitted patient notes">
              {packet.stations.map((station) => {
                const note = station.reviewPacket.patientNote;
                return (
                  <li key={`note:${station.identity.stationRunId}`}>
                    {note ? (
                      <>
                        <Typography.Text>{`Station ${station.identity.stationOrder} note submitted at ${note.submittedAtSecond}s`}</Typography.Text>
                        <Typography.Paragraph>{note.text}</Typography.Paragraph>
                        <Typography.Text type="secondary">{patientNoteDurableRef(station.identity.stationRunId, note.submittedAtSecond)}</Typography.Text>
                      </>
                    ) : (
                      <Typography.Text>{`Station ${station.identity.stationOrder} patient note missing`}</Typography.Text>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-label="Actor plan and execution provenance">
            <Typography.Text strong>Actor plan and execution provenance</Typography.Text>
            <Typography.Paragraph type="secondary">
              Plan is committed intent; execution is what rendered. Captions use the faculty-safe spoken text, not TTS markup.
              Private trace payloads are not displayed.
            </Typography.Paragraph>
            <ul className="compact-list" aria-label="Actor turn provenance">
              {packet.stations.flatMap((station) =>
                station.reviewPacket.actorTurnReplays.length > 0
                  ? station.reviewPacket.actorTurnReplays.map((replay) => (
                    <li key={`${station.identity.stationRunId}:${replay.planId}:${replay.turnId}`}>
                      <Typography.Text>{`Station ${station.identity.stationOrder} ${replay.plan.actorId}`}</Typography.Text>
                      <Typography.Text type="secondary">
                        {`plan ${replay.planId}; execution ${replay.execution ? replay.execution.interruption.kind : "missing"}; caption ${replay.caption}`}
                      </Typography.Text>
                      <Typography.Text type="secondary">{actorTurnDurableRef(station.identity.stationRunId, replay.planId)}</Typography.Text>
                    </li>
                  ))
                  : [
                    <li key={`actor-missing:${station.identity.stationRunId}`}>
                      <Typography.Text>{`Station ${station.identity.stationOrder} no actor-turn provenance`}</Typography.Text>
                    </li>,
                  ],
              )}
            </ul>
          </section>

          <Typography.Text strong>Blockers and omissions</Typography.Text>
          <ul className="compact-list" aria-label="Assembled exam blockers and omissions">
            {examBlockers.length > 0 ? examBlockers.map((blocker) => (
              <li key={blocker}>
                <Typography.Text>{blocker}</Typography.Text>
              </li>
            )) : (
              <li>
                <Typography.Text>no_assembled_exam_blockers_or_omissions</Typography.Text>
              </li>
            )}
          </ul>

          <section aria-label="Faculty review disposition">
            <Typography.Text strong>Faculty review disposition</Typography.Text>
            <Typography.Paragraph type="secondary">
              Local faculty adjudication only. scoringValidityClaimed remains false. examEquivalenceGate remains false.
              This is not score use, clinical validity, or exam equivalence.
            </Typography.Paragraph>
            <Space wrap>
              {FACULTY_ADJUDICATION_DISPOSITIONS.map((value) => (
                <Button
                  key={value}
                  aria-label={`Record disposition ${value}`}
                  type={disposition?.disposition === value ? "primary" : "default"}
                  onClick={() => recordDisposition(value)}
                >
                  {DISPOSITION_LABEL[value]}
                </Button>
              ))}
            </Space>
            {disposition ? (
              <Typography.Paragraph aria-label="Recorded faculty disposition">
                {`${disposition.disposition}; scoringValidityClaimed ${String(disposition.scoringValidityClaimed)}; examEquivalenceGate ${String(disposition.examEquivalenceGate)}; clinicalValidityClaimed ${String(disposition.clinicalValidityClaimed)}; ${disposition.claimBoundary}`}
              </Typography.Paragraph>
            ) : null}
          </section>
        </>
      ) : null}
    </section>
  );
}

function uniquePreserve(values: readonly string[]): string[] {
  return [...new Set(values)];
}
