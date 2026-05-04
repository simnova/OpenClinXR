# OpenClinXR Quest Voice Godot Spike

Minimal Godot 4 sidecar for the realtime voice transport lane.

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

The transport probe is deliberately not presented as clinical voice evidence.
Production voice requires a real codec path, disclosure/retention/misuse controls,
and measured Quest capture/playback latency.
