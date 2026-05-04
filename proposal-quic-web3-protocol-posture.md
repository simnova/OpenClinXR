# Proposal: QUIC WebTransport Web3 Protocol Posture

Status: Proposed on 2026-05-04. Awaiting Patrick/architecture/security approval before adding QUIC/WebTransport gateway packages, Web3 signing libraries, wallet flows, or cloud relays.

## Decision Needed

Approve, reject, or defer the protocol direction for low-latency realtime voice beyond WebSocket:

- WebTransport over HTTP/3/QUIC for media transport experiments.
- Direct QUIC gateway experiments only if WebTransport is insufficient.
- Web3 strictly for identity/signaling/audit experiments, not clinical voice media.

## Recommendation

Keep WebSocket as the implemented local lane and add WebTransport/QUIC/Web3 only as evidence-gated optional lanes.

Do not install direct QUIC or Web3 packages yet. First prove the existing Bun/Hono WebSocket lane on Bun locally and on Quest. Then evaluate WebTransport only if the headset/browser/server path can be tested without a cloud relay. Treat Web3 as identity/signaling only; it should not carry clinical audio streams.

## Proposed Scope

| Lane | Proposed status | Rationale |
| --- | --- | --- |
| WebSocket | Implemented evidence lane | Bun and Hono both have documented WebSocket support, and the repo already has a local binary-frame harness. |
| WebTransport | Optional future lane | It can provide HTTP/3 streams and datagrams, but needs secure context, server SETTINGS support, and Quest browser evidence. |
| Direct QUIC | Optional future gateway | Potentially useful for latency, but requires a concrete server/runtime and Azure ingress story. |
| Web3 signaling | Optional future identity/signaling | Could support identity, signatures, consent/audit, or decentralized credentials later; not appropriate for media transport. |

## Approval Boundaries

Codex may continue to:

- Keep protocol posture and architecture tests in source.
- Run local WebSocket transport smokes.
- Research open-source options and write proposals.

Codex must not, without approval:

- Add `quic`, WebTransport polyfill/server, `ethers`, `viem`, `web3`, wallet, DID, or blockchain packages.
- Use cloud relays, hosted TURN, hosted WebTransport, hosted wallet services, or paid APIs.
- Change `apps/api` away from Bun + Hono primary.
- Claim WebTransport, QUIC, or Web3 runtime support without local evidence.

## Pros

- Preserves a path toward lower-latency HTTP/3/QUIC behavior without destabilizing the working WebSocket-first design.
- Prevents Web3 enthusiasm from leaking into clinical audio transport.
- Gives architecture rules enforceable vocabulary for future protocol work.
- Keeps the initial single-user Quest 3 scope simple and measurable.

## Cons

- WebSocket over TCP may eventually hit head-of-line or jitter limits for true realtime voice.
- WebTransport support requires server, browser, TLS, HTTP/3 settings, and headset verification.
- Direct QUIC may add non-TypeScript operational complexity.
- Web3 dependencies can be heavy, security-sensitive, and distracting unless the identity/signaling use case is crisp.

## Acceptance Criteria For Future Approval

- A concrete package/runtime list with exact versions and licenses.
- A no-cloud local test plan for Quest 3 and the Bun/Hono gateway.
- A rollback plan and dependency boundary enforced by ArchUnitTS.
- Evidence report fields for first packet latency, dropped frames/messages, backpressure, reconnect, and headset behavior.
- A statement that Web3 is identity/signaling only unless a later proposal explicitly changes that.

## Sources

- Bun WebSockets documentation: https://bun.sh/docs/runtime/http/websockets
- Hono WebSocket helper: https://hono.dev/docs/helpers/websocket
- MDN WebTransport API: https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API
- W3C WebTransport specification: https://www.w3.org/TR/webtransport/
