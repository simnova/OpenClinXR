# OpenClinXR Quest Voice Godot Spike

Minimal Godot 4 sidecar for the realtime voice transport lane.

**Arena role:** source-level Quest/Godot voice client contract for realtime voice transport, codec, capture, playback, and headset-latency evidence.

**Governing decisions:** [MADR 0017](../../../docs/madr/0017-websocket-first-realtime-transport.md), [MADR 0019](../../../docs/madr/0019-provider-adapter-model-and-voice-routing.md), [MADR 0021](../../../docs/madr/0021-local-first-no-cloud-implementation-spikes.md), and [MADR 0027](../../../docs/madr/0027-quest3-usb-webxr-smoke-gate.md).

**Production relationship:** this source-only sidecar may validate a future Quest voice client path. Production voice should stay behind `@openclinxr/voice-gateway` and provider adapters until codec, capture/playback, safety, retention, disclosure, and latency gates pass.

This is a source-level contract spike only. Godot is not required by the default
repo verification path, and this app does not yet prove Quest microphone capture,
native Opus encode/decode, playback, or end-to-end headset latency.

## Local Contract

- Connects to `/voice/realtime/ws`.
- Sends JSON control frames for `voice.start` and `voice.stop`.
- Sends `voice.audio_metadata` JSON before each binary packet with chunk index,
  byte length, codec, and client timestamp.
- Sends opaque binary audio packets through `WebSocketPeer.put_packet`.
- Receives JSON transcript/control frames and binary audio packets.
- Defaults to `opus` at 48 kHz for the future Quest audio codec lane.

## Run Shape

1. Start the gateway: `pnpm --filter @openclinxr/mock-realtime-voice-server dev`.
2. Open this folder in Godot 4.
3. Run the `RealtimeVoiceSpike` scene.
4. Use the transport probe button to validate bidirectional binary frames.

The default local gateway URL is `ws://127.0.0.1:4017/voice/realtime/ws`.

The transport probe is deliberately not presented as clinical voice evidence.
Production voice requires a real codec path, disclosure/retention/misuse controls,
and measured Quest capture/playback latency.

## Local Import Evidence

The source/import evidence lane can use a locally cached Godot 4 editor binary:

```bash
pnpm godot:project:import-check -- --godot-binary /Users/patrick/.cache/openclinxr/godot/4.5.1-stable/Godot.app/Contents/MacOS/Godot
```

The committed evidence artifact is
`docs/openclinxr/godot-project-import-check-2026-05-06.json` and can be checked
from the repo root with:

```bash
pnpm godot:project:import-check:validate
```

This only proves that Godot can parse/import the committed sidecar source on the
developer machine, with release/hash/license posture recorded for the local
editor binary. It still does not prove physical Quest runtime behavior,
microphone capture, native Opus encode/decode, headset playback, latency, or
clinical voice readiness.
