import type { Hono } from "hono";
import { hasFacultyAccess } from "@openclinxr/auth";
import {
  assembledExamReviewNotEvidenceFor,
  buildAssembledExamReviewPacket,
  type AssembledExamReviewPacket,
  type AssembledExamStationEvidenceInput,
  type BuildAssembledExamReviewPacketInput,
} from "@openclinxr/review-workflow";
import type { ApiAppContext } from "../api-app-context.js";
import { denyIfCannotReadStationRun } from "../api-route-support.js";
import type { ApiAppVariables } from "../api-types.js";
import { isRecord, parseStringArray } from "../api-support.js";
import {
  createScenarioRuntimeDurableStoreFromApiPersistence,
  type ApiRuntimeDurableStore,
} from "../runtime-durable-store.js";

/** Faculty assembled-exam review packet — one exam-run artifact, not a flattened station list. */
export const ASSEMBLED_EXAM_REVIEW_PACKET_PATH = "/exam-runs/:examRunId/assembled-review-packet";

type StaleIdentityReason = "exam_run_mismatch" | "learner_mismatch" | "station_run_mismatch";

export class AssembledExamDurableSaveError extends Error {
  readonly code = "durable_save_failed" as const;

  constructor(cause?: unknown) {
    super(cause instanceof Error ? cause.message : "durable_save_failed");
    this.name = "AssembledExamDurableSaveError";
  }
}

export function registerAssembledExamReviewRoutes(
  app: Hono<{ Variables: ApiAppVariables }>,
  ctx: ApiAppContext,
): void {
  const { persistence, sessionOwners, examRunOwners, assembledExamReviewPackets } = ctx;
  const durable = createScenarioRuntimeDurableStoreFromApiPersistence(persistence);

  app.post(ASSEMBLED_EXAM_REVIEW_PACKET_PATH, async (context) => {
    if (!hasFacultyAccess(context.get("identity"))) {
      return context.json({ error: "forbidden", reason: "faculty_role_required" }, 403);
    }

    const examRunId = context.req.param("examRunId")?.trim() ?? "";
    if (examRunId.length === 0) {
      return context.json({ error: "invalid_exam_run", reason: "examRunId_required" }, 400);
    }

    const body = (await context.req.json().catch(() => ({}))) as {
      examRunId?: unknown;
      learnerId?: unknown;
      stations?: unknown;
    };
    const bodyExamRunId = typeof body.examRunId === "string" ? body.examRunId.trim() : "";
    if (bodyExamRunId.length > 0 && bodyExamRunId !== examRunId) {
      return staleIdentity(context, "exam_run_mismatch");
    }

    const stations = parseStationEvidenceList(body.stations);
    if (!stations) {
      return context.json({ error: "invalid_body", reason: "stations_required" }, 400);
    }

    const learnerId = typeof body.learnerId === "string" ? body.learnerId : null;
    const stored = await loadAssembledExamReviewPacket(durable, assembledExamReviewPackets, examRunId);
    if (stored) {
      const mismatch = storedIdentityMismatch(stored, {
        examRunId,
        learnerId,
        stations,
      });
      if (mismatch) {
        return staleIdentity(context, mismatch);
      }
    }

    const actualStationRunIds = stations.map((station) => station.stationRunId);
    const ownershipDenied = denyStations(context.get("identity"), sessionOwners, actualStationRunIds);
    if (ownershipDenied) {
      return context.json(ownershipDenied.body, ownershipDenied.status);
    }

    try {
      const packet = buildAssembledExamReviewPacket({
        examRunId,
        ...(learnerId ? { learnerId } : {}),
        stations,
      } satisfies BuildAssembledExamReviewPacketInput);

      await persistAssembledExamReviewPacket(
        durable,
        assembledExamReviewPackets,
        examRunOwners,
        packet,
      );
      return context.json(packet, 201);
    } catch (error) {
      return assembledExamError(context, error);
    }
  });

  app.get(ASSEMBLED_EXAM_REVIEW_PACKET_PATH, async (context) => {
    if (!hasFacultyAccess(context.get("identity"))) {
      return context.json({ error: "forbidden", reason: "faculty_role_required" }, 403);
    }

    const examRunId = context.req.param("examRunId")?.trim() ?? "";
    if (examRunId.length === 0) {
      return context.json({ error: "invalid_exam_run", reason: "examRunId_required" }, 400);
    }

    const stored = await loadAssembledExamReviewPacket(durable, assembledExamReviewPackets, examRunId);
    if (!stored) {
      return context.json({ error: "assembled_exam_review_packet_not_found" }, 404);
    }
    if (stored.examRunId !== examRunId) {
      return staleIdentity(context, "exam_run_mismatch");
    }

    const requestedStationRunIds = parseOptionalStationRunIds(context.req.query("stationRunIds"));
    const storedStationRunIds = stored.stations.map((station) => station.identity.stationRunId);
    if (requestedStationRunIds && !sameStationRunIds(requestedStationRunIds, storedStationRunIds)) {
      return staleIdentity(context, "station_run_mismatch");
    }

    const ownershipDenied = denyStations(context.get("identity"), sessionOwners, storedStationRunIds);
    if (ownershipDenied) {
      return context.json(ownershipDenied.body, ownershipDenied.status);
    }

    const examOwner = examRunOwners.get(examRunId);
    if (examOwner) {
      const examOwnershipDenied = denyIfCannotReadStationRun(context.get("identity"), examRunOwners, examRunId);
      if (examOwnershipDenied) {
        return context.json(examOwnershipDenied.body, examOwnershipDenied.status);
      }
    }

    return context.json(stored);
  });
}

