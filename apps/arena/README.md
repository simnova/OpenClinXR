# Capability Arena Apps

This directory holds runnable proving-ground apps that are not production runtime roots. Each arena app must link back to the MADR(s) that explain why the trial exists, what decision it is informing, and what evidence is required before promotion.

| Arena app | Technical trial | Governing MADRs | Decision posture |
| --- | --- | --- | --- |
| `api-python-backend` | Local Python inference/backend harness for voice and model experiments. | [MADR 0019](../../docs/madr/0019-provider-adapter-model-and-voice-routing.md), [MADR 0021](../../docs/madr/0021-local-first-no-cloud-implementation-spikes.md), [MADR 0022](../../docs/madr/0022-local-llm-runtime-and-model-tiering.md), [MADR 0023](../../docs/madr/0023-vibevoice-as-local-voice-candidate.md) | Approved local-only proving ground; not a production API surface. |
| `mock-realtime-voice-server` | Local WebSocket realtime voice transport harness. | [MADR 0017](../../docs/madr/0017-websocket-first-realtime-transport.md), [MADR 0019](../../docs/madr/0019-provider-adapter-model-and-voice-routing.md), [MADR 0021](../../docs/madr/0021-local-first-no-cloud-implementation-spikes.md), [MADR 0024](../../docs/madr/0024-pnpm-node-first-bun-deployment-gate.md) | Validates transport/provider seams before production voice gateway promotion. |
| `ui-quest-voice-godot` | Source-level Godot Quest voice client contract for codec/capture/playback experiments. | [MADR 0017](../../docs/madr/0017-websocket-first-realtime-transport.md), [MADR 0019](../../docs/madr/0019-provider-adapter-model-and-voice-routing.md), [MADR 0021](../../docs/madr/0021-local-first-no-cloud-implementation-spikes.md), [MADR 0027](../../docs/madr/0027-quest3-usb-webxr-smoke-gate.md) | Source-only sidecar; not production voice, WebXR, or Quest readiness evidence. |
| `ui-xr-iwsdk-spike` | Meta IWSDK sidecar for Quest/MR and SDK-fit experiments. | [MADR 0027](../../docs/madr/0027-quest3-usb-webxr-smoke-gate.md), [MADR 0028](../../docs/madr/0028-iwsdk-sidecar-spike.md) | Accepted sidecar spike; blocked from production XR adoption until evidence gates pass. |

Arena apps can be launched and tested independently. They may inform production decisions, but promotion into `apps/api`, `apps/ui-admin`, or `apps/ui-xr` requires explicit adapter contracts, evidence, architecture-rule updates, and a MADR update or successor MADR.
