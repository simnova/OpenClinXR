# Proposal: Local Model Benchmark

Status: Approved by Patrick on 2026-05-04 10:40:15 EDT; execution in progress as a local-only benchmark.

## Decision Needed

Approve a first local model download and benchmark scope for OpenClinXR. This approval would allow Codex to download one source-backed model, configure a private local environment file, and run a real local model benchmark on this Mac without cloud calls or third-party APIs.

## Recommendation

Approve `Qwen/Qwen3-4B-GGUF` as the first benchmark candidate behind `llama.cpp`.

Use the smaller Qwen GGUF path first because `llama.cpp` is already installed locally with Apple Silicon/Metal support, and a 4B-class model is the lowest-risk way to validate adapter shape, structured-output behavior, latency, memory, and thermal posture before trying larger DeepSeek or Kimi-style reasoning runs.

## Proposed Scope

| Item | Proposed value | Posture |
| --- | --- | --- |
| Runtime | `llama.cpp` via `llama-cli` or `llama-server` | Installed locally; benchmark only |
| First model | `Qwen/Qwen3-4B-GGUF` | Proposed first candidate |
| Alternate model | `deepseek-ai/DeepSeek-R1-Distill-Qwen-7B` | Defer until first benchmark passes |
| Cloud calls | None | Disallowed |
| Default app dependency | None | Disallowed |
| Env file | `.env.openclinxr.local` or explicit shell exports | Private; do not commit |
| Evidence output | `docs/openclinxr/local-provider-benchmark-YYYY-MM-DD.json` and a future real local-model benchmark report | Commit evidence only, not weights |

## Approved Local Execution Plan

| Item | Approved value |
| --- | --- |
| Runtime | `llama.cpp` via `llama-cli` |
| Model repo | `Qwen/Qwen3-4B-GGUF` |
| Model repo SHA checked before download | `bc640142c66e1fdd12af0bd68f40445458f3869b` |
| Quantized file | `Qwen3-4B-Q4_K_M.gguf` |
| Model card license | Apache-2.0 |
| Expected model file size | `2,497,280,256` bytes |
| Download/cache path | llama.cpp Hugging Face cache under the user's local cache |
| Private env file | `.env.openclinxr.local`, ignored by git |
| Uninstall/cache cleanup | Use `llama-cli --cache-list` to locate the cached model, then remove only the `Qwen/Qwen3-4B-GGUF` cache entry. |

## Pros

- Uses already installed local runtime tooling and avoids API spend.
- Provides real latency, memory, model-card, and structured-output evidence instead of mock-only readiness.
- Keeps model downloads opt-in and outside normal install, test, CI, and dev startup paths.
- Gives the agent factory a concrete local reasoning candidate for future unattended critique loops.

## Cons

- Downloads model weights onto the local machine and consumes disk space.
- A small local model may not represent production-grade clinical reasoning or dialogue quality.
- Model license, model-card limits, quantization choice, and cache path still need explicit operator acceptance.
- Any benchmark result is hardware-specific and should not be generalized to other machines without reruns.

## Approval Wording

Approve this proposal if Codex may download and benchmark `Qwen/Qwen3-4B-GGUF` locally through `llama.cpp`, set `OPENCLINXR_LOCAL_MODEL_RUNTIME`, `OPENCLINXR_LOCAL_MODEL_ID`, and `OPENCLINXR_LOCAL_MODEL_DOWNLOAD_APPROVED=true` only in a private local env context, and commit benchmark evidence without committing model weights.

## Acceptance Criteria

- Model source, license/model-card posture, quantization/file choice, disk footprint, and cache location are recorded before download.
- `pnpm local:runtime:probe` still passes after setup.
- `pnpm local:provider:benchmark -- --env-file .env.openclinxr.local --output docs/openclinxr/local-provider-benchmark-YYYY-MM-DD.json` records local model readiness without cloud calls.
- A real local model benchmark records prompt, model ID, runtime command, time to first token, tokens/sec, peak memory if available, structured-output behavior, and any thermal notes.
- Default `pnpm verify` does not require the model runtime or weights.

## Sources

- `docs/openclinxr/local-ai-voice-model-strategy.md`
- `.env.openclinxr.local.example`
- `tools/openclinxr/local-provider-benchmark.ts`
