import { describe, expect, it } from "vitest";
import {
  type AssembledExamPhaseTransitionType,
  buildAssembledExamReviewPacket,
  type AssembledExamReviewTraceInput,
  type AssembledExamStationEvidenceInput,
} from "../index.js";

const EXAM_RUN_ID = "exam_run_learner_phase_001_ed_chest_pain_priority_v1__peds_asthma_parent_anxiety_v1";
const ED_STATION_RUN_ID = "run_ed_001";
const PEDS_STATION_RUN_ID = "run_peds_001";
const ED_BUNDLE_ID = "bundle_ed_chest_pain_001";
const PEDS_BUNDLE_ID = "bundle_peds_asthma_001";
const ED_CONTENT_IDENTITY = "cid_ed_chest_pain_001";
const PEDS_CONTENT_IDENTITY = "cid_peds_asthma_001";

function durableEventRef(stationRunId: string, sequence: number): string {
  return `durable://station-runs/${stationRunId}/events/${sequence}`;
}

function phaseTransition(input: {
  stationRunId: string;
  scenarioId: string;
  stationOrder: number;
  eventType: AssembledExamPhaseTransitionType;
  sequence: number;
  atSecond: number;
  formAtSecond: number;
  phase: "encounter" | "note" | "complete";
  advanceReason?: string;
}): AssembledExamReviewTraceInput {
  return {
    stationRunId: input.stationRunId,
    sequence: input.sequence,
    eventType: input.eventType,
    source: "system",
    atSecond: input.atSecond,
    payload: {
      scenarioId: input.scenarioId,
      examRunId: EXAM_RUN_ID,
      stationOrder: input.stationOrder,
      phase: input.phase,
      formAtSecond: input.formAtSecond,
      durableEventRef: durableEventRef(input.stationRunId, input.sequence),
      ...(input.advanceReason ? { advanceReason: input.advanceReason } : {}),
    },
  };
}

function canonicalPhaseTransitions(input: {
  stationRunId: string;
  scenarioId: string;
  stationOrder: number;
  startSequence: number;
  advanceReason: string;
}): AssembledExamReviewTraceInput[] {
  const specs: Array<{
    eventType: AssembledExamPhaseTransitionType;
    atSecond: number;
    formAtSecond: number;
    phase: "encounter" | "note" | "complete";
    advanceReason?: string;
  }> = [
    { eventType: "encounter.started", atSecond: 60, formAtSecond: 60, phase: "encounter" },
    { eventType: "encounter.ended", atSecond: 900, formAtSecond: 900, phase: "encounter" },
    { eventType: "note.started", atSecond: 900, formAtSecond: 900, phase: "note" },
    { eventType: "note.submitted", atSecond: 1260, formAtSecond: 1260, phase: "note" },
    {
      eventType: "station.advanced",
      atSecond: 1260,
      formAtSecond: 1260,
      phase: "complete",
      advanceReason: input.advanceReason,
    },
  ];
  return specs.map((spec, index) =>
    phaseTransition({
      ...input,
      ...spec,
      sequence: input.startSequence + index,
    }),
  );
}

function pins() {
  return [
    {
      stationOrder: 1,
      scenarioId: "ed_chest_pain_priority_v1",
      bundleId: ED_BUNDLE_ID,
      contentIdentity: ED_CONTENT_IDENTITY,
    },
    {
      stationOrder: 2,
      scenarioId: "peds_asthma_parent_anxiety_v1",
      bundleId: PEDS_BUNDLE_ID,
      contentIdentity: PEDS_CONTENT_IDENTITY,
    },
  ];
}

function edStation(
  overrides: Partial<AssembledExamStationEvidenceInput> = {},
): AssembledExamStationEvidenceInput {
  return {
    stationRunId: ED_STATION_RUN_ID,
    scenarioId: "ed_chest_pain_priority_v1",
    stationOrder: 1,
    encounterBundle: { bundleId: ED_BUNDLE_ID, contentIdentity: ED_CONTENT_IDENTITY },
    requiredTraceTags: ["ecg_request", "patient_note_submitted"],
    traceEvents: [
      { stationRunId: ED_STATION_RUN_ID, sequence: 0, eventType: "station.started", source: "system", atSecond: 0 },
      { stationRunId: ED_STATION_RUN_ID, sequence: 7, eventType: "learner.order", source: "learner", tag: "ecg_request", atSecond: 200 },
      { stationRunId: ED_STATION_RUN_ID, sequence: 9, eventType: "note.submitted", source: "learner", tag: "patient_note_submitted", atSecond: 1260 },
    ],
    phaseTransitions: canonicalPhaseTransitions({
      stationRunId: ED_STATION_RUN_ID,
      scenarioId: "ed_chest_pain_priority_v1",
      stationOrder: 1,
      startSequence: 10,
      advanceReason: "patient_note_submitted_advancing",
    }),
    patientNote: {
      stationRunId: ED_STATION_RUN_ID,
      submittedAtSecond: 1260,
      text: "Concern for ACS. ECG requested.",
    },
    blockers: [],
    advanceReason: "patient_note_submitted_advancing",
    facultyScoreDraft: {
      reviewerId: "faculty_001",
      status: "draft",
      comments: "ED station review.",
    },
    ...overrides,
  };
}

