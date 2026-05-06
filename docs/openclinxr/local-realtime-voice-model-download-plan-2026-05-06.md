# Local Realtime Voice Model Download Plan

Date: 2026-05-06
Status: Pre-download record; no model weights committed

## Decision

Patrick approved local Hugging Face model/weight downloads when licensing posture works. This record keeps the approved realtime voice model lane auditable before any large cache changes.

## Recommended First Download

Use `mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit` first.

- License: Apache-2.0 per Hugging Face model metadata.
- Source record: `sources/qwen3-tts-mlx-4bit-2026.json`.
- Posture: developer-only outbound TTS fallback, not full-duplex dialog, not Quest-ready, not production-ready.
- Expected large files from HEAD checks:
  - `model.safetensors`: 1,024,490,700 bytes.
  - `speech_tokenizer/model.safetensors`: 682,293,092 bytes.
- Expected total download footprint: roughly 1.71 GB plus tokenizer/config files.
- Target cache path: `/Users/patrick/.cache/openclinxr/realtime-voice/mlx-community__Qwen3-TTS-12Hz-0.6B-Base-4bit`.

## Deferred Candidate

Keep `kyutai/moshiko-mlx-q4` deferred until the Apache-2.0 TTS fallback cache and benchmark path are clean.

- License: CC-BY-4.0 per Hugging Face model metadata.
- Source record: `sources/moshiko-mlx-q4-2026.json`.
- Posture: developer-only research candidate for full-duplex voice; not professional-duty or production clinical simulation evidence.

## Commands

Install Hugging Face Hub only inside the ignored realtime voice venv if needed:

```bash
/Users/patrick/.cache/openclinxr/realtime-voice/api-python-backend-venv/bin/python -m pip install 'huggingface_hub[cli]'
```

Download Qwen3-TTS MLX into the approved cache:

```bash
mkdir -p /Users/patrick/.cache/openclinxr/realtime-voice/mlx-community__Qwen3-TTS-12Hz-0.6B-Base-4bit
HF_HOME=/Users/patrick/.cache/openclinxr/huggingface \
  /Users/patrick/.cache/openclinxr/realtime-voice/api-python-backend-venv/bin/huggingface-cli download \
  mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit \
  --local-dir /Users/patrick/.cache/openclinxr/realtime-voice/mlx-community__Qwen3-TTS-12Hz-0.6B-Base-4bit
```

Regenerate cache evidence after the download:

```bash
pnpm local:voice:model-cache -- --output docs/openclinxr/local-realtime-voice-model-cache-evidence-2026-05-06.json
pnpm local:voice:live-dialog -- --model-cache-evidence docs/openclinxr/local-realtime-voice-model-cache-evidence-2026-05-06.json --output docs/openclinxr/local-voice-live-dialog-benchmark-2026-05-06.json
pnpm agent:benchmarks
```

## Cleanup

```bash
rm -rf /Users/patrick/.cache/openclinxr/realtime-voice/mlx-community__Qwen3-TTS-12Hz-0.6B-Base-4bit
rm -rf /Users/patrick/.cache/openclinxr/huggingface/models--mlx-community--Qwen3-TTS-12Hz-0.6B-Base-4bit
```

Do not remove `/Users/patrick/.cache/openclinxr/realtime-voice/api-python-backend-venv` unless intentionally rebuilding the local FastAPI support runtime.

## Current Evidence

`pnpm local:voice:model-cache` now records a reproducible cache-inventory report. As of this pre-download record, the cache contains the support venv only and no approved Moshi/Qwen model weights. Live dialog remains blocked on real local voice stream evidence, WebXR/Quest playback, safety controls, and production review.
