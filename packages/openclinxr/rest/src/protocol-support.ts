export type OpenClinXrApiRuntimeTarget = "bun-hono" | "node-hono" | "azure-functions-node";

export type OpenClinXrRealtimeProtocolId =
  | "http-rest"
  | "admin-graphql"
  | "websocket"
  | "webtransport"
  | "quic"
  | "web3-signaling";

export type OpenClinXrApiProtocolStatus = "ready" | "contract_ready" | "planned" | "blocked";
export type OpenClinXrApiProtocolClaimScope =
  | "runtime_ready"
  | "contract_only"
  | "evidence_gated_future_lane"
  | "identity_signaling_audit_only";

export type OpenClinXrApiProtocolSupport = {
  protocolId: OpenClinXrRealtimeProtocolId;
  status: OpenClinXrApiProtocolStatus;
  claimScope: OpenClinXrApiProtocolClaimScope;
  runtimeTarget: OpenClinXrApiRuntimeTarget;
  role: "control-plane" | "admin-graphql" | "media-transport" | "identity-signaling-audit";
  clinicalMediaAllowed: boolean;
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
  apiBunWebSocketRuntimeVerified?: boolean;
  bunHttp3WebTransportVerified?: boolean;
  questWebTransportVerified?: boolean;
  azureWebTransportIngressVerified?: boolean;
  quicGatewayDesignReviewed?: boolean;
  quicGatewayImplemented?: boolean;
  azureQuicIngressVerified?: boolean;
  web3SignalingDesignReviewed?: boolean;
  web3IdentityAndSignalingProtocolSelected?: boolean;
  web3SignalingProtocolSelected?: boolean;
} = {}): OpenClinXrApiProtocolPosture {
  const websocketReady = Boolean(input.apiBunWebSocketRuntimeVerified);
  const webTransportReady = Boolean(
    input.bunHttp3WebTransportVerified
      && input.questWebTransportVerified
      && input.azureWebTransportIngressVerified,
  );
  const quicReady = Boolean(input.quicGatewayDesignReviewed && input.quicGatewayImplemented && input.azureQuicIngressVerified);
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
        claimScope: "runtime_ready",
        runtimeTarget: "bun-hono",
        role: "control-plane",
        clinicalMediaAllowed: false,
        path: "/",
        blockers: [],
        notes: "Hono fetch handlers are runtime-portable and remain the main public API surface.",
      },
      {
        protocolId: "admin-graphql",
        status: "ready",
        claimScope: "runtime_ready",
        runtimeTarget: "bun-hono",
        role: "admin-graphql",
        clinicalMediaAllowed: false,
        path: "/admin/graphql",
        blockers: [],
        notes: "Apollo-style GraphQL contracts run through the same Hono application boundary.",
      },
      {
        protocolId: "websocket",
        status: websocketReady ? "ready" : "contract_ready",
        claimScope: websocketReady ? "runtime_ready" : "contract_only",
        runtimeTarget: "bun-hono",
        role: "media-transport",
        clinicalMediaAllowed: true,
        path: "/voice/realtime/ws",
        blockers: websocketReady ? [] : ["api_bun_websocket_runtime_not_verified"],
        notes: websocketReady
          ? "Realtime audio is WebSocket-first and the Bun/Hono upgrade handler has local runtime evidence."
          : "Realtime audio is WebSocket-first and apps/api owns a Bun WebSocket upgrade handler, but Bun runtime execution evidence is still required before a runtime-ready claim.",
      },
      {
        protocolId: "webtransport",
        status: webTransportReady ? "ready" : "blocked",
        claimScope: webTransportReady ? "runtime_ready" : "evidence_gated_future_lane",
        runtimeTarget: "bun-hono",
        role: "media-transport",
        clinicalMediaAllowed: webTransportReady,
        path: "/voice/realtime/webtransport",
        blockers: [
          input.bunHttp3WebTransportVerified ? undefined : "bun_http3_webtransport_not_verified",
          input.questWebTransportVerified ? undefined : "quest_webtransport_path_not_verified",
          input.azureWebTransportIngressVerified ? undefined : "azure_webtransport_ingress_not_verified",
        ].filter((blocker): blocker is string => typeof blocker === "string"),
        notes: "Keep WebTransport behind evidence until Bun HTTP/3, Quest browser/client support, and deployable Azure ingress are measured end to end.",
      },
      {
        protocolId: "quic",
        status: quicReady ? "ready" : "planned",
        claimScope: quicReady ? "runtime_ready" : "evidence_gated_future_lane",
        runtimeTarget: "bun-hono",
        role: "media-transport",
        clinicalMediaAllowed: quicReady,
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
        claimScope: "identity_signaling_audit_only",
        runtimeTarget: "bun-hono",
        role: "identity-signaling-audit",
        clinicalMediaAllowed: false,
        blockers: [
          input.web3SignalingDesignReviewed ? undefined : "operator_web3_signaling_proposal_missing",
          web3SignalingProtocolSelected ? undefined : "web3_identity_and_signaling_protocol_not_selected",
        ].filter((blocker): blocker is string => typeof blocker === "string"),
        notes: "web3 support stays scoped to identity/signaling contracts and is not part of the clinical voice media path.",
      },
    ],
  };
}
