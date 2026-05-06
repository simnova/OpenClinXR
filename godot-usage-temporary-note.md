# Godot Usage Temporary Note

Status: temporary, deletable after the Quest voice-client direction is settled.
Date: 2026-05-06

## Current Use

OpenClinXR uses Godot only in `apps/ui-quest-voice-godot`, a narrow Quest 3 realtime voice-transport sidecar.

The sidecar exists to test a headset-native client shape for low-latency bidirectional audio:

- Connect to the Bun/Hono gateway at `/voice/realtime/ws`.
- Send JSON control frames such as `voice.start`, `voice.audio_metadata`, and `voice.stop`.
- Send opaque binary audio packets through Godot `WebSocketPeer.put_packet`.
- Receive transcript/control JSON and binary audio packets from the gateway.
- Keep a future Opus-at-48-kHz codec contract visible without claiming a working native Opus implementation yet.

This is source-contract evidence only until a local Godot 4 executable and physical Quest run prove import, microphone capture, playback, codec behavior, and headset latency.

## Why Godot Was Added

Godot was added for one technical purpose: a minimal Quest-native client lane for realtime voice transport.

The WebXR/IWSDK browser app remains the main XR scenario UI path. Browser WebXR is still the right place to evolve the clinical scene, hands, locomotion, visual QA, and IWSDK sidecar evidence. Godot is being evaluated because headset audio can become more predictable outside the browser if native microphone capture, playback timing, and codec integration are easier to control.

Godot also has a favorable posture for this spike:

- MIT-licensed engine.
- Direct Quest deployment path.
- Strong local/offline development story.
- Simple enough to isolate as a sidecar without adding npm workspace dependencies.
- Useful for testing binary WebSocket transport without changing the production-shaped Bun/Hono and FastAPI backend design.

## Long-Term Position

Godot is not currently selected as the long-term primary OpenClinXR client.

The current recommendation is to keep Godot as an evidence-gated sidecar until one of these outcomes becomes clear:

- If Godot produces materially better Quest microphone, playback, Opus, and latency evidence than the WebXR/IWSDK path, it may become a long-term headset voice companion client or a candidate client lane for voice-heavy scenarios.
- If WebXR/IWSDK can satisfy the same audio, latency, and interaction requirements cleanly, Godot should remain a single-purpose spike and can be removed after the transport lessons and evidence contracts are preserved.
- If neither path clears the voice evidence gates, Godot should not be promoted; the team should reassess native, WebRTC, or platform-specific alternatives through a new proposal.

## Boundaries

Godot does not replace:

- `apps/ui-xr` as the main WebXR scenario app.
- `apps/ui-xr-iwsdk-spike` as the IWSDK sidecar.
- `apps/api` as the Bun/Hono gateway.
- `apps/api-python-backend` as the Python ML/inference backend lane.
- `packages/openclinxr/session-state` or MongoDB-backed durable state packages.

Godot evidence must not be used to claim:

- Quest microphone capture until a physical Quest run records it.
- Native Opus encode/decode until a real codec path is integrated and measured.
- Audio playback until headset playback is observed.
- Low latency until p50/p95 end-to-end headset timings are captured.
- Clinical voice readiness until safety controls and real model behavior are exercised.
- Production readiness without a follow-up proposal.

## Delete Criteria

This file can be deleted when the repo has a stable client decision record that supersedes it, or when `apps/ui-quest-voice-godot` is either promoted through a proposal or removed as a completed spike.