async function persistAssembledExamReviewPacket(
  durable: ApiRuntimeDurableStore,
  memory: Map<string, AssembledExamReviewPacket>,
  examRunOwners: Map<string, string>,
  packet: AssembledExamReviewPacket,
): Promise<void> {
  try {
    await durable.saveAssembledExamReviewPacket(packet.examRunId, packet);
  } catch (error) {
    throw new AssembledExamDurableSaveError(error);
  }
  memory.set(packet.examRunId, packet);
  if (packet.learnerId) {
    examRunOwners.set(packet.examRunId, packet.learnerId);
  }
}

async function loadAssembledExamReviewPacket(
  durable: ApiRuntimeDurableStore,
  memory: Map<string, AssembledExamReviewPacket>,
  examRunId: string,
): Promise<AssembledExamReviewPacket | undefined> {
  const fromSink = await durable.getAssembledExamReviewPacket(examRunId);
  return fromSink ?? memory.get(examRunId);
}

function storedIdentityMismatch(
  stored: AssembledExamReviewPacket,
  incoming: {
    examRunId: string;
    learnerId: string | null;
    stations: readonly AssembledExamStationEvidenceInput[];
  },
): StaleIdentityReason | undefined {
  if (stored.examRunId !== incoming.examRunId) {
    return "exam_run_mismatch";
  }
  if ((stored.learnerId ?? null) !== incoming.learnerId) {
    return "learner_mismatch";
  }
  const storedStations = stored.stations.map((station) => ({
    stationRunId: station.identity.stationRunId,
    scenarioId: station.identity.scenarioId,
    stationOrder: station.identity.stationOrder,
  }));
  const incomingStations = [...incoming.stations]
    .map((station) => ({
      stationRunId: station.stationRunId,
      scenarioId: station.scenarioId,
      stationOrder: station.stationOrder,
    }))
    .sort((left, right) => left.stationOrder - right.stationOrder);
  if (storedStations.length !== incomingStations.length) {
    return "station_run_mismatch";
  }
  for (let index = 0; index < storedStations.length; index += 1) {
    const left = storedStations[index];
    const right = incomingStations[index];
    if (
      !left
      || !right
      || left.stationRunId !== right.stationRunId
      || left.scenarioId !== right.scenarioId
      || left.stationOrder !== right.stationOrder
    ) {
      return "station_run_mismatch";
    }
  }
  return undefined;
}

function denyStations(
  identity: Parameters<typeof denyIfCannotReadStationRun>[0],
  sessionOwners: Map<string, string>,
  stationRunIds: readonly string[],
): ReturnType<typeof denyIfCannotReadStationRun> {
  for (const stationRunId of stationRunIds) {
    const denied = denyIfCannotReadStationRun(identity, sessionOwners, stationRunId);
    if (denied) {
      return denied;
    }
  }
  return undefined;
}

function staleIdentity(
  context: { json: (body: Record<string, unknown>, status: 409) => Response },
  reason: StaleIdentityReason,
): Response {
  return context.json({
    error: "stale_identity",
    reason,
    notEvidenceFor: [...assembledExamReviewNotEvidenceFor],
  }, 409);
}

