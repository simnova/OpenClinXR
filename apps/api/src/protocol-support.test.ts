import { describe, expect, it } from "vitest";
import { createOpenClinXrApiProtocolPosture } from "./protocol-support.js";

describe("OpenClinXR API protocol posture", () => {
  it("does not mark direct QUIC ready until operator design review is recorded", () => {
    const posture = createOpenClinXrApiProtocolPosture({
      quicGatewayImplemented: true,
      azureQuicIngressVerified: true,
    });
    const quic = posture.protocols.find((protocol) => protocol.protocolId === "quic");

    expect(quic).toMatchObject({
      status: "planned",
      blockers: expect.arrayContaining(["operator_quic_gateway_proposal_missing"]),
    });
  });

  it("marks direct QUIC ready only after design review, implementation, and ingress evidence", () => {
    const posture = createOpenClinXrApiProtocolPosture({
      quicGatewayDesignReviewed: true,
      quicGatewayImplemented: true,
      azureQuicIngressVerified: true,
    });
    const quic = posture.protocols.find((protocol) => protocol.protocolId === "quic");

    expect(quic).toMatchObject({
      status: "ready",
      blockers: [],
    });
  });

  it("does not mark WebTransport ready until local Bun, Quest, and Azure ingress evidence are all recorded", () => {
    const posture = createOpenClinXrApiProtocolPosture({
      bunHttp3WebTransportVerified: true,
      questWebTransportVerified: true,
      azureWebTransportIngressVerified: false,
    });
    const webTransport = posture.protocols.find((protocol) => protocol.protocolId === "webtransport");

    expect(webTransport).toMatchObject({
      status: "blocked",
      clinicalMediaAllowed: false,
      blockers: expect.arrayContaining(["azure_webtransport_ingress_not_verified"]),
    });
  });

  it("keeps Web3 signaling out of the clinical media path while QUIC remains evidence gated", () => {
    const posture = createOpenClinXrApiProtocolPosture();
    const quic = posture.protocols.find((protocol) => protocol.protocolId === "quic");
    const web3 = posture.protocols.find((protocol) => protocol.protocolId === "web3-signaling");

    expect(quic).toMatchObject({
      role: "media-transport",
      clinicalMediaAllowed: false,
      blockers: expect.arrayContaining(["operator_quic_gateway_proposal_missing", "quic_gateway_not_implemented"]),
    });
    expect(web3).toMatchObject({
      role: "identity-signaling-audit",
      clinicalMediaAllowed: false,
      blockers: expect.arrayContaining([
        "operator_web3_signaling_proposal_missing",
        "web3_identity_and_signaling_protocol_not_selected",
      ]),
    });
  });
});
