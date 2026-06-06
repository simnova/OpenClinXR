# Capability Arena Packages

This directory holds package-level proving-ground work. Each package keeps its technical trial close to the MADR that governs it.

| Arena package | Technical trial | Governing MADRs | Decision posture |
| --- | --- | --- | --- |
| `iwsdk-spike` | IWSDK policy, evidence, MCP/tooling, and sidecar verification contracts. | [MADR 0027](../../../docs/madr/0027-quest3-usb-webxr-smoke-gate.md), [MADR 0028](../../../docs/madr/0028-iwsdk-sidecar-spike.md) | Accepted sidecar spike; not production XR runtime. |
| `model-vetting` | Isolated humanoid model-vetting report schema and local-only evidence contract for Anny-compatible candidates. | [MADR 0021](../../../docs/madr/0021-local-first-no-cloud-implementation-spikes.md), [MADR 0027](../../../docs/madr/0027-quest3-usb-webxr-smoke-gate.md), [MADR 0028](../../../docs/madr/0028-iwsdk-sidecar-spike.md) | Local metadata/lab contract only; not scene, Quest, learner, production, clinical, or scoring readiness. |
| `multi-actor-state-spike` | Historical multi-actor state routing and state-shape experiment. | [MADR 0014](../../../docs/madr/0014-cellixjs-inspired-domain-contexts.md), [MADR 0018](../../../docs/madr/0018-first-class-communication-style-layer.md) | Superseded by `@openclinxr/session-state` for production-shaped contracts. |

Keep arena dependencies opt-in and evidence-gated. If a capability graduates, promote the stable contract into a non-arena package and leave the spike history here as provenance. Promotion should also update the governing MADR or add a successor MADR.
