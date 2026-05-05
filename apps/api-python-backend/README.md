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
and Qwen3-TTS MLX are approved developer-only candidates, but remain
`approved_runtime_missing` until model weights, local MLX runtime, and real
inference evidence exist.

The MLX, Moshi, and Qwen stacks are intentionally notes-only in this spike; no
optional packages are installed by the verifier or package scripts.

`voice:evidence` scans `~/.cache/openclinxr/realtime-voice` for local model
evidence files. Runtime support virtual environments such as
`api-python-backend-venv` are reported under `support_directories`, not as model
weights, so they do not make local inference appear ready.

`voice:install-local` is intentionally constrained to the approved local
realtime voice proposal candidates: `kyutai/moshiko-mlx-q4` and
`mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit`. It only accepts existing local
source files or directories and rejects remote URLs; model downloads and
runtime package installs stay outside this repo and outside default verify.
`voice:evidence` uses the same candidate list and will not mark a manually
dropped unapproved model directory as ready.
