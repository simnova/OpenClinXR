# API Python Backend Runtime Smoke

Date: 2026-05-05

## Result

The local FastAPI backend runtime smoke passed using an ignored external virtual
environment at `~/.cache/openclinxr/realtime-voice/api-python-backend-venv`.

Observed evidence:

- Python: 3.11.4.
- FastAPI, Uvicorn, and WebSockets imports were available in the external venv.
- `GET /health` returned `{ "status": "ok", "service": "api-python-backend" }`.
- `GET /capabilities` returned `transport-echo` as ready, with `moshi-mlx` and
  `qwen3-tts-mlx` marked `approved_runtime_missing`.
- `WS /voice/realtime/ws` accepted the connection.
- JSON control acknowledgements were observed.
- Binary audio-like packets were echoed.
- Audio metadata, partial transcript, final transcript, and stop events were observed.
- The backend emitted the canonical `backendProtocol` field.
- The echoed audio metadata carried `clientSentAtMs` and numeric
  `backendObservedAtMs` latency fields.

## Boundary

This is still not live clinical voice evidence. The smoke does not execute Moshi,
Qwen3-TTS, VibeVoice, Grok Voice, ASR, native Opus encode/decode, Quest
microphone capture, or headset playback. It only proves that the Python backend
can run locally and satisfy the JSON-plus-binary WebSocket contract.

Machine-readable evidence:

- `docs/openclinxr/api-python-backend-runtime-smoke-2026-05-05.json`
