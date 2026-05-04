export const openClinXrSpanNames = {
  apiRoute: "openclinxr.api.route",
  graphqlOperation: "openclinxr.graphql.operation",
  mongoTraceSnapshot: "openclinxr.mongo.trace_snapshot",
  modelGenerateActorResponse: "openclinxr.model.generate_actor_response",
  voiceSynthesize: "openclinxr.voice.synthesize",
  xrInteraction: "openclinxr.xr.interaction",
} as const;

export const telemetryAttributeNames = {
  scenarioId: "openclinxr.scenario_id",
  scenarioVersion: "openclinxr.scenario_version",
  stationRunId: "openclinxr.station_run_id",
  actorId: "openclinxr.actor_id",
  providerId: "openclinxr.provider_id",
  routeId: "openclinxr.route_id",
  routeSurface: "openclinxr.route_surface",
  stationRunScoped: "openclinxr.station_run_scoped",
  requestPolicyId: "openclinxr.request_policy_id",
  deviceProfile: "openclinxr.device_profile",
  guardrailStatus: "openclinxr.guardrail_status",
  graphqlOperationName: "openclinxr.graphql.operation_name",
} as const;

export type TelemetryAttributeInput = Partial<Record<keyof typeof telemetryAttributeNames, string | number | boolean>> & {
  learnerUtterance?: string;
  promptText?: string;
  hiddenFacts?: string[];
  patientNoteText?: string;
  rawAudioReference?: string;
};

export type SafeTelemetryAttributes = Record<(typeof telemetryAttributeNames)[keyof typeof telemetryAttributeNames], string | number | boolean>;

export type OpenClinXrSpanName = (typeof openClinXrSpanNames)[keyof typeof openClinXrSpanNames];

export type TelemetrySpanRecord = {
  name: OpenClinXrSpanName;
  attributes: Partial<SafeTelemetryAttributes>;
  durationMs: number;
  statusCode?: number;
  errorType?: string;
};

export type TelemetrySummaryLabelName = (typeof telemetrySummaryLabelNames)[number];

export type TelemetrySpanSummaryBucket = {
  name: OpenClinXrSpanName;
  labels: Partial<Record<TelemetrySummaryLabelName, string | number | boolean>>;
  count: number;
  errorCount: number;
  statusCodes: number[];
  durationMs: {
    avg: number;
    max: number;
    min: number;
    p95: number;
  };
};

export type TelemetrySpanSummary = {
  buckets: TelemetrySpanSummaryBucket[];
};

export type TelemetryRecorder = {
  recordSpan: (span: TelemetrySpanRecord) => Promise<void> | void;
};

export type InMemoryTelemetryRecorder = TelemetryRecorder & {
  spans: () => TelemetrySpanRecord[];
  clear: () => void;
};

const allowedInputKeys = Object.keys(telemetryAttributeNames) as Array<keyof typeof telemetryAttributeNames>;
const telemetrySummaryLabelNames = [
  telemetryAttributeNames.deviceProfile,
  telemetryAttributeNames.graphqlOperationName,
  telemetryAttributeNames.guardrailStatus,
  telemetryAttributeNames.providerId,
  telemetryAttributeNames.requestPolicyId,
  telemetryAttributeNames.routeId,
  telemetryAttributeNames.routeSurface,
  telemetryAttributeNames.stationRunScoped,
] as const;

export function telemetryRouteAttributes(input: TelemetryAttributeInput): Partial<SafeTelemetryAttributes> {
  return safeTelemetryAttributes(input);
}

export function safeTelemetryAttributes(input: TelemetryAttributeInput): Partial<SafeTelemetryAttributes> {
  const attributes: Partial<SafeTelemetryAttributes> = {};
  for (const key of allowedInputKeys) {
    const value = input[key];
    if (value !== undefined) {
      attributes[telemetryAttributeNames[key]] = value;
    }
  }
  return attributes;
}

export function summarizeTelemetrySpans(spans: TelemetrySpanRecord[]): TelemetrySpanSummary {
  const buckets = new Map<string, {
    name: OpenClinXrSpanName;
    labels: TelemetrySpanSummaryBucket["labels"];
    durations: number[];
    errorCount: number;
    statusCodes: Set<number>;
  }>();

  for (const span of spans) {
    const labels = telemetrySummaryLabels(span.attributes);
    const key = `${span.name}:${JSON.stringify(labels)}`;
    const bucket = buckets.get(key) ?? {
      name: span.name,
      labels,
      durations: [],
      errorCount: 0,
      statusCodes: new Set<number>(),
    };

    bucket.durations.push(span.durationMs);
    if (span.statusCode !== undefined) {
      bucket.statusCodes.add(span.statusCode);
    }
    if (span.errorType || (span.statusCode !== undefined && span.statusCode >= 500)) {
      bucket.errorCount += 1;
    }
    buckets.set(key, bucket);
  }

  return {
    buckets: [...buckets.values()]
      .map((bucket) => ({
        name: bucket.name,
        labels: bucket.labels,
        count: bucket.durations.length,
        errorCount: bucket.errorCount,
        statusCodes: [...bucket.statusCodes].sort((left, right) => left - right),
        durationMs: summarizeDurations(bucket.durations),
      }))
      .sort((left, right) => {
        const byName = left.name.localeCompare(right.name);
        return byName === 0 ? JSON.stringify(left.labels).localeCompare(JSON.stringify(right.labels)) : byName;
      }),
  };
}

export function createNoopTelemetryRecorder(): TelemetryRecorder {
  return {
    recordSpan: () => undefined,
  };
}

function telemetrySummaryLabels(
  attributes: Partial<SafeTelemetryAttributes>,
): TelemetrySpanSummaryBucket["labels"] {
  const labels: TelemetrySpanSummaryBucket["labels"] = {};
  for (const labelName of telemetrySummaryLabelNames) {
    const value = attributes[labelName];
    if (value !== undefined) {
      labels[labelName] = value;
    }
  }
  return labels;
}

function summarizeDurations(durations: number[]): TelemetrySpanSummaryBucket["durationMs"] {
  const sorted = [...durations].sort((left, right) => left - right);
  const total = sorted.reduce((sum, duration) => sum + duration, 0);

  return {
    avg: roundMetric(total / sorted.length),
    max: sorted.at(-1) ?? 0,
    min: sorted[0] ?? 0,
    p95: percentile(sorted, 0.95),
  };
}

function percentile(sortedValues: number[], percentileValue: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }
  const index = Math.max(0, Math.ceil(sortedValues.length * percentileValue) - 1);
  return sortedValues[index] ?? 0;
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

export function createInMemoryTelemetryRecorder(): InMemoryTelemetryRecorder {
  const records: TelemetrySpanRecord[] = [];

  return {
    recordSpan: (span) => {
      records.push({ ...span, attributes: { ...span.attributes } });
    },
    spans: () => records.map((span) => ({ ...span, attributes: { ...span.attributes } })),
    clear: () => {
      records.splice(0, records.length);
    },
  };
}
