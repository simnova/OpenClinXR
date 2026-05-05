# API Bun To Python Voice Proxy Smoke

**Date:** 2026-05-05  
**Status:** Passed local developer smoke; repeatable script added
**Scope:** Local workstation only; no cloud, no paid APIs, no model downloads, no Quest claim

## Purpose

Verify that `apps/api` can run under Bun and forward realtime voice WebSocket frames to a running local `apps/api-python-backend` FastAPI process when `OPENCLINXR_PYTHON_VOICE_BACKEND_WS_URL` is set.

This complements:

- `docs/openclinxr/api-bun-websocket-runtime-smoke-2026-05-05.json`
- `docs/openclinxr/api-python-backend-runtime-smoke-2026-05-05.json`

## Runtime Setup

- Python backend: `/Users/patrick/.cache/openclinxr/realtime-voice/api-python-backend-venv/bin/python`
- Python route: `ws://127.0.0.1:8766/voice/realtime/ws`
- Bun executable: `/Users/patrick/.bun/bin/bun`
- Bun gateway route: `ws://127.0.0.1:4326/voice/realtime/ws`
- Bun environment: `OPENCLINXR_PYTHON_VOICE_BACKEND_WS_URL=ws://127.0.0.1:8766/voice/realtime/ws`

## Observed Result

```json
{
  "status": "passed",
  "eventTypes": [
    "gateway.ready",
    "backend.ready",
    "voice.started",
    "audio.chunk",
    "transcript.partial",
    "transcript.final",
    "voice.stopped"
  ],
  "binaryMessages": 1,
  "ready": true,
  "latencyFields": true
}
```

## What This Proves

- The Bun/Hono API entrypoint can run locally with an opt-in Python backend WebSocket URL.
- The gateway can queue client frames until the backend WebSocket opens.
- JSON control frames and binary audio frames are forwarded to the FastAPI backend.
- Backend JSON and binary frames are forwarded back to the client.
- Backend latency fields (`clientSentAtMs`, `backendObservedAtMs`) survive the gateway hop.

## What This Does Not Prove

- No Moshi, Qwen3-TTS, VibeVoice, Grok, ASR, or real inference model ran.
- No Quest microphone capture or headset audio playback was exercised.
- No Opus encode/decode quality was validated; the binary frame is still opaque Opus-like data.
- No production Azure ingress, TLS, scaling, or low-latency claim is made.

## Repeatable Command

The one-off proof has been converted into an opt-in package-managed smoke:

```bash
pnpm local:voice:bun-python-proxy-smoke -- --output docs/openclinxr/api-bun-python-proxy-runtime-smoke-2026-05-05.json --python-port 8767 --api-port 4327 --timeout-ms 5000
```

Keep the default `pnpm local:voice:bun-websocket-smoke` deterministic and backend-free.
