# OpenClinXR API Python Backend

Minimal FastAPI skeleton for a realtime voice AI spike.

Routes:

- `GET /health`
- `GET /capabilities`
- `WS /voice/realtime/ws`

The websocket accepts JSON text control frames and binary audio chunks. It sends
JSON control acknowledgements, transcript/audio metadata, and echoes binary audio
chunks back to the caller.

`GET /capabilities` reports `transport-echo` as the only ready mode. Moshi MLX
and Qwen3-TTS MLX remain `proposal_required` until operator approval, model
weights, and local MLX runtime evidence exist.

The MLX, Moshi, and Qwen stacks are intentionally notes-only in this spike; no
optional packages are installed by the verifier or package scripts.
