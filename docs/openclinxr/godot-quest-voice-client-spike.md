# Godot Quest Voice Client Spike

Date: 2026-05-04

## Status

`apps/ui-quest-voice-godot` is a source-level Godot 4 sidecar for the realtime
voice transport contract. It is intentionally outside the default runtime path
and does not add package dependencies.

## Contract

```mermaid
sequenceDiagram
  participant Client as "Quest 3 Godot Client"
  participant Gateway as "Bun/Hono or Node/Hono Gateway"
  participant Backend as "FastAPI Voice Backend"

  Client->>Gateway: "voice.start JSON"
  Client->>Gateway: "voice.audio_metadata JSON"
  Client->>Gateway: "binary encoded audio packet"
  Gateway->>Backend: "proxied JSON/binary WebSocket frame"
  Backend-->>Gateway: "transcript JSON + binary audio packet"
  Gateway-->>Client: "JSON + binary WebSocket frames"
  Client->>Gateway: "voice.stop JSON"
```

## Evidence Boundary

This sidecar validates code shape only:

- Godot `WebSocketPeer` is the client transport.
- Binary packets use `put_packet`.
- JSON control frames use `send_text`.
- `voice.audio_metadata` carries chunk index, byte length, codec, and client timestamp before each binary packet.
- The endpoint is `/voice/realtime/ws`.
- The future codec lane is `opus` at 48 kHz.

It does not prove:

- Quest microphone capture.
- Native Opus encode/decode.
- Audio playback.
- Real Moshi/Qwen/Grok inference.
- End-to-end latency on the headset.

## Next Evidence Steps

1. Run the source-level check now, and optionally provide a local Godot 4 binary
   for a headless import check:
   `pnpm godot:project:import-check -- --godot-binary /path/to/godot`.
2. Add a Quest-compatible native Opus codec path or deliberately switch this
   lane to WebRTC if that proves simpler.
3. Connect to the local gateway and record first binary frame round-trip from
   the Quest.
4. Add capture/playback timestamps and report p50/p95 end-to-end latency.

## Source/Import Checker

The repo-managed checker is:

```bash
pnpm godot:project:import-check
```

Without `--godot-binary`, it validates only committed source shape: Godot 4
project metadata, mobile renderer posture, the `RealtimeVoiceSpike` scene
bindings, local WebSocket endpoint, JSON control frames, binary packet sending,
and explicit `opus` / 48 kHz declarations. It records
`godot_import_not_executed` until a local Godot executable is supplied. Even a
passing import check is not Quest runtime, microphone, Opus encode/decode,
playback, latency, clinical voice, or production-readiness evidence.

## Evidence Checker

Future hardware runs should start from
`docs/openclinxr/godot-quest-voice-evidence-template.json` and validate with:

```bash
pnpm godot:quest:voice:evidence -- --input docs/openclinxr/godot-quest-voice-evidence-template.json
```

The checker intentionally scores binary WebSocket round-trip, Quest microphone
capture, Opus encode/decode, playback, and latency as separate evidence lanes.
It does not convert a transport probe into production runtime readiness,
clinical voice-dialog quality, Grok parity, WebXR readiness, or low-latency
voice readiness.
