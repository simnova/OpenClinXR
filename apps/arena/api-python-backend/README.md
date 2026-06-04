# OpenClinXR API Python Backend

**Arena role:** local Python voice/model backend proving ground.

**Governing decisions:** [MADR 0019](../../../docs/madr/0019-provider-adapter-model-and-voice-routing.md), [MADR 0021](../../../docs/madr/0021-local-first-no-cloud-implementation-spikes.md), [MADR 0022](../../../docs/madr/0022-local-llm-runtime-and-model-tiering.md), and [MADR 0023](../../../docs/madr/0023-vibevoice-as-local-voice-candidate.md).

**Promotion gate:** production use must go through `@openclinxr/voice-gateway` or another stable provider adapter, with local model/runtime evidence and explicit privacy/procurement review where applicable.

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
