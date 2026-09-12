import type {
  SamplingPlanActivationPersistFailure,
  SamplingPlanActivationPersistResult,
  SamplingPlanActivationRecord,
  SamplingPlanActivationSink,
} from "./sampling-plan-types.js";

export async function persistSamplingPlanActivation(
  sink: SamplingPlanActivationSink,
  record: SamplingPlanActivationRecord,
): Promise<SamplingPlanActivationPersistResult> {
  try {
    const result = await sink.saveActivationRecord(record);
    if (isPersistFailure(result)) {
      return { status: "refused", reason: result.reason };
    }
    return { status: "persisted", record };
  } catch (error) {
    return {
      status: "refused",
      reason: namedPersistFailure(error),
    };
  }
}

function isPersistFailure(value: unknown): value is SamplingPlanActivationPersistFailure {
  if (typeof value !== "object" || value === null) return false;
  if (!("ok" in value) || !("reason" in value)) return false;
  return value.ok === false && typeof value.reason === "string" && value.reason.trim().length > 0;
}

function namedPersistFailure(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return "sampling_plan_activation_persistence_failed";
}
