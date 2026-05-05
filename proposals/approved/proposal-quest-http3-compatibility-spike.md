# Proposal: Quest HTTP3 Compatibility Spike

**Status:** Approved  
**Approved by:** Patrick Gidich on 2026-05-05 12:38 EDT  
**Scope:** future Quest 3 / Quest Browser compatibility evidence only; not part of the local Bun WebSocket smoke

## Decision

Patrick approved a future spike to test whether Quest 3 / Quest Browser can support HTTP/3 in practice, noting that the browser is Chromium-based and may support it but must be confirmed with an actual test.

## Boundaries

- This approval does not enable HTTP/3, WebTransport, QUIC, or Web3 in the current local Bun WebSocket smoke.
- The future spike must use real Quest 3 / Quest Browser evidence before any architecture claim moves from planned to runtime-ready.
- The future spike must record exact Bun/Hono/runtime versions, server settings, TLS/security-context requirements, Quest Browser version when available, and whether `Bun.serve({ h3: true })` was enabled.
- No cloud relay, hosted TURN, hosted WebTransport, wallet, blockchain, paid API, or production ingress changes are approved by this note.

## Acceptance Criteria for Future Work

- A concrete local test path that proves or rejects Quest Browser HTTP/3 reachability without cloud infrastructure.
- A dedicated compatibility evidence report that separates HTTP/3 transport reachability from WebTransport API support and from clinical media readiness.
- A rollback plan and architecture gate updates that keep WebSocket as the primary implemented lane unless the Quest evidence is strong.
- Explicit statements that this is not proof of production Azure ingress, low-latency clinical voice, Opus media readiness, or real in-VR voice interaction.
