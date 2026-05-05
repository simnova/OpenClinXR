# Realtime Voice Transport Spike Refresh

Date: 2026-05-05

## Summary

The realtime voice transport evidence now distinguishes three separate local lanes:

- Bun/Hono WebSocket runtime smoke: passed in `docs/openclinxr/api-bun-websocket-runtime-smoke-2026-05-05.json`.
- FastAPI backend runtime smoke: passed in `docs/openclinxr/api-python-backend-runtime-smoke-2026-05-05.json`.
- Bun/Hono to FastAPI proxy smoke: passed in `docs/openclinxr/api-bun-python-proxy-runtime-smoke-2026-05-05.json`.

The consolidated report is `docs/openclinxr/realtime-voice-transport-spike-2026-05-05.json`.

## Evidence Change

The consolidated report now records `apiBunPythonProxyRuntimeSmoke.status: "passed"` with:

- Python backend health observed.
- Bun gateway health observed.
- Backend WebSocket URL configured through `OPENCLINXR_PYTHON_VOICE_BACKEND_WS_URL`.
- Gateway-to-backend `backend.ready` event observed.
- Canonical `python-fastapi-compatible-websocket` protocol observed.
- Latency-field plumbing observed.
- Opaque binary echo observed.

This retires the stale `bun_to_fastapi_proxy_runtime_not_verified`, `bun_runtime_not_installed_on_this_machine`, and `fastapi_backend_not_runtime_executed` blockers when the passed runtime evidence files are supplied to `pnpm local:voice:realtime-spike`.

## Still Not Claimed

This is still not live clinical dialogue readiness. The report intentionally keeps these blockers:

- Quest Godot client execution is not observed.
- Native Opus encode/decode is not integrated.
- Moshi MLX or Qwen3-TTS real inference is not observed.
- Quest microphone/playback latency is not measured.
- Clinical voice safety controls are not exercised with a real model.

HTTP/3, WebTransport, direct QUIC, Web3, cloud relays, paid APIs, and production ingress remain outside this evidence lane.

## Reproduction

```sh
pnpm local:voice:realtime-spike -- \
  --output docs/openclinxr/realtime-voice-transport-spike-2026-05-05.json \
  --api-bun-websocket-runtime-smoke docs/openclinxr/api-bun-websocket-runtime-smoke-2026-05-05.json \
  --api-python-backend-runtime-smoke docs/openclinxr/api-python-backend-runtime-smoke-2026-05-05.json \
  --api-bun-python-proxy-runtime-smoke docs/openclinxr/api-bun-python-proxy-runtime-smoke-2026-05-05.json
```
