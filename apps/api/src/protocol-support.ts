export type OpenClinXrApiRuntimeTarget = "bun-hono" | "node-hono" | "azure-functions-node";

export type OpenClinXrRealtimeProtocolId =
  | "http-rest"
  | "admin-graphql"
  | "websocket"
  | "webtransport"
  | "quic"
  | "web3-signaling";

export type OpenClinXrApiProtocolStatus = "ready" | "contract_ready" | "planned" | "blocked";

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
  questWebTransportVerified?: boolean;
  quicGatewayDesignReviewed?: boolean;
  quicGatewayImplemented?: boolean;
  azureQuicIngressVerified?: boolean;
  web3SignalingDesignReviewed?: boolean;
  web3IdentityAndSignalingProtocolSelected?: boolean;
  web3SignalingProtocolSelected?: boolean;
} = {}): OpenClinXrApiProtocolPosture {
  const webTransportReady = Boolean(input.bunHttp3WebTransportVerified && input.questWebTransportVerified);
  const quicReady = Boolean(input.quicGatewayImplemented && input.azureQuicIngressVerified);
  const web3SignalingProtocolSelected = Boolean(
    input.web3IdentityAndSignalingProtocolSelected || input.web3SignalingProtocolSelected,
  );
  const web3SignalingReady = Boolean(input.web3SignalingDesignReviewed && web3SignalingProtocolSelected);

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
        status: "contract_ready",
        runtimeTarget: "bun-hono",
        path: "/voice/realtime/ws",
        blockers: ["api_bun_websocket_upgrade_not_implemented"],
        notes: "Realtime audio is WebSocket-first, but the verified bidirectional media path is still the mock gateway fallback until apps/api owns a Bun WebSocket upgrade handler.",
      },
      {
        protocolId: "webtransport",
        status: webTransportReady ? "ready" : "blocked",
        runtimeTarget: "bun-hono",
        path: "/voice/realtime/webtransport",
        blockers: [
          input.bunHttp3WebTransportVerified ? undefined : "bun_http3_webtransport_not_verified",
          input.questWebTransportVerified ? undefined : "quest_webtransport_path_not_verified",
        ].filter((blocker): blocker is string => typeof blocker === "string"),
        notes: "Keep WebTransport behind evidence until Bun HTTP/3 and Quest browser/client support are measured end to end.",
      },
      {
        protocolId: "quic",
        status: quicReady ? "ready" : "planned",
        runtimeTarget: "bun-hono",
        blockers: [
          input.quicGatewayDesignReviewed ? undefined : "operator_quic_gateway_proposal_missing",
          input.quicGatewayImplemented ? undefined : "quic_gateway_not_implemented",
          input.azureQuicIngressVerified ? undefined : "azure_quic_ingress_not_verified",
        ].filter((blocker): blocker is string => typeof blocker === "string"),
        notes: "QUIC is a target transport lane for latency-sensitive audio only after gateway design, implementation, and Azure ingress evidence are concrete.",
      },
      {
        protocolId: "web3-signaling",
        status: web3SignalingReady ? "ready" : "planned",
        runtimeTarget: "bun-hono",
        blockers: [
          input.web3SignalingDesignReviewed ? undefined : "operator_web3_signaling_proposal_missing",
          web3SignalingProtocolSelected ? undefined : "web3_identity_and_signaling_protocol_not_selected",
        ].filter((blocker): blocker is string => typeof blocker === "string"),
        notes: "web3 support stays scoped to identity/signaling contracts and is not part of the clinical voice media path.",
      },
    ],
  };
}
