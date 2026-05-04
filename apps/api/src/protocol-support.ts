export type OpenClinXrApiRuntimeTarget = "bun-hono" | "node-hono" | "azure-functions-node";

export type OpenClinXrRealtimeProtocolId =
  | "http-rest"
  | "admin-graphql"
  | "websocket"
  | "webtransport"
  | "quic"
  | "web3-signaling";

export type OpenClinXrApiProtocolStatus = "ready" | "planned" | "blocked";

export type OpenClinXrApiProtocolSupport = {
  protocolId: OpenClinXrRealtimeProtocolId;
  status: OpenClinXrApiProtocolStatus;
  runtimeTarget: OpenClinXrApiRuntimeTarget;
  path?: `/${string}`;
  blockers: string[];
  notes: string;
};

export type OpenClinXrApiProtocolPosture = {
  primaryRuntimeTarget: "bun-hono";
  localFallbackRuntimeTarget: "node-hono";
  azureRuntimeTarget: "azure-functions-node";
  protocols: OpenClinXrApiProtocolSupport[];
};

export function createOpenClinXrApiProtocolPosture(input: {
  bunHttp3WebTransportVerified?: boolean;
  quicGatewayImplemented?: boolean;
  web3SignalingProtocolSelected?: boolean;
} = {}): OpenClinXrApiProtocolPosture {
  return {
    primaryRuntimeTarget: "bun-hono",
    localFallbackRuntimeTarget: "node-hono",
    azureRuntimeTarget: "azure-functions-node",
    protocols: [
      {
        protocolId: "http-rest",
        status: "ready",
        runtimeTarget: "bun-hono",
        path: "/",
        blockers: [],
        notes: "Hono fetch handlers are runtime-portable and remain the main public API surface.",
      },
      {
        protocolId: "admin-graphql",
        status: "ready",
        runtimeTarget: "bun-hono",
        path: "/admin/graphql",
        blockers: [],
        notes: "Apollo-style GraphQL contracts run through the same Hono application boundary.",
      },
      {
        protocolId: "websocket",
        status: "ready",
        runtimeTarget: "bun-hono",
        path: "/voice/realtime/ws",
        blockers: [],
        notes: "Realtime audio starts WebSocket-first; Node/Hono remains the local fallback until Bun is installed here.",
      },
      {
        protocolId: "webtransport",
        status: input.bunHttp3WebTransportVerified ? "ready" : "blocked",
        runtimeTarget: "bun-hono",
        path: "/voice/realtime/webtransport",
        blockers: input.bunHttp3WebTransportVerified ? [] : ["bun_http3_webtransport_not_verified", "quest_webtransport_path_not_verified"],
        notes: "Keep WebTransport behind evidence until Bun HTTP/3 and Quest browser/client support are measured end to end.",
      },
      {
        protocolId: "quic",
        status: input.quicGatewayImplemented ? "ready" : "planned",
        runtimeTarget: "bun-hono",
        blockers: input.quicGatewayImplemented ? [] : ["quic_gateway_not_implemented", "azure_quic_ingress_not_verified"],
        notes: "QUIC is a target transport lane for latency-sensitive audio once the gateway path is concrete.",
      },
      {
        protocolId: "web3-signaling",
        status: input.web3SignalingProtocolSelected ? "ready" : "planned",
        runtimeTarget: "bun-hono",
        blockers: input.web3SignalingProtocolSelected ? [] : ["web3_identity_and_signaling_protocol_not_selected"],
        notes: "Web3 support is limited to future identity/signaling contracts and is not part of the clinical voice path yet.",
      },
    ],
  };
}