function assembledExamError(
  context: {
    json: (body: Record<string, unknown>, status: 400 | 500) => Response;
  },
  error: unknown,
): Response {
  if (error instanceof AssembledExamDurableSaveError) {
    return context.json({
      error: "durable_save_failed",
      reason: error.message,
      notEvidenceFor: [...assembledExamReviewNotEvidenceFor],
    }, 500);
  }
  const message = error instanceof Error ? error.message : "assembled_exam_review_packet_invalid";
  const crossRun = /cross-run|provenance/.test(message);
  return context.json({
    error: crossRun ? "cross_run_identity" : "assembled_exam_review_packet_invalid",
    reason: message,
    notEvidenceFor: [...assembledExamReviewNotEvidenceFor],
  }, 400);
}

function parseOptionalStationRunIds(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "string") {
    const ids = value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
    return ids.length > 0 ? ids : undefined;
  }
  const ids = parseStringArray(value);
  return ids.length > 0 ? ids : undefined;
}

function sameStationRunIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((id, index) => id === right[index]);
}

function parseStationEvidenceList(value: unknown): AssembledExamStationEvidenceInput[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const stations: AssembledExamStationEvidenceInput[] = [];
  for (const item of value) {
    const station = parseStationEvidence(item);
    if (!station) {
      return undefined;
    }
    stations.push(station);
  }
  return stations;
}

function parseStationEvidence(value: unknown): AssembledExamStationEvidenceInput | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const stationRunId = typeof value["stationRunId"] === "string" ? value["stationRunId"] : "";
  const scenarioId = typeof value["scenarioId"] === "string" ? value["scenarioId"] : "";
  const stationOrder = value["stationOrder"];
  const facultyScoreDraft = value["facultyScoreDraft"];
  if (
    stationRunId.length === 0
    || scenarioId.length === 0
    || typeof stationOrder !== "number"
    || !isRecord(facultyScoreDraft)
    || typeof facultyScoreDraft["reviewerId"] !== "string"
    || facultyScoreDraft["status"] !== "draft"
    || typeof facultyScoreDraft["comments"] !== "string"
  ) {
    return undefined;
  }

  const requiredTraceTags = parseStringArray(value["requiredTraceTags"]);
  const traceEvents = Array.isArray(value["traceEvents"]) ? value["traceEvents"] : [];
  const phaseTransitions = Array.isArray(value["phaseTransitions"]) ? value["phaseTransitions"] : [];
  if (!traceEvents.every(isRecord) || !phaseTransitions.every(isRecord)) {
    return undefined;
  }

  const station: AssembledExamStationEvidenceInput = {
    stationRunId,
    scenarioId,
    stationOrder,
    requiredTraceTags,
    traceEvents: traceEvents as unknown as AssembledExamStationEvidenceInput["traceEvents"],
    phaseTransitions: phaseTransitions as unknown as AssembledExamStationEvidenceInput["phaseTransitions"],
    facultyScoreDraft: {
      reviewerId: facultyScoreDraft["reviewerId"],
      status: "draft",
      comments: facultyScoreDraft["comments"],
    },
  };

  const timeCritical = value["timeCriticalTraceTagThresholds"];
  if (isRecord(timeCritical)) {
    const thresholds: Record<string, number> = {};
    for (const [key, raw] of Object.entries(timeCritical)) {
      if (typeof raw === "number" && Number.isFinite(raw)) {
        thresholds[key] = raw;
      }
    }
    station.timeCriticalTraceTagThresholds = thresholds;
  }
  const patientNote = value["patientNote"];
  if (isRecord(patientNote) && typeof patientNote["stationRunId"] === "string" && typeof patientNote["text"] === "string") {
    station.patientNote = {
      stationRunId: patientNote["stationRunId"],
      submittedAtSecond: typeof patientNote["submittedAtSecond"] === "number" ? patientNote["submittedAtSecond"] : 0,
      text: patientNote["text"],
    };
  }
  if (Array.isArray(value["blockers"])) {
    station.blockers = parseStringArray(value["blockers"]);
  }
  const advanceReason = value["advanceReason"];
  if (typeof advanceReason === "string" || advanceReason === null) {
    station.advanceReason = advanceReason;
  }
  return station;
}
