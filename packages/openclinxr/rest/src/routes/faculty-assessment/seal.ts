import { createHash } from "node:crypto";
import type { ApiFacultyAssessmentRecord } from "../../runtime-durable-store.js";

export function sealedAssessmentIdFor(
  packetDigest: string,
  assessment: ApiFacultyAssessmentRecord,
): string {
  return createHash("sha256").update(canonicalJson({
    packetDigest,
    assessmentId: assessment.assessmentId,
    examRunId: assessment.examRunId,
    raterId: assessment.raterId,
    status: assessment.status,
    narrativeFeedback: assessment.narrativeFeedback,
    observations: assessment.observations,
  })).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}
