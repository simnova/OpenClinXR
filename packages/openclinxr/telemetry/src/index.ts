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

export type TelemetryRecorder = {
  recordSpan: (span: TelemetrySpanRecord) => Promise<void> | void;
};

export type InMemoryTelemetryRecorder = TelemetryRecorder & {
  spans: () => TelemetrySpanRecord[];
  clear: () => void;
};

const allowedInputKeys = Object.keys(telemetryAttributeNames) as Array<keyof typeof telemetryAttributeNames>;

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

export function createNoopTelemetryRecorder(): TelemetryRecorder {
  return {
    recordSpan: () => undefined,
  };
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