function pedsStation(
  overrides: Partial<AssembledExamStationEvidenceInput> = {},
): AssembledExamStationEvidenceInput {
  return {
    stationRunId: PEDS_STATION_RUN_ID,
    scenarioId: "peds_asthma_parent_anxiety_v1",
    stationOrder: 2,
    encounterBundle: { bundleId: PEDS_BUNDLE_ID, contentIdentity: PEDS_CONTENT_IDENTITY },
    requiredTraceTags: ["patient_note_submitted"],
    traceEvents: [
      { stationRunId: PEDS_STATION_RUN_ID, sequence: 0, eventType: "station.started", source: "system", atSecond: 0 },
      { stationRunId: PEDS_STATION_RUN_ID, sequence: 9, eventType: "note.submitted", source: "learner", tag: "patient_note_submitted", atSecond: 1260 },
    ],
    phaseTransitions: canonicalPhaseTransitions({
      stationRunId: PEDS_STATION_RUN_ID,
      scenarioId: "peds_asthma_parent_anxiety_v1",
      stationOrder: 2,
      startSequence: 10,
      advanceReason: "last_station_note_submitted_exam_complete",
    }),
    patientNote: {
      stationRunId: PEDS_STATION_RUN_ID,
      submittedAtSecond: 1260,
      text: "Work of breathing assessed.",
    },
    blockers: [],
    advanceReason: "last_station_note_submitted_exam_complete",
    facultyScoreDraft: {
      reviewerId: "faculty_001",
      status: "draft",
      comments: "Peds station review.",
    },
    ...overrides,
  };
}

