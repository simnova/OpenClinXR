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
});
