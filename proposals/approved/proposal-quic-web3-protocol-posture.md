# Proposal: QUIC WebTransport Web3 Protocol Posture

Status: Approved by Patrick Gidich on 2026-05-04 19:24 EDT.

Awaiting implementation of local WebSocket evidence collection on Bun and Quest. This approval does not authorize direct QUIC, WebTransport polyfill/server, Web3 package installs, wallet/DID/blockchain dependencies, cloud relays, hosted TURN, hosted WebTransport, hosted wallet services, or paid APIs.

## Decision Record

Approved the protocol direction for low-latency realtime voice beyond WebSocket:

- WebTransport over HTTP/3/QUIC for media transport experiments, strictly gated.
- Direct QUIC gateway experiments only if WebTransport proves insufficient, strictly gated.
- Web3 strictly for identity/signaling/audit experiments; never for clinical voice media.

## Recommendation Approved

Approve WebSocket as the primary implemented local lane. Treat WebTransport, direct QUIC, and Web3 as strictly evidence-gated optional future lanes.

Do not install direct QUIC or Web3 packages yet. First prove and measure the existing Bun/Hono WebSocket lane locally and on Quest hardware. Only then evaluate WebTransport, and only if a complete local no-cloud-relay test path exists for headset, browser, and server. Web3 must remain limited to identity, signing, consent/audit, and decentralized credentials; it must never carry clinical audio or media streams.

## Proposed Scope

| Lane | Proposed status | Rationale |
| --- | --- | --- |
| WebSocket | Implemented evidence lane | Bun and Hono both have mature, documented WebSocket support. The repo already has a local binary-frame harness. This is the lane we will prove first on Quest. |
| WebTransport | Optional future lane | Can provide HTTP/3 streams and datagrams with potentially lower latency. Requires secure context, server SETTINGS support, and real Quest browser evidence. Any future implementation should prefer staying inside the existing Bun/Hono gateway where possible. |
| Direct QUIC | Optional future gateway | Potentially useful for latency, but requires a concrete server/runtime story and Azure ingress plan. Only considered if WebTransport is insufficient. |
| Web3 signaling | Optional future identity/signaling | Could support identity, signatures, consent/audit, or decentralized credentials later; not appropriate for media transport. |

## Approval Boundaries

Codex may continue to:

- Keep protocol posture and architecture tests in source.
- Run local WebSocket transport smokes on Bun.
- Research open-source options and write proposals.
- Collect and report local evidence from the current WebSocket lane.

Codex must not, without approval:

- Add `quic`, WebTransport polyfill/server, `ethers`, `viem`, `web3`, wallet, DID, or blockchain packages.
- Use cloud relays, hosted TURN, hosted WebTransport, hosted wallet services, or paid APIs.
- Change `apps/api` away from Bun + Hono primary.
- Claim WebTransport, QUIC, or Web3 runtime support without local Quest and server evidence.

## Pros

- Preserves a path toward lower-latency HTTP/3/QUIC behavior without destabilizing the working WebSocket-first design.
- Prevents Web3 enthusiasm from leaking into clinical audio transport.
- Gives architecture rules enforceable vocabulary for future protocol work.
- Keeps the initial single-user Quest 3 scope simple and measurable.

## Cons

- WebSocket over TCP may eventually hit head-of-line blocking or jitter limits for true high-quality realtime voice; future evidence will quantify this.
- WebTransport support requires server, browser, TLS, HTTP/3 settings, and headset verification.
- Direct QUIC may add non-TypeScript operational complexity.
- Web3 dependencies can be heavy, security-sensitive, and distracting unless the identity/signaling use case is crisp.

## Acceptance Criteria For Future Approval

- A concrete package/runtime list with exact versions and licenses.
- A no-cloud local test plan for Quest 3 and the Bun/Hono gateway.
- A rollback plan and dependency boundary enforced by ArchUnitTS.
- Evidence report fields for first packet latency, dropped frames/messages, backpressure, reconnect, and headset behavior.
- A statement that Web3 is identity/signaling only unless a later proposal explicitly changes that.
- Security and license review completed for any new packages before installation.

## Sources

- Bun WebSockets documentation: https://bun.sh/docs/runtime/http/websockets
- Hono WebSocket helper: https://hono.dev/docs/helpers/websocket
- MDN WebTransport API: https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API
- W3C WebTransport specification: https://www.w3.org/TR/webtransport/
