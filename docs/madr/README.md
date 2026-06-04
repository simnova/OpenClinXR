# MADR Index And Arena Linkage

MADR files are the decision record for technology choices. Arena directories are the proving ground for candidates that have not yet been promoted into production app/runtime paths.

## Capability Arena Map

| Arena path | Trial | Governing MADRs | Promotion target |
| --- | --- | --- | --- |
| [`apps/arena`](../../apps/arena/README.md) | Runnable capability arena app directory. | [0017](0017-websocket-first-realtime-transport.md), [0019](0019-provider-adapter-model-and-voice-routing.md), [0021](0021-local-first-no-cloud-implementation-spikes.md), [0022](0022-local-llm-runtime-and-model-tiering.md), [0023](0023-vibevoice-as-local-voice-candidate.md), [0024](0024-pnpm-node-first-bun-deployment-gate.md), [0027](0027-quest3-usb-webxr-smoke-gate.md), [0028](0028-iwsdk-sidecar-spike.md) | Keep runnable cage matches outside production app roots. |
| [`apps/arena/api-python-backend`](../../apps/arena/api-python-backend/README.md) | Local Python voice/model backend harness. | [0019](0019-provider-adapter-model-and-voice-routing.md), [0021](0021-local-first-no-cloud-implementation-spikes.md), [0022](0022-local-llm-runtime-and-model-tiering.md), [0023](0023-vibevoice-as-local-voice-candidate.md) | Stable provider adapters through `@openclinxr/voice-gateway` or model gateway contracts. |
| [`apps/arena/mock-realtime-voice-server`](../../apps/arena/mock-realtime-voice-server/README.md) | Local WebSocket realtime voice transport harness. | [0017](0017-websocket-first-realtime-transport.md), [0019](0019-provider-adapter-model-and-voice-routing.md), [0021](0021-local-first-no-cloud-implementation-spikes.md), [0024](0024-pnpm-node-first-bun-deployment-gate.md) | `@openclinxr/voice-gateway` and API runtime transport paths. |
| [`apps/arena/ui-quest-voice-godot`](../../apps/arena/ui-quest-voice-godot/README.md) | Source-level Godot Quest voice client contract. | [0017](0017-websocket-first-realtime-transport.md), [0019](0019-provider-adapter-model-and-voice-routing.md), [0021](0021-local-first-no-cloud-implementation-spikes.md), [0027](0027-quest3-usb-webxr-smoke-gate.md) | `@openclinxr/voice-gateway` and Quest voice client path only after codec/capture/playback/latency evidence clears. |
| [`apps/arena/ui-xr-iwsdk-spike`](../../apps/arena/ui-xr-iwsdk-spike/README.md) | Meta IWSDK Quest/WebXR sidecar. | [0027](0027-quest3-usb-webxr-smoke-gate.md), [0028](0028-iwsdk-sidecar-spike.md) | `apps/ui-xr` only after evidence-gated MADR update or successor MADR. |
| [`packages/openclinxr/arena`](../../packages/openclinxr/arena/README.md) | Package-level capability arena directory. | [0014](0014-cellixjs-inspired-domain-contexts.md), [0018](0018-first-class-communication-style-layer.md), [0027](0027-quest3-usb-webxr-smoke-gate.md), [0028](0028-iwsdk-sidecar-spike.md) | Keep spike packages out of stable package imports until promoted by decision and architecture rule. |
| [`packages/openclinxr/arena/iwsdk-spike`](../../packages/openclinxr/arena/iwsdk-spike/README.md) | IWSDK evidence and policy contracts. | [0027](0027-quest3-usb-webxr-smoke-gate.md), [0028](0028-iwsdk-sidecar-spike.md) | Stable XR/runtime contracts outside arena. |
| [`packages/openclinxr/arena/multi-actor-state-spike`](../../packages/openclinxr/arena/multi-actor-state-spike/README.md) | Superseded multi-actor state experiment. | [0014](0014-cellixjs-inspired-domain-contexts.md), [0018](0018-first-class-communication-style-layer.md) | Already superseded by `@openclinxr/session-state`; retain for provenance only. |

## Promotion Rule

A trial can inform production only when:

1. The governing MADR says the trial is accepted or a successor MADR updates the decision.
2. Focused evidence exists in docs or package tests.
3. Production code consumes a stable adapter/package, not arena internals.
4. Architecture rules are updated to encode the allowed boundary.
