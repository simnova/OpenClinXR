# API Python Backend Runtime Smoke

Date: 2026-05-04

## Result

The local FastAPI backend runtime smoke passed using an ignored virtual
environment at `.openclinxr-local/api-python-backend-venv`.

Observed evidence:

- Python: 3.11.4.
- FastAPI, Uvicorn, and WebSockets imports were available in the local venv.
- `GET /health` returned `{ "status": "ok", "service": "api-python-backend" }`.
- `GET /capabilities` returned `transport-echo` as ready, with `moshi-mlx` and
  `qwen3-tts-mlx` still marked `proposal_required`.
- `WS /voice/realtime/ws` accepted the connection.
- JSON control acknowledgements were observed.
- Binary audio-like packets were echoed.
- Audio metadata and transcript delta JSON frames were observed.

## Boundary

This is still not live clinical voice evidence. The smoke does not execute Moshi,
Qwen3-TTS, VibeVoice, Grok Voice, ASR, native Opus encode/decode, Quest
microphone capture, or headset playback. It only proves that the Python backend
can run locally and satisfy the JSON-plus-binary WebSocket contract.

Machine-readable evidence:

- `docs/openclinxr/api-python-backend-runtime-smoke-2026-05-04.json`
