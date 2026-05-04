# OpenClinXR API Python Backend

Minimal FastAPI skeleton for a realtime voice AI spike.

Routes:

- `GET /health`
- `WS /voice/realtime/ws`

The websocket accepts JSON text control frames and binary audio chunks. It sends
JSON control acknowledgements, transcript/audio metadata, and echoes binary audio
chunks back to the caller.

The MLX, Moshi, and Qwen stacks are intentionally notes-only in this spike; no
optional packages are installed by the verifier or package scripts.
