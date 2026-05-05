# Godot Usage Posture

Status: temporary note, safe to delete after the architecture decision is absorbed into MADRs or implementation docs.

Last updated: 2026-05-05.

## Short Answer

Godot is currently a narrow sidecar spike, not the primary long-term OpenClinXR client architecture.

The primary examinee experience remains WebXR in the browser, with the production-oriented path centered on `apps/ui-xr` and the IWSDK/IWER experimentation path centered on `apps/ui-xr-iwsdk-spike`. Godot exists to test one specific risk area: whether a Quest-native client can move realtime voice frames over the approved WebSocket-first protocol lane with lower friction than browser WebXR audio experiments.

## Why Godot Was Introduced

The realtime voice work has several unknowns that are hard to answer from desktop browser tests alone:

- Quest microphone capture behavior.
- Bidirectional binary audio frame transport.
- Opus-oriented audio packet contracts.
- Playback timing and first-audible-latency measurement.
- Potential headset-side behavior that differs from Quest Browser WebXR.

Godot is MIT licensed, runs on Quest targets, and has a built-in `WebSocketPeer`. That makes it useful for a small local technical spike where the goal is not UI polish, clinical simulation fidelity, or final product architecture, but rather confirming the shape of a headset-capable voice transport client.

## Current Repo Shape

The current Godot sidecar lives at:

- `apps/ui-quest-voice-godot`

Its current contract is intentionally small:

- Connect to `/voice/realtime/ws`.
- Send `voice.start` and `voice.stop` JSON control frames.
- Send `voice.audio_metadata` before binary audio packets.
- Send opaque binary packets through Godot `WebSocketPeer`.
- Receive JSON transcript/control frames and binary audio packets.
- Default the future codec contract to Opus at 48 kHz.

The architecture tests also enforce that this remains a dependency-free sidecar until stronger headset evidence exists. It has no `package.json`, is not part of the default TypeScript workspace dependency graph, and is explicitly documented as not proving Quest microphone capture, native Opus encode/decode, playback, or end-to-end latency.

## Long-Term Posture

Godot should not become the default examinee application unless evidence forces that decision.

The long-term preferred path is still:

- WebXR / IWSDK for the immersive clinical encounter.
- React, TypeScript, and the existing pnpm/Turborepo conventions for most application code.
- Bun + Hono for the primary API gateway.
- Python sidecar services where model or asset-generation workloads require Python-native tooling.
- Provider facades for local-vs-production voice/model/runtime swaps.

Godot should be treated as one of three possible future outcomes:

1. Spike only: it validates useful transport assumptions, then is deleted.
2. Developer diagnostic tool: it remains as a headset audio transport harness for local testing.
3. Product fallback: it becomes a supported Quest-native client only if WebXR cannot meet voice latency, audio reliability, input, or comfort requirements after fair optimization.

The current recommendation is outcome 1 or 2. Outcome 3 requires a separate proposal and stronger evidence.

## What Godot Is Not

Godot is not currently:

- The main OpenClinXR client.
- A replacement for `apps/ui-xr`.
- A replacement for IWSDK/IWER experiments.
- A reason to move administrative or authoring UI away from React/Ant Design.
- Evidence that realtime clinical dialog is ready.
- Evidence that Opus capture/playback works on Quest.
- Evidence that the full WebXR immersive station should be abandoned.

## Decision Gates Before Broader Adoption

Before Godot can be considered for anything beyond a sidecar or diagnostic tool, it would need evidence for:

- Real Quest 3 execution, not source inspection only.
- Working microphone capture.
- Native Opus encode/decode or a justified alternate codec path.
- Bidirectional playback with measured first-audible latency.
- Stable reconnect/backpressure behavior during a realistic encounter.
- Comparison against the browser WebXR lane using the same gateway and scenario.
- Packaging, update, device-management, telemetry, accessibility, and support implications.
- Security and privacy review for headset-native audio capture.
- Clear rationale for why WebXR/IWSDK cannot satisfy the use case.

## When To Delete This Note

Delete this file after one of these happens:

- The Godot sidecar is deleted as a completed spike.
- A MADR captures the Godot posture permanently.
- A product/client architecture document includes the same guardrails.
- The team decides Godot should be proposed as a formal supported client, in which case this temporary note should be replaced by a proper proposal.

Until then, keep treating Godot as a contained evidence-gathering tool for the realtime voice lane.