describe("assembled review packet binds stations to pinned bundles", () => {
  it("binds each station to its pinned encounter bundle", () => {
    const packet = buildAssembledExamReviewPacket({
      examRunId: EXAM_RUN_ID,
      learnerId: "learner_phase_001",
      stations: [edStation(), pedsStation()],
      encounterBundlePins: pins(),
    });

    expect(packet.stations).toHaveLength(2);
    expect(packet.stations[0]?.encounterBundle).toMatchObject({
      pinnedBundleId: ED_BUNDLE_ID,
      pinnedContentIdentity: ED_CONTENT_IDENTITY,
      runtimeBundleId: ED_BUNDLE_ID,
      runtimeContentIdentity: ED_CONTENT_IDENTITY,
      bound: true,
      mismatch: null,
    });
    expect(packet.stations[1]?.encounterBundle).toMatchObject({
      pinnedBundleId: PEDS_BUNDLE_ID,
      pinnedContentIdentity: PEDS_CONTENT_IDENTITY,
      runtimeBundleId: PEDS_BUNDLE_ID,
      runtimeContentIdentity: PEDS_CONTENT_IDENTITY,
      bound: true,
      mismatch: null,
    });
    expect(packet.omissions).not.toContain("substituted_encounter_bundle");
    expect(packet.omissions).not.toContain("missing_encounter_bundle_evidence");
  });

  it("COUNTERWEIGHT: stations without pins stay bound-free for the known-good path", () => {
    const packet = buildAssembledExamReviewPacket({
      examRunId: EXAM_RUN_ID,
      stations: [edStation(), pedsStation()],
    });
    expect(packet.stations[0]?.encounterBundle.mismatch).toBeNull();
    expect(packet.stations[0]?.omissions).toEqual([]);
    expect(packet.stations[1]?.omissions).toEqual([]);
  });

  it("marks a substituted bundle without refusing the packet", () => {
    const packet = buildAssembledExamReviewPacket({
      examRunId: EXAM_RUN_ID,
      stations: [
        edStation({
          encounterBundle: { bundleId: "bundle_substituted_999", contentIdentity: ED_CONTENT_IDENTITY },
        }),
        pedsStation(),
      ],
      encounterBundlePins: pins(),
    });
    expect(packet.stations[0]?.encounterBundle).toMatchObject({
      pinnedBundleId: ED_BUNDLE_ID,
      runtimeBundleId: "bundle_substituted_999",
      bound: false,
      mismatch: "substituted_bundle",
    });
    expect(packet.stations[0]?.encounterBundle.omissions).toContain("substituted_encounter_bundle");
    expect(packet.stations[0]?.omissions).toContain("substituted_encounter_bundle");
    expect(packet.omissions).toContain("substituted_encounter_bundle");
  });

  it("marks substituted content identity on the same bundle id", () => {
    const packet = buildAssembledExamReviewPacket({
      examRunId: EXAM_RUN_ID,
      stations: [
        edStation(),
        pedsStation({
          encounterBundle: { bundleId: PEDS_BUNDLE_ID, contentIdentity: "cid_tampered_999" },
        }),
      ],
      encounterBundlePins: pins(),
    });
    expect(packet.stations[1]?.encounterBundle).toMatchObject({
      pinnedBundleId: PEDS_BUNDLE_ID,
      runtimeContentIdentity: "cid_tampered_999",
      bound: false,
      mismatch: "substituted_bundle",
    });
    expect(packet.stations[1]?.omissions).toContain("substituted_encounter_bundle");
    expect(packet.omissions).toContain("substituted_encounter_bundle");
  });

  it("marks missing runtime bundle evidence without refusing the packet", () => {
    const ed = edStation();
    const { encounterBundle: _dropped, ...edWithoutBundle } = ed;
    const packet = buildAssembledExamReviewPacket({
      examRunId: EXAM_RUN_ID,
      stations: [edWithoutBundle, pedsStation()],
      encounterBundlePins: pins(),
    });
    expect(packet.stations[0]?.encounterBundle).toMatchObject({
      pinnedBundleId: ED_BUNDLE_ID,
      runtimeBundleId: null,
      bound: false,
      mismatch: "missing_runtime_bundle",
    });
    expect(packet.stations[0]?.encounterBundle.omissions).toContain("missing_encounter_bundle_evidence");
    expect(packet.stations[0]?.omissions).toContain("missing_encounter_bundle_evidence");
    expect(packet.omissions).toContain("missing_encounter_bundle_evidence");
  });

  it("marks a cross-station bundle swap without refusing the packet", () => {
    const packet = buildAssembledExamReviewPacket({
      examRunId: EXAM_RUN_ID,
      stations: [
        edStation({
          encounterBundle: { bundleId: PEDS_BUNDLE_ID, contentIdentity: PEDS_CONTENT_IDENTITY },
        }),
        pedsStation({
          encounterBundle: { bundleId: ED_BUNDLE_ID, contentIdentity: ED_CONTENT_IDENTITY },
        }),
      ],
      encounterBundlePins: pins(),
    });
    expect(packet.stations[0]?.encounterBundle).toMatchObject({
      bound: false,
      mismatch: "cross_station_bundle",
    });
    expect(packet.stations[1]?.encounterBundle).toMatchObject({
      bound: false,
      mismatch: "cross_station_bundle",
    });
    expect(packet.stations[0]?.omissions).toContain("cross_station_encounter_bundle");
    expect(packet.omissions).toContain("cross_station_encounter_bundle");
  });

  it("binds every station after a multi-station restart with the same pins and runtime evidence", () => {
    const packet = buildAssembledExamReviewPacket({
      examRunId: EXAM_RUN_ID,
      stations: [
        edStation({
          traceEvents: [
            { stationRunId: ED_STATION_RUN_ID, sequence: 0, eventType: "station.started", source: "system", atSecond: 0 },
            { stationRunId: ED_STATION_RUN_ID, sequence: 1, eventType: "station.started", source: "system", atSecond: 300 },
            { stationRunId: ED_STATION_RUN_ID, sequence: 7, eventType: "learner.order", source: "learner", tag: "ecg_request", atSecond: 400 },
            { stationRunId: ED_STATION_RUN_ID, sequence: 9, eventType: "note.submitted", source: "learner", tag: "patient_note_submitted", atSecond: 1260 },
          ],
        }),
        pedsStation(),
      ],
      encounterBundlePins: pins(),
    });
    expect(packet.stations[0]?.encounterBundle).toMatchObject({ bound: true, mismatch: null });
    expect(packet.stations[1]?.encounterBundle).toMatchObject({ bound: true, mismatch: null });
  });

  it("rejects pins that do not cover every station", () => {
    expect(() =>
      buildAssembledExamReviewPacket({
        examRunId: EXAM_RUN_ID,
        stations: [edStation(), pedsStation()],
        encounterBundlePins: pins().slice(0, 1),
      }),
    ).toThrow(/rejects substituted or missing encounter bundle/);
  });
});
